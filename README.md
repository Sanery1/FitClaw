# FitClaw

> AI 健身私教 + 智能编程助手 — 基于 Claude Code 生态的全栈 AI Agent 平台

FitClaw 是一个多模态 AI Agent 平台，将**全流程健身私教**与**智能编程助手**结合为一体。项目 Fork 自 [pi-mono](https://github.com/Sanery1/FitClaw)，在原有编程代理能力之上，增加了完整的健身教练功能：

- **个性化训练计划生成**：基于用户经验、目标、器械自动设计分化训练方案
- **动作数据库**：50+ 动作的详细教学（中文/英文），含标准动作要领、常见错误、变式
- **训练记录追踪**：记录每次训练的重量/次数/RPE，支持渐进超负荷管理
- **体测数据管理**：追踪体重、体脂率、围度变化
- **长期进度分析**：个人记录汇总、进阶事件日志、训练一致性分析

## 包结构

| 包 | 说明 |
|----|------|
| **[@fitclaw/ai](packages/ai)** | 统一多厂商 LLM API（OpenAI、Anthropic、Google 等） |
| **[@fitclaw/agent-core](packages/agent)** | Agent 运行时：工具调用、状态管理、事件系统 |
| **[@fitclaw/claw](packages/coding-agent)** | 主 CLI 应用：交互式编码 Agent + 健身私教 |
| **[@fitclaw/tui](packages/tui)** | 终端 UI 库：差异渲染、组件化设计 |
| **[@fitclaw/mom](packages/mom)** | Slack/飞书 Bot：将 Agent 接入即时通讯 |
| **[@fitclaw/web-ui](packages/web-ui)** | Web 组件：AI 聊天界面的可复用 UI |
| **[@fitclaw/pods](packages/pods)** | GPU Pod 管理：vLLM 部署 CLI |

## 快速开始

```bash
npm install          # 安装所有依赖
npm run build        # 构建所有包
npm run check        # Lint + 格式化 + 类型检查
npm run test         # 运行测试
```

## 健身私教功能

启动 Coding Agent 后，使用以下工具完成健身教练全流程：

| 模块 | 工具 | 功能 |
|------|------|------|
| 动作数据库 | `query_exercises` | 按肌群/器械/难度搜索动作 |
| 动作数据库 | `get_exercise_detail` | 获取动作完整教学（要领/错误/变式） |
| 训练记录 | `log_workout` | 记录一次训练 |
| 训练记录 | `get_workout_history` | 查询历史训练 |
| 体测数据 | `log_body_metrics` | 记录体重/体脂/围度 |
| 体测数据 | `get_body_metrics_history` | 查询体测历史 |
| 训练计划 | `create_training_plan` | 创建/覆盖训练计划 |
| 训练计划 | `get_current_plan` | 获取当前计划 |
| 训练计划 | `get_today_workout` | 获取今日训练内容 |
| 进度分析 | `get_progress_summary` | 获取进度摘要 |
| 进度分析 | `log_progressive_overload` | 记录进阶事件 |

## 开发

```bash
npm run check        # Lint + 格式化 + 类型检查
npm run build        # 构建所有包（按依赖顺序）
npm run test         # 运行所有测试
npm run dev          # 并行 watch 所有包
```

## Fork 说明

本项目 Fork 自 [Sanery1/FitClaw](https://github.com/Sanery1/FitClaw)，原始版权归 Mario Zechner 所有。

主要改动：
- 所有包从 `@mariozechner/pi-*` 重命名为 `@fitclaw/*`
- 新增 11 个健身 Agent 工具 + 动作数据库
- 新增分层知识库系统（`.fitclaw/prompts/` + `fitclaw.md`）
- 新增飞书 Bot 适配器接口预留
- 新增知识库校验脚本

## 许可证

MIT — 沿用原始项目协议
