# FitClaw 项目学习指南

> 本文档指导开发者从 0 到 1 理解 FitClaw 项目架构。按阶段阅读，每个阶段有明确的目标、阅读清单和动手任务。

---

## 项目定位

**FitClaw = AI 健身私教 + 智能编程助手**，全栈 AI Agent 平台。

7 个 npm 包组成 monorepo：

| 包 | npm 名 | 核心职责 |
|----|--------|----------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM API 统一层 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：状态机、事件流、工具循环 |
| `packages/coding-agent` | `@fitclaw/claw` | **主 CLI 应用**（交互式 TUI） |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件库（差分渲染） |
| `packages/mom` | `@fitclaw/mom` | Slack / 飞书 Bot 适配器 |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件（Lit） |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI |

---

## 阶段 0：理解架构决策 — 为什么这样设计（1 天）

> **阅读本文前先读这一节。** 理解 What 和 How 能让你改代码，理解 Why 才能让你做决策。
> 完整决策记录见 `~/.claude/plans/pi-mono-fitclaw-claw-fitclaw-https-gith-keen-hammock.md`

### 0.1 核心设计哲学

FitClaw 的所有架构决策遵循一条主线原则：

**最小化对核心框架的侵入，最大化在既有框架内的扩展。**

这意味着：不改动 agent-loop 核心循环、不改动 compaction 触发逻辑、不改动 system-prompt 构建管道。所有健身功能通过"注入点"挂载到现有流程上。

### 0.2 12 个关键决策速览

---

#### 决策 1：动作数据库 — 为什么用 TypeScript 工具而不是 Python 脚本或纯 Skill？

```
方案 A: Python 脚本                    ← 被否决
方案 B: 纯 Skill（Markdown 描述）       ← 被否决
方案 C: TypeScript AgentTool ✅         ← 选定
```

**为什么**：
- 800+ 条动作数据需要**结构化查询**（按肌群/器械/难度/关键词过滤）。纯 Skill 方案里这些数据全塞在 Markdown 中，LLM 无法查询，且每次加载全部 token 巨大。
- Python 脚本引入外部依赖，跨平台分发困难；bash 工具调用有额外进程开销。
- TypeScript 工具利用现有的 `AgentTool` + TypeBox Schema 校验体系，数据一次性加载到内存毫秒级响应。LLM 通过标准 Function Calling 自然决定何时查询动作库。

**你可以验证**：看 `packages/coding-agent/src/core/tools/fitness/exercises.ts` — 整个查询逻辑不到 80 行。

---

#### 决策 2：为什么恰好 11 个工具，不多不少？

```
方案 A: 更少工具（只保留核心 5 个）      ← 被否决
方案 B: 更多工具（拆分更细，20+）        ← 被否决
方案 C: 11 个工具，5 个领域模块 ✅        ← 选定
```

**为什么**：
- 用户需求的 4 项核心功能（训练记录 / 体测追踪 / 训练计划 / 进度分析）各需至少 1 读 1 写，加动作数据库需 2 个查询工具 = 最少 10 个。
- 少于 10 个则功能不完整；多于 11 个则当前场景用不上，过度拆分增加维护复杂度。
- 5 个模块（exercises / workout / body / plan / progress）按领域边界清晰拆分，每个文件 <200 行。

**你可以验证**：看 `packages/coding-agent/src/core/tools/fitness/index.ts` — `createAllFitnessTools()` 返回恰好 11 个工具的数组。

---

#### 决策 3：长期记忆 — 为什么扩展现有 Compaction 而不是重写？

```
方案 A: 完全重写 compaction 系统         ← 被否决
方案 B: 新建独立的健身记忆系统，双轨并行   ← 被否决
方案 C: 扩展现有 compaction 模块 ✅       ← 选定
```

**为什么**：
- 现有 compaction 已经处理好 Token 估算、触发时机、AbortSignal 中断、proper-lockfile 并发保护等边界情况——这些坑已经被踩过了。
- 双轨并行（健身记忆系统 + 编程记忆系统独立运行）必然导致数据不一致。
- 改造点很小：只在摘要 JSON 新增 `fitnessProfile` 字段，LLM 摘要 prompt 中加入健身数据提取指令。摘要通过 system prompt 注入流程**自动**回到会话上下文，链路无需改动。

**深层原因**：这是"在既有框架边界内做扩展"原则的典型体现——自己不用重写一个压缩系统，改动是加字段而非改架构。

---

#### 决策 4：包命名 — 为什么是 `@fitclaw/*` 而不是 `@fit-dev/fit-*`？

```
方案 A: 保持 @mariozechner scope         ← 被否决
方案 B: @fit-dev/fit-* + fit CLI         ← 被否决
方案 C: @fitclaw/* + fitclaw CLI ✅      ← 选定
```

**为什么**：
- 项目已从原作者独立，不应沿用 `@mariozechner` scope。
- `fit` 是通用词，CLI 命令名可能与其他工具（fitness/fitbit）冲突；`@fit-dev/fit-ai` 有冗余的 `fit` 前缀。
- `@fitclaw` 做到**三点统一**：项目名 = scope = CLI 命令 = 配置目录名。简洁且无歧义。

---

#### 决策 5：知识库架构 — 为什么是 2 层而不是 4 层？

```
方案 A: 4 层（索引层 + 基础层 + 域层 + 校验层）← 被否决
方案 B: 纯索引 + 域文件（无核心层）              ← 被否决
方案 C: 2 层（核心层 + 域文件层）+ 校验脚本 ✅    ← 选定
```

**为什么**：
- 核心层（`fitclaw.md`，始终注入 ~300-500 tokens）提供**兜底安全规则**：纯索引+域文件方案下，Agent 可能不触发索引就直接回答，缺少安全兜底。
- 4 层方案中索引层和基础层职责重叠，可以合并——属于过度设计。
- 域文件按需加载，Token 消耗最小化。
- 校验脚本保证多人在多时间维护知识库时不会引入不一致。

**你可以验证**：看 `.fitclaw/prompts/` 下的域文件和 `packages/mom/src/agent.ts` 中 `loadFitClawKnowledge()` 的加载逻辑。

---

#### 决策 6：健身数据持久化 — 为什么用 JSONL 而不是 SQLite？

```
方案 A: SQLite 独立数据库              ← 被否决
方案 B: JSONL + 独立计划文件 ✅         ← 选定
方案 C: 双写（JSONL + SQLite）         ← 被否决
```

**为什么**：
- 框架的 `CustomMessageEntry` 就是为扩展数据设计的，compaction 天然能从中提取——不需要造新轮子。
- SQLite 引入额外依赖和跨平台问题；更致命的是 Session fork 会丢失健身数据（fork 只复制 JSONL 文件）。
- 双写方案是第一大 bug 来源：两个数据源必然出现不一致。
- 训练计划独立存储为 `current.json` 是因为它本质是**配置**而非对话，且每轮需注入 system prompt。

**深层原因**：单一数据源（Single Source of Truth）原则。所有用户数据走一条路径，compaction 自动处理长期记忆，不存在同步问题。

**注意**：实际代码实现与原始规划有偏差——当前健身数据存储在 `<channelDir>/fitness-data.json`（独立 JSON 文件），而非 Session JSONL CustomEntry。这是 Bot 场景驱动的务实选择（Bot 不需要 Session fork，更简单的独立 JSON 文件已足够）。

---

#### 决策 7：System Prompt 组装 — 为什么 Hook 进去而不是独立构建？

```
方案 A: 独立 FitnessPromptBuilder 类     ← 被否决
方案 B: 通过 transformContext 注入消息    ← 被否决
方案 C: Hook 进现有 system-prompt.ts ✅   ← 选定
```

**为什么**：
- `system-prompt.ts` 已有 `BuildSystemPromptOptions` 接口，`fitnessMode` 参数就是扩展点——直接在此注入即可。
- 独立构建器是过度设计：两套 prompt builder 并行维护，同样的事情写两遍。
- 通过 `transformContext` 注入消息会**污染对话历史**：健身上下文（用户画像、训练计划、可用器械）是指令而非对话，放在 system prompt 中才是正确的位置。

**你可以验证**：看 `system-prompt.ts:133-136` — `fitnessMode` 分支直接替换身份描述和工具列表，不改动其他构建逻辑。

---

#### 决策 8：Skill vs 工具的分工 — 什么放 Skill，什么放工具？

```
方案 A: 全部放 Skill（Markdown 描述所有逻辑）   ← 被否决
方案 B: 全部放工具（TypeScript 硬编码所有逻辑）  ← 被否决
方案 C: Skill 管软知识，工具管硬操作 ✅           ← 选定
```

**为什么**：
- **软知识**（引导话术、计划设计决策树、进阶触发条件）特点是变化频繁、需要热更新、用自然语言描述最好——适合放 Skill。
- **硬操作**（查询动作库、记录训练、计算进度）特点是结构化数据、需要类型安全、执行确定性——适合放 TypeScript 工具。
- 全放 Skill：800+ 条动作数据放 Markdown 无法查询，且每次加载 token 巨大。
- 全放工具：引导话术和决策树用 Function Calling 表达过于僵硬，且修改话术需要重新构建。

**这是 FitClaw 最核心的架构洞察**：Skill 是"方法论层"（告诉 LLM 怎么思考），工具是"执行层"（让 LLM 能操作数据）。两层通过 Skill 的 `@skill-name` 触发机制协作：

```
用户输入 → LLM 匹配 Skill 触发条件 → 输出 @fitness-coach
  → 加载完整 SKILL.md（引导话术/决策树）
  → LLM 按 Skill 引导对话 → 适时调用工具执行数据操作
  → 对话切题后 Skill 内容从 prompt 移除
```

---

#### 决策 9：构建策略 — 为什么逐包改造而不是批量脚本？

```
方案 A: 批量脚本全改后统一修复       ← 被否决
方案 B: 新旧代码并行开发             ← 被否决
方案 C: 渐进式逐包改造 ✅             ← 选定
```

**为什么**：
- 7 个包形成有向无环图（tui → ai → agent-core → claw → mom → ...），按拓扑序改造，每步出错能立刻定位。
- 批量全改后统一调试：错误面不可控，200+ 文件改动中排查一个问题极其痛苦。
- 新旧双轨并行：维护负担翻倍，且最终还是要合并。

**验证流程**：每个包改造完 → `npm run check`（类型 + lint）→ `npm run test` → 通过后进入下一包。

---

#### 决策 10：飞书集成 — 为什么用 Adapter 接口而不是单独开包？

```
方案 A: 飞书单独开新包                  ← 被否决
方案 B: BotAdapter 接口 + placeholder ✅  ← 选定
```

**为什么**：
- 核心的 `AgentRunner`（Agent 编排逻辑）对 Slack 和飞书完全相同。单独开包会导致这段逻辑重复维护。
- `BotAdapter` 接口解耦 IM 层与 Agent 编排层：`AgentRunner` 不感知底层是 Slack 还是飞书。
- Placeholder 方法体留空，不阻塞主流程编译运行。飞书 API 就绪后只需填充 `adapters/feishu/` 下的 `listener.ts` + `renderer.ts`，不动上层代码。

**你可以验证**：看 `packages/mom/src/types.ts` 的 `BotContext` 接口 — 这是 IM 无关的抽象。

---

#### 决策 11：数据 Schema 设计 — 为什么 `fitclaw/` 前缀 + MessageEntry/Entry 分离？

```
方案 A: 全部数据走 CustomMessageEntry     ← 被否决
方案 B: 全部数据走 CustomEntry            ← 被否决
方案 C: 按"是否需要 LLM 看到"分离 ✅       ← 选定
```

**为什么**：
- `fitclaw/` 命名空间前缀与现有扩展隔离，扫描过滤方便。
- **需要 LLM 看到的数据**（训练记录、体测、PR）走 `CustomMessageEntry`——compaction 触发前 LLM 就能直接读取近期数据做决策。
- **不需要 LLM 看到的数据**（进阶事件）走 `CustomEntry`——只是状态变更记录，compaction 提取摘要后自然进入上下文，不占 token。
- `measurements` 字段用 `Record<string, number>` 而非固定字段：不同用户关注不同部位（有人量胸围、有人量腿围），硬约束反而不灵活。

**核心原则**：每一类数据存哪里，取决于"LLM 做决策时需要看到原始数据还是摘要就够"。

---

#### 决策 12：文件结构 — 为什么健身代码全放 `fitness/` 子目录？

```
方案 A: 健身工具散落在原有 tools/ 目录     ← 被否决
方案 B: 动作数据库单独开包                  ← 被否决
方案 C: 健身代码隔离在 fitness/ 子目录 ✅   ← 选定
```

**为什么**：
- 散落原 tools/ 目录：与现有的 7 个内置工具（read/bash/edit/write/grep/find/ls）混在一起，边界不清，难以维护。
- 单独开包：动作数据库只是 JSON 数据，无独立逻辑，单独开包属过度设计。
- `fitness/` 子目录方案：健身代码完全隔离，不改动现有核心循环。5 个健身工具文件按领域拆分，每个 <200 行。

**你可以验证**：看 `packages/coding-agent/src/core/tools/fitness/` — 每个文件对应一个领域模块，互不交叉。

---

### 0.3 决策之间的依赖关系

这些决策不是孤立的，它们层层递进：

```
决策 1 (动作数据库)
  ↓
决策 2 (健身工具集 11 个)
  ↓
决策 8 (Skill 管软知识, 工具管硬操作)  ← 定义了方法论与执行的分界
  ↓
决策 11 (数据 Schema: MessageEntry/Entry 分离)
  ↓
决策 6 (数据持久化: JSONL + 计划独立文件)
  ↓
决策 3 (长期记忆: 扩展 Compaction)
  ↓
决策 7 (System Prompt: Hook 注入)
  ↓
决策 5 (知识库: 2 层架构)
  ↓
决策 4 (包命名)  ← 横切所有
决策 9 (构建策略) ← 横切所有
决策 10 (飞书预留) ← 横切所有
决策 12 (文件结构) ← 横切所有
```

**读懂这个依赖链**，你就理解了 FitClaw 的完整设计推理过程。

---

## 阶段 1：建立 Agent 领域心智模型（1-2 天）

### 目标
理解 AI Agent 的核心概念，不读项目代码。

### 必读资料
1. [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — 工具使用的经典范式
2. [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
3. [Anthropic Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)

### 核心概念清单

| 概念 | 一句话解释 | 在 FitClaw 中的体现 |
|------|-----------|---------------------|
| System Prompt | 告诉 LLM "你是谁、你能做什么" 的指令 | `system-prompt.ts` 构建 |
| Tool Definition | 工具的名称 + 描述 + 参数 Schema | `AgentTool.parameters` (typebox) |
| Tool Call | LLM 决定调用工具时返回的结构 | `assistant.content` 中的 `{type:"toolCall"}` |
| Tool Result | 工具执行完返回给 LLM 的结果 | `{role:"toolResult", content:[...]}` |
| Streaming | LLM 逐字返回，而非一次性返回全文 | `AssistantMessageEventStream` 协议 |
| Message 角色 | user / assistant / toolResult | `Message` 联合类型 |
| Context Window | LLM 能处理的最大 token 数 | `model.contextWindow` + compaction |

### 动手实验
用 OpenAI/Claude API 手写一个最小 Agent（只有 `bash` 工具），观察 LLM 如何决定调用工具。

---

## 阶段 2：理解类型契约（2-3 天）

### 目标
掌握项目的数据类型体系，这是理解后续代码的基础。

### 阅读顺序

```
packages/ai/src/types.ts          (453 行，LLM 层类型)
    ↓
packages/agent/src/types.ts       (366 行，Agent 层类型)
    ↓
packages/coding-agent/src/core/extensions/types.ts  (选读，扩展层类型)
```

### 核心类型对照表

```
LLM 层 (ai)              Agent 层 (agent-core)         Session 层 (coding-agent)
─────────────────────────────────────────────────────────────────────────────
Message              →   AgentMessage (+ custom)    →   Session entry
Context              →   AgentContext                →   prompt 上下文
Tool                 →   AgentTool (+ execute)       →   ToolDefinition
AssistantMessage     →   AgentEvent stream           →   Session persistence
streamSimple()       →   agentLoop()                 →   AgentSession.prompt()
```

### 关键问题自测
- `AgentMessage` 为什么比 `Message` 更通用？（支持自定义消息类型扩展）
- `convertToLlm()` 的作用是什么？（AgentMessage[] → Message[] 的适配器）
- `AgentEvent` 和 `AgentSessionEvent` 的区别？（后者增加了 queue_update / compaction 等会话级事件）

---

## 阶段 3：追踪一条消息的完整旅程（3-4 天）

### 目标
端到端理解数据流，建立代码地图。

### 追踪路径

```
用户输入 "帮我查一下深蹲怎么做"
    ↓
1. packages/coding-agent/src/cli.ts
   - 设置 undici 代理、进程标题
   - 调用 main(process.argv.slice(2))
    ↓
2. packages/coding-agent/src/main.ts
   - parseArgs() 解析参数（--fitness 标志在这里识别）
   - 创建 SessionManager（会话文件管理）
   - 构建 createRuntime 工厂函数
   - 调用 createAgentSessionRuntime(createRuntime, {...})
    ↓
3. packages/coding-agent/src/core/sdk.ts  →  createAgentSession()
   - 创建 AuthStorage、ModelRegistry、SettingsManager
   - 创建 ResourceLoader（加载扩展/技能/主题）
   - 恢复已有会话或创建新会话
   - 选择模型（从设置/命令行/会话恢复）
   - 创建 Agent 实例（传入 streamFn、convertToLlm 等）
   - 如果 fitnessMode: 创建健身工具并加入 customTools
   - 创建 AgentSession（传入 agent + sessionManager + ...）
   - 返回 { session, extensionsResult, modelFallbackMessage }
    ↓
4. packages/coding-agent/src/core/agent-session.ts  →  prompt()
   - 处理扩展命令（/xxx）
   - 扩展 input 事件拦截
   - 展开技能命令和提示模板
   - 如果正在 streaming: 排队 steer/followUp
   - 验证模型和 API Key
   - 检查是否需要 compaction
   - 构建用户消息数组
   - 触发 before_agent_start 扩展事件
   - 调用 agent.prompt(messages)
    ↓
5. packages/agent/src/agent.ts  →  prompt()
   - 检查是否已有 activeRun（防止并发）
   - runWithLifecycle() 包装执行
   - 调用 runAgentLoop()
    ↓
6. packages/agent/src/agent-loop.ts  →  runAgentLoop()
   - 添加用户消息到 context
   - emit agent_start / turn_start / message_start / message_end
   - 调用 runLoop()
    ↓
7. streamAssistantResponse()
   - transformContext() 扩展上下文变换
   - convertToLlm() AgentMessage → Message
   - 构建 llmContext: { systemPrompt, messages, tools }
   - 调用 streamFunction()（即 sdk.ts 传入的 streamSimple 包装）
    ↓
8. packages/ai/src/stream.ts  →  streamSimple()
   - 根据 model.api 路由到对应 provider
   - 添加 API Key、headers、retry 配置
   - 发起 HTTP 请求，返回 EventStream
    ↓
9. LLM 返回内容（含 toolCall）
   - 解析流事件：start → text_delta → toolcall_start → toolcall_delta → toolcall_end → done
   - 组装成 AssistantMessage
    ↓
10. 检查 toolCalls
    - 如果有：executeToolCalls()
    - 顺序或并行执行（取决于 toolExecution 配置）
    - prepareToolCall() → validateToolArguments() → tool.execute()
    - 生成 ToolResultMessage，加入 context
    - 下一轮 LLM 调用
    - 如果没有：turn_end → agent_end
    ↓
11. agent_end 后
    - AgentSession._checkCompaction() 检查上下文窗口
    - 如果需要：自动 compaction（调用 LLM 总结历史）
    - 或：自动重试（如果是可重试错误）
    - 消息持久化到 JSONL 文件
```

### 动手实验
在 `agent-loop.ts` 的 `runLoop()` 和 `streamAssistantResponse()` 中加 `console.log`，实际跑一条带工具调用的消息，观察完整事件序列。

---

## 阶段 4：理解工具系统（2-3 天）

### 目标
掌握工具的注册、定义、执行、扩展机制。

### 阅读顺序

```
packages/coding-agent/src/core/tools/index.ts              (工具工厂入口)
packages/coding-agent/src/core/tools/read.ts               (最简单的工具)
packages/coding-agent/src/core/tools/bash.ts               (最复杂的工具）
packages/coding-agent/src/core/tools/tool-definition-wrapper.ts
packages/coding-agent/src/core/tools/fitness/index.ts      (健身工具入口)
packages/coding-agent/src/core/tools/fitness/exercises.ts  (查询动作数据库)
packages/coding-agent/src/core/tools/fitness/store.ts      (数据持久化)
```

### 工具类型对比

| 类型 | 定义位置 | execute 方法 | 使用场景 |
|------|----------|-------------|----------|
| 内置工具 | `tools/*.ts` | 直接实现 | read/bash/edit/write/grep/find/ls |
| 健身工具 | `tools/fitness/*.ts` | 直接实现 | 11 个健身相关工具 |
| 扩展工具 | 扩展包注册 | ExtensionRunner 包装 | 第三方扩展 |
| 自定义工具 | SDK 传入 | `customTools` 参数 | `createAgentSession({customTools})` |

### 关键问题
- `AgentTool` vs `ToolDefinition`：前者是运行时工具（含 execute），后者是声明式定义（供 LLM 和扩展系统使用）。`tool-definition-wrapper.ts` 负责桥接。
- `prepareArguments`：在参数校验前对原始参数做兼容性转换。
- `executionMode`：`"sequential"` 独占执行，`"parallel"` 可并发。

### 动手实验
自己实现一个 `getCurrentTime` 工具，在 `sdk.ts` 中通过 `customTools` 注册，测试 LLM 是否能正确调用。

---

## 阶段 5：理解会话与持久化（2-3 天）

### 目标
掌握 Session 的生命周期、树形结构和 Compaction 机制。

### 阅读顺序

```
packages/coding-agent/src/core/session-manager.ts     (会话文件管理)
packages/coding-agent/src/core/compaction/index.ts    (上下文压缩)
packages/coding-agent/src/core/agent-session.ts       (prompt/compact/navigateTree 方法)
```

### Session 树形结构

```
Entry (id, parentId, type)
    ├── message (user/assistant/toolResult)
    ├── compaction (摘要)
    ├── branchSummary (分支摘要)
    ├── custom_entry
    └── model_change / thinking_level_change / session_info / label

leafId 指向当前分支的末端
branch() 创建新分支（切换 parentId）
```

### Compaction 机制

| 触发条件 | 处理方式 | 是否自动重试 |
|----------|----------|-------------|
| 上下文溢出（overflow） | 压缩历史 + 自动 continue() | 是 |
| 超过阈值（threshold） | 压缩历史 | 否 |
| 手动 /compact | 压缩历史 | 否 |

### 健身数据持久化

- 存储位置：`<sessionDir>/fitness-data.json`
- 内存缓存：`Map<string, FitnessData>`（key 为 dataDir）
- 写入流程：tool.execute() → 修改内存 → persist() → 写 JSON 文件
- 读取流程：loadFitnessData() → 读 JSON → 放入 Map

---

## 阶段 6：理解 Bot 层（2 天）

### 目标
理解 mom 包如何将 CLI Agent 包装为聊天 Bot。

### 阅读顺序

```
packages/mom/src/main.ts          (双平台入口)
packages/mom/src/agent.ts         (AgentRunner 封装)
packages/mom/src/feishu.ts        (飞书适配器)
packages/mom/src/slack.ts         (Slack 适配器，选读)
```

### Bot 架构

```
用户消息（Slack/飞书）
    ↓
Bot 接收事件 → 创建 BotContext
    ↓
获取/创建 ChannelState（按 channelId / userId）
    ↓
AgentRunner.run(ctx, store)
    ↓
内部创建 AgentSession → prompt()
    ↓
通过 BotContext.respond() / setWorking() 返回结果
```

### BotContext 接口

| 方法 | Slack 实现 | 飞书实现 |
|------|-----------|----------|
| respond() | 更新/发送消息 | 累加文本 |
| replaceMessage() | 替换消息 | 替换累加文本 |
| setWorking() | 添加/移除 "..." 指示器 | 结束时 flush |
| respondInThread() | 发送线程消息 | 不实现（v1） |
| uploadFile() | 上传文件 | 不实现（v1） |
| deleteMessage() | 删除消息 | 不实现（v1） |

### 多用户隔离

- `channelStates` Map 的 key：`channelId`（单聊）或 `channelId/userId`（群聊@）
- 每个 state 有独立的 `AgentRunner` 和 `ChannelStore`
- 健身数据存储在 `<workingDir>/<channelId>/fitness-data.json`

---

## 阶段 6.5：深入 System Prompt 与工具调用机制（2-3 天）

### 目标
理清 CLI 和 Bot 两套程序的 system prompt 构建差异，以及工具调用（Tool Calling）的完整机制——从 TypeBox Schema 定义到 LLM 返回 toolCall 再到执行回写。

### 6.5.1 两条路径，两套 System Prompt

FitClaw 有**两个独立可执行程序**，它们共用底层 Agent 引擎（`@fitclaw/agent-core`），但 system prompt 构建逻辑完全不同：

```
                        CLI (fitclaw)                          Bot (mom)
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 入口              cli.ts → main.ts                  main.ts                 │
  │ 构建函数          system-prompt.ts                   agent.ts               │
  │                   buildSystemPrompt()                buildSystemPrompt()     │
  │ 身份              coding 模式: "expert coding        固定: "FitCoach,       │
  │                     assistant operating inside         AI fitness personal   │
  │                     FitClaw"                           trainer powered by    │
  │                   fitness 模式: "FitCoach, AI          FitClaw"             │
  │                     fitness coach"                                          │
  │ 加载              ✅ 是。resource-loader.ts           ❌ 否。mom 完全不     │
  │ AGENTS.md/        从 cwd 向上逐级查找                   引用 AGENTS.md /     │
  │ CLAUDE.md         注入为 "Project Context"              CLAUDE.md           │
  │ 加载              可选：~/.fitclaw/agent/SYSTEM.md     ❌ 无                │
  │ SYSTEM.md         项目级：.fitclaw/SYSTEM.md                                │
  │ 加载 .fitclaw/    ❌ 不加载                              ✅ 加载全部 *.md    │
  │ prompts/          （CLI 是编程工具，                     作为 "FitClaw       │
  │                    知识库无意义）                         Knowledge Base"    │
  │ 加载 Skills       ✅ 从 agentDir + cwd/.fitclaw/      ✅ 从 workspace/     │
  │                     skills/ 加载                          skills/ + channel/  │
  │                                                          skills/ 加载       │
  │ 加载 Memory       ❌ 不加载                              ✅ 从 workspace/    │
  │                                                          MEMORY.md +        │
  │                                                          channel/MEMORY.md  │
  │ prompt 编写方式   参数化动态拼接                         函数体内硬编码       │
  └─────────────────────────────────────────────────────────────────────────────┘
```

#### CLI 的 System Prompt（`system-prompt.ts:30-178`）

```
buildSystemPrompt({
  customPrompt,        // 用户自定义 prompt（完全替换默认）
  selectedTools,       // 启用的工具列表 ["read","bash","edit","write"]
  toolSnippets,        // 每个工具的一行描述
  promptGuidelines,    // 额外行为准则
  appendSystemPrompt,  // 追加文本（来自 SYSTEM.md）
  cwd,                 // 工作目录
  contextFiles,        // AGENTS.md / CLAUDE.md 内容
  skills,              // 已加载的 skills
  fitnessMode,         // true = 健身私教，false = 编程助手
})

→ 拼出一个 string，传给 Agent 的 systemPrompt 字段
```

两种模式的核心区别：

| | coding 模式（默认） | fitness 模式（`--fitness`） |
|---|---|---|
| 身份 | expert coding assistant | FitCoach, AI fitness coach |
| 工具列表 | 显式列出（read/bash/edit/write...） | 不列出（工具名已在 tool definition 中） |
| Guidelines | 动态生成（根据启用的工具组合） | 无（改由 promptGuidelines 参数提供） |
| FitClaw 文档路径 | 注入 README/docs/examples 路径 | 不注入 |

#### Bot 的 System Prompt（`agent.ts:149-217`）

```
buildSystemPrompt(workspacePath, channelId, memory, skills)

→ 返回一个硬编码模板，插入以下动态部分：
  1. loadFitClawKnowledge() — .fitclaw/prompts/*.md 全文拼接
  2. memory — workspace + channel 的 MEMORY.md 内容
  3. formatSkillsForPrompt(skills) — 技能列表格式化
```

结构：

```
You are FitCoach, ...
  ├── ## Your Role           — 身份 + 回复风格（1-3句简短）
  ├── ## FitClaw Knowledge   — .fitclaw/prompts/ 全部健身知识
  ├── ## Context             — 日期 + 对话历史
  ├── ## Formatting          — 纯文本格式要求
  ├── ## Memory              — MEMORY.md 读写指引
  ├── ## Skills              — 已安装技能
  └── ## Tools
        ├── General Tools    — bash/read/write/edit/attach
        └── Fitness Tools    — 11 个健身工具，每个附触发词
```

**关键差异总结**：CLI 的 prompt 是"框架式"的，通过参数组合适配不同模式；Bot 的 prompt 是"一体式"的，所有行为规则（包括触发词映射）直接写在函数体内，不依赖任何外部上下文文件。

### 6.5.2 工具定义：从 TypeBox Schema 到 LLM JSON Schema

#### 类型层次

```
@fitclaw/ai            @fitclaw/agent-core           具体实现
─────────────────────────────────────────────────────────────────
Tool<TParameters>  →   AgentTool<TParameters>    →   createQueryExercisesTool()
  ├ name: string          ├ extends Tool               ├ name: "query_exercises"
  ├ description: string   ├ label: string              ├ label: "Query Exercises"
  └ parameters: TSchema   ├ execute(toolCallId,        ├ parameters: Type.Object({...})
                              params, signal,           └ execute: async (id, params) => {...}
                              onUpdate)
                          └ prepareArguments?()
```

#### TypeBox → JSON Schema 的转换是**自动且无损的**

关键代码在 `packages/ai/src/utils/validation.ts:297`：
```typescript
if (!hasTypeBoxMetadata(tool.parameters) && isJsonSchemaObject(tool.parameters)) {
  // ...
}
```

以及 provider 层直接透传：
```typescript
// openai-completions.ts:951
parameters: tool.parameters as any, // TypeBox already generates JSON Schema
```

TypeBox 的 `Type.Object({...})` 在运行时**已经是合法的 JSON Schema 对象**（通过 `Symbol.for("TypeBox.Kind")` 标记）。Provider 层直接将其序列化进 LLM API 请求的 `tools[].function.parameters` 字段，无需额外转换。

#### 一个完整的工具定义拆解（以 `log_body_metrics` 为例）

```typescript
// 1. 用 TypeBox 定义参数 Schema（会被序列化为 JSON Schema 发给 LLM）
const logBodyMetricsSchema = Type.Object({
  date:    Type.Optional(Type.String({ description: "Measurement date YYYY-MM-DD" })),
  weight:  Type.Optional(Type.Number({ description: "Body weight in kg" })),
  bodyFat: Type.Optional(Type.Number({ description: "Body fat percentage" })),
  measurements: Type.Optional(
    Type.Record(Type.String(), Type.Number(), {
      description: 'Body measurements in cm, e.g. { "chest": 100, "waist": 80 }'
    })
  ),
});

// 2. 创建 AgentTool 对象
export function createLogBodyMetricsTool(dataDir: string): AgentTool<typeof logBodyMetricsSchema> {
  return {
    name: "log_body_metrics",            // LLM 看到的工具名
    label: "Log Body Metrics",           // UI 显示用，不发给 LLM
    description: "Record body measurements: weight, body fat...",  // LLM 据此判断何时调用
    parameters: logBodyMetricsSchema,     // TypeBox schema → JSON Schema → LLM
    async execute(_toolCallId, params) {  // LLM 返回的 JSON 参数在此被 TypeBox 校验后执行
      await ensureLoaded(dataDir);
      const metrics = getMetrics(dataDir);
      // ... 业务逻辑 ...
    }
  };
}
```

#### CLI vs Bot 的工具注册对比

```
CLI (sdk.ts)                          Bot (agent.ts → tools/index.ts)
──────────────────────────────────────────────────────────────────────
createAgentSession({                  createMomTools(executor, channelDir)
  fitnessMode: true,                      ↓
})                                    [
  ↓                                     createReadTool(executor),    // 经 sandbox 包装
AgentSession._buildTools()              createBashTool(executor),    // 经 sandbox 包装
  ↓                                     createEditTool(executor),    // 经 sandbox 包装
内置工具 (read/bash/edit/write/...)     createWriteTool(executor),   // 经 sandbox 包装
+ customTools (健身工具由调用者传入)     attachTool,                 // 文件分享
+ extensionTools (扩展系统注册)         ...createAllFitnessTools(),  // 直接复用 claw 的健身工具
  ↓                                    ]
传给 Agent({ tools })
```

注意：Bot 的 `bash/read/edit/write` 经过了 sandbox executor 重新包装（命令在容器/子进程中执行），而健身工具是**直接复用** `@fitclaw/claw` 的 `createAllFitnessTools()`——同一套工具代码服务于两个入口。

### 6.5.3 工具调用完整流程：从用户消息到工具执行

```
用户发送消息 "今天练什么"
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. LLM 请求阶段  (streamAssistantResponse)                   │
│                                                              │
│   transformContext(messages)  // 可选：上下文变换/压缩        │
│       ↓                                                      │
│   convertToLlm(messages)      // AgentMessage[] → Message[]  │
│       ↓                                                      │
│   构建 Context {                                              │
│     systemPrompt,  ← CLI 或 Bot 各自的 system prompt         │
│     messages,      ← 转换后的 LLM 兼容消息列表               │
│     tools,         ← AgentTool[] 直接作为 Tool[] 传给 LLM    │
│   }                                                          │
│       ↓                                                      │
│   streamSimple(model, context, options)                      │
│       ↓                                                      │
│   根据 model.api 路由到对应 provider:                         │
│     OpenAI / Anthropic / Google / Mistral / ...              │
│       ↓                                                      │
│   Provider 将 Tool 序列化为 API 要求的格式:                   │
│     OpenAI:     tools[].function.{name,description,parameters}│
│     Anthropic:  tools[].{name,description,input_schema}       │
│     Google:     tools[].functionDeclarations[]                │
└──────────────────────────────────────────────────────────────┘
    │
    ▼  HTTP Response (SSE / JSON Stream)
┌──────────────────────────────────────────────────────────────┐
│ 2. LLM 响应解析阶段                                          │
│                                                              │
│   事件流:                                                     │
│     start → text_start → text_delta → text_end              │
│           → toolcall_start → toolcall_delta → toolcall_end  │
│           → done                                             │
│       ↓                                                      │
│   组装成 AssistantMessage {                                  │
│     content: [                                               │
│       { type: "text", text: "好的，让我查一下..." },         │
│       { type: "toolCall",                                    │
│         id: "call_abc123",                                   │
│         name: "get_today_workout",                           │
│         arguments: { "label": "查看今日训练" }                │
│       }                                                      │
│     ]                                                        │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. 工具执行阶段  (executeToolCalls)                          │
│                                                              │
│   检测 assistantMessage.content 中的 toolCall block:         │
│     ↓                                                        │
│   for each toolCall:                                         │
│     ① 查找工具: context.tools.find(t => t.name === tc.name) │
│     ② prepareArguments(): 参数兼容性转换（可选）             │
│     ③ validateToolArguments(): TypeBox 校验参数              │
│     ④ beforeToolCall 钩子: 可 block 工具执行                │
│     ⑤ tool.execute(toolCallId, params, signal)              │
│     ⑥ afterToolCall 钩子: 可修改执行结果                    │
│     ↓                                                        │
│   生成 ToolResultMessage {                                   │
│     role: "toolResult",                                      │
│     toolCallId: "call_abc123",                               │
│     content: [{ type: "text", text: "今日训练: ..." }],     │
│     isError: false                                           │
│   }                                                          │
│     ↓                                                        │
│   将 ToolResultMessage 加入 context.messages                 │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. 循环判断                                                  │
│                                                              │
│   如果 hasMoreToolCalls (LLM 返回了更多 tool call):          │
│     → 回到步骤 1，继续下一轮 LLM 调用                        │
│   如果 pendingMessages 有排队消息:                            │
│     → 注入消息，继续循环                                     │
│   否则:                                                      │
│     → emit agent_end，结束                                   │
└──────────────────────────────────────────────────────────────┘
```

### 6.5.4 "触发词"机制的真相

System prompt 中的触发词（如 `Use when user says "今天练什么"`）**不是代码级别的路由逻辑**。它们的工作原理是：

```
System Prompt 中的工具描述块:
  - get_today_workout: Get today's scheduled workout.
    Use when user asks "今天练什么"/"今天的训练"/"今日计划".
    Do NOT use bash to check the date.

          ↓ 作为 system prompt 的一部分发给 LLM
          ↓ LLM 阅读这段文本，理解语义
          ↓

  用户说 "今天练什么"
          ↓
  LLM 判断: 这匹配 get_today_workout 的触发条件
          ↓
  LLM 输出 toolCall: { name: "get_today_workout", arguments: {...} }
```

**本质上，这是 Prompt Engineering，不是代码路由。** LLM 根据 system prompt 中的自然语言描述（包括触发词示例）来决定调用哪个工具。System prompt 中写 `Use when user says "XXX"` 就是给 LLM 的 few-shot 行为指引。

这套机制的优势和风险：

| 优势 | 风险 |
|------|------|
| 无需额外路由代码，LLM 自行判断 | LLM 可能误判，调用错误的工具 |
| 支持模糊匹配（"今天练啥"也能命中） | 需要精心编写触发词覆盖各种说法 |
| 可以写否定规则（`Do NOT use bash`） | 触发词过多会占用 context window |
| 中英文混用自然支持 | 依赖 LLM 的理解能力 |

### 6.5.5 Context Files 加载机制详解

#### `AGENTS.md` / `CLAUDE.md` 的加载（仅 CLI）

```
loadProjectContextFiles({ cwd, agentDir })
    │
    ├── ① 加载全局: loadContextFileFromDir(agentDir)
    │     查找 ~/.fitclaw/agent/AGENTS.md 或 CLAUDE.md
    │     (存在则取第一个)
    │
    └── ② 从 cwd 向上遍历到根目录:
          每个目录查找 AGENTS.md 或 CLAUDE.md
          (子目录优先，加入 contextFiles)
             ↓
          按"祖先 → 子孙"顺序排列
             ↓
          注入 system prompt 的 "Project Context" 段落
```

关键代码（`resource-loader.ts:58-74`）：
```typescript
const candidates = ["AGENTS.md", "CLAUDE.md"];
for (const filename of candidates) {
  const filePath = join(dir, filename);
  if (existsSync(filePath)) { return { path: filePath, content: ... }; }
}
```

**注意**：每个目录只加载第一个找到的文件（`AGENTS.md` 优先于 `CLAUDE.md`）。这两个文件是**互斥**的——同一目录下不会同时加载。

#### `SYSTEM.md` / `APPEND_SYSTEM.md` 的加载（仅 CLI）

```
discoverSystemPromptFile()
    ├── ① 项目级: <cwd>/.fitclaw/SYSTEM.md
    └── ② 全局级: ~/.fitclaw/agent/SYSTEM.md
         (项目级优先)

discoverAppendSystemPromptFile()
    ├── ① 项目级: <cwd>/.fitclaw/APPEND_SYSTEM.md
    └── ② 全局级: ~/.fitclaw/agent/APPEND_SYSTEM.md
```

区别：
- `SYSTEM.md`：**替换**默认 system prompt（通过 `customPrompt` 参数）
- `APPEND_SYSTEM.md`：**追加**到默认 system prompt 末尾（通过 `appendSystemPrompt` 参数）

#### Bot 为什么不加载这些文件？

Bot 的设计哲学是**自包含**。它的运行环境是后台守护进程，不存在 "cwd 项目上下文" 的概念。所有行为规则直接写在 `buildSystemPrompt()` 函数里，所有知识放在 `.fitclaw/prompts/` 下。这样设计的好处是：

- 行为可预测（不依赖文件系统上的外部文件）
- 部署简单（不需要在每个 workspace 配置 AGENTS.md）
- 健身知识通过 `.fitclaw/prompts/` 统一管理

### 动手实验

1. **对比 CLI 和 Bot 的 system prompt**：在 `system-prompt.ts` 的 `buildSystemPrompt()` 返回前加 `console.log(prompt)`，跑 `--fitness` 模式；在 `agent.ts` 的 `buildSystemPrompt()` 返回前加 `console.log(prompt)`，启动 Bot。对比两个 prompt 的差异。

2. **追踪一次工具调用**：在 `agent-loop.ts` 的 `streamAssistantResponse()` 和 `executeToolCalls()` 入口处加日志，发一条 "今天练什么"，观察 LLM 返回的完整 toolCall JSON。

3. **添加一个新触发词**：在 Bot 的 `buildSystemPrompt()` 中给 `get_today_workout` 增加触发词 `"今天该练啥"/"训练安排"`，重启 Bot 测试 LLM 能否识别。

---

## 阶段 7：扩展系统（选学，3-5 天）

### 目标
理解插件机制的设计和实现。

### 阅读顺序

```
packages/coding-agent/src/core/extensions/loader.ts   (扩展加载)
packages/coding-agent/src/core/extensions/runner.ts   (事件执行)
packages/coding-agent/src/core/extensions/wrapper.ts  (工具包装)
docs/extensions.md                                    (如果有)
```

### 扩展能力矩阵

| 能力 | API | 说明 |
|------|-----|------|
| 注册命令 | `pi.registerCommand()` | `/xxx` 斜杠命令 |
| 注册工具 | `pi.registerTool()` | 动态添加 AgentTool |
| 拦截输入 | `pi.on("input")` | 修改或拦截用户输入 |
| 拦截工具调用 | `pi.on("tool_call")` | block/allow 工具 |
| 拦截工具结果 | `pi.on("tool_result")` | 修改结果 |
| 修改请求 | `pi.on("before_provider_request")` | 修改 LLM payload |
| 会话事件 | `pi.on("session_start"/"session_end")` | 生命周期 |
| 资源发现 | `pi.on("resources_discover")` | 动态加载技能/主题 |

---

## 阶段 8：动手改造（持续）

### 入门任务（由易到难）

| # | 任务 | 涉及文件 | 难度 |
|---|------|----------|------|
| 1 | 修改系统提示词，添加新 guideline | `system-prompt.ts` | ★ |
| 2 | 添加新健身工具（如连续训练天数） | `tools/fitness/` | ★★ |
| 3 | 给飞书回复添加卡片渲染 | `main.ts` + `card-renderer.ts` | ★★ |
| 4 | 提取 Compaction 逻辑到独立服务 | `agent-session.ts` | ★★★ |
| 5 | 给健身数据加 Zod Schema 校验 | `tools/fitness/store.ts` | ★★ |
| 6 | 实现飞书 WebSocket 断线重连 | `feishu.ts` | ★★★ |
| 7 | 将健身工具拆分为独立扩展包 | `extensions/` | ★★★★ |

---

## 附录 A：关键文件速查

| 需求 | 文件路径 |
|------|----------|
| CLI 入口 | `packages/coding-agent/src/cli.ts` |
| 参数解析 | `packages/coding-agent/src/cli/args.ts` |
| 主流程 | `packages/coding-agent/src/main.ts` |
| Session 工厂 | `packages/coding-agent/src/core/sdk.ts` |
| 业务核心 | `packages/coding-agent/src/core/agent-session.ts` |
| 系统提示词 | `packages/coding-agent/src/core/system-prompt.ts` |
| Agent 运行时 | `packages/agent/src/agent.ts` + `agent-loop.ts` |
| LLM 统一层 | `packages/ai/src/stream.ts` + `types.ts` |
| 内置工具 | `packages/coding-agent/src/core/tools/*.ts` |
| 健身工具 | `packages/coding-agent/src/core/tools/fitness/*.ts` |
| 动作数据库 | `packages/coding-agent/data/exercises.json` |
| 扩展系统 | `packages/coding-agent/src/core/extensions/` |
| 会话持久化 | `packages/coding-agent/src/core/session-manager.ts` |
| Bot 入口 | `packages/mom/src/main.ts` |
| 飞书适配 | `packages/mom/src/feishu.ts` |
| 配置文件 | `packages/coding-agent/src/config.ts` |

## 附录 B：调试技巧

```bash
# 查看工具调用日志
pm2 logs --lines 100 | grep -E "↳|✓|💬"

# 运行单个测试
npm run test -- packages/mom/test/card-renderer.test.ts

# 查看构建产物
cd packages/coding-agent && npm run build && ls dist/

# 本地运行 CLI（开发模式）
cd packages/coding-agent && npx tsx src/cli.ts --fitness

# 查看会话文件
cat ~/.fitclaw/agent/sessions/<session-id>.jsonl | head -20
```
