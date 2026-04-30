# CLAUDE.md — FitClaw 项目指南

> 供后续 AI Agent 快速理解项目来龙去脉、当前状态和待办事项。

## 一句话定位

**FitClaw = AI 健身私教 + 智能编程助手**，基于 [pi-mono](https://github.com/badlogic/pi-mono) Fork 的全栈 AI Agent 平台。

## 项目来历

| 时间 | 事件 |
|------|------|
| 2026-04 | 从 [badlogic/pi-mono](https://github.com/badlogic/pi-mono) Fork，原始作者 Mario Zechner |
| 2026-04 | 全部 7 个包从 `@mariozechner/pi-*` 重命名为 `@fitclaw/*` |
| 2026-04 | 新增健身私教功能（11 个 Agent 工具 + 动作数据库 + 知识库） |
| 2026-04 | 新增飞书 Bot 适配器占位 |
| 2026-04 | 配置系统从 `.pi/` 迁移到 `.fitclaw/` |
| 2026-04 | 推送到 [Sanery1/FitClaw](https://github.com/Sanery1/FitClaw) |

## 架构概览

7 个 npm 包，monorepo 结构：

| 包 | npm 名 | 职责 |
|----|--------|------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM API 统一层 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：工具调用、状态管理 |
| `packages/coding-agent` | `@fitclaw/claw` | **主 CLI 应用**（交互式 TUI） |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件库 |
| `packages/mom` | `@fitclaw/mom` | Slack/飞书 Bot |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件 |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI |

详细架构 → [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md)

## 已完成的改造

- ✅ 包重命名：200+ 源文件 import 路径、tsconfig、vitest 别名全部更新
- ✅ 11 个健身 Agent 工具（动作数据库 / 训练记录 / 体测 / 训练计划 / 进度分析）
- ✅ 50 个动作的完整数据库 `packages/coding-agent/data/exercises.json`（中英文）
- ✅ 知识库系统 `.fitclaw/`（skills / prompts + `fitclaw.md`）
- ✅ 飞书 Bot 完整实现 `packages/mom/src/feishu.ts`（WebSocket 长连接模式）
- ✅ `.gitignore` 更新、`README.md` 完整重写
- ✅ 配置目录从 `~/.pi/` 迁移到 `~/.fitclaw/`
- ✅ 代码推送到 GitHub
- ✅ 文档归档到 `docs/` 目录

## 技术记录（Plan 文件）

| 计划文件 | 说明 |
|----------|------|
| `~/.claude/plans/pi-mono-fitclaw-claw-fitclaw-https-gith-keen-hammock.md` | 完整技术决策文档（12 个架构决策） |
| `~/.claude/plans/plan-tranquil-kahn.md` | **当前待执行**：CLI 品牌重构 + 启动简化 |

## 待完成 / 待完善

### 🔴 高优先级

1. **CLI 品牌重构**（详见 plan-tranquil-kahn.md）
   - System prompt 仍自称 "pi, a coding agent harness"
   - CLI 命令名仍为 `pi`，需改为 `fitclaw`
   - 启动信息过多，需精简
   - 涉及 6 个文件：`package.json`、`config.ts`、`system-prompt.ts`、`interactive-mode.ts`、`args.ts`、`package-manager-cli.ts`

### 🟡 中优先级

2. **APP_NAME 全面替换** — 代码中仍有多处硬编码 `"pi"` 字符串（env var `PI_CODING_AGENT`、`PI_PACKAGE_DIR`、`PI_OFFLINE` 等），需分批替换
3. **GitHub URL 更新** — `config.ts` 和 `interactive-mode.ts` 中仍有 `github.com/badlogic/pi-mono` 引用

### 🟢 低优先级

5. **Web UI 健身界面** — `packages/web-ui` 目前只有通用聊天界面，无健身专用 UI
6. **动作图片资源** — 动作数据库仅有文字，可添加 GIF/图片示范
7. **移动端适配** — TUI 之外的移动端健身体验

## 如何启动

```bash
npm install
npm run build                          # 构建全部包
node packages/coding-agent/dist/cli.js # 启动 CLI（当前仍用此路径）
```

## 配置系统

FitClaw 配置目录：`~/.fitclaw/agent/`

| 文件 | 用途 |
|------|------|
| `settings.json` | 默认 Provider、模型、主题 |
| `auth.json` | API Key 存储 |
| `models.json` | 自定义 Provider baseUrl |

配置方式 → 参考早前对话或查看 `packages/coding-agent/src/config.ts`

## Commit 历史（当前 main 分支）

```
da408f41 fix(mom): remove thinking content from Feishu main messages
bc4945f4 chore: update auto-generated models list from build
d00a2c14 fix: 更改项目名称并改善兼容性
3e345608 feat: FitClaw — AI健身私教 + 智能编程助手 全栈平台
```

## AI Agent 工作规则

1. **每次功能修复完成后必须 push 到 GitHub** — `git push origin main`
2. **Bug 修复记录在 git commit history 中** — 每次修复一个独立 commit，message 遵循 conventional commits 格式
3. **项目文档统一放在 `docs/` 目录** — 不散落在根目录

## 关键文件速查

| 需求 | 路径 |
|------|------|
| 健身工具实现 | `packages/coding-agent/src/core/tools/fitness/` |
| 健身数据 Schema | `packages/coding-agent/src/core/fitness/schemas.ts` |
| 动作数据库 | `packages/coding-agent/data/exercises.json` |
| 知识库 | `.fitclaw/skills/` + `.fitclaw/prompts/` |
| 系统提示词 | `packages/coding-agent/src/core/system-prompt.ts` |
| 启动界面 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| 配置文件 | `packages/coding-agent/src/config.ts` |
| CLI 参数解析 | `packages/coding-agent/src/cli/args.ts` |
| 设置管理 | `packages/coding-agent/src/core/settings-manager.ts` |
| 模型注册 | `packages/coding-agent/src/core/model-registry.ts` |
