# FitClaw 项目审计报告

> 生成时间：2026-04-30
> 基于：main 分支 HEAD (e2f859ae)

---

## 一、项目定位与来历

**FitClaw = AI 健身私教 + 智能编程助手**，全栈 AI Agent 平台。

| 时间 | 事件 |
|------|------|
| 2026-04 | 项目初始化，基于 TypeScript monorepo 架构 |
| 2026-04 | 全部 7 个包统一使用 `@fitclaw/*` 命名空间 |
| 2026-04 | 新增健身私教功能（11 个 Agent 工具 + 动作数据库 + 知识库） |
| 2026-04 | 新增飞书 Bot 完整实现（WebSocket 长连接模式） |
| 2026-04 | 配置系统统一到 `~/.fitclaw/` |
| 2026-04 | CLI 品牌重构完成（`--fitness` flag + FitCoach 身份） |

---

## 二、架构概览

### 2.1 Monorepo 结构（7 个包）

| 包 | npm 名 | 职责 | 依赖关系 |
|----|--------|------|----------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM API 统一层 | 无内部依赖 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：工具调用、状态管理、事件系统 | 依赖 ai |
| `packages/coding-agent` | `@fitclaw/claw` | **主 CLI 应用**（交互式 TUI + 健身模式） | 依赖 ai + agent-core + tui |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件库（差分渲染） | 无内部依赖 |
| `packages/mom` | `@fitclaw/mom` | Slack/飞书 Bot 适配器 | 依赖 ai + agent-core + claw |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件（lit-based） | 依赖 ai + tui |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI | 依赖 agent-core |

### 2.2 构建顺序

```
tui → ai → agent-core → claw → mom → web-ui → pods
```

根目录 `package.json` 的 `build` script 按此顺序硬编码执行。

### 2.3 技术栈

- **编译器**：`tsgo`（TypeScript 原生编译器预览版，`@typescript/native-preview`）
- **Lint/Format**：Biome 2.3.5
- **测试**：Vitest（agent, ai, claw）/ Node test runner（tui）
- **运行时**：Node.js >= 20.6.0，也支持 Bun 编译为二进制
- **Agent 框架**：自研，基于 ReAct 循环（Thought → Action → Observation）
- **Schema 校验**：typebox
- **LLM 支持**：OpenAI、Anthropic、Google Gemini、Bedrock、Mistral、Azure 等 10+ 厂商

---

## 三、核心功能模块详解

### 3.1 健身私教系统（重点改造）

#### 3.1.1 11 个健身 Agent 工具

位于 `packages/coding-agent/src/core/tools/fitness/`，按领域分 5 个文件：

| 文件 | 工具 | 功能 |
|------|------|------|
| `exercises.ts` | `query_exercises` | 多条件搜索动作库（肌群/器械/难度/关键词） |
| `exercises.ts` | `get_exercise_detail` | 获取动作完整详情（要领/错误/变式） |
| `workout.ts` | `log_workout` | 记录一次训练（动作/组数/次数/重量/RPE） |
| `workout.ts` | `get_workout_history` | 查询历史训练记录 |
| `body.ts` | `log_body_metrics` | 记录体测数据（体重/体脂/围度） |
| `body.ts` | `get_body_metrics_history` | 查询体测历史 |
| `plan.ts` | `create_training_plan` | 创建/覆盖训练计划（周分化/动作安排） |
| `plan.ts` | `get_current_plan` | 获取当前激活计划 |
| `plan.ts` | `get_today_workout` | 获取今日计划内容 |
| `progress.ts` | `get_progress_summary` | 获取进度摘要（训练次数/PR/体测趋势） |
| `progress.ts` | `log_progressive_overload` | 记录进阶事件（突破重量/次数） |

#### 3.1.2 数据持久化（`store.ts`）

- **内存存储**：`Map<string, FitnessData>`，以 `dataDir` 为 key
- **磁盘存储**：`<dataDir>/sport-data/fitness.json`（通过 `FileSportDataStore`），每次 mutation 后 `store.save()` 立即 flush
- **Bot 场景**：`dataDir = <channelDir>`，即每个 channel 有独立的健身数据文件
- **CLI 场景**：`dataDir` 默认空字符串（不持久化），未来可绑定 session 目录

#### 3.1.3 动作数据库

- **文件**：`packages/coding-agent/data/exercises.json`
- **规模**：50 个动作（中英文双语）
- **Schema**：`Exercise` 接口，包含 id/name/nameZh/primaryMuscle/equipment/difficulty/instructions/tips/cautions/variations
- **加载方式**：运行时动态 `readFile`，首次加载后缓存到 `exerciseCache`

#### 3.1.4 知识库系统（2026-05-01 改造）

**分层结构**（对齐标准化 Skills 格式）：
- **核心层**：`fitclaw.md`（根目录，~300-500 tokens），安全红线 + 行为准则
- **Skill 正文**：`.fitclaw/skills/fitness-coach/SKILL.md`（>5000 tokens），教练方法论 + 决策树 + 引导话术
- **渐进式知识库**：`.fitclaw/skills/fitness-coach/references/*.md`（LLM 按需 read）
  - `exercise_technique.md` / `training_methods.md` / `safety.md` / `nutrition.md` / `recovery.md`
  - `onboarding.md` / `plan-design.md` / `progression.md`
- **工具定义**：`.fitclaw/skills/fitness-coach/scripts/tools.ts`（jiti 运行时加载）
- **静态数据**：`.fitclaw/skills/fitness-coach/assets/exercises.json`

**加载机制**：
- CLI `--fitness` 模式：检测 fitness-coach skill 的 `hasTools`，激活后注入渐进式知识索引（~100 tokens），LLM 按需 read 具体文件
- Bot（mom）：`buildSystemPrompt()` 注入知识索引（替代旧的全量拼接）。旧位置 `.fitclaw/prompts/` 已废弃删除
- 多运动支持：在 `.fitclaw/skills/` 下新增 skill 目录即可，零框架代码改动

### 3.2 CLI 应用（`@fitclaw/claw`）

#### 3.2.1 启动模式

| 模式 | 触发条件 | 说明 |
|------|----------|------|
| Interactive | 默认（TTY） | 交互式 TUI，支持会话管理、主题、快捷键 |
| Print | `--print` 或 piped stdin | 非交互，处理完即退出 |
| JSON | `--mode json` | 结构化输出 |
| RPC | `--mode rpc` | JSON-RPC 协议，供 IDE 扩展使用 |
| Fitness | `--fitness` | 健身私教身份 + 加载知识库 |

#### 3.2.2 健身模式实现（2026-05-01 改造）

```
args.ts 解析 --fitness → main.ts 加载渐进式知识索引
→ sdk.ts 检测 fitness-coach skill 的 hasTools → 创建 FileSportDataStore
→ system-prompt.ts buildSystemPrompt() 切换身份描述
```

**已修复**：CLI 健身模式现在通过 skill 检测自动注册健身工具（`createFitnessTools(store)` + `createFitnessStore(sessionDir)`）。知识库从全文拼接改为渐进式索引（~100 tokens）。

#### 3.2.3 配置系统

| 配置项 | 路径 |
|--------|------|
| 用户配置目录 | `~/.fitclaw/agent/` |
| 设置文件 | `~/.fitclaw/agent/settings.json` |
| API Key | `~/.fitclaw/agent/auth.json` |
| 自定义模型 | `~/.fitclaw/agent/models.json` |
| 会话存储 | `~/.fitclaw/agent/sessions/` |
| 环境变量覆盖 | `FITCLAW_CODING_AGENT_DIR` |

### 3.3 Bot 系统（`@fitclaw/mom`）

#### 3.3.1 双平台适配

| 平台 | 环境变量 | 状态 |
|------|----------|------|
| Slack | `MOM_SLACK_APP_TOKEN` + `MOM_SLACK_BOT_TOKEN` | 原有功能，完整支持 |
| 飞书 | `MOM_FEISHU_APP_ID` + `MOM_FEISHU_APP_SECRET` | **已实现 v1**，WebSocket 长连接 |

#### 3.3.2 飞书 Bot 实现细节

**文件**：`packages/mom/src/feishu.ts`

- **SDK**：`@larksuiteoapi/node-sdk`（Lark/Feishu 官方 SDK）
- **连接模式**：WebSocket 长连接（`WSClient`），非 webhook
- **事件处理**：`im.message.receive_v1`，去重机制（`seenEventIds` Set，上限 1000）
- **消息类型**：支持文本、图片、文件
- **@提及检测**：比较 `mentions[].name` 与 `MOM_FEISHU_BOT_NAME`
- **消息发送**：
  - 群聊：必须 @bot 才响应
  - 单聊：直接响应
  - 回复：使用 `im.message.reply`（thread 形式）

**Context 适配器**（`main.ts:createFeishuContext`）：
- 飞书消息**不可编辑**，因此没有 `updateMessage` 的实时流式更新
- 采用**累积 + 最终发送**策略：`respond()` 累积文本，`setWorking(false)` 时一次性 flush
- Thinking 内容和 tool 详情被抑制（不发送 thread），只发最终回复

#### 3.3.3 Agent Runner（`agent.ts`）

**核心设计**：
- 每个 channel 一个 `AgentRunner`，缓存在 `channelRunners` Map 中
- 使用 `AgentSession` 包装底层 `Agent`，提供会话持久化
- 系统 prompt 每次 run 前刷新（读取最新 MEMORY.md、skills、知识库）

**模型配置**：
- 默认 Provider：`MiniMax`
- 默认模型：`MiniMax-M2.7-highspeed`
- 通过 `MOM_LLM_PROVIDER` / `MOM_LLM_MODEL` 环境变量覆盖

**健身工具注册**：
```typescript
// agent.ts:createRunner()
const tools = createMomTools(executor, channelDir);
// createMomTools = [read, bash, edit, write, attach] + createAllFitnessTools(dataDir)
```

**数据隔离**：
- 群聊：`dataDir = <workingDir>/<chatId>/<userOpenId>/`（按用户隔离）
- 单聊：`dataDir = <workingDir>/<chatId>/`（按会话隔离）

### 3.4 系统提示词架构

#### 3.4.1 CLI System Prompt（`system-prompt.ts`）

```
非 fitness 模式：
  "You are an expert coding assistant operating inside pi..."
  + 可用工具列表 + 指南 + pi 文档路径

fitness 模式（--fitness）：
  "You are FitCoach, an AI fitness coach..."
  + .fitclaw/skills/fitness-coach/references/ 渐进式知识索引
```

**问题**：非 fitness 模式的 system prompt 中仍包含 `"operating inside pi"` 和 `"Pi documentation"` 等遗留 branding（虽然 `pi` 是小写，但在用户可见文本中仍显突兀）。

#### 3.4.2 Bot System Prompt（`mom/src/agent.ts:buildSystemPrompt`）

Bot 的 system prompt 是**硬编码**的完整字符串（~200 行），包含：
1. FitCoach 身份定义
2. 知识库注入（`loadFitClawKnowledge()`）
3. 工具描述（通用工具 + 健身工具，带触发词）
4. Memory 机制说明
5. Skills 列表

**触发词设计**：每个健身工具描述末尾有中文触发词，如：
```
- query_exercises: ... Use when user asks "有什么动作"/"推荐动作"...
```

### 3.5 长期记忆（Compaction）

- 基于项目原有的 `compaction` 模块
- 当上下文窗口达到阈值（默认 80%）时，LLM 自动摘要历史消息
- **健身数据提取**：摘要 JSON 可包含 `fitnessProfile` 字段（决策 3）
- **当前状态**：`fitnessProfile` 字段在 compaction 摘要中的提取逻辑**尚未找到实现代码**，可能只存在于设计文档中

---

## 四、待完善与潜在问题

### 4.1 高优先级（功能性缺陷）

#### 1. CLI 健身模式缺少工具注册 ✅ 已修复 (2026-05-01)
**问题**：`main.ts` 中 `--fitness` 仅切换 system prompt 身份和加载知识库，但没有注册 11 个健身工具。
**修复**：`sdk.ts` 中 `fitnessMode=true` 时自动创建 `FileSportDataStore` 并注册 11 个健身工具（commit `ca1a1780`）。同时支持 skill `hasTools` 检测（Sport Skill Pack 架构）。

#### 2. 非 fitness 模式的 system prompt 残留 "pi" branding
**问题**：`system-prompt.ts:137-153` 中仍有 `"operating inside pi"`、`"Pi documentation"`、`"read pi .md files"` 等文本。
**修复方向**：将 `pi` 替换为 `FitClaw` 或 `fitclaw`，文档路径引用改为 FitClaw 文档。

#### 3. `package.json` 的 `bin` 字段仍为 `"pi"` ✅ 已修复 (2026-05-02, c7d6ba52)
**问题**：`packages/coding-agent/package.json` 的 `bin` 字段曾是 `{ "pi": "dist/cli.js" }`。
**修复**：改为 `{ "fitclaw": "dist/cli.js" }`，`"pi"` 别名已移除。

#### 4. 环境变量残留 `PI_` 前缀 ✅ 已修复 (2026-05-02, c7d6ba52)
**问题**：26 个源文件中存在 `PI_*` 环境变量的 fallback 检查。
**修复**：所有 `|| process.env.PI_*` fallback 全部移除，仅保留 `FITCLAW_*`。

#### 5. 飞书 Bot 的 `card-renderer.ts` 是 placeholder ✅ 已修复 (2026-05-01, 4a9b5d03)
**问题**：`packages/mom/src/adapters/feishu/card-renderer.ts` 直接 `throw new Error("not yet implemented")`。
**影响**：如果某处调用了 `renderFeishuCard`，会导致崩溃。当前代码路径似乎没有调用它，但这是一个技术债务。

#### 6. `ecosystem.config.cjs` 包含硬编码的飞书 App 凭证 ✅ 已修复
**问题**：曾硬编码飞书 App 凭证在仓库中。
**修复**：已改为 `process.env.MOM_FEISHU_APP_ID || ""` 和 `process.env.MOM_FEISHU_APP_SECRET || ""`。原凭证已从源代码中移除。

### 4.2 中优先级（架构/可维护性）

#### 7. CLI 与 Bot 的健身数据不互通
**问题**：CLI 的健身数据不持久化（`dataDir` 为空），Bot 的健身数据存在 channel 目录。两者是完全隔离的存储。
**影响**：用户在 Bot 中积累的训练记录，无法在 CLI 中查看或管理。
**修复方向**：统一数据存储路径（如 `~/.fitclaw/agent/fitness-data/`），或提供数据同步机制。

#### 8. 动作数据库仅 50 个动作
**问题**：相对于专业健身应用（数百至数千动作），50 个动作覆盖有限。
**修复方向**：
- 扩展现有 JSON 文件（增加到 200-300 个核心动作）
- 或接入外部动作数据库 API
- 或允许用户自定义添加动作

#### 9. 健身工具没有输入校验（除 typebox 基础校验外）
**问题**：例如 `create_training_plan` 接收的 `weeks` 数组可能包含无效数据（如 `dayOfWeek` 超出 1-7），但没有业务逻辑层面的校验。
**修复方向**：在工具 execute 中添加业务校验，如 `daysPerWeek` 范围检查、`dayOfWeek` 有效性检查等。

#### 10. `store.ts` 的并发安全问题
**问题**：`loadFitnessData` 和 `persist` 之间没有锁机制。如果两个请求同时操作同一 `dataDir`，可能产生竞态条件（读取-修改-写入丢失更新）。
**缓解**：Node.js 单线程事件循环降低了概率，但 async I/O 仍可能导致交错执行。
**修复方向**：添加 `proper-lockfile` 或内存级锁（`Map<dataDir, Promise>`）。

#### 11. `buildSystemPrompt`（mom）每次 run 都全量重建
**问题**：`agent.ts:574` 每次消息都重新读取 MEMORY.md、skills、知识库文件。
**影响**：文件 I/O 开销虽小，但在高并发场景下累积。
**修复方向**：添加文件修改时间缓存，仅当 mtime 变化时才重建 system prompt。

### 4.3 低优先级（体验/优化）

#### 12. Web UI 没有健身界面
**问题**：`packages/web-ui` 只有通用聊天 UI 组件，没有健身专属界面（如训练计划可视化、进度图表等）。
**状态**：CLAUDE.md 中标记为低优先级（P5）。

#### 13. 动作数据库没有图片/GIF 资源
**问题**：`exercises.json` 中有 `gifUrl` 字段，但所有条目都是空的。
**修复方向**：添加图片资源托管（CDN 或本地 assets），并在工具输出中返回图片 URL。

#### 14. 缺少 `scripts/validate-knowledge.ts` 的执行入口
**问题**：知识库校验脚本存在于 `scripts/validate-knowledge.ts`，但没有在 `package.json` 中注册 script。
**修复方向**：在根目录 `package.json` 的 `scripts` 中添加 `"validate-knowledge": "tsx scripts/validate-knowledge.ts"`。

#### 15. `fitness-coach` Skill 封装 ✅ 已处理 (2026-05-01)
**问题**：`.fitclaw/skills/fitness-coach/` 目录存在，但 Skill 系统没有自动加载它。
**已实施**：Sport Skill Pack 架构（`docs/LEARNING_GUIDE.md` 决策 13）。Skill 系统扩展了 `hasTools`/`knowledgeEntries` 字段，`loadSkillFromFile()` 自动检测 `scripts/tools.ts` 和 `references/`。CLI 和 Bot 都通过 skill 检测决定工具加载。知识库从全文注入改为渐进式索引（~1,200 tokens → ~100 tokens）。

#### 16. `mom` 的 `buildSystemPrompt` 函数过长（>200 行） ✅ 已改善 (2026-05-01)
**问题**：违反 coding-style.md 的 "Functions < 50 lines" 规则。
**已实施**：Bot 的工具列表从 27 行硬编码缩减为 3 行概括指令；知识库从全文拼接改为渐进式索引。函数行数显著减少。

#### 17. `package.json` 的 `dependencies` 包含 `@fitclaw/claw`
**问题**：根目录 `package.json`:
```json
"dependencies": {
  "@fitclaw/claw": "^0.30.2"
}
```
这是一个 monorepo，根目录不应依赖子包。这会导致版本不一致问题（根目录锁在 0.30.2，子包是 0.70.5）。
**修复方向**：移除根目录对 `@fitclaw/claw` 的依赖。

#### 18. `start.sh` 和 `fitclaw-test.sh` 的存在
**问题**：根目录有 `start.sh`、`fitclaw-test.sh`、`fitclaw-test.ps1` 等脚本，但它们没有在 `package.json` 中被引用，内容也未被审查。
**风险**：可能包含过时的路径或硬编码配置。

#### 19. `.pi` 目录已清理 ✅
**状态**（2026-05-01）：根目录 `.pi/`（旧扩展、slash 命令 prompts）已删除。`.fitclaw/` 是独立的知识库目录，非从 `.pi/` 迁移而来。

#### 20. `proud-popping-river.md` 计划文件与项目无关
**问题**：该计划文件描述的是一个名为 "FitAI" 的 React + Vite + SQLite 健身追踪 Web 应用，与当前 FitClaw 项目完全不同。
**风险**：容易混淆，该计划的技术栈和架构与 FitClaw 完全无关。

---

## 五、测试覆盖情况

| 包 | 测试框架 | 状态 |
|----|----------|------|
| `packages/ai` | vitest | 有测试 |
| `packages/agent` | vitest | 有测试 |
| `packages/coding-agent` | vitest | 有测试 |
| `packages/tui` | Node test runner | 有测试 |
| `packages/mom` | 无 | **缺失** |
| `packages/web-ui` | 无 | 无（纯组件库） |
| `packages/pods` | 无 | 无（简单 CLI） |

**问题**：mom（Bot）没有任何自动化测试，飞书适配器的消息解析、去重、上下文适配等逻辑完全依赖手动测试。

---

## 六、安全审计

### 6.1 已确认的问题

1. **飞书凭证硬编码**（见 4.1 #6）
2. **下载文件路径拼接未 sanitization**：`feishu.ts:downloadFile` 使用 `fileKey.replace(/[^a-zA-Z0-9]/g, "_")` 处理文件名，但 `messageId` 未做同样处理
3. **Bot 可以执行任意 bash 命令**：mom 的 tools 包含 `bash`，在群聊场景下任何 @bot 的用户都可以让 Bot 执行 shell 命令

### 6.2 需要审查的脚本

根目录 `scripts/` 下的多个 `.mjs` 脚本（如 `apply-feishu-part1.mjs`、`apply-feishu-part2.mjs`、`integrate-fitness.mjs`）是**一次性迁移脚本**，应该在迁移完成后删除，避免误执行导致数据损坏。

---

## 七、近期提交历史分析

```
e2f859ae docs: update CLAUDE.md to reflect completed tasks 1-3
1277ef74 feat: add --fitness flag for CLI fitness coach mode
c1d52c3d chore: update GitHub URLs to Sanery1/FitClaw
d743e3bc refactor: rename PiManifest types and replace pi branding strings
88a29d16 fix(mom): isolate fitness data per user in group chats
cfab9ef7 fix(mom): strip Feishu bot system prompt of unused sections
cb3de68c fix(fitness): log persist errors instead of silently failing
d2698e8f feat: P0/P1/P2 — fitness tool precision, data persistence, and knowledge base
```

**观察**：
- 截至 2026-04-30，最近 8 个 commit 集中在健身功能和品牌重构
- 没有测试相关 commit
- 没有安全审计相关 commit

---

## 八、建议的下一步行动

### 短期（1-2 天）
1. ~~修复 CLI 健身工具注册~~ ✅ 已修复 (ca1a1780)
2. ~~确认 ecosystem.config.cjs 无硬编码凭证~~ ✅ 已确认（当前已使用 `process.env`）
3. ~~删除一次性迁移脚本~~ ✅ 已删除（`scripts/apply-feishu-*.mjs`、`scripts/integrate-fitness.mjs` 等不再存在）
4. ~~修复 system-prompt.ts 中的 "pi" 残留 branding~~ ✅ 已修复 (2026-05-02, 70dfd51f + c7d6ba52)

### 中期（1 周）
5. 统一 CLI 与 Bot 的健身数据存储路径
6. 扩展动作数据库到 150-200 个动作
7. 为 mom 添加基础单元测试（飞书消息解析、去重逻辑）
8. 实现 `card-renderer.ts` 或移除 placeholder

### 长期（择机）
9. ~~封装 `fitness-coach` 为真正的 Skill~~ ✅ 已实施 (2026-05-01)
10. Web UI 健身界面
11. 动作图片/GIF 资源
12. 将 `bin` 从 `"pi"` 改为 `"fitclaw"`
13. ~~实现完整的 jiti 动态加载 `scripts/tools.ts`~~ ✅ 已实施 (2026-05-02, 1487b2aa)
