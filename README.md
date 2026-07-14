# FitClaw

> 通过飞书持续记录训练、记住个人状态，并调整下一次训练的个人 AI 健身教练。

FitClaw 当前是一个学习优先、飞书优先的个人健身 Agent。它围绕一个明确闭环构建：收集必要画像、生成和确认计划、记录训练、复盘历史、给出下一练建议，并在伤病或高风险请求上保持保守。

Agent runtime、Coding CLI、TUI 和多模型接入是内部基础设施，不是与健身教练并列的产品定位。

## 产品边界

第一阶段重点：

- 飞书中的渐进式 onboarding
- `bodybuilding` Skill 支撑的计划、动作和训练工作流
- 用户画像、当前计划和训练历史的结构化长期数据
- 可回归验证的计划、记录、复盘、下一练和安全行为
- CLI/TUI 作为开发、调试和 Agent 学习界面

第一阶段不做：

- 完整消费者移动 App
- 支付、订阅或多用户 SaaS
- 通用 Agent 平台或 Skill 市场
- 远端 GPU/vLLM 管理产品化
- 以 Web dashboard 作为主要用户入口

## 架构

```text
Feishu user
  -> apps/coach-bot              transport, cards, channel sessions
  -> packages/coach-core         coach identity, response and memory policy
  -> packages/runtime            Skill discovery and declared data namespaces
  -> packages/agent              tool loop and Agent state
  -> packages/ai                 model/provider abstraction
  -> skill data + conversation session storage
```

长期状态分成两类：

- 对话历史：由 SessionManager 保存，用于短期上下文连续性。
- 健身事实：只写入 Skill 声明的 data namespace，例如 `user_profile`、`training_plan` 和 `training_log`。

`MEMORY.md` 不再作为伤病、目标或计划的第二事实源。

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/coach-bot` | 主产品入口：飞书接入、消息渲染、会话和部署 |
| `packages/coach-core` | 与 transport 无关的 FitCoach 产品行为和数据策略 |
| `packages/runtime` | Skill 发现、frontmatter、namespace 存储和数据工具 |
| `packages/agent` | 通用 Agent 工具循环和状态 |
| `packages/ai` | 多厂商模型 API 抽象 |
| `packages/coding-agent` | 开发与调试 CLI，不作为健身产品入口 |
| `packages/tui` | CLI 使用的终端 UI 基础设施 |
| `packages/web-ui` | 保留的非核心 Web UI 组件，第一阶段冻结扩张 |
| `packages/pods` | 保留的非核心 GPU 工具，第一阶段冻结扩张 |
| `.fitclaw/skills/bodybuilding` | 当前 canonical bodybuilding Skill 和动作资源 |

## 快速开始

```bash
npm install
npm run build

# 主产品：飞书 Bot
cp .env.example .env
docker compose up -d --build

# 开发调试 CLI
node packages/coding-agent/dist/cli.js
```

Bot 也可以从源码启动：

```bash
npx tsx apps/coach-bot/src/main.ts ./feishu-workspace
```

## Skill 数据

`SKILL.md` 的 `data:` frontmatter 声明可持久化 namespace。runtime 自动提供 `data_<skill>_read` 和 `data_<skill>_write`，并限制只能访问已声明的数据。

```yaml
data:
  user_profile: {}
  training_log: {type: array}
  training_plan: {}
```

对象 namespace 表示当前状态并使用 `replace`；数组 namespace 表示历史流并使用 `append`。当前文件 backend 位于 `<dataDir>/sport-data/<skill>/<namespace>.json`，它是可替换实现，不是产品领域接口。

## 开发与验证

```bash
npm run check
npm run test
npm run build

cd packages/coding-agent
npm run eval -- --suite skills
npm run eval -- --suite session
```

项目方向和验收事实源：

- [产品方向](openspec/specs/product-direction/spec.md)
- [飞书健身闭环](openspec/specs/feishu-fitness-user-loop/spec.md)
- [健身记忆契约](openspec/specs/fitness-memory-contract/spec.md)
- [第一阶段 MVP](docs/FIRST_STAGE_MVP_CHECKLIST.md)
- [当前闭环状态](docs/FEISHU_FITNESS_LOOP_STATUS.md)

## License

MIT
