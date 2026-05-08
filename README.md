# FitClaw

> AI 运动私教 + 智能编程助手 — 基于 Claude Code 生态的全栈 AI Agent 平台

FitClaw 是一个多模态 AI Agent 平台，将**全流程运动私教**与**智能编程助手**结合为一体：

- **个性化训练计划生成**：基于用户经验、目标、器械自动设计分化训练方案
- **动作数据库**：800+ 动作的开源数据库（free-exercise-db），支持按肌群/器械/难度筛选
- **训练记录追踪**：记录每次训练的重量/次数/RPE，支持渐进超负荷管理
- **体测数据管理**：追踪体重、体脂率、围度变化
- **长期进度分析**：个人记录汇总、进阶事件日志、训练一致性分析

## 包结构

| 包 | 说明 |
|----|------|
| **[@fitclaw/ai](packages/ai)** | 统一多厂商 LLM API（OpenAI、Anthropic、Google 等） |
| **[@fitclaw/agent-core](packages/agent)** | Agent 运行时：工具调用、状态管理、事件系统 |
| **[@fitclaw/claw](packages/coding-agent)** | 主 CLI 应用：交互式编码 Agent + 运动私教 |
| **[@fitclaw/tui](packages/tui)** | 终端 UI 库：差异渲染、组件化设计 |
| **[@fitclaw/mom](packages/mom)** | 飞书 Bot：将 Agent 接入即时通讯 |
| **[@fitclaw/web-ui](packages/web-ui)** | Web 组件：AI 聊天界面的可复用 UI |
| **[@fitclaw/pods](packages/pods)** | GPU Pod 管理：vLLM 部署 CLI |

## 快速开始

```bash
npm install          # 安装所有依赖
npm run build        # 构建所有包

# CLI 启动
node packages/coding-agent/dist/cli.js

# Bot Docker 部署
cp .env.example .env && docker compose up -d --build
```

AI 接手速读 → [docs/PROJECT_UNDERSTANDING.md](docs/PROJECT_UNDERSTANDING.md)
完整问答与项目说明 → [docs/QNA.md](docs/QNA.md)

### 启动方式

FitClaw 有两个独立入口：

| 命令 | 用途 |
|------|------|
| `node packages/coding-agent/dist/cli.js` | 终端交互式 AI 编程助手（通过已安装的 skill 使用运动功能） |
| `docker compose up -d` | 飞书 Bot（Docker，推荐） |
| `pm2 start ecosystem.config.cjs` | 飞书 Bot（裸机） |

两个程序共享底层 Agent 引擎，互不依赖。Bot 配置统一到 `.env` 一个文件，CLI 配置在 `~/.fitclaw/agent/`。

## 运动私教功能

基于 **Model B 纯 Skill 架构**：skill 目录包含 SKILL.md 指令 + Python 查询脚本 + 800+ 动作的 free-exercise-db 数据库。LLM 通过 `data_<skill>_read` / `data_<skill>_write` 工具持久化用户数据，通过 `bash` 运行 Python 脚本查询动作数据库。

| Skill | 动作数据库 | 安装位置 | 功能 |
|-------|-----------|----------|------|
| bodybuilding | 800+ 动作（JSON + 图片） | CLI: `.fitclaw/skills/` / Bot: `feishu-workspace/skills/` | 用户画像收集 → 训练计划生成 → 动作教学 → 渐进超负荷跟踪 |
| swimming-coach | 泳姿教学 | CLI: `.fitclaw/skills/` / Bot: `feishu-workspace/skills/` | 泳姿纠正、训练计划、配速追踪 |

## 开发

```bash
npm run check        # Lint + 格式化 + 类型检查
npm run build        # 构建所有包（按依赖顺序）
npm run test         # 运行所有测试
npm run dev          # 并行 watch 所有包
```

## 主要特性

- **纯 Skill 架构**（Model B）：skill 不依赖框架类型，Markdown + 脚本即可
- **bodybuilding Skill**：800+ 动作数据库 + Python 查询脚本 + 9 份知识库文档
- **通用数据持久化**：`data:` frontmatter 声明 → 框架自动注册 read/write 工具，读写均限制在声明的 namespace 内
- 飞书 Bot 完整适配器（WebSocket 长连接模式）
- 统一配置系统（`.fitclaw/`）

AI 接手速读 → [docs/PROJECT_UNDERSTANDING.md](docs/PROJECT_UNDERSTANDING.md)
完整问答、学习路径与风险记录 → [docs/QNA.md](docs/QNA.md)

## 许可证

MIT
