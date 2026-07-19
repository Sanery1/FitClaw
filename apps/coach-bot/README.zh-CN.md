# FitClaw Coach Bot

简体中文 | [English](./README.md)

FitClaw 的主要应用：一个以飞书为首要接入平台的私人 AI 健身教练。

该应用负责飞书消息传输、卡片渲染、私人用户关系、私聊会话、沙箱工具和部署。教练行为由 `@fitclaw/coach-core` 提供，Skill 发现与持久化数据命名空间由 `@fitclaw/runtime` 提供。

## 运行

部署命令需要在仓库根目录执行。推荐使用 Docker：

```bash
cp .env.example .env
chmod 600 .env
# 填写飞书和模型凭据。不要提交或分享该文件。
docker compose up -d --build
```

`MOM_*` 前缀作为 Docker 部署契约继续保留。容器启动时，entrypoint 会写入 `auth.json` 和 `models.json`；内置模型保留目录中的元数据，未知的 API 兼容 Provider/模型组合则根据同一组字段注册。

从源码在本机运行时，需要先安装依赖并构建 workspace。内置 Provider 使用各自的标准密钥环境变量；DeepSeek 对应 `DEEPSEEK_API_KEY`。自定义 Provider 需要使用 Docker，或显式配置 `~/.fitclaw/agent/models.json` 和 `auth.json`。

```bash
npm install
npm run build --workspace @fitclaw/coach-bot
export MOM_FEISHU_APP_ID=cli-xxxxxxxx
export MOM_FEISHU_APP_SECRET=xxxxxxxx
export MOM_FEISHU_BOT_NAME=FitClaw
export MOM_LLM_PROVIDER=deepseek
export MOM_LLM_MODEL=deepseek-v4-pro
export DEEPSEEK_API_KEY=sk-xxxxxxxx
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach ./data
```

在飞书开发者后台选择“使用长连接接收事件”，并订阅：

- `im.message.receive_v1`
- `contact.user.created_v3`
- `contact.user.deleted_v3`

同时开通接收和发送消息、上传/下载消息资源、接收上述通讯录事件所需的权限。发布应用版本，并确保应用可用范围包含所有目标用户，否则邀请或事件会失败。

Docker Compose 会在独立的 `fitclaw-skill-runner` 容器中运行 Skill 命令。Runner 使用 `network_mode: none`，只读挂载工作区，不持有 Bot 凭据，仅通过权限为 `0600` 的 Unix socket 与 Bot 通信。当 Runner 不可用时，命令执行会直接失败，不会降级为非隔离执行。

## 私人教练数据

FitClaw 在飞书中只有一个企业 Bot，但会按照 `tenant_key + open_id` 为每个用户维护独立的私人教练关系。

新员工只会收到一次私人邀请。用户回复 `开始` 后，私人教练关系才会激活。群聊中的 `@FitClaw` 只会收到转到私聊的提示，不会进入 Coach Agent，也不会读取或写入私人记忆。

已启用的用户可以发送 `停用` 撤回访问授权，之后也可以再次发送 `开始` 重新同意。停用期间保留已有数据，但系统不会访问这些数据。

```text
tenants/{tenantKey}/users/{openId}/
├── relationship.json
├── sport-data/bodybuilding/*.json
└── sessions/{chatId}/context.jsonl
```

员工离职后，关系状态会变为 `revoked`，训练提醒会被关闭，并立即禁止访问原有记忆。物理数据的保留期限和删除流程属于独立的发布治理策略，当前不会自动删除数据。

## 记忆迁移

迁移旧私聊会话时，管理员必须提供身份映射文件。迁移命令默认只执行 dry-run。它不会修改或删除源文件，但 apply 模式可能合并并原子替换目标文件。

```json
{
  "version": 1,
  "sessions": [
    {
      "chatId": "oc_private_chat",
      "tenantKey": "tenant_key",
      "openId": "ou_user",
      "kind": "dm"
    },
    {
      "chatId": "oc_group_chat",
      "tenantKey": "tenant_key",
      "openId": "ou_user",
      "kind": "group",
      "legacyPath": "oc_group_chat/ou_user",
      "confirmedPersonalData": false
    }
  ]
}
```

```bash
# 使用 workspace 命令前先构建一次
npm run build --workspace @fitclaw/coach-bot

# 只生成报告；检查身份映射和每一条警告
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach migrate-memory ./data --mapping ./mapping.json

# apply 前必须备份 workspace 并停止 Bot。迁移与运行中的会话写入不共享锁。
docker compose stop fitclaw-bot
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach migrate-memory ./data --mapping ./mapping.json --apply --conflict destination
docker compose start fitclaw-bot

# 先预览已有员工，再显式发送一次邀请
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach invite-existing ./data --mapping ./mapping.json
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach invite-existing ./data --mapping ./mapping.json --send
```

群聊历史会归档到 `migration-archive/groups`，不会合并到私人会话上下文。除非映射中明确设置 `confirmedPersonalData: true`，否则群聊产生的结构化数据会被跳过。

## 开发

在仓库根目录运行：

```bash
npm run build --workspace @fitclaw/coach-bot
npm test --workspace @fitclaw/coach-bot
npx tsx apps/coach-bot/src/main.ts ./feishu-workspace
```

关键模块：

- `src/main.ts`：进程入口和私人教练组件装配
- `src/private-coach-service.ts`：邀请、激活、隐私和离职撤销路由
- `src/relationships.ts`：私人教练关系的原子持久化
- `src/memory-migration.ts`：默认 dry-run 的旧数据迁移
- `src/agent.ts`：每个私人会话的 Agent 运行编排
- `src/runtime/skills.ts`：Skill 加载和数据工具组装
- `src/runtime/session.ts`：模型、认证选择和共享会话组装
- `src/runtime/events.ts`：将 Agent 与会话事件转换为 Bot 响应
- `src/skill-runner.ts`：隔离的 Skill 命令服务和权限清单复验
- `src/runtime/skill-runner-client.ts`：Coach 执行器使用的 Unix socket 客户端
- `src/adapters/feishu/`：飞书传输和渲染适配器
- `src/tools/`：沙箱文件与命令工具

需要长期保存的健身事实必须使用 Skill 声明的数据命名空间。对话历史属于 Session 上下文，不能作为第二套健身数据库。

`attach` 工具只能发送当前已加载 Skill 目录中的图片或文件。在把文件内容交给飞书媒体上传 API 之前，系统会同时校验请求路径和最终 realpath。

执行本地脚本的 Skill 必须声明 `permissions.network: false`，并配置明确的 `permissions.commands.allow` 命令前缀。目前不支持允许联网的 Skill 命令。
