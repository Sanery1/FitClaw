# CLAUDE.md — FitClaw 项目指南

> 供后续 AI Agent 快速理解项目来龙去脉、当前状态和待办事项。

## 一句话定位

**FitClaw = AI 健身私教 + 智能编程助手**，基于 [pi-mono](https://github.com/badlogic/pi-mono) Fork 的全栈 AI Agent 平台。

## 项目来历

| 时间 | 事件 |
|------|------|
| 2026-04 | 从 [Sanery1/FitClaw](https://github.com/Sanery1/FitClaw) Fork，原始作者 Mario Zechner |
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
- ✅ 知识库系统 `.fitclaw/`（skills / prompts）
- ✅ 飞书 Bot 完整实现 `packages/mom/src/feishu.ts`（WebSocket 长连接模式）
- ✅ `.gitignore` 更新、`README.md` 完整重写
- ✅ 配置目录从 `~/.pi/` 迁移到 `~/.fitclaw/`
- ✅ 代码推送到 GitHub
- ✅ 文档归档到 `docs/` 目录
- ✅ 健身工具集成到 Bot（`createMomTools` 包含 `createAllFitnessTools()`）
- ✅ System prompt 工具描述加入触发词（P1）
- ✅ 健身数据 JSON 文件持久化，按 channel 隔离（P0）
- ✅ Bot 加载 `.fitclaw/prompts/` 知识库（P2）
- ✅ 使用指南: `docs/USER_GUIDE.md` (2026-05-01)
- ✅ 安全修复: Bash 危险命令拦截 + 路径遍历防护 (2026-05-01, f09e06cd)
- ✅ 风险清单: `docs/RISK_ISSUES.md`（#2 #3 已修复）

## 技术记录（Plan 文件）

| 计划文件 | 说明 |
|----------|------|
| `~/.claude/plans/pi-mono-fitclaw-claw-fitclaw-https-gith-keen-hammock.md` | 完整技术决策文档（12 个架构决策） |
| `~/.claude/plans/plan-tranquil-kahn.md` | CLI 品牌重构 + 启动简化（已部分完成） |

## 待完成 / 待完善

### ✅ 已完成 (截至 2026-05-01)

1. **CLI 品牌重构** — PiManifest → FitClawManifest 类型重命名，pi→fitclaw 字符串替换 (d743e3bc)
2. **CLI 健身模式** — `--fitness` flag + FitCoach 身份 + `.fitclaw/prompts/` 知识库加载 (1277ef74)
3. **APP_NAME / GitHub URL 替换** — 6 个 package.json + README/AGENTS/CLAUDE/.pi/prompts 全部更新 (c1d52c3d)
4. **安全修复 #2** — Bash 危险命令拦截 (f09e06cd)
5. **安全修复 #3** — 文件工具路径遍历防护 (f09e06cd)

### 🟢 低优先级（择机执行）

4. **P3：封装 fitness-coach Skill** — 将 11 个健身工具封装为独立 Skill，统一决策流程，减少 system prompt token
5. **Web UI 健身界面** — `packages/web-ui` 目前只有通用聊天界面
6. **动作图片资源** — 动作数据库仅有文字，可添加 GIF/图片示范

## 健身数据架构

### 数据存储位置

| 数据类型 | 来源 | 存储 |
|---------|------|------|
| 动作数据库 | `packages/coding-agent/data/exercises.json`（静态文件） | 磁盘，永久 |
| 训练记录 / 体测 / 计划 / 超负荷 | 用户通过 Bot 输入 | `<channelDir>/fitness-data.json`（JSON 文件） |
| 对话历史 | 消息记录 | `<channelDir>/context.jsonl` + `log.jsonl` |

### 数据写入流程

```
用户消息 → LLM 决定调用工具 → tool.execute()
  → loadFitnessData(dataDir)  // 首次从磁盘加载
  → getWorkouts(dataDir) 等    // 读写内存
  → persist(dataDir)           // 立即 flush 到磁盘
```

### 工具调用检测

PM2 日志中查看：
- `↳ toolName` — 工具开始执行
- `✓ toolName (Xs)` — 工具成功完成
- `💬 Response` 但没有 `↳` — LLM 纯文本回答，未调工具

### System Prompt 版本

| 组件 | 文件 | 健身相关 |
|------|------|---------|
| Bot system prompt | `packages/mom/src/agent.ts` `buildSystemPrompt()` | 有：工具描述 + 触发词 + `.fitclaw/prompts/` 知识库 |
| CLI system prompt | `packages/coding-agent/src/core/system-prompt.ts` `buildSystemPrompt()` | 无健身人格（仅 `buildFitnessPromptHook()` 在传入 profile 时注入） |

## 如何启动

```bash
npm install
npm run build                          # 构建全部包
node packages/coding-agent/dist/cli.js # 启动 CLI
pm2 start ecosystem.config.cjs         # 启动飞书 Bot（需 PM2）
```

## 配置系统

FitClaw 配置目录：`~/.fitclaw/agent/`

| 文件 | 用途 |
|------|------|
| `settings.json` | 默认 Provider、模型、主题 |
| `auth.json` | API Key 存储 |
| `models.json` | 自定义 Provider baseUrl |

配置方式 → 参考早前对话或查看 `packages/coding-agent/src/config.ts`

## Commit 历史（当前 main 分支，最近 10 个）

```
b89d5cec docs: add comprehensive USER_GUIDE.md with usage instructions
f09e06cd fix: add bash dangerous command interception and path traversal protection
6c14b148 docs: add LEARNING_GUIDE.md and RISK_ISSUES.md
024702f4 style(mom): use template literals in card-renderer tests
ad3f2e56 chore: update package-lock.json for mom vitest devDependency
31d75d65 test(mom): add unit tests for types and card-renderer modules
4a9b5d03 feat: implement minimal Feishu card renderer
f195e99e fix: replace pi branding in system prompt with FitClaw
69861542 feat: rename package.json bin from pi to fitclaw with backward compat
9c3055d9 feat: add FITCLAW_ env var prefix support with PI_ fallback
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
