---
title: "FitClaw 教练人格功能单机发布与故障复盘"
created_at: "2026-07-20"
discussion_period: "2026-07-20"
location: "在线"
source: "当前对话与本次实际命令输出"
scope: "教练人格功能从本地验证、GitHub 发布、腾讯云单机部署到真实飞书验收的完整过程"
article_type: "故障复盘"
status: "draft"
tags: ["FitClaw", "Docker Compose", "GitHub", "飞书", "发布状态机", "故障恢复"]
audience: "FitClaw 维护者和后续发布操作员"
---

# FitClaw 教练人格功能单机发布与故障复盘

## 结论

教练人格功能最终以提交 `d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb` 发布到生产服务器，并在真实飞书私聊中完成卡片、选择持久化和模型回复验证。发布记录于 `2026-07-20T14:52:36Z` 标记为 `verified`。

发布期间遇到两个相互独立的问题：服务器到 GitHub 的 HTTPS 链路连续超时，以及部署脚本无法对容器 UID/GID 持有的 workspace 目录执行 `sync -f`。前者通过**已推送 SHA + 可验证 Git bundle**完成一次性传输降级；后者触发脚本自动恢复旧 Bot，随后以最小权限修复和回归测试闭环。两次问题均未造成目录切换失败后的数据分叉，也没有丢失生产 workspace。

## 发布范围与环境

| 项目 | 值 |
| --- | --- |
| 原生产 SHA | `0525d5670c441249ca112fbf56bfe1fc20eb7d56` |
| 人格功能 SHA | `94ddfd2aba7ea80b879bccb88a440a55cd1cf484` |
| 最终发布 SHA | `d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb` |
| 修复提交 | `fix(deploy): sync root-owned workspace safely` |
| 服务器 | Ubuntu 24.04，2 vCPU，2 GiB RAM，40 GiB 磁盘 |
| 编排方式 | Docker Compose，`fitclaw-bot` + `fitclaw-skill-runner` |
| 发布入口 | `scripts/deploy-release.sh <full-sha>` |
| 验收入口 | 真实飞书私聊 + `deploy-release.sh verify <full-sha>` |

从原生产 SHA 到目标版本的应用变化集中在教练人格选择、关系状态、系统提示词和对应测试；同时包含此前已完成的部署工具与文档变更、未使用的 `packages/pods` 删除。没有 Dockerfile、Compose、数据 Schema 或迁移脚本变化，因此按**普通、存储兼容发布**处理。

## 技术路径

正式路径保持为：

```text
本地开发与确定性验证
  -> 提交并推送 GitHub main
  -> 用完整 Git SHA 标识发布版本
  -> 服务器候选 checkout
  -> 服务器构建 Docker 镜像
  -> 冻结并复制 workspace
  -> 目录切换与容器重建
  -> 真实飞书 smoke
  -> 显式 verify
```

本地没有为生产发布启动 Docker。服务器仍负责生成适合自身架构的镜像，Git SHA 负责证明源代码版本，workspace manifest 和发布记录负责证明可变数据的复制与切换状态。

本次 GitHub 网络故障后采用的 Git bundle 只是**传输层降级**，没有改变版本来源和构建位置：目标 SHA 已先在 `origin/main` 验证，bundle 只包含 Git 对象，不包含 `.env`、workspace、忽略文件或未提交文件；服务器再次执行 `git bundle verify`、SHA-256 校验、Git commit SHA 校验和干净工作树校验，最后仍在服务器构建镜像。

## 本地发布门禁

发布前确认本地 `HEAD` 和 `origin/main` 均为人格功能提交 `94ddfd2...`，工作树干净。

| 检查 | 结果 |
| --- | --- |
| Coach Bot 针对性测试 | PASS，4 个文件、34 个测试 |
| Coach Core 针对性测试 | PASS，1 个文件、7 个测试 |
| `npm run check` | PASS，Biome 未产生修复，类型检查和 browser smoke 通过 |
| `npm run test` | PASS，全部 workspace 退出码为 0 |
| `npm run build` 第一次 | FAIL，受限网络阻断 models.dev、OpenRouter 和 Vercel 模型目录 |
| `npm run build` 联网重跑 | PASS，生成阶段读取 963 个 tool-capable models |
| 构建后工作树 | 恢复动态生成文件后 clean，严格匹配待发布 SHA |
| `git diff --check` | PASS |

第一次构建失败不是人格代码错误。离线回退生成了不完整的 `packages/ai/src/models.generated.ts`，继而导致类型索引错误。联网构建通过后，该动态生成文件产生 7,697 行外部目录差异；因为它不属于本次功能范围，文件被恢复到 `HEAD`，避免把实时目录漂移混入发布提交。

## 第一次发布尝试：GitHub 链路失败

服务器预检时间为 `2026-07-20T21:47:54+08:00`。当时：

- 当前 checkout 为 `0525d567...`，tracked worktree clean。
- `.env` mode 为 `0600`。
- Bot 正常运行，Runner healthy。
- 可用内存约 1.2 GiB，swap 约 1.8 GiB 可用。
- 磁盘约 26 GiB 可用。
- 目标 SHA 没有既有 stage、backup 或 release record。

发布脚本第一次在 `Preparing candidate` 阶段执行普通 fetch，约 302 秒后以 `SSL connection timeout` 失败。此时发布状态仍在 `initialized`，没有构建、停 Bot、复制 workspace 或切换目录。

随后在候选目录执行三次 `--depth=1` 有界拉取，每次上限 240 秒，三次均失败，总耗时约 751 秒。生产 Bot 和 workspace 全程未变化。

### 传输降级

人格功能增量 bundle 的证据为：

| 项目 | 值 |
| --- | --- |
| bundle bytes | `136229` |
| bundle SHA-256 | `df28b577972010b01f29ca7fa1d3cbd05ca15c19c824d58459ca4727d5d876a1` |
| prerequisite | `0525d5670c441249ca112fbf56bfe1fc20eb7d56` |
| advertised HEAD | `94ddfd2aba7ea80b879bccb88a440a55cd1cf484` |

服务器验证 bundle 后把提交检出到候选目录，候选 `HEAD`、Git blob 和干净工作树均通过检查。

## 第二次发布尝试：workspace 权限缺陷

候选镜像构建成功，冷构建总耗时约 623 秒。主要耗时是运行时镜像内 `npm install --omit=dev`，单层约 357 秒。构建期间旧 Bot 一直在线。

状态机随后进入：

```text
initialized -> prepared -> bot_stopped
```

Bot 停止后，脚本使用 `sudo cp -a` 复制冻结 workspace，并使用 `sudo mv` 把副本移动到候选目录。紧接着执行普通用户权限的：

```bash
sync -f "$STAGE/feishu-workspace"
```

该目录归属 `999:999`、mode `0750`。部署用户 `ubuntu` 无法打开目录，因此命令报：

```text
sync: error opening '<candidate>/feishu-workspace': Permission denied
```

### 失败影响与自动恢复

错误发生在目录切换之前。退出处理器检测到 Bot 是本次脚本停止的，于是重新启动旧 Bot。恢复后证据为：

- 发布记录回到 `prepared`。
- `/home/ubuntu/fitclaw` 仍为 `0525d567...`。
- `fitclaw-bot` 重新运行。
- `fitclaw-skill-runner` 保持 healthy。
- 飞书 WebSocket 重新进入 ready。
- 没有生成旧版本 backup 目录，也没有发生 workspace 双写分叉。

## 权限修复

根因不是复制权限，而是**特权操作完成后又用非特权用户打开容器用户目录进行刷盘**。最小修复是对两处目录刷盘使用与目录所有权一致的权限边界：

```diff
-sync -f "$STAGE/feishu-workspace"
+sudo sync -f "$STAGE/feishu-workspace"
```

两处分别位于冻结 workspace 复制完成后和 canonical Skills 同步完成后。没有放宽 workspace mode，没有改变所有者，也没有给部署用户加入容器用户组。

### 回归验证

假 `sudo` 会给子命令设置 `FAKE_SUDO_ACTIVE=1`；假 `sync` 在打开 `feishu-workspace` 且未处于 sudo 上下文时失败。只加入测试、不修主脚本时，成功发布场景按预期失败：

```text
not ok - healthy candidate should deploy successfully (expected: 0, actual: 1)
```

修复后 7 个部署场景全部通过：

1. 参数和 SHA 校验。
2. 候选构建失败时旧服务保持在线。
3. 健康候选到达 `containers_started`。
4. 新容器启动失败时冻结并保留新旧 release。
5. 候选 checkout 篡改被拒绝。
6. workspace-only Skill 与 canonical Skill 冲突在停 Bot 前被拒绝。
7. 无法确认停写时写入 `FREEZE_CONFIRMED=false`。

同时通过 Bash 语法、`npm run check`、scoped diff 和 pre-commit 检查。修复提交为：

```text
d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb
fix(deploy): sync root-owned workspace safely
```

GitHub CLI 确认操作账号、公开仓库 `Sanery1/FitClaw` 和默认分支 `main` 后，提交成功推送；`origin/main` 与本地 `HEAD` 一致。

## 最终发布

最终提交的 Git bundle 证据为：

| 项目 | 值 |
| --- | --- |
| bundle bytes | `136842` |
| bundle SHA-256 | `a9239f455dcd3dfcec1a24d47858a9d0e40dd1b3a0a718ec77df87dd8f37893c` |
| GitHub main SHA | `d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb` |

服务器从该提交安装修复版 `deploy-release.sh` 和 `deploy-release-state.sh`，两个文件的 Git blob 与目标提交一致，Bash 语法通过。候选 checkout 的 origin 仍保持 GitHub 地址。

因为应用源码与上一候选相同，Docker 构建层全部命中缓存，最终发布耗时约 36 秒。状态依次完成：

```text
initialized
  -> prepared
  -> bot_stopped
  -> workspace_copied
  -> skills_synced
  -> cutover_started
  -> app_moved
  -> directories_swapped
  -> starting
  -> containers_started
```

切换完成后的关键状态：

| 检查 | 结果 |
| --- | --- |
| 当前 app SHA | `d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb` |
| Bot | running，restart count `0` |
| Runner | running、healthy，restart count `0` |
| Bot image ID | `sha256:7a8d23f4c2dbffb895409349f164a657918f4ff367c1f18ffe8b2a8769deb703` |
| Runner image ID | `sha256:5e0b79dd17d6d1f3df11df5103b8e4464785467770c04d7b8d0223e2b30044bb` |
| 最近 15 分钟错误日志计数 | `0` |
| 飞书 WebSocket | ready |

## 数据完整性检查

最初把所有 `.jsonl` 都按“一行一个 JSON”解析时出现大量失败。定位后确认这些失败全部来自 `last_prompt.jsonl`；代码实际通过 `JSON.stringify(debugContext, null, 2)` 把它写成**格式化的单个 JSON 调试快照**，文件名与格式不一致。

按真实存储合同重新检查后：

| 数据类型 | 数量 | 结果 |
| --- | ---: | --- |
| 普通 `.json` | 898 | 全部可解析 |
| `last_prompt.jsonl` 完整 JSON 快照 | 5 | 全部可解析 |
| 真正逐行 JSONL 文件 | 7 | 全部可解析 |
| JSONL 非空记录 | 708 | 全部可解析 |

该检查不输出业务内容。发布脚本此前还完成了 source/copy/runtime/cutover manifest 和文件数、字节数核对。

## 真实飞书 Smoke

真实飞书私聊完成以下链路：

| 步骤 | 结果 |
| --- | --- |
| 发送 `切换人格` | PASS，服务器接收 DM event |
| 人格选择卡片 | PASS，展示暖心鼓励、温和理性、严格督导三个选项 |
| 回复 `2` | PASS，确认选择“温和理性” |
| 关系状态持久化 | PASS，`personalityId=balanced`，没有 pending selection |
| 一句话训练问题 | PASS，模型返回单句、恢复导向建议 |
| 数据写入边界 | PASS，测试明确要求不保存训练数据 |

聚合检查发现 2 个 active relationship，其中 1 个为 balanced，`personalitySelectionPending=true` 的记录数为 0。报告不记录飞书用户、租户、会话 ID 或具体训练隐私。

## 发布确认与回滚点

真实 smoke 和服务器检查通过后执行：

```bash
bash /home/ubuntu/fitclaw-deploy-tools-d3cb98c0/deploy-release.sh \
  verify d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb
```

最终记录：

```text
STATUS=verified
VERIFIED_AT=2026-07-20T14:52:36Z
```

旧 release 保留在：

```text
/home/ubuntu/fitclaw-previous-d3cb98c09a0d259dc92fbd0d2bcc2bcf9fd1d4fb
```

若后续发现问题，不能只切回代码而忽略新版本运行期间产生的 workspace 写入；应按部署手册第 10 节判断保留最新数据还是恢复发布前快照。

## 尚未解决的问题

1. **GitHub 出口不可靠。** 普通 fetch 和三次浅 fetch 均超时。本次 bundle 是经过完整校验的一次性降级，不应成为默认手工步骤。部署脚本后续应评估内置 `--depth=1`、连接超时和有界重试；若问题持续，再评估 GitHub Actions + 镜像仓库，而不是依赖第三方 GitHub 代理。
2. **`last_prompt.jsonl` 命名与格式不一致。** 它实际是单个格式化 JSON。后续可单独评估改名为 `.json`，避免监控和恢复脚本误判；本次没有改动该调试合同。
3. **失败 attempt 现场仍保留。** `94ddfd2...` 的 record 为 `prepared`，候选目录和候选镜像用于审计。确认不再需要复盘后，应按受控清理流程处理，不能使用广泛的 `git clean` 或未校验递归删除。
4. **Compose 提示 buildx 未安装。** 本次使用 Docker driver 构建成功，属于非阻塞警告。只有构建能力或性能出现真实需求时再处理。

## 总结

本次发布证明了候选构建、停写复制、manifest 校验、目录切换、容器重建、真实飞书验收和显式 verify 的主流程可以在单台 2 GiB 服务器上工作。更重要的是，第一次权限失败发生在切换前并成功恢复旧 Bot，说明状态机的失败边界有效。

同时，这次运行暴露了两个必须以事实驱动处理的问题：GitHub 网络传输需要有界可靠性策略，容器用户目录的持久化操作必须始终保持一致的权限上下文。前者已记录但未扩大架构，后者已经通过最小代码修复和回归测试闭环。
