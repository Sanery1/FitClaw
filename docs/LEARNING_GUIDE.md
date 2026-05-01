# FitClaw 项目学习指南

> 本文档指导开发者从 0 到 1 理解 FitClaw 项目架构。按阶段阅读，每个阶段有明确的目标、阅读清单和动手任务。

---

## 项目定位

**FitClaw = AI 健身私教 + 智能编程助手**，基于 pi-mono fork 的全栈 AI Agent 平台。

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
