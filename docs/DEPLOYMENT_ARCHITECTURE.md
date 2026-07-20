# FitClaw 部署架构与发布手册

最后更新：2026-07-20

本文是 FitClaw 当前生产部署的技术选型记录和操作手册。它回答三个问题：为什么这样部署、每次修改后如何发布、什么条件出现后才值得升级架构。

本文不保存 IP、App Secret、LLM API Key、SSH 私钥或用户标识。服务器 `.env` 是部署配置事实源；Compose 会把其中的凭据注入 Bot 环境，entrypoint 还会在 Bot 容器可写层生成 `auth.json`/`models.json`。因此 Docker/root 访问权限等同于凭据访问权限，不能把 `docker inspect` 完整输出或容器配置公开。Runner 不接收这些凭据。

## 1. 当前结论

FitClaw 当前采用：

```text
本地开发与验证
  -> 提交并推送到 GitHub
  -> 服务器检出确定的 Git commit SHA
  -> 在候选目录构建 Docker 镜像
  -> 停止写入并复制、校验 workspace
  -> 目录切换并重建两个容器
  -> 验证容器、日志、飞书和数据
  -> 保留旧目录和旧镜像 ID 供回滚
```

运行拓扑是单台云服务器、两个容器、一个 Dockerfile：

```text
                         outbound HTTPS / WebSocket
                    +--------------------------------> Feishu / LLM API
                    |
+-------------------+------------------+
| fitclaw-bot                          |
| credentials, network, workspace RW   |
+-------------------+------------------+
                    |
                    | mode 0600 Unix socket
                    v
+--------------------------------------+
| fitclaw-skill-runner                 |
| no network, no Bot credentials,      |
| read-only rootfs and workspace       |
+--------------------------------------+
                    |
                    v
       host ./feishu-workspace
       user data + sessions + Skills
```

2026-07-20 已验证的生产基线：

| 项目 | 当前事实 |
| --- | --- |
| 云资源 | 腾讯云轻量应用服务器实例，Ubuntu 24.04，2 vCPU、2 GB RAM、40 GB 磁盘 |
| 当前目录 | `/home/ubuntu/fitclaw` |
| 运行时版本 | `0525d5670c441249ca112fbf56bfe1fc20eb7d56`；这是运行代码 SHA，不是本文提交 SHA |
| 容器 | `fitclaw-bot`、`fitclaw-skill-runner` |
| 守护 | Docker 与 containerd 已启用；两个容器均为 `restart: unless-stopped` |
| Runner 健康 | Unix socket 健康检查已启用 |
| Bot 健康 | 无独立 healthcheck，必须结合日志和真实飞书 smoke 判断 |
| 数据 | 宿主机 bind mount；当次切换前后均为 2,706 个文件、338,620,885 字节 |
| 配置权限 | `.env` 为 `0600`；workspace 当前为 `0750`，容器用户当前 UID/GID 为 `999:999` |
| 回滚目录 | `/home/ubuntu/fitclaw-previous-20260720-100409` |

UID/GID `999:999` 只是当前镜像的实测值。Dockerfile 没有固定数字，新镜像应重新执行 `id` 获取，不能把 999 当成长期接口。

## 2. 第一性原理与约束

部署先满足以下事实，再选择工具：

1. **发布必须可追踪。** 服务器运行的代码必须能对应到一个确定 Git SHA，不能只说“main 最新版”。
2. **用户数据不能进入镜像。** 镜像可以替换，训练数据、会话和关系状态必须独立持久化。
3. **执行 Skill 脚本属于更低信任级别。** 它不应同时获得网络、Bot 凭据和用户数据写权限。
4. **失败必须可回退。** 新构建、复制或启动失败时，旧代码和旧 workspace 仍然存在。
5. **单机方案要控制运维成本。** 当前没有多节点调度、自动扩缩容和跨实例一致性需求，不为假设中的规模引入平台。
6. **升级必须由证据触发。** 构建耗时、并发写、可用性目标或多主机分发成为真实问题后，再增加 CI、镜像仓库、数据库或 Kubernetes。

当前目标是一个低成本、单机、文件持久化的飞书个人教练，不是多租户 SaaS。技术选型因此优先可理解、可审计和可回滚，而不是组件数量。

## 3. 基础概念

| 概念 | 在本项目中的含义 | 什么时候起作用 |
| --- | --- | --- |
| 云服务器实例 | 云厂商在物理机上分配的一台虚拟机。购买的是实例使用权，日常可以把它称为服务器 | 提供 Ubuntu、CPU、内存、磁盘和公网访问 |
| Git commit | 某一时刻源代码的不可变快照，由 SHA 标识 | 确定本次要部署哪一版代码 |
| Dockerfile | 构建镜像的配方 | `docker compose build` 时读取 |
| 镜像 | 只读运行模板，包含 Node、Python、Poppler、生产依赖、构建产物和 canonical Skills | 创建或重建容器时使用；修改 Git 代码不会自动改变旧镜像 |
| 容器 | 镜像的运行实例，带进程、网络、挂载和一层临时可写状态 | `docker compose up` 后运行 Bot 或 Runner |
| Docker Compose | 用 `docker-compose.yml` 声明两个服务及其依赖、权限、挂载和重启策略 | 构建、创建、停止、重建和查看两个容器 |
| bind mount | 把服务器真实目录挂进容器 | 让 `feishu-workspace` 脱离镜像持久化；Bot 可写、Runner 只读 |
| named volume | Docker 管理的数据目录 | 当前只保存两个容器通信的 Unix socket，不保存业务数据 |
| release | 一个确定 SHA、对应镜像和一份可运行配置的组合 | 通过目录切换成为当前生产版本 |

Docker 默认把镜像层、容器层和 named volume 放在 Docker data root，Ubuntu 常见值为 `/var/lib/docker`。用下面的命令确认实际位置，不要手工编辑其中的文件：

```bash
docker info --format '{{.DockerRootDir}}'
docker image ls
docker inspect --format '{{.Image}}' fitclaw-bot
```

镜像层按内容复用。当前两个 Compose 服务都使用 `build: .` 和同一个 Dockerfile，Compose 可能产生两个 service-scoped 镜像引用，但相同层不会简单复制两份。真正需要的是两个权限不同的容器，不是两套业务代码。

## 4. 技术选型总表

| 决策 | 当前选择 | 没选的方案 | 当前理由 | 升级触发条件 |
| --- | --- | --- | --- | --- |
| 版本化发布源 | GitHub + 精确 commit SHA | 本地压缩包、SCP 覆盖服务器 | 可审计、可对比、可复现应用和 canonical Skill 的源代码状态 | 不变；未来制品也必须关联 SHA |
| 构建位置 | 服务器从候选 checkout 构建 | 本地 Docker 推送、GitHub Actions + registry | 只有一台低成本主机，不需要管理镜像仓库和 CI 凭据 | 多主机、多环境、频繁发布、构建影响线上或要求制品签名 |
| 进程编排 | Docker Compose | 裸机、PM2、Kubernetes | 一份声明同时覆盖镜像、两个容器、网络、挂载、健康和重启 | 多节点调度、自愈、滚动发布或水平扩缩容成为真实需求 |
| Skill 执行 | 独立 Runner 容器 | 在 Bot 内直接执行 | 权限差异形成实际最小权限边界 | 不能因为“少一个容器”而合并；只可在等价隔离存在时替换 |
| 可变用户/会话状态 | host bind mount；以 JSON/JSONL 为主 | 全放镜像、Docker named volume、PostgreSQL | 便于直接备份、核对和目录回滚，当前单实例写入量小 | 多实例共享、并发写、复杂查询、事务或恢复目标无法满足 |
| 飞书接入 | SDK WebSocket 长连接 | 公网 HTTP webhook | 只需出站连接，不需要域名、证书、反向代理和入站应用端口 | 平台要求 webhook，或新增公开 Web/API |
| 进程恢复 | Docker restart policy | PM2 守护 | Compose 已管理容器，避免第二套进程状态源 | 仍需补应用 healthcheck、告警，而不是再叠 PM2 |
| 发布切换 | staging 目录 + 旧目录保留 | 在当前目录 `git pull` 后原地构建 | 构建时旧服务可继续运行，失败不污染当前 release | 发布频率和 SLA 要求自动蓝绿/滚动发布 |

### 4.1 为什么是 GitHub到服务器构建

本地电脑负责生成经过验证的源代码提交，GitHub 负责保存和分发这个提交，服务器负责生成适合自身架构的镜像。这条链路不要求启动本地 Docker。

这个 SHA 证明应用镜像和仓库中的 canonical Skills，不证明整个运行时状态。`feishu-workspace` 还可包含 workspace 独有 Skill、session-level Skill、用户数据和运行中生成的文件；发布记录必须另外保存 workspace/Skill manifest。

相比把本地目录直接传到服务器，它有三个优势：

- 服务器拿到的是已提交内容，不会混入本地忽略文件、临时文件或未提交修改。
- 用 `git checkout --detach <SHA>` 和 `git rev-parse --verify HEAD` 可以证明实际发布版本。
- Docker build context 由 `.dockerignore` 排除 `.env`、workspace、测试、文档和 Git 元数据，凭据与用户数据不会进入镜像。

代价也要如实记录：本次冷构建约 546 秒，2 GB 主机上构建会占用 CPU、内存和磁盘；`node:22-slim`、apt 包和 `npm install` 也没有完全固定，因此精确 Git SHA只保证源代码可追踪，不保证未来重建得到逐字节相同的镜像。

出现以下任一情况时，迁移到 GitHub Actions 构建、GHCR 保存按 digest 固定的镜像，服务器只执行 pull 和 recreate：

- 需要把同一个构建产物部署到两台以上主机或多个环境。
- 构建持续影响线上服务、频繁 OOM，或发布时间不可接受。
- 多人发布导致手工步骤成为主要故障来源。
- 需要 SBOM、签名、漏洞扫描或严格的制品保留与审计。

### 4.2 为什么是 Compose，不是 PM2 或 Kubernetes

PM2 是 Node.js 进程管理器，可以重启一个进程，但当前生产边界还包括 Python/Poppler 依赖、非 root 用户、Runner 无网络、只读 rootfs、只读 workspace、Unix socket、健康检查和两个不同权限的进程。PM2 不能直接表达这整套边界，当前仓库也没有可用的生产 PM2 配置。

Kubernetes 能提供多节点调度、服务发现、自愈、滚动发布和水平扩缩容，但当前只有一个节点、一个 Bot 实例和本地文件状态。在状态外置前，把同一应用放进 Kubernetes 不会自动获得高可用，反而增加控制面、网络、存储和排障成本。

Compose 官方文档也把“单台服务器运行 Compose”列为最简单的生产部署方式。这与当前规模一致，不代表 Compose 适合所有未来阶段。

### 4.3 为什么必须是两个容器

| 权限 | Bot | Skill Runner |
| --- | --- | --- |
| 飞书/LLM 凭据 | 有，只由 `.env` 注入 | 无，不配置 `env_file` |
| 网络 | 有，访问飞书和 LLM | `network_mode: none` |
| workspace | 可写 | 只读 |
| root filesystem | 容器用户可写允许的位置 | `read_only: true` |
| 临时目录 | 镜像默认 | 64 MiB `tmpfs`，`noexec,nosuid` |
| 进程用户 | 非 root `fitclaw` | 同一非 root用户 |
| 对方通信 | Unix socket client | mode `0600` Unix socket server |

Runner 执行来自 Skill 的 Python/Node 命令。若把它合并进 Bot，脚本一旦越权就同时获得外网、Bot Secret 和用户数据写权限。拆成两个容器后，即使脚本执行路径出现问题，影响面仍被网络、挂载和凭据边界限制。

这个边界不是虚拟机级安全隔离，仍依赖 Docker Engine、Linux namespace/capability 和宿主机安全。当前 Compose 也尚未显式配置 `cap_drop`、`no-new-privileges` 或资源上限；只有在完成兼容性验证后才应增加，而不是仅为配置项数量进行“加固”。

### 4.4 为什么 workspace 用 bind mount

`feishu-workspace` 同时保存会话、用户关系、以 JSON/JSONL 为主的 Skill data、附件、Bot 实际加载的 Skills，以及本地知识索引。`knowledge/books.sqlite` 已经使用 SQLite，但它不是用户状态数据库。workspace 必须在重建容器后继续存在，也必须能被管理员直接备份和核对。bind mount 正好满足这两个需求。

它的代价是依赖宿主机路径和 UID/GID，因此：

- 不能只备份镜像；必须备份 workspace。
- 目录切换前必须复制并核对文件数和总字节。
- 新镜像构建后必须重新确认 `fitclaw` 用户的 UID/GID。
- 多主机不能直接共享这份本地目录；那是数据库或共享存储的升级触发条件。

`skill-runner-socket` named volume 只承载临时 IPC。它可以重建，不进入业务备份。

### 4.5 回滚副本不是灾难备份

`/home/ubuntu/fitclaw-previous-*` 与当前 release 位于同一块 40 GB 系统盘，只能处理发布失败。它不能防磁盘损坏、实例误删、账号入侵或整机不可用。

在真实用户持续使用前，至少建立：

- workspace 的定期云硬盘快照或加密异地备份，并记录实际 RPO/RTO。
- 每次数据迁移前的额外快照。
- `.env`/平台凭据的独立安全恢复方式；不能把明文 `.env` 混入普通代码或公开备份。
- 定期恢复演练。只有“备份任务成功”而没有验证恢复，不能证明数据可恢复。

当前 release 目录副本继续用于快速回滚；off-host backup 用于灾难恢复，两者不能互相替代。

### 4.6 为什么不开放 80/443

飞书 SDK 通过服务器主动发起 WebSocket 长连接，没有 Compose `ports:`。因此当前应用不需要公网 HTTP 入口、域名、Nginx/Caddy 或 TLS 证书。安全组只需按管理需要限制 SSH，应用需要正常出站访问飞书和 LLM API。

只有增加 webhook、Web dashboard 或公开 API 时，才引入反向代理、TLS 和相应入站端口。

## 5. 守护、掉线重连与已知边界

“守护”有两层，它们解决不同故障：

1. **进程或主机层：** 两个容器的 `restart: unless-stopped` 会在进程异常退出、Docker daemon 或主机恢复后重新拉起。若管理员手工执行了 `docker compose stop`，它会保持停止。
2. **网络连接层：** 当前 Lark SDK 默认 `autoReconnect: true`，并在当前锁定版本中无限重试。Node 进程还活着但 WebSocket 断开时，由 SDK 重连。

当前仍不等于高可用：

- Runner 有 socket healthcheck；Bot 没有 liveness/readiness healthcheck。
- Runner 进入 `unhealthy` 本身不会触发 Docker restart policy；只有进程退出才会重启，当前 unhealthy 需要人工检查或重启。
- `docker compose ps` 中 Bot 为 `Up` 只证明 Node 进程存在，不证明飞书或 LLM 可用。
- WebSocket 断线期间没有消息补偿队列，重连不能补回所有错过的事件。
- `depends_on: condition: service_healthy` 只控制初始启动顺序；Runner 后续异常不会自动重启 Bot，命令会明确失败。
- Bot 收到 SIGTERM 后当前没有完整的在途请求 drain，发布应选择空闲窗口。
- 当前没有外部告警、日志轮转策略、CPU/内存限制或可用率统计。

因此每次发布必须做真实飞书 smoke；有持续可用性目标后，再补 Bot healthcheck、外部探测、指标和告警。

## 6. 修改后的验证门禁

不是所有改动都需要相同测试。按风险选择最窄的有效检查，再执行项目规定的发布检查。

| 改动类型 | 本地必须做 | 本地 Docker |
| --- | --- | --- |
| 仅文档 | 检查链接、命令和 scoped diff；`git diff --check` | 不需要 |
| TypeScript 行为 | 先跑对应测试文件；再跑 `npm run check`、`npm run test`、`npm run build` | 通常不需要 |
| 新增或修改测试 | 对应测试必须先通过，再跑项目级检查 | 通常不需要 |
| Dockerfile、Compose、entrypoint、系统依赖 | 代码检查 + `docker compose config --quiet` + 候选镜像构建 | 有条件时应本地验证；服务器候选构建仍是发布门禁 |
| 数据 Schema 或迁移 | 迁移单测 + 全部项目检查 + 真实数据 dry-run + 备份与回滚演练 | 用候选镜像跑 dry-run |

`docker compose config` 默认可能展开 `.env`。日常校验只用 `docker compose config --quiet`，不要把完整输出粘贴到日志、Issue 或聊天中。

单元测试不是形式步骤。它应保护本次变化的合同；例如迁移修改必须覆盖 dry-run、冲突、路径边界和原子写入。真实飞书 smoke 负责验证 SDK、凭据、WebSocket、模型和媒体链路，不能替代确定性单测；单测也不能证明真实平台可用。

## 7. 首次安装

### 7.1 前置条件

- Ubuntu 24.04 实例；当前 2 vCPU、2 GB、40 GB 已能运行，但冷构建较慢。
- Docker Engine 和 Compose plugin，Docker/containerd 设置为开机启动。
- 服务器可读取 GitHub 仓库。私有仓库优先使用只读 deploy key，不把个人私钥复制到项目目录。
- 飞书应用已启用长连接，具备所需事件与消息权限，并已发布可用版本。
- 安全组只向可信管理来源开放 SSH 22；应用不需要 80/443 入站。
- `.env` 中的飞书与模型配置已准备好，但不得提交 Git。
- 在接入真实用户前定义 workspace 快照/异地备份、RPO、RTO 和恢复演练责任人。

先确认系统状态：

```bash
docker version
docker compose version
sudo systemctl is-enabled docker
sudo systemctl is-active docker
free -h
df -h /
```

### 7.2 检出并构建

以下命令中的 SHA 必须替换为本地已经验证并推送的完整 40 位 SHA：

```bash
set -euo pipefail
umask 077

REPO_URL="git@github.com:Sanery1/FitClaw.git"
APP="/home/ubuntu/fitclaw"
RELEASE_SHA="<40-character-commit-sha>"

test ! -e "$APP"
git clone "$REPO_URL" "$APP"
git -C "$APP" checkout --detach "$RELEASE_SHA"
test "$(git -C "$APP" rev-parse --verify HEAD)" = "$RELEASE_SHA"

cd "$APP"
test ! -e .env
cp .env.example .env
chmod 600 .env
# 使用编辑器填入真实值；不要通过会记录命令历史的方式直接拼接 Secret。

docker compose config --quiet
docker compose build
```

### 7.3 初始化 workspace

Bot 从 `feishu-workspace/skills` 加载 Skill，而不是直接读取仓库 `.fitclaw/skills`。首次安装需要把 canonical Skills 放入 workspace：

```bash
set -euo pipefail

cd /home/ubuntu/fitclaw
test ! -e feishu-workspace
mkdir -p feishu-workspace/skills
cp -a .fitclaw/skills/. feishu-workspace/skills/

BOT_IMAGE_REF="$(docker compose config --images | grep -- '-fitclaw-bot$')"
BOT_IMAGE="$(docker image inspect --format '{{.Id}}' "$BOT_IMAGE_REF")"
APP_UID="$(docker run --rm --entrypoint id "$BOT_IMAGE" -u fitclaw)"
APP_GID="$(docker run --rm --entrypoint id "$BOT_IMAGE" -g fitclaw)"
sudo chown -R "$APP_UID:$APP_GID" feishu-workspace
sudo chmod 750 feishu-workspace
```

### 7.4 启动和验收

```bash
cd /home/ubuntu/fitclaw
docker compose up -d --force-recreate --no-build
docker compose ps
docker compose logs --since=5m fitclaw-skill-runner fitclaw-bot
git rev-parse --verify HEAD
```

验收标准：

- Runner 为 `healthy`，Bot 为运行状态。
- Bot 日志出现 WebSocket client started，且没有持续重连、权限或模型配置错误。
- 从真实飞书私聊发送一条最小 smoke 消息并收到回复。
- 涉及健身行为的首发再按 [飞书健身闭环手动 Smoke 脚本](./FEISHU_FITNESS_SMOKE_SCRIPT.md) 验证对应路径。

## 8. 日常发布流程

### 8.1 本地：形成唯一发布 SHA

```bash
git branch --show-current
git status --short

# 代码改动按第 6 节执行相应测试；代码发布最终需要：
npm run check
npm run test
npm run build

# 只 add 本次修改的明确文件，然后提交。
git add <changed-file-1> <changed-file-2>
git commit -m "<type>: <description>"
git push origin main
git fetch origin main
git rev-parse --verify HEAD
git rev-parse --verify origin/main
```

第一条命令必须输出 `main`；若在 feature branch，先按项目流程合并回 main。任何检查失败都必须停止，不能继续提交。推送后最后两个 SHA 必须完全相同，记录该完整 SHA。仅文档改动按文档门禁执行，不必为了发布文档运行应用构建，也不需要重启服务器容器。

### 8.2 服务器：预检和候选构建

不要在 `/home/ubuntu/fitclaw` 中直接 `git pull` 和构建。使用独立候选目录，让旧容器在构建期间继续服务。

第 8.2 至 8.7 节默认在同一个 SSH shell 中连续执行，后续命令依赖前面定义的变量和 `workspace_stats`。TAT 每次“执行命令”可能是新 shell；使用 TAT 时必须在每次操作前重新定义并核对变量，尤其不能在 `$APP`、`$STAGE` 或 `$BACKUP` 为空时执行复制、移动或删除。

```bash
set -euo pipefail
umask 077

HOME_ROOT="/home/ubuntu"
APP="$HOME_ROOT/fitclaw"
REPO_URL="git@github.com:Sanery1/FitClaw.git"
RELEASE_SHA="<40-character-commit-sha>"
SHORT_SHA="${RELEASE_SHA:0:12}"
RELEASE_ID="$(date +%Y%m%d-%H%M%S)-$SHORT_SHA"
STAGE="$HOME_ROOT/fitclaw-release-$RELEASE_ID"
BACKUP="$HOME_ROOT/fitclaw-previous-$RELEASE_ID"
CANDIDATE_PROJECT="fitclaw_candidate_$SHORT_SHA"
RELEASE_RECORD_DIR="$HOME_ROOT/fitclaw-release-records"
RELEASE_RECORD="$RELEASE_RECORD_DIR/$RELEASE_ID.env"

test "${#RELEASE_SHA}" -eq 40
test -d "$APP/.git"
test ! -e "$STAGE"
test ! -e "$BACKUP"
test ! -e "$RELEASE_RECORD"
test -z "$(git -C "$APP" status --porcelain --untracked-files=no)"
install -d -m 700 "$RELEASE_RECORD_DIR"
sudo systemctl is-active --quiet docker
docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" ps
free -h
df -h "$HOME_ROOT"

git clone "$REPO_URL" "$STAGE"
git -C "$STAGE" checkout --detach "$RELEASE_SHA"
test "$(git -C "$STAGE" rev-parse --verify HEAD)" = "$RELEASE_SHA"
cp --preserve=mode "$APP/.env" "$STAGE/.env"
chmod 600 "$STAGE/.env"

docker compose \
  --project-name "$CANDIDATE_PROJECT" \
  --project-directory "$STAGE" \
  --file "$STAGE/docker-compose.yml" \
  config --quiet
docker compose \
  --project-name "$CANDIDATE_PROJECT" \
  --project-directory "$STAGE" \
  --file "$STAGE/docker-compose.yml" \
  build

CANDIDATE_BOT_REF="${CANDIDATE_PROJECT}-fitclaw-bot"
CANDIDATE_RUNNER_REF="${CANDIDATE_PROJECT}-fitclaw-skill-runner"
NEW_BOT_IMAGE="$(docker image inspect --format '{{.Id}}' "$CANDIDATE_BOT_REF")"
NEW_RUNNER_IMAGE="$(docker image inspect --format '{{.Id}}' "$CANDIDATE_RUNNER_REF")"
test -n "$NEW_BOT_IMAGE"
test -n "$NEW_RUNNER_IMAGE"
NEW_UID="$(docker run --rm --entrypoint id "$NEW_BOT_IMAGE" -u fitclaw)"
NEW_GID="$(docker run --rm --entrypoint id "$NEW_BOT_IMAGE" -g fitclaw)"
```

候选 project name 避免构建时覆盖当前 `fitclaw-*` 镜像标签。两个变量指向同一个 image ID 也是正常情况。

### 8.3 保存旧镜像信息

目录回滚只能恢复代码、配置和 workspace；还必须保留旧容器使用的 image ID：

```bash
OLD_BOT_REF="$(docker inspect --format '{{.Config.Image}}' fitclaw-bot)"
OLD_BOT_IMAGE="$(docker inspect --format '{{.Image}}' fitclaw-bot)"
OLD_RUNNER_REF="$(docker inspect --format '{{.Config.Image}}' fitclaw-skill-runner)"
OLD_RUNNER_IMAGE="$(docker inspect --format '{{.Image}}' fitclaw-skill-runner)"
OLD_RELEASE_SHA="$(git -C "$APP" rev-parse --verify HEAD)"
OLD_UID="$(docker run --rm --entrypoint id "$OLD_BOT_IMAGE" -u fitclaw)"
OLD_GID="$(docker run --rm --entrypoint id "$OLD_BOT_IMAGE" -g fitclaw)"

printf '%s\n' \
  "OLD_BOT_REF=$OLD_BOT_REF" \
  "OLD_BOT_IMAGE=$OLD_BOT_IMAGE" \
  "OLD_RUNNER_REF=$OLD_RUNNER_REF" \
  "OLD_RUNNER_IMAGE=$OLD_RUNNER_IMAGE" \
  "OLD_UID=$OLD_UID" \
  "OLD_GID=$OLD_GID" \
  > "$APP/.rollback-images"
chmod 600 "$APP/.rollback-images"

{
  printf 'HOME_ROOT=%q\n' "$HOME_ROOT"
  printf 'APP=%q\n' "$APP"
  printf 'RELEASE_ID=%q\n' "$RELEASE_ID"
  printf 'RELEASE_SHA=%q\n' "$RELEASE_SHA"
  printf 'STAGE=%q\n' "$STAGE"
  printf 'BACKUP=%q\n' "$BACKUP"
  printf 'CANDIDATE_PROJECT=%q\n' "$CANDIDATE_PROJECT"
  printf 'RELEASE_RECORD_DIR=%q\n' "$RELEASE_RECORD_DIR"
  printf 'NEW_BOT_IMAGE=%q\n' "$NEW_BOT_IMAGE"
  printf 'NEW_RUNNER_IMAGE=%q\n' "$NEW_RUNNER_IMAGE"
  printf 'NEW_UID=%q\n' "$NEW_UID"
  printf 'NEW_GID=%q\n' "$NEW_GID"
  printf 'OLD_BOT_REF=%q\n' "$OLD_BOT_REF"
  printf 'OLD_BOT_IMAGE=%q\n' "$OLD_BOT_IMAGE"
  printf 'OLD_RUNNER_REF=%q\n' "$OLD_RUNNER_REF"
  printf 'OLD_RUNNER_IMAGE=%q\n' "$OLD_RUNNER_IMAGE"
  printf 'OLD_RELEASE_SHA=%q\n' "$OLD_RELEASE_SHA"
  printf 'OLD_UID=%q\n' "$OLD_UID"
  printf 'OLD_GID=%q\n' "$OLD_GID"
  printf 'STATUS=%q\n' prepared
} > "$RELEASE_RECORD"
chmod 600 "$RELEASE_RECORD"
```

release record 不含 Secret，用于保存 SHA、目录和 image ID，并让 SSH/TAT 断线后可安全恢复变量。它仍在同一系统盘，不替代异地备份。不要在回滚窗口结束前执行 `docker system prune`。

### 8.4 停写、复制和核对 workspace

先停 Bot，阻止新的会话和数据写入。Runner 的 workspace 是只读，但切换前仍要停止它。当前 Bot 没有完整 drain，选择空闲窗口并先观察日志中没有正在处理的请求。

```bash
workspace_stats() {
  local dir="$1"
  local files bytes
  files="$(sudo find "$dir" -type f -printf '.' | wc -c)"
  bytes="$(sudo find "$dir" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
  printf '%s %s\n' "$files" "$bytes"
}

workspace_manifest() {
  local dir="$1"
  local output="$2"
  sudo bash -euo pipefail -c '
    cd "$1"
    find . -type f -print0 | sort -z | xargs -0 -r sha256sum
    find . -printf "metadata %y %m %U %G %p -> %l\n" | sort
  ' _ "$dir" > "$output"
  chmod 600 "$output"
}

docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" stop fitclaw-bot

SOURCE_STATS="$(workspace_stats "$APP/feishu-workspace")"
SOURCE_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-source.sha256"
TARGET_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-copy.sha256"
workspace_manifest "$APP/feishu-workspace" "$SOURCE_MANIFEST"
test ! -e "$STAGE/feishu-workspace"
sudo cp -a -- "$APP/feishu-workspace" "$STAGE/feishu-workspace"
TARGET_STATS="$(workspace_stats "$STAGE/feishu-workspace")"
workspace_manifest "$STAGE/feishu-workspace" "$TARGET_MANIFEST"
printf 'source=%s target=%s\n' "$SOURCE_STATS" "$TARGET_STATS"
test "$SOURCE_STATS" = "$TARGET_STATS"
cmp --silent "$SOURCE_MANIFEST" "$TARGET_MANIFEST"

{
  printf 'SOURCE_STATS=%q\n' "$SOURCE_STATS"
  printf 'SOURCE_MANIFEST=%q\n' "$SOURCE_MANIFEST"
  printf 'TARGET_MANIFEST=%q\n' "$TARGET_MANIFEST"
} >> "$RELEASE_RECORD"
```

如果复制或校验失败，当前目录尚未切换，直接重新启动旧 Bot：

```bash
docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" start fitclaw-bot
```

### 8.5 同步 canonical Skills

旧 workspace 中的 Skill 不会因为新镜像构建而自动更新。必须把新 SHA 中的 `.fitclaw/skills` 同步到候选 workspace。只替换仓库中同名的 canonical Skill，不默认删除 workspace 独有 Skill：

```bash
workspace_manifest() {
  local dir="$1"
  local output="$2"
  sudo bash -euo pipefail -c '
    cd "$1"
    find . -type f -print0 | sort -z | xargs -0 -r sha256sum
    find . -printf "metadata %y %m %U %G %p -> %l\n" | sort
  ' _ "$dir" > "$output"
  chmod 600 "$output"
}

sudo mkdir -p "$STAGE/feishu-workspace/skills"

for source in "$STAGE"/.fitclaw/skills/*; do
  test -f "$source/SKILL.md" || continue
  skill_name="${source##*/}"
  target="$STAGE/feishu-workspace/skills/$skill_name"
  old_canonical="$APP/.fitclaw/skills/$skill_name/SKILL.md"
  if test -e "$target" && test ! -f "$old_canonical"; then
    echo "New canonical Skill collides with workspace-only Skill: $skill_name" >&2
    echo "Rename or explicitly archive the workspace Skill before continuing." >&2
    exit 1
  fi
  sudo rm -rf -- "$target"
  sudo cp -a -- "$source" "$target"
done

sudo chown -R "$NEW_UID:$NEW_GID" "$STAGE/feishu-workspace"
sudo chmod 750 "$STAGE/feishu-workspace"

RUNTIME_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-runtime.sha256"
workspace_manifest "$STAGE/feishu-workspace" "$RUNTIME_MANIFEST"
{
  printf 'RUNTIME_MANIFEST=%q\n' "$RUNTIME_MANIFEST"
  printf 'CUTOVER_MANIFEST=%q\n' "$RUNTIME_MANIFEST"
} >> "$RELEASE_RECORD"
```

删除只发生在尚未运行的 `$STAGE/feishu-workspace/skills/<canonical-name>`。不得把该循环改成对整个 workspace 执行删除或 `--delete`。

如果本次提交删除或重命名了 canonical Skill，上述默认同步会保留旧副本，它仍可能被热加载。此时必须把经过审核的旧 Skill 从候选 workspace 移到 release 根目录的 `retired-skills/`，再重新生成 `RUNTIME_MANIFEST`；不能自动 prune workspace 独有 Skill。发布记录中的 runtime manifest 才代表本次完整 Skill inventory，Git SHA 单独不能代表它。

新增 canonical Skill 如果与旧 workspace 独有 Skill 同名，脚本会 fail closed。必须先决定保留哪一方并把另一方显式改名或归档，不能取消检查后覆盖。

### 8.6 切换目录并启动

```bash
docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" stop fitclaw-skill-runner

# named volume 会跨 release 保留；重置临时 socket 并按新镜像 UID/GID 改权。
SOCKET_VOLUME="fitclaw_skill-runner-socket"
docker volume inspect "$SOCKET_VOLUME" > /dev/null
docker run --rm --user 0:0 --entrypoint rm \
  --volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
  "$NEW_RUNNER_IMAGE" -f /run/fitclaw-skill-runner/runner.sock
docker run --rm --user 0:0 --entrypoint chown \
  --volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
  "$NEW_RUNNER_IMAGE" -R "$NEW_UID:$NEW_GID" /run/fitclaw-skill-runner

cd "$HOME_ROOT"
mv "$APP" "$BACKUP"
mv "$STAGE" "$APP"

# 把候选 image ID 绑定到当前 Compose 使用的稳定 service image 名称。
docker tag "$NEW_BOT_IMAGE" "$OLD_BOT_REF"
docker tag "$NEW_RUNNER_IMAGE" "$OLD_RUNNER_REF"

docker compose \
  --project-name fitclaw \
  --project-directory "$APP" \
  --file "$APP/docker-compose.yml" \
  up -d --force-recreate --no-build
```

若后续修改 Compose 的 `image:` 或 service 名称，先用 `docker compose config --images` 核对稳定引用，不能盲目沿用旧标签命令。

恢复规则按目录切换状态划分：

- 执行第一个 `mv "$APP" "$BACKUP"` 前发生任何失败，当前 release 仍完整。若 Bot 已停止，先把 socket volume 恢复为 `$OLD_UID:$OLD_GID`，再启动旧 Runner 和 Bot。
- 第一个目录 `mv` 开始后发生任何失败，不再继续试命令，立即按第 10 节读取 release record 做自包含回滚。
- 如果 SSH/TAT 断开，先用 `docker ps -a` 和三个目录的实际存在状态判断所处阶段，不能从中间盲目重贴整段。

### 8.7 发布验证

```bash
test "$(git -C "$APP" rev-parse --verify HEAD)" = "$RELEASE_SHA"
test "$(docker inspect --format '{{.Image}}' fitclaw-bot)" = "$NEW_BOT_IMAGE"
test "$(docker inspect --format '{{.Image}}' fitclaw-skill-runner)" = "$NEW_RUNNER_IMAGE"

docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" ps
docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" logs --since=5m fitclaw-skill-runner fitclaw-bot
sudo find "$APP/feishu-workspace" -type f -printf '.' | wc -c
sudo find "$APP/feishu-workspace" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }'

{
  printf 'DEPLOYED_AT=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'STATUS=%q\n' containers_started
} >> "$RELEASE_RECORD"
```

然后完成：

1. Runner `healthy`，Bot 运行，无重启循环。
2. 日志显示 WebSocket 启动，无持续权限、socket、模型或飞书错误。
3. 真实飞书最小消息能够收到回复。
4. 涉及 Skill、数据、媒体或教练策略的改动执行对应 smoke。
5. 抽查关键用户目录和 JSON/JSONL 可读，不能只看总文件数。
6. 记录 release SHA、两个 image ID、workspace 统计、验证结果和 backup 路径。

全部人工验收完成后，才把 release record 标记为 verified：

```bash
{
  printf 'VERIFIED_AT=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'VERIFIED_BY=%q\n' "${USER:-unknown}"
  printf 'STATUS=%q\n' verified
} >> "$RELEASE_RECORD"
```

至少保留一个已验证旧 release。新版本稳定并超过约定回滚窗口后，才人工删除更老备份和无引用镜像。

## 9. 涉及历史数据迁移的发布

数据迁移不是普通发布中的默认步骤。当前迁移工具默认 dry-run，源数据只复制、合并或归档，不删除源文件；apply 对每个目标文件使用原子替换，但整个多文件迁移不是一个数据库事务。这也是迁移只能作用于候选 workspace、不能直接修改 production workspace 的原因。

额外门禁：

1. 身份映射由管理员逐条核对，群聊个人数据必须显式确认。
2. 完成第 8.2、8.3 节，使用候选镜像对当前 production workspace 做只读 preliminary dry-run。
3. 审查所有 operation、warning、destination 和冲突策略。
4. 受影响用户已按产品流程亲自回复 `开始`，并由操作人明确批准 apply。
5. preliminary dry-run 批准后，按第 8.4、8.5 节停 Bot、复制/校验一致快照并同步 canonical Skills，再对候选 workspace 做 final dry-run。
6. 只对候选 workspace apply；当前 production workspace 保持原样直到目录切换。
7. apply 后校验报告、JSON/JSONL、用户隔离和统计，再执行第 8.6 节切换。

推荐用候选镜像执行，不在服务器安装第二套 Node 依赖。先把 mapping 放在受限目录，并让候选镜像的非 root 用户可读：

```bash
MIGRATION_DIR="/home/ubuntu/fitclaw-migration-$RELEASE_ID"
MAPPING_SOURCE="/home/ubuntu/<reviewed-private-mapping.json>"
MAPPING="$MIGRATION_DIR/mapping.json"
PRELIM_DRY_REPORT="$MIGRATION_DIR/preliminary-dry-run.json"
FINAL_DRY_REPORT="$MIGRATION_DIR/final-dry-run.json"
APPLY_REPORT="$MIGRATION_DIR/apply.json"

test ! -e "$MIGRATION_DIR"
test -f "$MAPPING_SOURCE"
sudo install -d -o ubuntu -g "$NEW_GID" -m 750 "$MIGRATION_DIR"
sudo install -o ubuntu -g "$NEW_GID" -m 644 "$MAPPING_SOURCE" "$MAPPING"

docker run --rm \
  --user "$OLD_UID:$OLD_GID" \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$APP/feishu-workspace,dst=/workspace,readonly" \
  --mount "type=bind,src=$MAPPING,dst=/mapping.json,readonly" \
  --entrypoint node \
  "$NEW_BOT_IMAGE" \
  /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/main.js \
  migrate-memory /workspace --mapping /mapping.json \
  > "$PRELIM_DRY_REPORT"
```

preliminary report 在 Bot 仍在线时生成，只用于提前发现映射、冲突和权限问题，不能作为 apply 的最终事实。批准后执行第 8.4、8.5 节；此时 `$STAGE/feishu-workspace` 是停写后复制、完成内容哈希校验并同步新 canonical Skills 的候选快照。

对该快照重新 dry-run，使用不同文件保存 final report：

```bash
docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$STAGE/feishu-workspace,dst=/workspace,readonly" \
  --mount "type=bind,src=$MAPPING,dst=/mapping.json,readonly" \
  --entrypoint node \
  "$NEW_BOT_IMAGE" \
  /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/main.js \
  migrate-memory /workspace --mapping /mapping.json \
  > "$FINAL_DRY_REPORT"
```

逐项比较两份报告的 `type`、相对 source/destination、`action`、`itemCount`、`hash` 和 warnings。`startedAt`、workspace 绝对路径等运行元数据不用于比较；若计划变化，必须解释变化并重新批准，不能覆盖或删除 preliminary report。final report 是 apply 的唯一依据。

确认 final report 后，对同一候选快照 apply：

```bash
docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$STAGE/feishu-workspace,dst=/workspace" \
  --mount "type=bind,src=$MAPPING,dst=/mapping.json,readonly" \
  --entrypoint node \
  "$NEW_BOT_IMAGE" \
  /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/main.js \
  migrate-memory /workspace --mapping /mapping.json --apply \
  > "$APPLY_REPORT"
```

先核对 apply report 的 operations、warnings、itemCount 和 hash 与 final dry-run 一致，且没有新增未解释结果。通过后才生成 migrated cutover manifest：

```bash
MIGRATED_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-migrated.sha256"
sudo bash -euo pipefail -c '
  cd "$1"
  find . -type f -print0 | sort -z | xargs -0 -r sha256sum
  find . -printf "metadata %y %m %U %G %p -> %l\n" | sort
' _ "$STAGE/feishu-workspace" > "$MIGRATED_MANIFEST"
chmod 600 "$MIGRATED_MANIFEST"
{
  printf 'MIGRATED_MANIFEST=%q\n' "$MIGRATED_MANIFEST"
  printf 'CUTOVER_MANIFEST=%q\n' "$MIGRATED_MANIFEST"
} >> "$RELEASE_RECORD"
```

只有 dry-run 报告出现真实数据冲突并完成业务取舍时，才附加 `--conflict legacy` 或 `--conflict destination`；不能把某个策略写成所有发布的默认值。

2026-07-20 当前迁移状态：已对 2 个映射会话完成 dry-run，计划 7 个 `copy` 操作（1 个 session、5 个 sport-data、1 个 group archive），有 3 条来自 `fitness-data.json` 与 canonical 数据重复的预期 warning；尚未执行 apply，也没有写入迁移数据。

完整映射格式、群聊归档规则和邀请命令见 [Coach Bot 中文说明](../apps/coach-bot/README.zh-CN.md#记忆迁移)。

## 10. 回滚与数据连续性

以下任一情况立即停止新版本，不在生产目录边改边试：容器重启循环、Runner 不健康、飞书无法回复、权限错误、数据统计异常、迁移结果与 dry-run 不一致。

回滚代码与回滚数据是两件事。新版本启动后可能已经写入会话或训练数据，直接恢复 `$BACKUP` 中的旧 workspace 会让这些增量在用户侧不可见，虽然它们仍保存在失败目录。必须先冻结写入，再按发布类型选择下面两条路径。

### 10.1 自包含的公共准备

回滚可能发生在新 SSH/TAT shell 中。先选择第 8.3 节生成的准确 release record，不能凭记忆拼目录：

```bash
set -euo pipefail
umask 077

RELEASE_RECORD="/home/ubuntu/fitclaw-release-records/<release-id>.env"
test -f "$RELEASE_RECORD"
. "$RELEASE_RECORD"

FAILED="$HOME_ROOT/fitclaw-failed-$RELEASE_ID"
test "$HOME_ROOT" = "/home/ubuntu"
test "$APP" = "/home/ubuntu/fitclaw"
test -d "$BACKUP/.git"
test "$(git -C "$BACKUP" rev-parse --verify HEAD)" = "$OLD_RELEASE_SHA"
test -f "$BACKUP/.rollback-images"
test ! -e "$FAILED"

if test -d "$APP/.git" && test ! -e "$STAGE"; then
  test "$(git -C "$APP" rev-parse --verify HEAD)" = "$RELEASE_SHA"
  ROLLBACK_STATE="normal"
elif test ! -e "$APP" && test -d "$STAGE/.git"; then
  test "$(git -C "$STAGE" rev-parse --verify HEAD)" = "$RELEASE_SHA"
  ROLLBACK_STATE="partial_cutover"
else
  echo "Unexpected release directory state; do not move anything manually." >&2
  exit 1
fi

for container in fitclaw-bot fitclaw-skill-runner; do
  if docker inspect "$container" > /dev/null 2>&1; then
    docker stop "$container" > /dev/null 2>&1 || true
    test "$(docker inspect --format '{{.State.Running}}' "$container")" = "false"
  fi
done

cd "$HOME_ROOT"

if test "$ROLLBACK_STATE" = "normal"; then
  # 正常情况：候选已成为 APP。
  mv "$APP" "$FAILED"
else
  # partial cutover：旧 APP 已移到 BACKUP，但候选尚未成为 APP。
  mv "$STAGE" "$FAILED"
fi

mv "$BACKUP" "$APP"

. "$APP/.rollback-images"
docker tag "$OLD_BOT_IMAGE" "$OLD_BOT_REF"
docker tag "$OLD_RUNNER_IMAGE" "$OLD_RUNNER_REF"

# 8.6 可能已把持久 socket volume 改成新 UID；回滚时必须对称恢复。
SOCKET_VOLUME="fitclaw_skill-runner-socket"
docker volume inspect "$SOCKET_VOLUME" > /dev/null
docker run --rm --user 0:0 --entrypoint rm \
  --volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
  "$OLD_RUNNER_IMAGE" -f /run/fitclaw-skill-runner/runner.sock
docker run --rm --user 0:0 --entrypoint chown \
  --volume "$SOCKET_VOLUME:/run/fitclaw-skill-runner" \
  "$OLD_RUNNER_IMAGE" -R "$OLD_UID:$OLD_GID" /run/fitclaw-skill-runner
```

此时旧代码和旧 workspace 已恢复，但 Bot 尚未启动。接下来必须只选 10.2 或 10.3 其中一条。

### 10.2 普通代码回滚：保留最新可变数据

只有本次发布没有执行数据迁移、没有改变存储合同，且旧代码能读取新写入时，才使用此路径。它把失败 release 的最新 workspace 复制给旧代码，只按新旧仓库的 canonical Skill 名单定向恢复，保留 workspace 独有 Skill：

```bash
OLD_WORKSPACE_SNAPSHOT="$APP/feishu-workspace-before-code-rollback-$RELEASE_ID"
FAILED_SKILLS="$APP/skills-from-failed-$RELEASE_ID"
test -d "$APP/feishu-workspace/skills"
test -d "$FAILED/feishu-workspace/skills"
test ! -e "$OLD_WORKSPACE_SNAPSHOT"
test ! -e "$FAILED_SKILLS"

sudo mv "$APP/feishu-workspace" "$OLD_WORKSPACE_SNAPSHOT"
sudo cp -a -- "$FAILED/feishu-workspace" "$APP/feishu-workspace"
sudo mkdir -p "$FAILED_SKILLS"

# 先移出失败 release 声明的 canonical Skills；workspace 独有 Skill 不动。
for source in "$FAILED"/.fitclaw/skills/*; do
  test -f "$source/SKILL.md" || continue
  skill_name="${source##*/}"
  target="$APP/feishu-workspace/skills/$skill_name"
  if test -e "$target"; then
    sudo mv "$target" "$FAILED_SKILLS/$skill_name"
  fi
done

# 再恢复旧 release 的 canonical Skills，优先使用旧 runtime 快照。
for source in "$APP"/.fitclaw/skills/*; do
  test -f "$source/SKILL.md" || continue
  skill_name="${source##*/}"
  runtime_source="$OLD_WORKSPACE_SNAPSHOT/skills/$skill_name"
  target="$APP/feishu-workspace/skills/$skill_name"
  if test -e "$target"; then
    test ! -e "$FAILED_SKILLS/$skill_name"
    sudo mv "$target" "$FAILED_SKILLS/$skill_name"
  fi
  if test -d "$runtime_source"; then
    sudo cp -a -- "$runtime_source" "$target"
  else
    sudo cp -a -- "$source" "$target"
  fi
done

sudo chown -R "$OLD_UID:$OLD_GID" "$APP/feishu-workspace"
sudo chmod 750 "$APP/feishu-workspace"
```

`$FAILED` 仍保留一份完整新 workspace；旧 workspace 快照和被替换的新 canonical Skills 也被保留，不会静默删除数据。workspace 独有 Skill 和 session-level Skill 属于可变状态，会随最新数据保留；因此只有格式兼容的代码回滚才能使用此路径。

### 10.3 数据迁移回滚：恢复旧快照并对账增量

执行过 migration、Schema 或不兼容存储变更时，不把新 workspace 直接交给旧代码。保持 10.1 恢复的旧 workspace，并比较 `$FAILED/feishu-workspace` 与 release record 中的 cutover manifest，确认切换后是否发生写入。

当前没有通用 down migration 或自动增量合并器。若存在新写入：

1. 新数据继续保存在 `$FAILED`，不得删除或覆盖。
2. 按 namespace、session JSONL 和关系状态逐项审计，制定显式回迁或人工合并方案。
3. 在完成取舍前保持受影响用户写入冻结；若先恢复旧 Bot，必须明确记录这段时间的 RPO 和待补数据。

迁移发布应使用维护窗口或飞书应用可用范围限制非测试用户写入。否则真实 smoke 与用户消息可能在 cutover 后产生增量，目录回滚无法自动做到零数据回退。

用下面的只读清单判断 cutover 后 workspace 是否变化；不同只表示“发生了变化”，不代表可以盲目覆盖：

```bash
FAILED_MANIFEST="$RELEASE_RECORD_DIR/$RELEASE_ID-workspace-failed.sha256"
sudo bash -euo pipefail -c '
  cd "$1"
  find . -type f -print0 | sort -z | xargs -0 -r sha256sum
  find . -printf "metadata %y %m %U %G %p -> %l\n" | sort
' _ "$FAILED/feishu-workspace" > "$FAILED_MANIFEST"
chmod 600 "$FAILED_MANIFEST"

if cmp --silent "$CUTOVER_MANIFEST" "$FAILED_MANIFEST"; then
  echo "No workspace changes detected after cutover."
else
  echo "Workspace changed after cutover; preserve FAILED and reconcile before discarding data."
fi
```

### 10.4 启动旧版本

完成 10.2 或 10.3 的数据选择后再启动：

```bash
docker compose \
  --project-name fitclaw \
  --project-directory "$APP" \
  --file "$APP/docker-compose.yml" \
  up -d --force-recreate --no-build

docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" ps
docker compose --project-name fitclaw --project-directory "$APP" --file "$APP/docker-compose.yml" logs --since=5m
git -C "$APP" rev-parse --verify HEAD

{
  printf 'ROLLED_BACK_AT=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'FAILED=%q\n' "$FAILED"
  printf 'STATUS=%q\n' rolled_back
} >> "$RELEASE_RECORD"
```

回滚后同样要做真实飞书最小 smoke 和数据抽查。保留 `$FAILED`、旧 workspace 快照和 release record 供对账与排障，不立即删除失败现场。

## 11. 日常运维与访问

首选 SSH key 登录，不使用项目中的飞书或 LLM 密钥作为系统账号密码。Ubuntu 镜像当前管理账号是 `ubuntu`；SSH 私钥只保存在管理员设备。

本地 `~/.ssh/config` 示例：

```sshconfig
Host fitclaw-prod
  HostName <server-public-ip>
  User ubuntu
  IdentityFile ~/.ssh/<fitclaw-private-key>
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

随后可执行 `ssh fitclaw-prod`，或在 VS Code Remote - SSH 中连接 `fitclaw-prod`。

当前公网 SSH 曾在 banner exchange 阶段超时。腾讯云 TAT“执行命令”可作为控制台应急通道，用于检查 `sshd`、安全组和容器状态；它不是日常发布首选，也不要在会被平台记录的命令中直接写 Secret。

在启用第 8 节作为日常流程前，必须先修复并验证稳定的 SSH/VS Code Remote - SSH。若只能使用有超时和新 shell 限制的 TAT，应先把本手册步骤实现为经过审查、可重入且保存 release record 的部署脚本，不能依赖临时变量连续手工执行长时间构建与切换。

常用只读检查：

```bash
cd /home/ubuntu/fitclaw
docker compose ps
docker compose logs --tail=200 fitclaw-bot
docker compose logs --tail=200 fitclaw-skill-runner
docker inspect --format '{{.Image}} {{.State.Status}} {{.RestartCount}}' fitclaw-bot
docker inspect --format '{{.Image}} {{.State.Status}} {{.RestartCount}}' fitclaw-skill-runner
git rev-parse --verify HEAD
df -h /
free -h
```

修改 `.env` 只需要 recreate 容器，不需要重新构建代码镜像：

```bash
chmod 600 .env
docker compose config --quiet
docker compose up -d --force-recreate --no-build
```

`docker compose restart` 只重启现有容器，不会读取新代码、生成新镜像或可靠应用所有 Compose 配置变化，因此不作为发布命令。

## 12. 已知限制和升级顺序

| 已知限制 | 现在为什么接受 | 达到什么证据后升级 | 优先方案 |
| --- | --- | --- | --- |
| 冷构建约 546 秒，和线上争用 2 GB 内存 | 发布频率低、单主机 | OOM、明显影响回复、频繁发布 | CI 构建 + GHCR digest |
| 基础镜像和 apt 包未按 digest/版本完全锁定 | 当前先保证源代码可追踪 | 合规、供应链或严格复现要求 | pin digest、`npm ci`、SBOM、签名 |
| Bot 无 healthcheck/告警 | 目前人工 smoke 可承担 | 明确可用率或响应时限 | liveness、外部探测、指标、告警、日志轮转 |
| 尚未验证 off-host backup/restore | 目前仍是小范围原型 | 接入持续真实用户前即必须处理 | 云盘快照或加密异地备份 + 定期恢复演练 |
| workspace 与 release 同目录，版本化与运行时 Skills 混合 | 目录回滚直观，manifest 可补审计 | Skill 删除/改名频繁、复制窗口或可追踪性不满足 | 将 canonical Skills 与可变用户/自定义 Skills 分层挂载 |
| 用户/会话状态以 JSON/JSONL 单机存储 | 当前单实例、低并发、便于审计；知识索引已单独使用 SQLite | 单机复杂查询，或多实例/并发写/恢复目标 | 先定义稳定存储接口；单机查询评估 SQLite，多实例写入评估 PostgreSQL |
| 附件和媒体占用同一块 40 GB 磁盘，无 retention | 当前数据量尚小 | 磁盘水位、备份时间或恢复时间超过目标 | 先做容量监控和保留策略，再评估对象存储 |
| 单 Bot 实例，无消息补偿 | 当前个人原型 | 有明确 SLA、多副本或断线补偿需求 | 外置状态、队列、幂等，再评估编排平台 |
| 无 CPU/内存限制 | 当前资源简单且需先观测 | 构建或脚本挤压 Bot | 先测量，再设置 Compose resource limits |
| 单节点 Compose | 当前不需要集群能力 | 多节点、自动调度、滚动发布和故障转移 | 状态外置后再评估 Kubernetes |

合理演进顺序是：先补可观测性与备份恢复指标，再外置共享状态和构建制品，最后才讨论多副本和 Kubernetes。反过来先上编排平台，不会自动解决本地文件一致性、消息幂等或健康定义。

## 13. 操作员清单

### 普通代码发布

- [ ] 本地针对性测试通过。
- [ ] `npm run check`、`npm run test`、`npm run build` 通过。
- [ ] 只提交本次文件并推送 `origin/main`。
- [ ] 记录完整 Git SHA。
- [ ] 服务器磁盘、内存、Docker 和当前容器正常。
- [ ] 候选目录检出并验证精确 SHA。
- [ ] 候选 project 完成镜像构建，旧服务仍在线。
- [ ] release record 已保存旧/新 image、UID/GID、目录和 SHA。
- [ ] 空闲窗口停 Bot，复制 workspace，统计和内容 manifest 一致。
- [ ] canonical Skills 同步到候选 workspace。
- [ ] runtime Skill inventory/hash 已记录；删除/改名经过显式处理。
- [ ] 停 Runner，目录交换，候选镜像重新标记并 recreate。
- [ ] SHA、image ID、Runner health、日志、workspace 和飞书 smoke 通过。
- [ ] 人工验收后才把 release record 标记为 verified。
- [ ] 记录 backup 路径并保留回滚镜像；明确代码/数据回滚路径。

### 数据迁移发布

- [ ] 完成普通发布中切换前的全部步骤。
- [ ] 身份映射逐条审核，用户同意证据完整。
- [ ] 迁移前 off-host snapshot 已完成并可识别。
- [ ] 候选镜像只读 dry-run，无未解释 warning。
- [ ] 停 Bot 后复制快照并再次 dry-run。
- [ ] 冲突策略逐项决定，不使用隐含默认。
- [ ] 只对候选 workspace apply。
- [ ] 报告、哈希、目标文件、用户隔离和数据可读性通过。
- [ ] 切换、真实飞书 smoke 和回滚材料通过。

### 仅文档发布

- [ ] 链接、命令、路径和事实已核对。
- [ ] `git diff --check` 通过。
- [ ] 提交并推送文档。
- [ ] 不重建镜像，不重启运行中的 Bot。

## 14. 参考依据

以下资料用于约束技术判断；“当前采用或不采用”仍是结合 FitClaw 现状得出的项目决策，不是资料本身的通用结论。

- [Docker Compose 功能与用途](https://docs.docker.com/compose/intro/features-uses/)
- [Docker Compose 生产环境](https://docs.docker.com/compose/how-tos/production/)
- [Docker restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- [Compose services 规范](https://docs.docker.com/reference/compose-file/services/)
- [Docker Engine 安全](https://docs.docker.com/engine/security/)
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Docker 构建最佳实践：固定基础镜像](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)
- [Docker registry 概念](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-registry/)
- [Git detached checkout](https://git-scm.com/docs/git-checkout)
- [Git rev-parse](https://git-scm.com/docs/git-rev-parse)
- [GitHub Actions](https://docs.github.com/en/actions/about-github-actions/understanding-github-actions)
- [Kubernetes 概览](https://kubernetes.io/docs/concepts/overview/)
- [SQLite 适用场景](https://www.sqlite.org/whentouse.html)
- [PM2 Quick Start](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Gitea Docker Compose 安装](https://docs.gitea.com/installation/install-with-docker)
- [Sentry self-hosted](https://github.com/getsentry/self-hosted)
