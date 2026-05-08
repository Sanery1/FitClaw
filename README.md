# FitClaw

> AI 运动私教 + 智能编程助手 — 基于 Claude Code 生态的全栈 AI Agent 平台

FitClaw 是一个 TypeScript monorepo AI Agent 平台，目标是把“通用 Agent runtime”和“可安装的领域 Skill”分开治理。底层提供多厂商 LLM 接入、ReAct 工具循环、事件流、TUI、飞书 Bot、Web UI 和 GPU Pod 管理；上层通过 Skill 包注入运动私教等领域能力。

项目不是单纯健身 App，也不是单纯聊天 Bot。更准确地说，它是一套可复用的 Agent 基础设施：

- **Agent runtime**：统一模型调用、工具执行、状态管理、流式事件和会话上下文
- **CLI 编程助手**：提供类似 Claude Code 的终端交互式开发体验
- **飞书 Bot**：把同一套 Agent 能力接入即时通讯和团队工作流
- **运动私教 Skill**：通过 `SKILL.md`、脚本、动作数据库和数据 namespace 提供训练计划、动作查询、训练记录和体测管理
- **Web/UI 组件**：沉淀可复用聊天界面和终端 UI 能力
- **GPU Pod 管理**：辅助部署和管理 vLLM 等本地/远端推理资源

当前运动私教能力采用 **Model B 纯 Skill 架构**：框架不再硬编码健身工具，Skill 目录负责领域知识、工作流、动作库和查询脚本；框架负责发现 Skill、注入轻量索引、注册通用数据工具并执行安全边界。

## 架构概览

```text
用户输入
  ↓
CLI / 飞书 Bot / Web UI
  ↓
@fitclaw/claw 会话层
  ↓
@fitclaw/agent-core ReAct 工具循环
  ↓
@fitclaw/ai 多厂商 LLM 抽象
  ↓
工具调用 / Skill 数据读写 / 脚本执行 / 事件流输出
```

Skill 系统采用 progressive disclosure：

1. 启动时只把 Skill 的 `name`、`description`、`location` 注入系统提示词。
2. Agent 判断任务相关时再读取对应 `SKILL.md`。
3. 需要更深资料时再读取 Skill 内的 `references/`、`scripts/`、`assets/`。
4. 涉及用户数据时，只能通过 `SKILL.md` frontmatter 声明过的 `data:` namespace 读写。

## 包结构

| 包 | 说明 |
|----|------|
| **[@fitclaw/ai](packages/ai)** | 多厂商 LLM 抽象层，统一消息、模型、流式事件和工具参数 |
| **[@fitclaw/agent-core](packages/agent)** | Agent 运行时，负责 ReAct 循环、工具执行、hook 和事件系统 |
| **[@fitclaw/claw](packages/coding-agent)** | 主 CLI 应用，包含交互式编程助手、Skill 加载、系统提示词、数据工具和 eval harness |
| **[@fitclaw/tui](packages/tui)** | 终端 UI 库，负责组件、diff 渲染和交互式界面基础能力 |
| **[@fitclaw/mom](packages/mom)** | 飞书 Bot 适配器，负责消息接入、事件回写和 Docker/PM2 部署 |
| **[@fitclaw/web-ui](packages/web-ui)** | Web 聊天 UI 组件，目前以通用 Agent 界面能力为主 |
| **[@fitclaw/pods](packages/pods)** | GPU Pod 管理 CLI，用于 vLLM 等推理服务部署和运维 |

## 快速开始

```bash
npm install          # 安装所有依赖
npm run build        # 构建所有包

# 启动 CLI
node packages/coding-agent/dist/cli.js

# 启动飞书 Bot
cp .env.example .env && docker compose up -d --build
```

AI 接手速读 → [docs/PROJECT_UNDERSTANDING.md](docs/PROJECT_UNDERSTANDING.md)

### 启动方式

FitClaw 有两个独立入口：

| 命令 | 用途 |
|------|------|
| `node packages/coding-agent/dist/cli.js` | 终端交互式 AI 编程助手（通过已安装的 skill 使用运动功能） |
| `docker compose up -d` | 飞书 Bot（Docker，推荐） |
| `pm2 start ecosystem.config.cjs` | 飞书 Bot（裸机） |

两个程序共享底层 Agent 引擎，互不依赖。Bot 配置统一到 `.env` 一个文件，CLI 配置在 `~/.fitclaw/agent/`。

## 运动私教功能

运动能力不是写死在 TypeScript 工具层里，而是安装在 Skill 目录中。一个 Skill 通常包含：

```text
<skill>/
  SKILL.md          # frontmatter + 工作流说明
  references/       # 领域知识
  scripts/          # 查询、校验或转换脚本
  assets/           # 图片、模板、静态资源
```

LLM 通过 `data_<skill>_read` / `data_<skill>_write` 工具持久化用户数据，通过受控脚本查询动作数据库。Skill 数据读写已经加固：未声明 namespace、路径穿越、非法 namespace 和写入失败都会被显式拒绝。

| Skill | 动作数据库 | 安装位置 | 功能 |
|-------|-----------|----------|------|
| bodybuilding | 800+ 动作（JSON + 图片） | CLI: `.fitclaw/skills/` / Bot: `feishu-workspace/skills/` | 用户画像收集 → 训练计划生成 → 动作教学 → 渐进超负荷跟踪 |
| swimming-coach | 泳姿教学 | CLI: `.fitclaw/skills/` / Bot: `feishu-workspace/skills/` | 泳姿纠正、训练计划、配速追踪 |

同步 CLI 和 Bot 的 Skill：

```bash
node packages/coding-agent/dist/cli.js skill sync
```

## 开发

```bash
npm run check        # Lint + 格式化 + 类型检查
npm run build        # 构建所有包（按依赖顺序）
npm run test         # 运行所有测试
npm run dev          # 并行 watch 所有包
```

Coding Agent 的 Skill eval：

```bash
cd packages/coding-agent
npm run eval
```

## 主要特性

- **纯 Skill 架构**（Model B）：skill 不依赖框架类型，Markdown + 脚本即可
- **bodybuilding Skill**：800+ 动作数据库 + Python 查询脚本 + 9 份知识库文档
- **通用数据持久化**：`data:` frontmatter 声明 → 框架自动注册 read/write 工具，读写均限制在声明的 namespace 内
- **Skill 同步命令**：`skill sync` 将项目 Skill 同步到飞书 Bot workspace，减少 CLI/Bot 行为漂移
- **确定性 eval harness**：用 faux 模型验证 Skill 工作流、工具调用和安全回归
- 飞书 Bot 完整适配器（WebSocket 长连接模式）
- 统一配置系统（`.fitclaw/`）

## 文档

- AI 接手速读：[docs/PROJECT_UNDERSTANDING.md](docs/PROJECT_UNDERSTANDING.md)
- Agent 开发规则：[AGENTS.md](AGENTS.md)
- Claude/Codex 项目速查：[CLAUDE.md](CLAUDE.md)

## 许可证

MIT
