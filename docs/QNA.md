# FitClaw 技术架构 Q&A

> 基于源码与文档的详细技术问答，涵盖架构设计、实现细节与工程实践。
> **最后更新：2026-05-07**

后续 AI Agent 接手项目时，先读 [PROJECT_UNDERSTANDING.md](./PROJECT_UNDERSTANDING.md) 获取 5-10 分钟速览，再按需读本文档中的详细问答。

---

## 一、三层架构与 ReAct 推理引擎

### Q1: fit-ai / fit-agent-core / fit-claw 三层的职责边界与依赖关系具体如何划分？层间通信采用什么机制？

**A:**

三层架构如下：

```
应用层 (@fitclaw/claw + @fitclaw/mom)
  │  会话管理、Skill 系统、系统提示词组装、上下文压缩、CLI/Bot 交互
  ↓
Agent 框架层 (@fitclaw/agent-core)
  │  推理循环（runLoop）、工具执行引擎、Steering/FollowUp 双队列、事件系统
  ↓
LLM 抽象层 (@fitclaw/ai)
     26 个 Provider 统一接入、流式事件协议、JSON Schema 参数校验
```

**职责边界：**

| 层 | 包名 | 核心职责 |
|----|------|----------|
| LLM 抽象层 | `@fitclaw/ai` | 统一 `Message`/`Context`/`Model` 类型定义；10 种 API 协议（`KnownApi`）/ 26 个内置 Provider（`KnownProvider`）的流式接入；`EventStream` 异步迭代流协议；工具参数 JSON Schema 校验（TypeBox）；API Key 解析（环境变量 + OAuth + ADC） |
| Agent 框架层 | `@fitclaw/agent-core` | `runLoop()` 双层 while 循环驱动推理；`executeToolCalls()` 并行/顺序工具执行引擎；`BeforeToolCall`/`AfterToolCall` 钩子；Steering（实时注入）/ FollowUp（后置任务）双队列；`Agent` 状态机（isStreaming/pendingToolCalls/errorMessage）；生命周期事件（agent_start/end、turn_start/end、message_*、tool_execution_*） |
| 应用层 | `@fitclaw/claw` / `@fitclaw/mom` | CLI 交互式 TUI / 飞书 Bot 适配；`SessionManager` JSONL 树形持久化；Skill 发现/加载/渐进式披露；`buildSystemPrompt()` 动态组装；上下文压缩（compaction）；`FileSportDataStore` 运动数据持久化；扩展系统（registerCommand/registerTool/钩子） |

**依赖关系：** 每层只依赖下层的类型接口，不依赖具体实现。`agent-loop.ts` 只 import `@fitclaw/ai` 的类型，不 import `@fitclaw/claw`。CLI 和 Bot 是两个独立的应用层实现，共享同一个 Agent 框架层。

**层间通信机制：**
- **类型接口**：下层导出 TypeScript 接口（`Message`、`Context`、`AgentTool`、`StreamFn`），上层依赖接口而非实现
- **事件流**：`EventStream<AgentEvent, AgentMessage[]>` 是 `AsyncIterable`，上层用 `for await` 消费生命周期事件
- **依赖注入**：`Agent` 构造函数接收 `streamFn`、`convertToLlm`、`transformContext`、`getApiKey` 等函数，由上层注入具体实现
- **钩子函数**：`beforeToolCall`/`afterToolCall` 钩子允许上层拦截和修改工具调用行为

**核心文件：** `packages/ai/src/types.ts`、`packages/agent/src/agent-loop.ts`、`packages/coding-agent/src/core/sdk.ts`

---

### Q1-1: LLM 抽象层是怎么抽象封装的？不同模型他们的字段是不同的？怎么屏蔽这种不同？会有一个统一的结构吗？

**A:**

---

#### 先看结论：这层到底在做什么？

LLM 抽象层的目标不是“把所有模型变成同一个模型”，而是把**不同 Provider 的输入/输出协议差异封装起来**。上层 Agent 只面对 FitClaw 的统一类型：

```text
上层 Agent 只认：
  Model
  Context
  Message
  Tool
  AssistantMessageEvent

Provider 适配器负责：
  FitClaw 统一 Context -> Provider 请求格式
  Provider 流式响应 -> FitClaw 统一事件
```

一句话：

> FitClaw 内部说统一语言；发给模型前翻译成 Provider 方言；模型回包后再翻译回统一事件。

---

#### 阅读主线

这一节可以按这个顺序理解：

| 顺序 | 要解决的问题 | 对应概念 |
|------|--------------|----------|
| 1 | 不同模型返回格式不同，怎么屏蔽？ | `Message` / `ContentBlock` / `AssistantMessageEvent` |
| 2 | 一个模型怎么知道走哪个协议？ | `model.api` |
| 3 | API Key 和 `model.api` 是不是一回事？ | 不是，API Key 由 `provider` 找 |
| 4 | 小众模型怎么接入？ | 复用 OpenAI/Anthropic 等兼容协议 |
| 5 | 什么时候才要注册新 Provider？ | 完全新协议才需要 |
| 6 | `streamSimple`、`stream`、适配器函数是什么关系？ | 统一入口、简单入口、协议实现 |
| 7 | 实际转化长什么样？ | DeepSeek 复用 OpenAI 适配器 |
| 8 | 流式返回最终变成什么？ | `AssistantMessage` |

第 9-11 节是源码深读：完整旅程、模式总结、最终类比。第一次读可以先看 1-8。

---

#### 核心名词先对齐

- `model.api` 不是 API Key。它是 FitClaw 内部用来选择“哪一种上游 API 协议”的路由键，例如 `"anthropic-messages"`、`"openai-responses"`、`"azure-openai-responses"`、`"google-generative-ai"`。
- API Key 是另一回事。`packages/coding-agent/src/core/sdk.ts` 会先通过 `modelRegistry.getApiKeyAndHeaders(model)` 取到 `apiKey` 和请求头，再把它们传给 `streamSimple(model, context, options)`。
- Provider 是预先注册好的。`packages/ai/src/stream.ts` import 了 `providers/register-builtins.ts`，该文件末尾会执行 `registerBuiltInApiProviders()`，把 `api -> { stream, streamSimple }` 放进 `apiProviderRegistry` 这个 Map。
- `streamSimple` 是上层常用入口，接收统一的 `reasoning`、`apiKey`、`headers`、超时、重试等通用参数；`stream` 是 Provider 的协议级实现，负责把统一 `Context` 变成上游 HTTP 请求，再把上游流式响应翻译回统一事件。

可以把它想成一套总机：

```text
用户选择模型
  -> 得到 Model: { id, provider, api, baseUrl, reasoning, ... }
  -> sdk.ts 根据 provider 取 API Key
  -> streamSimple(model, context, { apiKey, headers, ... })
  -> 用 model.api 查表找到 Provider
  -> Provider.stream / streamSimple 发真实请求并翻译事件
```

---

#### 1. 问题背景：不同 Provider 的格式不一样

假设你直接对接不同模型，同一个"Hello"文本，返回格式天差地别：

**OpenAI 返回：**
```json
{ "choices": [{ "delta": { "content": "Hello" } }] }
```

**Anthropic 返回：**
```json
{ "type": "content_block_delta", "delta": { "text": "Hello" } }
```

**Gemini 返回：**
```json
{ "candidates": [{ "content": { "parts": [{ "text": "Hello" }] } }] }
```

如果你直接在业务代码里处理这些差异，结果就是 **if-else 地狱**——每新增一个厂商，所有消费流事件的地方都要加分支。FitClaw 要对接 26 个 Provider，如果这么做，代码根本无法维护。

---

#### 2. 核心思想：内部统一，边界翻译

> **"不让上层适配模型，而是让模型适配我"**

具体做法：定义一套"普通话"（统一类型），每个 Provider 提供一个"翻译官"（适配器），把自家的"方言"翻译成"普通话"。上层代码只认"普通话"，完全不知道底层是谁在说话。

---

#### 3. 三层抽象

##### 3.1 统一类型：立规矩

这一步不是转换数据，而是**定义一个"统一宇宙"**——所有 Provider 的输入/输出都必须符合这个世界的规则：

```typescript
// 统一消息类型（与 Provider 无关）
type Message = UserMessage | AssistantMessage | ToolResultMessage;

// 统一内容块 —— 因为 LLM 会混着输出文本、思考、工具调用，必须拆成"块"
type ContentBlock = TextContent | ThinkingContent | ToolCall;

// 统一流事件 —— 源码里的完整协议包含 start/delta/end/done/error
type AssistantMessageEvent =
  | { type: "start";        partial: AssistantMessage }
  | { type: "text_start";   contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta";   contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end";     contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done";   reason: "stop"|"length"|"toolUse"; message: AssistantMessage }
  | { type: "error";  reason: "error"|"aborted"; error: AssistantMessage };
```

> **`partial` 是干嘛的？** 它是“当前已经拼到一半的 assistant 消息”。比如模型一边吐文本、一边吐工具调用参数时，Provider 会持续更新同一个 `AssistantMessage.content` 数组，然后把最新快照放进 `partial`。上层 UI 不需要理解 OpenAI/Anthropic/Gemini 的原生流事件，只要看 `partial.content` 和事件类型即可。

这里的“统一结构”分三层：

| 统一结构 | 解决什么问题 |
|----------|--------------|
| `Message` | 把用户消息、助手消息、工具结果放进同一个历史数组 |
| `ContentBlock` | 把助手输出拆成文本、思考、工具调用三类块 |
| `AssistantMessageEvent` | 把各家 Provider 的流式增量统一成同一套事件 |

---

##### 3.2 Provider 适配器：翻译官

每个 Provider 只做一件事：

```typescript
stream(model, context, options) → AssistantMessageEventStream
```

把自家的"方言"翻译成"普通话"：

```
Anthropic 原生事件: { type: "content_block_delta", delta: { text: "新" } }
        │
        ▼ Provider 翻译
        │
统一事件: stream.push({ type: "text_delta", delta: "新" })
```

上层看到的是 `text_delta`，完全不知道底层是 Anthropic 还是 OpenAI。**这一层是整个系统最关键的"魔法"**。

> **为什么有 `streamSimple` + `stream` 两层？**
>
> `streamSimple` 是“统一入口”：上层只传 `SimpleStreamOptions`，例如 `reasoning: "high"`、`apiKey`、`headers`、`timeoutMs`、`maxRetries`。不同 Provider 会在自己的 `streamSimpleXxx` 中把这些通用参数翻译成自家参数，例如 Anthropic 的 thinking effort、OpenAI 的 reasoning effort、Gemini 的 thinking level 或 token budget。
>
> `stream` 是“协议实现”：它已经拿到 Provider 专属选项，负责做真实请求和事件翻译。例如 Anthropic 的 `streamAnthropic()` 会创建 Anthropic SDK 客户端，发送 `client.messages.create({ stream: true })`，再把 `content_block_delta` 等原生事件翻译成 `text_delta`、`toolcall_delta`、`done` 等统一事件。

---

##### 3.3 路由系统：按 `model.api` 找适配器

整个设计最优雅的地方就这一行：

```typescript
const provider = resolveApiProvider(model.api);  // 按字符串查 Map
```

`model.api = "anthropic-messages"` → 自动走 Anthropic 协议适配器；换成 `"openai-responses"` → 自动走 OpenAI Responses 协议适配器。**没有 if / switch，全靠 `Map<string, Provider>`**。

`model.api` 从哪里来？主要来自两处：

1. 内置模型：`packages/ai/src/models.generated.ts` 里每个模型都带 `api` 字段，例如 `claude-opus-4-7` 的 `api` 是 `"anthropic-messages"`。
2. 自定义模型：`packages/coding-agent/src/core/model-registry.ts` 会读取 `models.json` 或扩展注册的模型配置；如果是自定义 Provider，配置里也需要说明 `api` 或继承 Provider 级默认值。

Provider 是怎么注册的？`packages/ai/src/providers/register-builtins.ts` 会注册内置 API：

```typescript
registerApiProvider({ api: "xxx", stream: streamXxx, streamSimple: streamSimpleXxx });
```

注册后，`packages/ai/src/stream.ts` 的入口函数只做查表：

```typescript
export function streamSimple(model, context, options) {
  const provider = resolveApiProvider(model.api);
  return provider.streamSimple(model, context, options);
}
```

如果 `model.api` 没有注册，就会抛出：`No API provider registered for api: ...`。

#### 4. 小众模型怎么接入？

小众模型通常不需要单独写 Provider。关键看它“说哪种协议”：

| 小众模型/平台的上游协议 | `model.api` 应该填什么 | 是否需要新适配器 |
|------------------------|------------------------|------------------|
| OpenAI Chat Completions 兼容 | `"openai-completions"` | 通常不需要 |
| OpenAI Responses 兼容 | `"openai-responses"` | 通常不需要 |
| Anthropic Messages 兼容 | `"anthropic-messages"` | 通常不需要 |
| Gemini 原生协议 | `"google-generative-ai"` / `"google-vertex"` | 已有内置适配器 |
| 完全自定义协议 | 新的 `api` 名称 | 需要注册新的 `streamSimple`/Provider |

项目里很多“小众 Provider”其实就是这种做法：模型来自不同平台，但 `api` 复用已有协议适配器。例如：

```typescript
{
  id: "deepseek-v3.2",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  compat: {
    thinkingFormat: "deepseek",
    requiresReasoningContentOnAssistantMessages: true
  }
}
```

```typescript
{
  id: "some-groq-model",
  api: "openai-completions",
  provider: "groq",
  baseUrl: "https://api.groq.com/openai/v1"
}
```

```typescript
{
  id: "claude-opus-4-7",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com"
}
```

这说明 `provider` 和 `api` 不是一回事：

| 字段 | 含义 | 例子 |
|------|------|------|
| `provider` | 账号/鉴权/模型归属，用来找 API Key、展示供应商 | `"deepseek"`、`"groq"`、`"openrouter"` |
| `api` | 协议路由，用来找哪个适配器处理请求 | `"openai-completions"`、`"anthropic-messages"` |
| `baseUrl` | 真实请求地址 | `"https://api.groq.com/openai/v1"` |
| `id` | 上游模型名，最终会作为请求里的 `model` 字段 | `"llama-3.3-70b-versatile"` |

所以“小众模型接入”的核心不是“给每个模型写一套代码”，而是给模型贴对协议标签：

```json
{
  "providers": {
    "my-small-provider": {
      "api": "openai-completions",
      "baseUrl": "https://example.com/openai/v1",
      "apiKey": "MY_SMALL_PROVIDER_API_KEY",
      "models": [
        {
          "id": "my-small-model",
          "name": "My Small Model",
          "reasoning": false,
          "input": ["text"],
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "contextWindow": 128000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

`ModelRegistry.parseModels()` 会按这个顺序识别 `api`：

```typescript
const api = modelDef.api ?? providerConfig.api ?? builtInDefaults?.api;
```

也就是：

1. 单个模型自己写了 `api`，用模型自己的。
2. 模型没写，Provider 配置写了 `api`，用 Provider 的。
3. 如果是在覆盖内置 Provider，且前两者都没写，就继承内置 Provider 的默认 `api`。
4. 仍然没有 `api`，这个模型不会被加入可用模型列表。

如果某个小众平台只是 OpenAI-compatible，那么它最终会走这条链路：

```text
model.api = "openai-completions"
  -> streamSimple()
  -> resolveApiProvider("openai-completions")
  -> streamSimpleOpenAICompletions()
  -> streamOpenAICompletions()
  -> new OpenAI({ apiKey, baseURL: model.baseUrl })
  -> client.chat.completions.create({ model: model.id, messages, stream: true })
```

只有当上游既不是 OpenAI-compatible，也不是 Anthropic-compatible，也不是已有 Gemini/Bedrock/Mistral 协议时，才需要注册新的 Provider：

```typescript
registerApiProvider({
  api: "my-custom-api",
  stream: streamMyCustomApi,
  streamSimple: streamSimpleMyCustomApi,
});
```

或者通过扩展系统注册 `streamSimple`，但配置里必须提供 `api`，否则 `ModelRegistry.validateProviderConfig()` 会报错：`"api" is required when registering streamSimple.`

#### 5. 注册新的 Provider 是什么过程？

这里要分清两种“注册”：

| 场景 | 是否启动时已注册 | 用户要提供什么 |
|------|------------------|----------------|
| 使用内置协议，例如 OpenAI/Anthropic/Gemini/Bedrock | 是，`register-builtins.ts` 已经注册 | 只需要选模型或配置 `baseUrl`/`apiKey`/`models` |
| 接入 OpenAI-compatible 小众平台 | 协议适配器已注册 | 配 `api: "openai-completions"`、`baseUrl`、`apiKey`、模型列表 |
| 接入完全新协议 | 否 | 必须提供新的 `api` 名称和 `streamSimple` 实现 |

内置 Provider 的注册发生在模块加载时。`packages/ai/src/providers/register-builtins.ts` 最后直接调用：

```typescript
registerBuiltInApiProviders();
```

它会把内置协议放进 `apiProviderRegistry`：

```typescript
registerApiProvider({
  api: "openai-completions",
  stream: streamOpenAICompletions,
  streamSimple: streamSimpleOpenAICompletions,
});

registerApiProvider({
  api: "anthropic-messages",
  stream: streamAnthropic,
  streamSimple: streamSimpleAnthropic,
});
```

`api-registry.ts` 里本质就是一个 Map：

```typescript
const apiProviderRegistry = new Map<string, RegisteredApiProvider>();
```

注册就是往 Map 里塞一条记录：

```typescript
apiProviderRegistry.set(provider.api, {
  provider: {
    api: provider.api,
    stream: wrapStream(provider.api, provider.stream),
    streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
  },
  sourceId,
});
```

所以运行时路由非常直接：

```text
model.api
  -> apiProviderRegistry.get(model.api)
  -> provider.streamSimple(model, context, options)
```

对普通用户来说，最常见情况不是“注册新 Provider”，而是“声明一个新模型使用已有协议”。例如 OpenAI-compatible 平台只需要这样：

```json
{
  "providers": {
    "my-provider": {
      "api": "openai-completions",
      "baseUrl": "https://example.com/openai/v1",
      "apiKey": "MY_PROVIDER_API_KEY",
      "models": [
        {
          "id": "my-model",
          "name": "My Model",
          "reasoning": false,
          "input": ["text"],
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "contextWindow": 128000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

这不会新增协议适配器，只是新增一个 `Model`，让它复用已经注册好的 `"openai-completions"`。

真正注册新 Provider 时，需要的是代码能力，不只是配置。扩展系统最终会调用 `ModelRegistry.registerProvider(providerName, config)`；如果 `config.streamSimple` 存在，`applyProviderConfig()` 会执行：

```typescript
registerApiProvider(
  {
    api: config.api!,
    stream: (model, context, options) =>
      streamSimple(model, context, options as SimpleStreamOptions),
    streamSimple,
  },
  `provider:${providerName}`,
);
```

因此用户/扩展至少要提供：

| 必需项 | 作用 |
|--------|------|
| `api` | 新协议的路由名，例如 `"my-custom-api"` |
| `streamSimple` | 把 FitClaw 的 `Model + Context + options` 转成上游请求，再返回 `AssistantMessageEventStream` |
| `models` | 这个 Provider 暴露哪些模型 |
| `baseUrl` | 上游服务地址 |
| `apiKey` 或 `oauth` | 鉴权方式 |

如果只是注册 `streamSimple` 但没给 `api`，源码会直接拒绝：

```typescript
if (config.streamSimple && !config.api) {
  throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
}
```

如果定义了 `models`，但没有 `baseUrl` 或没有 `apiKey/oauth`，也会被拒绝。这是为了保证模型进入列表后，后续请求真的有路由、有地址、有鉴权。

#### 6. `streamSimple`、`stream`、具体适配器函数是什么关系？

可以按三层理解：

```text
@fitclaw/ai 对外统一入口
  streamSimple(model, context, options)
    -> 按 model.api 查 apiProviderRegistry
    -> provider.streamSimple(...)

Provider 的简单入口
  streamSimpleOpenAICompletions(...)
  streamSimpleAnthropic(...)
  streamSimpleGoogle(...)
    -> 把通用 options 翻译成该协议需要的 options
    -> 调用同协议的 streamXxx(...)

Provider 的协议实现
  streamOpenAICompletions(...)
  streamAnthropic(...)
  streamGoogle(...)
    -> 转换消息格式
    -> 发真实 HTTP/SDK 请求
    -> 把上游原生流事件翻译成 AssistantMessageEvent
```

所以关系不是“每个模型一个适配器函数”，而是“每种 API 协议一个适配器函数”。很多模型共享同一个适配器：

```text
deepseek 模型
groq 模型
openrouter 模型
某个自定义 OpenAI-compatible 模型
  -> model.api = "openai-completions"
  -> streamSimpleOpenAICompletions()
  -> streamOpenAICompletions()
```

而 Anthropic 协议模型走另一组：

```text
claude-opus-4-7
某个 Anthropic-compatible 代理模型
  -> model.api = "anthropic-messages"
  -> streamSimpleAnthropic()
  -> streamAnthropic()
```

`streamSimple` 和 `stream` 都是注册到同一个 Provider 记录里的两个入口：

```typescript
registerApiProvider({
  api: "openai-completions",
  stream: streamOpenAICompletions,
  streamSimple: streamSimpleOpenAICompletions,
});
```

两者职责不同：

| 名称 | 位置 | 谁调用 | 做什么 |
|------|------|--------|--------|
| `streamSimple()` | `packages/ai/src/stream.ts` | 应用层/Agent 层 | 统一入口，按 `model.api` 找 Provider |
| `provider.streamSimple()` | 注册表里的函数 | `streamSimple()` | 把通用参数翻译成协议参数 |
| `provider.stream()` | 注册表里的函数 | `stream()` 或同协议 `streamSimpleXxx()` | 执行协议级请求和事件翻译 |
| `streamOpenAICompletions()` / `streamAnthropic()` | 各 Provider 文件 | `streamSimpleXxx()` 或 `provider.stream()` | 具体适配器实现 |

以 OpenAI-compatible 小众模型为例，完整链路是：

```text
Agent.runLoop()
  -> sdk.ts 注入的 streamFn(model, context, options)
  -> modelRegistry.getApiKeyAndHeaders(model)
  -> @fitclaw/ai streamSimple(model, context, { apiKey, headers, ... })
  -> resolveApiProvider(model.api)
  -> provider.streamSimple(model, context, options)
  -> streamSimpleOpenAICompletions(model, context, options)
  -> streamOpenAICompletions(model, context, openAIOptions)
  -> new OpenAI({ apiKey, baseURL: model.baseUrl })
  -> client.chat.completions.create({ model: model.id, messages, stream: true })
  -> 输出统一 AssistantMessageEvent
```

关键点：

1. `model.id` 决定请求哪个模型。
2. `model.provider` 决定从哪里拿 API Key、headers，以及展示归属。
3. `model.api` 决定走哪个协议适配器。
4. 适配器函数通常按协议写，不按单个模型写。

#### 7. 实际例子：DeepSeek 模型复用 OpenAI 适配器

假设当前模型是一个 OpenAI-compatible 的 DeepSeek 模型：

```typescript
const model = {
  id: "deepseek-v3.2",
  provider: "deepseek",
  api: "openai-completions",
  baseUrl: "https://api.deepseek.com",
  reasoning: true,
};
```

Agent 层传进来的 FitClaw 统一上下文可能是：

```typescript
const context = {
  systemPrompt: "You are FitClaw.",
  messages: [
    {
      role: "user",
      content: "读取我的训练记录，然后给我下一次训练建议。",
      timestamp: 1760000000000,
    },
  ],
  tools: [
    {
      name: "data_bodybuilding_read",
      description: "Read bodybuilding data",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string" },
        },
        required: ["namespace"],
      },
    },
  ],
};
```

第一步，应用层调用统一入口：

```typescript
streamSimple(model, context, {
  apiKey: "sk-...",
  reasoning: "medium",
  headers: { "X-App": "FitClaw" },
});
```

`streamSimple()` 只按 `model.api` 查表：

```typescript
const provider = resolveApiProvider(model.api);
return provider.streamSimple(model, context, options);
```

因为 `model.api === "openai-completions"`，所以实际调用的是：

```text
streamSimpleOpenAICompletions(model, context, options)
```

第二步，`streamSimpleOpenAICompletions()` 把通用参数变成 OpenAI Completions 专属参数：

```typescript
return streamOpenAICompletions(model, context, {
  apiKey: "sk-...",
  headers: { "X-App": "FitClaw" },
  reasoningEffort: "medium",
});
```

这一步还没有发请求，只是把 `reasoning: "medium"` 这种通用说法，变成 OpenAI-compatible 适配器内部使用的 `reasoningEffort`。

第三步，`streamOpenAICompletions()` 才真正做协议转换。它会调用 `buildParams()`，里面又会调用 `convertMessages()` 和 `convertTools()`。

FitClaw 统一格式：

```typescript
{
  role: "user",
  content: "读取我的训练记录，然后给我下一次训练建议。"
}
```

会变成 OpenAI Chat Completions 的消息格式：

```typescript
{
  role: "user",
  content: "读取我的训练记录，然后给我下一次训练建议。"
}
```

这条用户文本看起来没变，是因为两边刚好接近。但工具定义会明显变：

FitClaw 统一工具格式：

```typescript
{
  name: "data_bodybuilding_read",
  description: "Read bodybuilding data",
  parameters: { type: "object", properties: { namespace: { type: "string" } } }
}
```

会被 `convertTools()` 转成 OpenAI 工具格式：

```typescript
{
  type: "function",
  function: {
    name: "data_bodybuilding_read",
    description: "Read bodybuilding data",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string" }
      },
      required: ["namespace"]
    },
    strict: false
  }
}
```

最终发给 DeepSeek 的请求参数大致是：

```typescript
{
  model: "deepseek-v3.2",
  messages: [
    { role: "system", content: "You are FitClaw." },
    { role: "user", content: "读取我的训练记录，然后给我下一次训练建议。" }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "data_bodybuilding_read",
        description: "Read bodybuilding data",
        parameters: { type: "object", properties: { namespace: { type: "string" } }, required: ["namespace"] },
        strict: false
      }
    }
  ],
  stream: true,
  reasoning_effort: "medium",
  stream_options: { include_usage: true }
}
```

客户端创建时使用的是这个模型自己的 `baseUrl`：

```typescript
new OpenAI({
  apiKey: "sk-...",
  baseURL: "https://api.deepseek.com",
  defaultHeaders: { "X-App": "FitClaw" },
});
```

所以虽然函数名叫 `streamOpenAICompletions()`，请求实际发给的是 DeepSeek。这里的 “OpenAI” 指协议格式，不是供应商一定是 OpenAI。

第四步，上游返回 OpenAI-compatible 流式片段。例如工具调用可能这样分片回来：

```typescript
{
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call_123",
            type: "function",
            function: {
              name: "data_bodybuilding_read",
              arguments: "{\"namespace\":\"training_log\"}"
            }
          }
        ]
      }
    }
  ]
}
```

`streamOpenAICompletions()` 会把它翻译成 FitClaw 统一事件：

```typescript
{ type: "toolcall_start", contentIndex: 0, partial: output }
{ type: "toolcall_delta", contentIndex: 0, delta: "{\"namespace\":\"training_log\"}", partial: output }
{ type: "toolcall_end", contentIndex: 0, toolCall: {
  type: "toolCall",
  id: "call_123",
  name: "data_bodybuilding_read",
  arguments: { namespace: "training_log" }
}, partial: output }
```

最后 `done` 事件里的 `AssistantMessage` 长这样：

```typescript
{
  role: "assistant",
  content: [
    {
      type: "toolCall",
      id: "call_123",
      name: "data_bodybuilding_read",
      arguments: { namespace: "training_log" }
    }
  ],
  api: "openai-completions",
  provider: "deepseek",
  model: "deepseek-v3.2",
  stopReason: "toolUse",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  timestamp: 1760000000000
}
```

这就是完整转换：

```text
FitClaw 统一 Context
  -> streamSimple()
  -> 根据 model.api 找到 openai-completions Provider
  -> streamSimpleOpenAICompletions() 映射通用 options
  -> streamOpenAICompletions() 转成 OpenAI Chat Completions 请求
  -> DeepSeek 返回 OpenAI-compatible 流
  -> streamOpenAICompletions() 翻译成 AssistantMessageEvent
  -> Agent 看到统一 ToolCall，执行 data_bodybuilding_read
```

#### 8. `AssistantMessageEvent` 做了什么？统一后的信息格式是什么？

`AssistantMessageEvent` 不是最终消息本身，而是“模型正在流式输出时的事件协议”。它解决的是一个流式问题：不同厂商一边返回文本、一边返回 reasoning/thinking、一边返回工具调用参数，而且字段名和事件名都不一样。FitClaw 要把这些原生事件统一成同一种事件流。

可以把它理解成“打字过程中的事件”：

```text
start
  -> text_start
  -> text_delta: "我"
  -> text_delta: "建议"
  -> text_end
  -> toolcall_start
  -> toolcall_delta: "{\"namespace\""
  -> toolcall_delta: ":\"training_log\"}"
  -> toolcall_end
  -> done
```

这些事件不断更新同一个 `partial: AssistantMessage`。`partial` 是“当前已经拼好的助手消息快照”；`done.message` 才是最后完整的助手消息。

源码里的事件类型是：

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

统一后的最终消息格式是 `AssistantMessage`：

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  responseId?: string;
  usage: Usage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}
```

其中 `content` 是最关键的统一结构。它把模型输出拆成块：

```typescript
type TextContent = {
  type: "text";
  text: string;
};

type ThinkingContent = {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

type ToolCall = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
};
```

一个最终消息可能长这样：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "需要先读取训练记录，再给建议。"
    },
    {
      "type": "text",
      "text": "我先看一下你的训练记录。"
    },
    {
      "type": "toolCall",
      "id": "call_123",
      "name": "data_bodybuilding_read",
      "arguments": {
        "namespace": "training_log"
      }
    }
  ],
  "api": "openai-completions",
  "provider": "deepseek",
  "model": "deepseek-v3.2",
  "usage": {
    "input": 1200,
    "output": 180,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalTokens": 1380,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  },
  "stopReason": "toolUse",
  "timestamp": 1760000000000
}
```

对应关系如下：

| 上游原生概念 | FitClaw 统一后 |
|--------------|----------------|
| OpenAI `delta.content` | `text_delta`，最终进入 `{ type: "text", text }` |
| Anthropic `thinking_delta` / reasoning | `thinking_delta`，最终进入 `{ type: "thinking", thinking }` |
| OpenAI `tool_calls[].function.arguments` | `toolcall_delta` / `toolcall_end`，最终进入 `{ type: "toolCall", name, arguments }` |
| Anthropic `tool_use.input` | `ToolCall.arguments` |
| Provider 的 token usage | `AssistantMessage.usage` |
| Provider 的停止原因 | `AssistantMessage.stopReason` |

所以 `AssistantMessageEvent` 的作用是“统一流式过程”，`AssistantMessage` 的作用是“统一最终结果”。上层 Agent 不需要管原始 Provider 是怎么分片的，只需要消费这些统一事件；当看到 `done.reason === "toolUse"` 时，就从 `done.message.content` 里取 `toolCall` 并执行工具。

---

#### 9. 完整转换旅程（核心链路）

从应用层一路追踪到 HTTP 请求，再回到应用层。下面用 Claude (Anthropic) 做例子：

---

**Step 1：上层调用 — 完全不知道模型是谁**

```typescript
const stream = streamFn(model, context);
for await (const event of stream) {
  // event.type 总是 "text_delta" | "toolcall_start" | "done" | "error"
  // 不管是 Anthropic 还是 OpenAI，这段代码完全一样
}
```

---

**Step 2：路由 — 按 `model.api` 字符串找到对应 Provider**

```typescript
// stream.ts
const provider = resolveApiProvider(model.api);  // "anthropic-messages" → streamAnthropic
return provider.streamSimple(model, context, options);
```

---

**Step 3：Provider 内部做三件事**

**① 输入转换（统一 → Provider 方言）**

这里容易误解：FitClaw 不是只做“Provider 方言 → 统一格式”，而是做**双向翻译**。

```text
发请求前：FitClaw 统一格式 -> Provider 方言
收到响应后：Provider 方言 -> FitClaw 统一格式
```

为什么发请求前要先转成 Provider 方言？因为真正接收请求的是 Anthropic/OpenAI/Gemini 的官方 API，它们不认识 FitClaw 内部的 `Message`、`ToolCall.arguments`、`ToolResultMessage`。FitClaw 内部可以统一，但发到外部时必须遵守对方 API 的字段规则。

也就是说：

| 阶段 | 谁是接收方 | 必须使用谁的格式 |
|------|------------|------------------|
| 发请求 | Anthropic/OpenAI/Gemini API | Provider 方言 |
| 收响应 | FitClaw 上层 Agent/UI | FitClaw 统一格式 |

所以这一步写成“统一 → Provider 方言”是对的；下一步“输出转换”才是“Provider 方言 → 统一事件”。

`streamAnthropic` 内部先调 `transformMessages()` 做跨 Provider 兼容处理，再调 `convertMessages()` 把统一 `Message[]` 转为 Anthropic 的 `MessageParam[]`：

| 统一类型 | → | Anthropic API 格式 |
|---------|---|-------------------|
| `toolCall`（`arguments`） | → | `tool_use`（`input`） |
| `toolResult`（独立 role） | → | `tool_result`（包裹在 `role: "user"` 中） |

`transformMessages` 提前处理跨 Provider 兼容问题：

| 差异点 | 转换策略 |
|--------|---------|
| OpenAI toolCallId 450+ 字符含 `|` | `normalizeToolCallId()` 哈希映射为 64 字符 |
| 非视觉模型收到图片 | 自动降级为文本占位符 `"(image omitted: ...)"` |
| 跨模型 thinking 块不兼容 | 非 redacted → 纯文本，redacted → 丢弃 |
| 孤立 toolCall（无对应 toolResult） | 自动补 `isError: true` 空结果 |

**② 发 HTTP 请求**

创建 Anthropic SDK 客户端，发起 `client.messages.create({ stream: true })`。

**③ 输出转换（Provider 方言 → 统一事件）**

逐事件翻译：

```
Anthropic content_block_start { type: "tool_use", input: {...} }
        │
        ▼ 字段映射
        │
统一事件: { type: "toolcall_start", toolCall: { name, arguments } }
                                              ↑ 统一叫 arguments，不是 input
```

---

**Step 4：回到上层**

上层 `for await` 消费到的永远是同一套事件类型，完全不感知底层 Provider 的差异。

---

##### 9.1 对比：切换到 OpenAI 哪些变了？

| 阶段 | Anthropic | OpenAI | 上层感知 |
|------|-----------|--------|---------|
| 统一入口 | `streamSimple(model, context)` | `streamSimple(model, context)` | **完全相同** |
| 路由查表 | `get("anthropic-messages")` | `get("openai-completions")` | **无感知** |
| 消息转换 | `convertMessages()` → Anthropic 格式 | `toOpenAI()` → OpenAI 格式 | **无感知** |
| thinking 参数 | `thinking: { type: "adaptive", effort }` | `reasoning_effort: "high"` | **无感知** |
| tool_use 字段名 | `type: "tool_use"`, `input` | `type: "function"`, `function.arguments` | **无感知** |
| tool_result 包装 | 包裹在 `role: "user"` 中 | 独立 `role: "tool"` | **无感知** |
| 流协议 | SSE 手动解析 | SDK 原生 stream | **无感知** |
| 输出事件 | → `AssistantMessageEvent` | → **同样的** `AssistantMessageEvent` | **完全一致** |

**所有差异被封在 Provider 的 `stream` 函数内部。**

---

##### 9.2 完整调用链路图

```
应用层 (agent-loop.ts / sdk.ts)
  │  streamFn(model, context) → for await (event)
  ▼
stream.ts — 统一入口
  │  resolveApiProvider(model.api) ← 按字符串查 Map，无 if/switch
  ▼
Provider streamSimple — 高级选项映射
  │  reasoning → effort / thinkingBudgetTokens
  ▼
Provider stream — 核心转换（3 件事）
  │  ① transformMessages + convertMessages → 统一 → Provider 格式
  │  ② new SDKClient() → client.create({ stream: true })
  │  ③ 逐事件翻译 → stream.push(AssistantMessageEvent)
  ▼
应用层 — 统一消费
  event.type = "text_delta" | "toolcall_start" | "done" | "error"
```

---

#### 10. 设计思想（面试核心）

这套设计就 3 个经典模式：

| 模式 | 体现 |
|------|------|
| **Adapter Pattern（适配器）** | 不同 API → 统一接口 |
| **Strategy Pattern（策略）** | `model.api` 决定走哪个 Provider |
| **Plugin System（插件）** | 新增 Provider = `registerApiProvider({...})` |

---

#### 11. 总结

把整个系统想成一个**翻译公司**：

```
客户（上层）说普通话
  ↓
公司按语言分配翻译（model.api → Map 查表）
  ↓
翻译把内容改写成对应语言（convertMessages）
  ↓
对方回复（Provider API）
  ↓
翻译再翻回普通话（stream.push → AssistantMessageEvent）
  ↓
客户完全不知道对方说的是哪种语言
```

**为什么这套封装能工作？两个核心决策：**

1. **`model.api` 字符串做路由键** — 一个 Map 替代所有 if/else
2. **`AssistantMessageEvent` 做统一输出协议** — 每个 Provider 内部把原生事件翻译成同一套类型，外部完全不可见

**核心文件：** `packages/ai/src/types.ts`、`packages/ai/src/stream.ts`、`packages/ai/src/api-registry.ts`、`packages/ai/src/providers/register-builtins.ts`、`packages/ai/src/providers/anthropic.ts`、`packages/ai/src/providers/transform-messages.ts`

---

### Q1-2: `runLoop()` 双层 while 循环驱动推理——具体是一个什么样的过程？

**A:**

`runLoop()` 位于 `packages/agent/src/agent-loop.ts:155-234`，是 Agent 框架层的核心引擎。它不是一个简单的轮询，而是**"外层 FollowUp 驱动 + 内层 ToolCall 驱动"**的双层状态机。

**源码级流程（逐行中文注释）：**

```typescript
/**
 * runLoop — Agent 推理核心循环
 *
 * 这是一个 async 函数，意味着它内部会使用 await 等待异步操作（网络请求、文件读写等）。
 * await 会让出 JS 事件循环，等异步操作完成后再回到这个函数继续执行（详见下方 await 机制解释）。
 *
 * 参数说明：
 *   currentContext - 当前上下文（消息历史、系统提示词、可用工具列表）
 *   newMessages    - 本轮新增的全部消息（调用者最终获取的返回值）
 *   config         - 配置契约（模型、工具、各种钩子函数）
 *   signal         - AbortSignal，用于取消正在进行的请求
 *   emit           - 事件发射器，向上层（CLI/Bot）发送状态事件
 *   streamFn       - LLM 流式调用函数（默认是 streamSimple）
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  // ============================================================
  // 初始化阶段
  // ============================================================

  // firstTurn: 标记是否为第一轮推理。
  // 第一轮不需要 emit turn_start（因为 agent_start 已经发过了）。
  let firstTurn = true;

  // getSteeringMessages: 检查用户是否有"插入消息"（用户在 Agent 等待时新发的消息）。
  // 例如：用户看到 Agent 正在调用工具，觉得不对，在终端键入"不用了，直接告诉我答案"。
  // 此时后台队列里就有一条 steering 消息，等待被注入到上下文中。
  // await 在这里让出控制权，等待 getSteeringMessages 的 Promise 完成。
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  // ============================================================
  // 第一层循环（外层）：FollowUp 驱动
  //
  // while(true) 是一个"永不主动退出"的循环。
  // 退出全靠内部的 break（见 Step 8）。
  // 为什么不用 while(someCondition)？因为退出条件在循环体中段才判断，
  // 用 while(true) + break 比把条件提到顶部更清晰。
  // ============================================================
  while (true) {
    // ----------------------------------------------------------
    // hasMoreToolCalls = true
    // 初始假设"LLM 会调用工具"，这样循环体至少会执行一次。
    // 如果 LLM 回复里没有 toolCall，则设回 false，内层循环结束。
    // 如果 LLM 回复里有 toolCall 且 terminate 为 false，则保持 true 继续。
    // ----------------------------------------------------------
    let hasMoreToolCalls = true;

    // ============================================================
    // 第二层循环（内层）：ToolCall + Steering 驱动
    //
    // 继续条件（满足其一即可）：
    //   1. hasMoreToolCalls === true  → LLM 上一次回复里有工具调用需要继续
    //   2. pendingMessages.length > 0 → 有提前到达的 steering 消息需要处理
    //
    // 典型的一轮内层循环：
    //   用户: "查天气"
    //     → LLM: 调用 search_weather 工具
    //     → 工具返回: {temp: 25}
    //     → LLM: "当前温度是 25°C"  ← 文本回复，没有 toolCall，内层结束
    // ============================================================
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      // --------------------------------------------------------
      // turn_start 事件:
      // - 第一轮跳过（agent_start 已经通知过了）
      // - 后续每轮都发，通知上层"新的一轮推理开始了"
      // 上层（CLI/Bot）通常用这个事件更新 spinner 或时间戳。
      // --------------------------------------------------------
      if (!firstTurn) {
        // await: 等待 emit 完成（确保事件按顺序发送，不会乱序）
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      // ==========================================================
      // Step 1: 注入 Steering 消息（用户在 Agent 运行时实时插入的消息）
      //
      // 场景：Agent 正在调用工具，用户等不及了，在终端输入"不用工具了直接回答"。
      // 这条消息会通过 getSteeringMessages 被收集到 pendingMessages 队列里。
      // 在这里被注入到 currentContext.messages（供 LLM 阅读）和
      // newMessages（供上层记录/返回）中。
      //
      // 为什么要注入而不是替换？因为上下文（之前的所有消息）必须保留，
      // 否则 LLM 会丢失历史记忆。Steering 消息是在历史之上"追加"的。
      // ==========================================================
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          // emit message_start / message_end: 通知上层有新的消息到达
          // 上层（CLI）收到后会渲染这条消息到终端
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });

          // 追加到 currentContext.messages:
          //   → 下一次调用 LLM 时，这条消息会出现在上下文里（LLM 能看到它）
          // 追加到 newMessages:
          //   → 调用者（agentLoop / agentLoopContinue）最终返回的消息列表
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        // 清空待处理队列——这些消息已经被注入了
        pendingMessages = [];
      }

      // ==========================================================
      // Step 2: 调用 LLM，获取流式响应
      //
      // streamAssistantResponse 做了以下事情（详见 agent-loop.ts:240-333）：
      //   1. transformContext()   — 可选的消息转换（如对话压缩/摘要）
      //   2. convertToLlm()      — 把 AgentMessage[] 转成 Message[]
      //   3. streamFunction()    — 实际调用 LLM API（OpenAI / Anthropic / minimax）
      //   4. 通过 emit 逐条通知上层每个流式事件（text_delta、toolcall_start 等）
      //   5. 返回最终的 AssistantMessage
      //
      // await: 等待整个流式响应完成（包括所有 text_delta 和最终的 done 事件）
      // 这可能是几百毫秒到几十秒的阻塞时间
      // ==========================================================
      const message = await streamAssistantResponse(
        currentContext, config, signal, emit, streamFn
      );

      // ==========================================================
      // Step 3: 错误 / 中止检查
      //
      // stopReason 是 AssistantMessage 的一个字段：
      //   - "endTurn"  : 正常，LLM 完成了这轮回复
      //   - "error"    : 发生错误（网络故障、API 错误等）
      //   - "aborted"  : 被外部中断（用户取消、signal 触发）
      //
      // 如果出错或被取消，立即终止整个 Agent 循环，
      // 不能让错误消息继续进入后续处理流程。
      // ==========================================================
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        // 通知上层：本轮结束（带回错误上下文）
        await emit({ type: "turn_end", message, toolResults: [] });
        // 通知上层：整个 Agent 结束（带上所有已产生的新消息）
        await emit({ type: "agent_end", messages: newMessages });
        return; // 直接退出 runLoop 函数
      }

      // ==========================================================
      // Step 4: 提取 LLM 回复中的 ToolCall
      //
      // AssistantMessage.content 是一个联合数组，每个元素可能是：
      //   - { type: "text", text: "..." }
      //   - { type: "toolCall", id: "call_xxx", name: "search", arguments: {...} }
      //   - { type: "thinking", text: "..." }
      //
      // 这里过滤出所有 toolCall 类型的 content block。
      // 一次 LLM 回复可以同时包含多个 toolCall（比如同时查天气和查新闻）。
      // ==========================================================
      const toolCalls = message.content.filter((c) => c.type === "toolCall");

      const toolResults: ToolResultMessage[] = [];
      // 先假设没有更多工具调用——如果没有 toolCall 则内层循环结束
      hasMoreToolCalls = false;

      if (toolCalls.length > 0) {
        // =======================================================
        // Step 5: 执行工具调用
        //
        // executeToolCalls 会根据配置决定并行还是串行执行：
        //   - parallel:   所有工具同时启动，Promise.all 等待全部完成
        //   - sequential: 逐个执行（前一个的结果可能影响后一个）
        //
        // 每个工具的完整执行流程：
        //   a. prepareToolCall()    — 查找工具、验证参数、beforeToolCall 钩子
        //   b. executePreparedToolCall() — tool.execute() 实际运行
        //   c. finalizeExecutedToolCall() — afterToolCall 钩子、结果修正
        //   d. createToolResultMessage() — 包装成 ToolResultMessage
        //
        // batch.terminate: 如果所有工具都返回 terminate: true，
        //   则设 hasMoreToolCalls = false，跳出内层循环。
        //   这防止了"工具链死循环"——某个工具可能明确表示"到此为止"。
        // =======================================================
        const executedToolBatch = await executeToolCalls(
          currentContext, message, config, signal, emit
        );
        toolResults.push(...executedToolBatch.messages);

        // !batch.terminate → 还要继续用工具
        //  batch.terminate → 工具链到此结束
        hasMoreToolCalls = !executedToolBatch.terminate;

        // 将工具执行结果追加到上下文中
        // → 下一次 LLM 调用时，LLM 会看到这些工具返回的内容
        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      // 通知上层：本轮结束（携带 LLM 回复和工具结果）
      await emit({ type: "turn_end", message, toolResults });

      // ==========================================================
      // Step 6: 内层循环末尾——再次检查 Steering 消息
      //
      // 在内层循环体的最后（turn_end 已发出），检查是否有新的 steering
      // 消息到达。如果有，pendingMessages.length > 0 会让内层
      // while 重新执行，在下一轮调用 LLM 之前先注入这些消息。
      //
      // 典型场景：
      //   1. LLM 回复了文本（没有 toolCall），hasMoreToolCalls = false
      //   2. 用户在这之后发了新消息 → pendingMessages 有内容
      //   3. 此时内层 while 因为 pendingMessages.length > 0 而继续
      //   4. 下一轮先注入用户新消息，再调用 LLM → Agent "无缝衔接"
      // ==========================================================
      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // ============================================================
    // 内层循环已退出（hasMoreToolCalls === false 且 pendingMessages === []）
    //
    // 此时：
    //   - LLM 已经给出了最终文本回复（没有工具调用）
    //   - 没有 pending 的 steering 消息
    //   - Agent 处于"可以停止"的状态
    //
    // 但是！不等于"必须停止"——还有 FollowUp 场景：
    // ============================================================

    // ============================================================
    // Step 7: 检查 FollowUp 队列
    //
    // FollowUp 和 Steering 的区别：
    //
    //   Steering 消息：
    //     - 来源：用户实时输入（终端打字）
    //     - 时机：Agent 正在推理时到达
    //     - 处理：内层循环中注入，立即处理
    //     - 来源函数：getSteeringMessages()
    //
    //   FollowUp 消息：
    //     - 来源：系统内部产生（对话压缩后的重试、Bot 定时提醒、错误重试）
    //     - 时机：Agent 停止后到达
    //     - 处理：外层循环中作为 pending 重新进入内层循环
    //     - 来源函数：getFollowUpMessages()
    //
    // 举例（FollowUp 场景）：
    //   上下文长了 → 自动压缩 → 系统生成一条"请基于压缩后的上下文继续"的消息
    //   → 放入 followUpMessages 队列 → 外层循环捕获 → 重新进入内层循环继续推理
    // ============================================================
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      // 把 followUp 消息当作 pending 消息设置
      // → 外层 continue → 回到 while(true) 顶部 → 重新进入内层 while
      // → 内层 while 因为 pendingMessages.length > 0 而执行
      pendingMessages = followUpMessages;
      continue; // 跳回外层循环顶部，继续推理
    }

    // ============================================================
    // Step 8: 真正结束
    //
    // 没有 toolCall、没有 steering、没有 followUp → Agent 任务完成
    // break 跳出外层 while(true)，进入最终的 agent_end
    // ============================================================
    break;
  }

  // 通知上层：Agent 整个生命周期结束
  // newMessages 包含了本轮所有新增消息（用户消息、LLM 回复、工具结果等）
  await emit({ type: "agent_end", messages: newMessages });
}
```

**状态转换图解（增强版）：**

```
                        ┌─────────────────────────────────┐
                        │        getSteeringMessages       │
                        │   ┌─────────────────────────┐    │
                        │   │ 用户在终端实时输入       │    │
                        │   │ "不用工具了，直接答"     │    │
                        │   └───────────┬─────────────┘    │
                        │               │ 随到随取          │
                        │               ▼                  │
[Agent 启动]            │        pendingMessages           │
    │                   │               │                  │
    ▼                   │               ▼                  │
┌───────────────────────────────────────────────────────┐  │
│ 外层 while(true)                                      │  │
│                                                       │  │
│  ┌─────────────────────────────────────────────────┐ │  │
│  │ 内层 while(hasMoreToolCalls || pending.length>0) │ │  │
│  │                                                  │ │  │
│  │  Step 1: 注入 pending steering 消息              │◄┼─┘
│  │  Step 2: streamAssistantResponse() → LLM 回复    │ │
│  │           │                                      │ │
│  │     ┌─────┴──────┐                               │ │
│  │     │ 有 toolCall?│                               │ │
│  │     └─────┬──────┘                               │ │
│  │      Yes  │  No                                  │ │
│  │       ▼   │   ▼                                  │ │
│  │  Step 5   │  hasMoreToolCalls = false            │ │
│  │  execute  │   → turn_end → 检查 pending          │ │
│  │  tools    │     → 无 → 退出内层                   │ │
│  │   │       │                                      │ │
│  │   ▼       │                                      │ │
│  │  terminate? ──Yes──► hasMoreToolCalls = false    │ │
│  │   │                                              │ │
│  │  No → hasMoreToolCalls = true → 继续内层         │ │
│  └─────────────────────────────────────────────────┘ │
│                       │                              │
│         内层退出后 ▼                                  │
│  ┌──────────────────────────────────────┐            │
│  │ getFollowUpMessages()                │            │
│  │   · 对话压缩重试                      │            │
│  │   · Bot 定时提醒                      │            │
│  │   · 错误自动恢复                      │            │
│  └───────────┬──────────────────────────┘            │
│              │                                       │
│    有 FollowUp? ──Yes──► pending = FollowUp          │
│       │                  ▲                           │
│      No                  │ continue ─────────────────┘
│       ▼                               (回到外层顶部)
│   break;
└───────────────────────────────────────────────────────┘
        │
        ▼
   agent_end → 返回 newMessages
```

**关键设计意图：**

- **内层循环**处理 "LLM 想调用工具" 和 "用户突然发新消息（steering）" 这两种需要继续推理的情况；
- **外层循环**处理 "当前任务已完成，但队列里还有后续任务（followUp）" 的情况，例如压缩后的自动重试、Bot 的定时提醒；
- `hasMoreToolCalls` 和 `batch.terminate` 控制是否继续内层循环——如果工具返回 `terminate: true`，则强制跳出，防止无限工具链。

**核心文件：** `packages/agent/src/agent-loop.ts:155-234`

---

#### await 是什么机制？

`await` 是 JavaScript/TypeScript 中用于等待异步操作完成的关键字。要理解它，需要从底层往上讲。

##### 1. JavaScript 是单线程的

JS 只有一个主线程，同一时刻只能做一件事。如果主线程被阻塞（比如等待网络响应），整个程序就卡死了——UI 无法交互、其他请求无法处理。

##### 2. 事件循环（Event Loop）

JS 的解决方案是**事件循环**：把耗时操作（网络请求、文件读写、定时器）交给浏览器/Node.js 底层线程池去处理，主线程继续运行。等底层操作完成后，把回调函数放入**微任务队列（microtask queue）**，事件循环在合适的时机取出执行。

```
┌──────────────────────────────────────────┐
│              调用栈 (Call Stack)           │
│  ┌────────────────────────────────────┐  │
│  │  foo()                             │  │
│  │  bar()   ← 当前正在执行的函数        │  │
│  │  baz()                             │  │
│  └────────────────────────────────────┘  │
│              │ 栈空时                      │
│              ▼                            │
│  ┌────────────────────────────────────┐  │
│  │       微任务队列 (Microtask Queue)    │  │
│  │  [Promise.resolve().then(cb1)]     │  │
│  │  [await 之后的代码 cb2]             │  │
│  │  [queueMicrotask(cb3)]             │  │
│  └────────────────────────────────────┘  │
│              │ 微任务队列空时              │
│              ▼                            │
│  ┌────────────────────────────────────┐  │
│  │       宏任务队列 (Macrotask Queue)   │  │
│  │  [setTimeout callback]             │  │
│  │  [I/O 完成事件]                     │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

##### 3. Promise：异步操作的"占位符"

Promise 是一个状态机，有三个状态：

```
         pending（进行中）
          /          \
    resolve          reject
       /                \
  fulfilled（成功）   rejected（失败）
```

一旦状态从 `pending` 变成 `fulfilled` 或 `rejected`，就**永远不会再变**。Promise 的 `.then()` 注册的回调会在 Promise 敲定后进入微任务队列。

```typescript
// 创建一个 Promise
const promise = new Promise<string>((resolve, reject) => {
  // 这里的代码是同步执行的
  setTimeout(() => {
    resolve("done");  // 1 秒后在宏任务中 resolve
  }, 1000);
});
// 此时 promise 是 pending 状态

promise.then((value) => {
  console.log(value);  // 1 秒后输出 "done"
});
// 此时 promise.then(...) 注册了回调，主线程继续往下走
```

##### 4. await = Promise.then() 的语法糖

`await` 本质上是对 Promise 的 `.then()` 调用的语法糖：

```typescript
// 这两段代码在语义上等价（细节略有差异）：

// 版本 A：async/await
async function getData(): Promise<string> {
  const result = await fetch("https://api.example.com/data");
  // ↑ 等价于：fetch(...).then(result => { 后面代码放这里 })
  return result.text();
}

// 版本 B：Promise.then() 链
function getData(): Promise<string> {
  return fetch("https://api.example.com/data").then((result) => {
    return result.text();
  });
}
```

**`await` 做了什么（精确步骤）：**

1. 遇到 `await somePromise`
2. 如果 `somePromise` 已经 fulfilled → 直接取到值，**不停顿**，继续往下执行
3. 如果 `somePromise` 是 pending → **把当前 async 函数剩下的代码包装成一个微任务**，挂到 `somePromise.then(剩余代码)`
4. **让出主线程**（yield to event loop）——当前 async 函数暂停，调用栈清空，事件循环可以处理其他任务
5. 等 `somePromise` fulfilled 后，之前包装的微任务被放入微任务队列
6. 事件循环取出该微任务，**恢复** async 函数的执行，`await` 表达式求值为 Promise 的结果值

##### 5. 在 runLoop 中的实际体现

```typescript
// agent-loop.ts Step 2
const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
```

这一行的执行过程：

```
1. 调用 streamAssistantResponse()，返回一个 Promise<AssistantMessage>
2. await 检查这个 Promise 的状态
   - 此时 Promise 是 pending（LLM 请求刚发出去，还没有完整回复）
3. await 把 runLoop 函数的剩余代码包装成回调，挂到 .then() 上
4. runLoop 暂停！主线程让出给事件循环
5. 事件循环可以处理其他任务（比如渲染终端 spinner、处理用户键盘输入）
6. 底层网络层持续接收 LLM 的流式数据（SSE）
7. 每条 text_delta 到达 → emit 事件给上层 → 上层更新终端显示
8. 流结束 → Promise resolve → 之前包装的微任务进入队列
9. 事件循环取出微任务 → runLoop 恢复执行 → message 拿到完整的 AssistantMessage
10. 继续执行后续代码（检查 stopReason、提取 toolCall 等）
```

##### 6. 和普通同步代码的对比

```typescript
// 同步代码（阻塞式）
function syncLoop() {
  while (true) {
    const response = callLLM();  // 假设这是同步的
    // ↑ 调用时，整个线程卡住，UI 冻结，其他用户请求全部等待
    // 等 5 秒后 response 返回，才能处理下一个请求
    if (response.done) break;
  }
}

// async 代码（非阻塞式）
async function asyncLoop() {
  while (true) {
    const response = await callLLMAsync();  // 异步的
    // ↑ 调用时，发起请求后就立即让出主线程
    // 在等待的 5 秒内，主线程可以：
    //   - 处理其他用户的请求
    //   - 渲染终端动画（spinner）
    //   - 检测 AbortSignal（用户是否按了取消）
    //   - 接收 steering 消息
    // 等 response 到达后，事件循环让 asyncLoop 恢复执行
    if (response.done) break;
  }
}
```

##### 7. 为什么不直接用 Promise.then()？

```typescript
// Promise 链式写法（回调地狱）
function runLoop(): Promise<void> {
  return getSteeringMessages().then(pendingMessages => {
    return streamAssistantResponse(context).then(message => {
      if (message.stopReason === "error") {
        return emit("agent_end").then(() => { return; });
      }
      const toolCalls = message.content.filter(c => c.type === "toolCall");
      if (toolCalls.length > 0) {
        return executeToolCalls(context, message).then(batch => {
          // ...层层嵌套，难以阅读和维护
        });
      }
    });
  });
}

// async/await 写法（和同步代码一样直观）
async function runLoop(): Promise<void> {
  let pendingMessages = await getSteeringMessages();
  while (true) {
    const message = await streamAssistantResponse(context);
    if (message.stopReason === "error") {
      await emit("agent_end");
      return;
    }
    const toolCalls = message.content.filter(c => c.type === "toolCall");
    if (toolCalls.length > 0) {
      const batch = await executeToolCalls(context, message);
      // ...逻辑清晰，像同步代码一样可读
    }
  }
}
```

**总结：`await` 是一个"暂停并等待"操作符。它让 async 函数在执行到异步调用时主动暂停、让出主线程给事件循环处理其他任务，等异步结果返回后再自动恢复执行。这让异步代码可以写成看起来像同步代码的样子，同时保持了非阻塞的优势。**

---

### Q1-3: 层间通信机制主要是哪几个？说明具体的实现过程，结合例子和原理。

**A:**

三层之间的通信依赖四种机制：**类型接口、事件流、依赖注入、钩子函数**。它们分别解决"编译时解耦"、"运行时数据流"、"行为定制"三类问题。

---

**机制一：类型接口（编译时解耦）**

**原理：** 下层只导出 TypeScript 类型和纯函数签名，上层 import 类型而非实现，编译后无运行时耦合。

**具体实现：**

```typescript
// @fitclaw/ai 导出统一类型（下层）
export interface Message { role: "user" | "assistant" | "toolResult"; ... }
export interface Context { systemPrompt?: string; messages: Message[]; tools?: Tool[]; }
export type StreamFunction = (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;

// @fitclaw/agent-core 只依赖类型（上层）
import type { Message, Context, StreamFunction } from "@fitclaw/ai";
// 绝不 import 任何 Provider 的具体实现
```

**例子：** `agent-loop.ts` 第 240 行的 `streamAssistantResponse()` 接收的 `config.convertToLlm` 和 `streamFn` 都是上层注入的函数，但它们的类型签名由 `@fitclaw/ai` 定义。Agent 层知道"需要把 AgentMessage[] 转成 Message[]"，但完全不知道 OpenAI 和 Anthropic 的 Message 格式有何区别。

---

**机制二：事件流（运行时数据流）**

**原理：** `EventStream<AgentEvent, AgentMessage[]>` 是一个异步可迭代对象（`AsyncIterable`），下层推事件，上层用 `for await` 消费。事件是单向流，天然支持背压（backpressure）——如果上层处理慢，下层的 `push()` 会排队等待。

**具体实现：**

```typescript
// 下层（Agent 框架）产生事件
function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream(
    (event) => event.type === "agent_end",   // 终止条件
    (event) => event.type === "agent_end" ? event.messages : []
  );
}

// 上层（CLI/Bot）消费事件
for await (const event of stream) {
  switch (event.type) {
    case "message_start":     renderNewMessage(event.message); break;
    case "text_delta":        appendText(event.assistantMessageEvent.delta); break;
    case "tool_execution_start": showSpinner(event.toolName); break;
    case "tool_execution_end":   hideSpinner(event.toolName, event.result); break;
    case "compaction":        showCompactNotice(); break;
  }
}
```

**例子（Bot 场景）：** 飞书 Bot 的 `createRunner()` 订阅了 `tool_execution_start/end` 事件，当 Agent 开始执行 `data_bodybuilding_write` 时，Bot 可以在飞书线程中反馈"正在记录训练数据..."，执行完成后再更新结果摘要。这个交互完全由事件流驱动，Agent 层不感知飞书 API 的存在。

---

**机制三：依赖注入（构造函数注入）**

**原理：** `Agent` 类不硬编码任何上层实现，而是通过构造函数接收函数。这符合依赖反转原则（DIP）——高层模块定义接口，低层模块实现接口。

**具体实现：**

```typescript
// AgentLoopConfig 是上层必须提供的"契约"
interface AgentLoopConfig {
  model: Model;
  tools: AgentTool[];
  systemPrompt: string;
  convertToLlm: (messages: AgentMessage[]) => Promise<Message[]>;
  transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
  getApiKey?: (provider: Provider) => Promise<string | undefined>;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
}

// CLI 上层注入具体实现（packages/coding-agent/src/core/sdk.ts）
const agent = new Agent({
  model,
  tools,
  convertToLlm: async (msgs) => convertToLlm(msgs, config),
  transformContext: async (msgs) => runner.emitContext(msgs),  // 扩展系统介入
  getApiKey: async (provider) => auth.getKey(provider),
  getSteeringMessages: async () => sessionManager.getSteeringMessages(),
});
```

**例子：** `convertToLlm` 在 CLI 层被注入为 `convertToLlm(msgs, config)`，它会做消息格式转换和上下文压缩；而在单元测试中，可以注入一个假函数 `async (msgs) => msgs`，完全绕过真实 LLM 调用。

---

**机制四：钩子函数（拦截与扩展）**

**原理：** `beforeToolCall` / `afterToolCall` 是两个异步钩子，允许上层在工具调用前后插入自定义逻辑，而不修改 Agent 核心代码。这是**开闭原则（OCP）**的体现。

**具体实现：**

```typescript
// AgentLoopConfig 中的钩子定义
interface AgentLoopConfig {
  beforeToolCall?: (ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<{ block: true; reason: string } | void>;
  afterToolCall?: (ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<Partial<AgentToolResult> | void>;
}
```

**例子（安全拦截）：**

```typescript
// 上层注入 beforeToolCall，拦截危险操作
beforeToolCall: async ({ toolCall, args }) => {
  if (toolCall.name === "bash" && args.command.includes("rm -rf /")) {
    return { block: true, reason: "Dangerous command blocked" };
  }
}
```

当 Agent 要执行 `bash` 工具时，`prepareToolCall()`（`agent-loop.ts:517-567`）先调用 `beforeToolCall`。如果钩子返回 `{ block: true }`，工具不会执行，直接生成 `isError: true` 的 `ToolResultMessage` 返回给 LLM。

**例子（结果后处理）：**

```typescript
// 上层注入 afterToolCall，修改工具结果
afterToolCall: async ({ toolCall, result, isError }) => {
  if (toolCall.name === "data_bodybuilding_read") {
    // 对敏感数据进行脱敏后再给 LLM
    return { content: sanitize(result.content) };
  }
}
```

`finalizeExecutedToolCall()`（`agent-loop.ts:606-649`）在工具执行完成后调用 `afterToolCall`，上层可以覆盖 `content`、`isError`、甚至设置 `terminate: true` 终止整个批次。

**四种机制的关系：**

| 机制 | 解决的问题 | 通信方向 | 典型场景 |
|------|-----------|---------|---------|
| 类型接口 | 编译时解耦 | 无（仅类型） | 上层 import 下层类型 |
| 事件流 | 运行时数据传递 | 下层 → 上层 | 流式渲染、工具执行反馈 |
| 依赖注入 | 行为定制 | 上层 → 下层 | 注入 API Key、消息转换器 |
| 钩子函数 | 拦截与扩展 | 上层 ↔ 下层 | 安全拦截、结果脱敏、权限控制 |

**核心文件：** `packages/agent/src/agent-loop.ts`、`packages/agent/src/types.ts`、`packages/coding-agent/src/core/sdk.ts`

---

### Q1b: 流式输出机制是如何实现的？使用了什么传输协议？网络中断时前端如何检测？

**A:**

> **一个比喻帮你理解：日料板前 vs 宴会厨房**
>
> 想象你去一家日料店，坐在板前（吧台）：
>
> - **传统模式像宴会厨房**：厨师在后台把所有菜做好，一次性端上来。你可能等 20 分钟干坐着，不知道厨师在忙什么；如果中间火灭了，整桌菜都得重做；菜上齐了你才发现第一道菜不对口味，但已经来不及了。
>
> - **流式输出像板前日料**：师傅就站在你面前，捏好一贯寿司立刻放到你盘子里。你每 2 秒就看到进展——"哦，金枪鱼来了"→"下一个是鳗鱼"→"差不多了"。不想吃了随时说"停"，你只需为已上的几贯买单。万一师傅中途被油锅烫了手（网络中断），你当场就知道，不用傻等。
>
> 把这个意象套到 FitClaw 上，就是下面这些机制：
>
> | 比喻 | 对应技术 |
> |------|---------|
> | 师傅边做边递 | `EventStream` 生产者-消费者队列（每生成一点内容立刻推送） |
> | 板前传送带 | **SSE** 协议（大多数厂商用的"单向传送带"）|
> | 你坐在板前看 | `for await...of` 消费流（前端一个循环吃到所有事件）|
> | 叫停出餐 | `AbortSignal` 链式取消（按 Escape 立刻切断） |
> | 发现师傅不动了 | 三层反馈：AbortSignal 中断 → Provider/Agent 错误事件 → UI 流状态停止或保持等待 |
>
> 下面展开技术细节：

**流式输出实现：**

FitClaw 采用**生产者-消费者队列 + AsyncIterable**模式实现统一流式抽象，位于 `@fitclaw/ai` 层：

1. **`EventStream<T, R>` 类**（`packages/ai/src/utils/event-stream.ts`）：
   - 内部维护 `events` 队列和 `waitingConsumers` 列表
   - `push(event)` 将事件入队，唤醒等待的消费者
   - 实现 `AsyncIterable`，上层用 `for await` 消费
   - `AssistantMessageEventStream` 扩展检测 `done`/`error` 事件自动结束迭代

2. **`AssistantMessageEvent` 统一事件协议**（`packages/ai/src/types.ts:260-272`）：

   | 事件类型 | 说明 |
   |---------|------|
   | `start` | 流开始 |
   | `text_start` / `text_delta` / `text_end` | 文本内容块 |
   | `thinking_start` / `thinking_delta` / `thinking_end` | 推理/思考块 |
   | `toolcall_start` / `toolcall_delta` / `toolcall_end` | 工具调用块 |
   | `done` | 正常完成（reason: stop/length/toolUse） |
   | `error` | 错误或中止（reason: aborted/error） |

   每个事件携带 `partial: AssistantMessage`，表示截至目前累积的完整消息状态。

**传输协议（按 Provider 分类）：**

| Provider | 传输协议 | 实现方式 |
|---------|---------|---------|
| Anthropic | **SSE** | SDK `stream: true` + 自定义 SSE parser（`iterateSseMessages`） |
| OpenAI (Completions/Responses) | **SSE** | SDK 原生流式接口 |
| OpenAI Codex | **SSE / WebSocket / auto** | 原始 `fetch()` + `response.body.getReader()` 或 WebSocket |
| Azure OpenAI | **SSE** | SDK 原生流式接口 |
| Google Gemini CLI | **SSE** | 原始 `fetch()` + `Accept: text/event-stream` |
| Google (GenAI) / Vertex | **Native SDK Stream** | `@google/genai` `generateContentStream()` |
| Amazon Bedrock | **Native SDK Stream** | AWS SDK `ConverseStreamCommand` |
| Mistral | **Native SDK Stream** | `@mistralai/mistralai` `chat.stream()` |

SSE 解析使用 `ReadableStream.getReader()` + `TextDecoder` 手动解码 chunks，按 `\n\n` 分割事件行。

**网络中断检测机制：**

1. **AbortSignal 链式传递**：
   - `StreamOptions.signal` 从应用层传递到 Provider 层
   - 用户按 Escape / `agent.abort()` → `AbortController.abort()` → 所有 Provider 的 `fetch()` / SDK 调用立即取消
   - Anthropic/OpenAI/Bedrock/Google/Mistral 均支持 `signal` 参数

2. **Provider 层重试检测**：
   - `isRetryableError()` 匹配状态码 429/500/502/503/504 和正则：
     ```
     /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused|other side closed/i
     ```
   - 指数退避重试：`baseDelayMs * 2 ** (attempt - 1)`，最大 3 次

3. **Agent 层综合重试**（`packages/coding-agent/src/core/agent-session.ts:2396-2488`）：
   - `_isRetryableError()` 覆盖更全面的网络错误模式：
     ```
     /overloaded|rate.?limit|429|500|502|503|504|network.?error|connection.?error|connection.?refused|connection.?lost|fetch failed|timed? out|timeout/i
     ```
   - 触发 `auto_retry_start` / `auto_retry_end` 事件，延迟后调用 `agent.continue()`
   - 上下文溢出（`stopReason === "error"` 且错误文本匹配 `isContextOverflow()`，或少数 Provider 成功返回但 usage 超过 contextWindow）→ compaction 压缩 + 自动重试一次

4. **前端/UI 层感知**：
   - **CLI TUI**：`AgentEvent` 流式消费，`error` 事件或 `AbortSignal` 触发后停止渲染，显示错误信息
   - **Web UI**（`StreamingMessageContainer`）：订阅 `AgentEvent`，`message_end` 或 `agent_end` 清除流式容器；如果底层没有发出结束事件，`isStreaming` 会保持为 true，UI 继续显示脉冲光标。当前 Web UI 没有单独实现“长时间无事件自动超时”逻辑
   - **Bot**：`AgentSession` 的 `errorMessage` 状态更新后，Bot 将错误信息通过飞书消息发送给用户

**核心文件：** `packages/ai/src/utils/event-stream.ts`、`packages/ai/src/stream.ts`、`packages/ai/src/types.ts`、`packages/coding-agent/src/core/agent-session.ts`

---

### Q2: LLM Provider 解耦的实现细节是什么？是否支持多 Provider 热切换或 Fallback 机制？

**A:**

**一句话结论：Provider 已经解耦，运行时可以换模型，但失败时不会自动跨厂商切换。**
它更像一个“插座面板”：Agent 只知道插到 `streamSimple()` 这个统一插口上，至于后面接的是 OpenAI、Anthropic、Gemini 还是 Bedrock，由 `model.api` 去注册表里查。

**解耦实现：**

1. **Provider 注册表**（`api-registry.ts`）：维护 `Map<string, RegisteredApiProvider>`。每个 Provider 注册两个统一入口：`stream()` 和 `streamSimple()`。
2. **API 路由**（`stream.ts`）：根据 `model.api` 调用 `getApiProvider(api)`，查不到就抛 `No API provider registered for api: ...`。
3. **懒加载**（`register-builtins.ts`）：10 种内置 API 协议的实现通过动态 `import()` 延迟加载，避免启动时一次性加载所有厂商 SDK。
4. **统一事件协议**：所有 Provider 把自家流式协议翻译成 `AssistantMessageEvent`，上层只消费 `start`、`text_delta`、`thinking_delta`、`toolcall_delta`、`done`、`error` 等统一事件。
5. **跨 Provider 消息兼容**（`transform-messages.ts`）：在历史消息换模型重放前，处理图片降级、tool call ID 标准化、thinking 块转换、孤立 tool call 补空结果等兼容问题。

**热切换支持到什么程度：**

- **CLI 支持运行时切换模型**：`/model` 或模型循环会更新 `agent.state.model`，并把 `ModelChangeEntry` 写入 JSONL。后续 turn 使用新模型。
- **`ModelRegistry` 负责模型选择**：内置模型、用户配置、认证状态都会进入 `findInitialModel()` 的选择逻辑。
- **`scopedModels` 是可循环模型列表**：主要用于 Ctrl+P/模型循环，不是失败后的自动备用链路。
- **Bot 不做运行时热切换**：`packages/mom` 通过 `MOM_LLM_PROVIDER` / `MOM_LLM_MODEL` 环境变量选择模型，通常需要重启进程才生效。

**Fallback 机制：**

- **Provider 内部 fallback**：OpenRouter 兼容配置支持 `allow_fallbacks` 和 `order` 等路由参数，这是 OpenRouter 自己在上游模型之间降级。
- **Agent 级错误重试**：网络错误、限流、5xx 等会被 `AgentSession._isRetryableError()` 识别，按设置做指数退避后调用 `agent.continue()` 重试。
- **上下文溢出恢复**：context overflow 不走普通 retry，而是触发 compaction，移除失败消息后自动重试一次。
- **没有跨 Provider 自动 fallback**：当前没有“Anthropic 失败 → 自动切 OpenAI → 再重试”的框架级策略。跨厂商切换需要用户主动换模型，或交给 OpenRouter 这类 Provider 内部路由处理。

**核心文件：** `packages/ai/src/api-registry.ts`、`packages/ai/src/providers/register-builtins.ts`、`packages/ai/src/providers/transform-messages.ts`

---

### Q3: ReAct 循环中 Thought → Action → Observation 的自动编排逻辑由哪一层负责？LLM 生成 Thought 的 Prompt 模板如何设计以确保不偏离用户意图？

**A:**

**重要澄清：FitClaw 的实现不是经典 ReAct 文本模板，而是 Function Calling / tool-use loop。**
因此源码里没有让 LLM 固定输出 `Thought: ... Action: ... Observation: ...` 的 prompt 模板，也没有用正则从自然语言里解析 Action。

可以把两种机制的差别理解为：

| 机制 | 模型输出 | 框架怎么处理 | 主要风险 |
|------|----------|--------------|----------|
| 经典 ReAct | 一段带 `Thought/Action/Observation` 标记的自然语言 | 正则或 parser 从文本中提取 action | 格式漂移、解析失败、参数难校验 |
| FitClaw 当前实现 | 结构化 `toolCall` 内容块 | 直接读取 `name` 和 `arguments`，再做 JSON Schema 校验 | 工具选错或参数语义错，但结构可控 |

典型工具调用在 FitClaw 内部是这样的结构，而不是自然语言动作描述：

```json
{
  "type": "toolCall",
  "name": "data_bodybuilding_read",
  "arguments": { "namespace": "user_profile" }
}
```

**编排逻辑由 Agent 框架层 `@fitclaw/agent-core` 负责。** 核心在 `packages/agent/src/agent-loop.ts` 的 `runLoop()`：

```
外层循环（followUp 驱动）：
  LLM 没有 toolCall 且没有 steering 消息时
  → 检查 getFollowUpMessages()
  → 有则继续，无则退出

内层循环（toolCall 驱动）：
  1. 注入 pendingMessages（steering 消息）到上下文
  2. streamAssistantResponse() → LLM 返回
  3. 提取 content 中的 toolCall 内容块
  4. 有 toolCall → executeToolCalls() → 结果加入上下文 → 回到 1
  5. 无 toolCall → 退出内层循环
```

**终止条件：** `toolCalls.length === 0` 且 `followUpMessages.length === 0`。

**"Thought" 如何落到实现上：**

FitClaw 不要求模型把思考写成可解析的 `Thought:` 文本。支持推理输出的 Provider 会把底层 reasoning/thinking 能力转换成统一的 `ThinkingContent`：

- Anthropic：`ThinkingContent`（`{ type: "thinking", thinking: string }`）
- OpenAI 等 Provider：通过各自 reasoning 字段或选项映射
- 上层只检查 `block.type === "thinking"`，不关心底层协议名称
- `ThinkingLevel` 支持 `minimal/low/medium/high/xhigh`；token 型 Provider 的默认预算在 `simple-options.ts` 中定义为 minimal 1024、low 2048、medium 8192、high 16384，`xhigh` 会按 Provider 能力钳制

**如何尽量不偏离用户意图：**

1. **系统提示词约束任务边界**：`buildSystemPrompt()` 注入角色、工具列表、Skill 元数据、项目上下文。
2. **工具 Schema 约束参数形状**：`validateToolArguments()` 对工具参数做 TypeBox/JSON Schema 校验。
3. **工具结果回流给模型**：工具成功或失败都会成为 `ToolResultMessage`，下一轮 LLM 能基于真实观察继续推理。
4. **Steering 支持人工干预**：用户中途输入会进入 steering 队列，在下一次 LLM 调用前注入上下文。

所以，这个问题如果按经典 ReAct 名词回答，容易误导。更准确的说法是：FitClaw 的 "Action" 是结构化 tool call，"Observation" 是 `ToolResultMessage`，"Thought" 不是可解析模板，而是 Provider 可选的 thinking 内容块。

**核心文件：** `packages/agent/src/agent-loop.ts:152-234`、`packages/ai/src/providers/simple-options.ts`

---

### Q4: 当 Action 执行失败或 Observation 返回异常时，错误处理与重试策略是怎样的？

**A:**

FitClaw 的错误处理不是单点逻辑，而是**四层纵深防御**：Provider 层（SDK 重试）→ Agent 层（自动重试 + 压缩恢复）→ 工具层（错误透传）→ UI 层（用户感知）。每一层有独立的判断逻辑和降级策略。

---

#### 第一层：Provider 级重试（SDK 内置 + 自定义退避）

##### 白话

把 LLM API 调用想象成打电话。如果对方占线（429）或服务器挂了（5xx），你不应该立刻告诉老板"打不通"，而是等几秒再拨一次。这就是 Provider 层重试做的事——在底层自动重拨，上层完全无感知。

##### 具体实现

**SDK 原生重试（Anthropic / OpenAI / Bedrock）：**

大部分 Provider 使用各厂商的官方 SDK，SDK 自带重试机制。FitClaw 通过 `StreamOptions` 传递三个控制参数：

```typescript
// packages/ai/src/types.ts
interface StreamOptions {
  timeoutMs?: number;       // SDK 请求超时
  maxRetries?: number;      // SDK 重试次数
  maxRetryDelayMs?: number; // 服务端要求延迟的上限
}
```

以 Anthropic 为例（`packages/ai/src/providers/anthropic.ts:468-472`）：

```typescript
const requestOptions = {
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
  ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
};
```

这些参数直接透传给 `client.messages.create()`，SDK 内部处理退避逻辑。OpenAI Completions、OpenAI Responses、Amazon Bedrock 均采用相同模式。

**自定义重试（Google Gemini CLI）：**

Gemini CLI 使用原始 `fetch()` 而非 SDK，因此自己实现了一套完整的重试引擎（`packages/ai/src/providers/google-gemini-cli.ts:398-475`）：

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_EMPTY_STREAM_RETRIES = 2;
```

重试判定逻辑（行 226-231）：
- HTTP 状态码 429 / 500 / 502 / 503 / 504
- 错误文本匹配：`resource exhausted`、`rate limit`、`overloaded`、`service unavailable`、`other side closed`

退避策略（行 437-450）：

```typescript
// 优先使用服务端返回的精确延迟
const serverDelay = extractRetryDelay(errorText, response);
const delayMs = serverDelay ?? BASE_DELAY_MS * 2 ** attempt; // 1s, 2s, 4s

// 如果服务端延迟超过 maxRetryDelayMs（默认 60s），直接抛错，不再等待
if (maxDelayMs > 0 && serverDelay && serverDelay > maxDelayMs) {
  throw new Error(`Server requested ${delaySeconds}s retry delay (max: ${Math.ceil(maxDelayMs / 1000)}s)`);
}
```

`extractRetryDelay()`（行 116-205）从三个来源提取精确的等待时间：

| 来源 | 示例 | 解析方式 |
|------|------|---------|
| HTTP 响应头 | `Retry-After: 120`、`x-ratelimit-reset: 1714723400` | 秒数或 HTTP 日期 |
| 响应体文本 | `"Your quota will reset after 18h31m10s"`、`"Please retry in 3.4s"` | 正则提取时间单位 |
| 响应体 JSON | `"retryDelay": "34.074824224s"` | 正则提取 JSON 字段 |

403/404 错误**不延迟**，直接切换到下一个 endpoint（行 424-427）。网络错误（`fetch failed`）视为可重试，并解包 `error.cause` 链获取底层错误信息（行 462-466）。

**空流重试（行 746-789）：** 如果第一次请求返回了 HTTP 200 但没有任何内容（空流），最多额外重试 2 次，起始延迟 500ms。这是针对 Gemini 服务端偶发空响应的防御性措施。

**这些参数的来源：** 由 `AgentSession` 在创建时从 `SettingsManager` 读取（`packages/coding-agent/src/core/sdk.ts:329-341`）：

```typescript
const providerRetrySettings = settingsManager.getRetrySettings().provider ?? {};
timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
```

用户可在 `settings.json` 中配置：

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 120000,
      "maxRetries": 3,
      "maxRetryDelayMs": 60000
    }
  }
}
```

##### 原理

为什么分两层重试（SDK 层 + Agent 层）？

- **SDK 层重试**处理的是单次 HTTP 请求的瞬时故障——网络闪断、服务端临时过载、限流。这些故障通常在几秒内自愈，SDK 内置重试即可覆盖。
- **Agent 层重试**处理的是 SDK 重试耗尽后的残留错误——以及需要修改 Agent 状态（如移除错误消息）才能重试的场景。SDK 层重试是"重拨同一个号码"，Agent 层重试是"换一个策略再试"。

---

#### 第二层：Agent 级自动重试（指数退避 + 状态回滚）

##### 白话

Provider/SDK 层已经按自身配置处理过请求级重试后，错误仍然冒上来。这时候 Agent 层接管——它不像 SDK 那样只看 HTTP 请求，而是先判断这个错误**值不值得重试**（限流值得，上下文溢出不值得），然后做**指数退避**（默认 2s → 4s → 8s），最后**回滚 Agent 状态**（删掉那条包含错误的 assistant 消息）再重试。

##### 具体实现

**入口（`packages/coding-agent/src/core/agent-session.ts:560-573`）：**

```typescript
if (event.type === "agent_end" && this._lastAssistantMessage) {
  const msg = this._lastAssistantMessage;
  // 先检查是否可重试错误
  if (this._isRetryableError(msg)) {
    const didRetry = await this._handleRetryableError(msg);
    if (didRetry) return; // 重试已发起，跳过压缩检查
  }
  this._resolveRetry();
  await this._checkCompaction(msg); // 非重试错误 → 检查是否需要压缩
}
```

**可重试判定（`_isRetryableError`，行 2396-2408）：**

这是整个重试策略的核心——一个精心调校的正则表达式，匹配 25+ 种错误模式：

```typescript
private _isRetryableError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;

  // 上下文溢出不在此重试——交给压缩流程处理
  if (isContextOverflow(message, contextWindow)) return false;

  // 匹配：overloaded、rate limit、429、5xx、network error、
  // connection refused/lost、fetch failed、socket hang up、
  // upstream connect、timed out、terminated、retry delay...
  return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(err);
}
```

明确排除的错误类型：
- **上下文溢出**：走 compaction 流程，不重试（重试只会再次溢出）
- **非 error stopReason**：`aborted`（用户主动取消）、`stop`（正常结束）、`length`（max_tokens 截断）

**指数退避执行（`_handleRetryableError`，行 2414-2488）：**

```typescript
private async _handleRetryableError(message: AssistantMessage): Promise<boolean> {
  const settings = this.settingsManager.getRetrySettings();
  if (!settings.enabled) { this._resolveRetry(); return false; }

  this._retryAttempt++;
  if (this._retryAttempt > settings.maxRetries) {
    // 超过最大重试次数 → emit auto_retry_end(success:false) → 放弃
    this._emit({ type: "auto_retry_end", success: false, attempt, finalError });
    this._retryAttempt = 0;
    this._resolveRetry();
    return false;
  }

  // 指数退避：baseDelayMs * 2^(attempt-1)，默认 2s → 4s → 8s
  const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

  this._emit({ type: "auto_retry_start", attempt, maxAttempts, delayMs, errorMessage });

  // 关键步骤：从 Agent 状态中移除包含错误的 assistant 消息
  // 这条消息已写入 JSONL 历史，但不应出现在重试的上下文中
  const messages = this.agent.state.messages;
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    this.agent.state.messages = messages.slice(0, -1);
  }

  // 可中止的 sleep
  this._retryAbortController = new AbortController();
  await sleep(delayMs, this._retryAbortController.signal);

  // 通过 setTimeout(0) 跳出事件处理器调用栈，避免重入问题
  setTimeout(() => {
    this.agent.continue().catch(() => {});
  }, 0);
  return true;
}
```

**重试期间的 Promise 追踪（行 2503-2510）：**

```typescript
private async waitForRetry(): Promise<void> {
  if (!this._retryPromise) return;
  await this._retryPromise;        // 等待重试完成或被取消
  await this.agent.waitForIdle();  // 等待 Agent 进入空闲状态
}
```

`session.prompt()` 在返回前调用 `waitForRetry()`，这意味着**用户端的 prompt() 调用会一直等待到所有重试完成**，不会在重试进行中返回一个中间状态。

**重试取消（`abortRetry`，行 2493-2497）：**

```typescript
abortRetry(): void {
  this._retryAbortController?.abort(); // 中断 sleep
  this._resolveRetry();                 // 解除 waitForRetry() 的阻塞
}
```

##### 原理

Agent 层重试和 Provider 层重试的关键区别：

| 维度 | Provider 层重试 | Agent 层重试 |
|------|---------------|------------|
| 重试对象 | 单次 HTTP 请求 | 整个 Agent turn |
| 状态感知 | 无状态，只是重发请求 | 回滚 Agent 消息状态 |
| 退避策略 | SDK 内置 / Gemini 自定义 | 固定指数 2s/4s/8s |
| 可中止性 | 通过 AbortSignal | 通过 AbortController |
| 用户感知 | 透明 | 通过 auto_retry_start/end 事件通知 UI |

为什么状态回滚是关键？如果不删除那条 `stopReason: "error"` 的 assistant 消息，重试时 LLM 会在上下文中看到"上一次我出错了"，这可能影响它的推理质量。回滚让重试对 LLM 完全透明。

---

#### 第三层：工具执行失败处理（准备 → 执行 → 收尾 三阶段）

##### 白话

LLM 决定调用工具后，框架分三步执行：准备参数（prepare）→ 真正执行（execute）→ 收尾检查（finalize）。任何一步失败都不会让整个 Agent 崩溃——错误被包装成 `isError: true` 的工具结果，返回给 LLM，让 LLM 自己决定下一步怎么办。

##### 具体实现

整个流程位于 `packages/agent/src/agent-loop.ts:517-668`。

**阶段 1：`prepareToolCall()`（行 517-567）——参数准备与校验**

```typescript
async function prepareToolCall(...): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  // 1. 工具不存在 → 立即返回错误
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return { kind: "immediate", result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true };
  }

  try {
    // 2. 参数类型转换 + JSON Schema 校验
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    const validatedArgs = validateToolArguments(tool, preparedToolCall);

    // 3. beforeToolCall 钩子 — 上层可以 block 工具调用
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall({...}, signal);
      if (beforeResult?.block) {
        return { kind: "immediate", result: createErrorToolResult(beforeResult.reason || "blocked"), isError: true };
      }
    }
    return { kind: "prepared", toolCall, tool, args: validatedArgs };
  } catch (error) {
    // 校验失败（类型不匹配、缺少必填字段等）
    return { kind: "immediate", result: createErrorToolResult(error.message), isError: true };
  }
}
```

`validateToolArguments()`（`packages/ai/src/utils/validation.ts`）的校验流程：
1. 克隆参数 → TypeBox `Value.Convert` 类型转换
2. 对非 TypeBox schema → JSON Schema 强制转换（`allOf`/`anyOf`/`oneOf` 递归处理、基本类型强制转换）
3. 使用编译后的 validator 校验（`WeakMap` 缓存编译结果，避免重复编译）
4. 返回格式化的校验错误（包含 JSON Path，如 `/namespace: expected string`）

**阶段 2：`executePreparedToolCall()`（行 569-604）——实际执行**

```typescript
async function executePreparedToolCall(...): Promise<ExecutedToolCallOutcome> {
  try {
    const result = await prepared.tool.execute(
      prepared.toolCall.id, prepared.args, signal,
      (partialResult) => {
        // 支持流式 partial result（如长时间运行的 bash 命令）
        updateEvents.push(emit({ type: "tool_execution_update", partialResult }));
      },
    );
    return { result, isError: false };
  } catch (error) {
    // 工具执行抛异常 → 捕获，不传播，包装为错误结果
    return { result: createErrorToolResult(error.message), isError: true };
  }
}
```

**阶段 3：`finalizeExecutedToolCall()`（行 606-649）——后处理**

```typescript
async function finalizeExecutedToolCall(...): Promise<FinalizedToolCallOutcome> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall({...}, signal);
      if (afterResult) {
        result = {
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          terminate: afterResult.terminate ?? result.terminate, // 可强制终止批次
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      // afterToolCall 钩子自身抛异常 → 替换为错误结果
      result = createErrorToolResult(error.message);
      isError = true;
    }
  }
  return { toolCall, result, isError };
}
```

**`isError` 标志如何传递到 LLM：**

错误结果会被标记为 `isError: true` 的 `ToolResultMessage`。各 Provider 在转换消息时正确传递这个标志：

| Provider | 传递方式 |
|----------|---------|
| Anthropic | `tool_result` 的 `is_error: true` 字段（`anthropic.ts` 行 1064） |
| Bedrock | `ToolResultStatus.ERROR` 枚举（`amazon-bedrock.ts` 行 732） |
| OpenAI | 通过文本前缀标记 |

LLM 看到 `isError: true` 后，通常会换一种方式重试——修改参数、换一个工具、或者告知用户当前无法完成。

**工具执行失败不自动重试。** 这不是 bug，而是刻意的设计选择：LLM 比框架更智能，它看到错误信息后可以创造性决策（换参数、换工具、拆分步骤、向用户求助），远比框架的"原样重试"有效。

##### 原理

三阶段设计实现了**关注点分离**：

| 阶段 | 职责 | 失败策略 |
|------|------|---------|
| prepare | 参数校验 + 安全拦截 | 返回 `isError` 给 LLM |
| execute | 实际运行工具 | 捕获异常，包装为 `isError` |
| finalize | 后处理 + 结果修正 | 钩子失败覆盖原结果 |

`beforeToolCall` 和 `afterToolCall` 钩子是框架的**依赖注入点**——上层（CLI/Bot）可以在不修改 Agent 核心代码的情况下注入安全策略、结果脱敏、权限控制等逻辑。这符合开闭原则（OCP）。

---

#### 第四层：上下文溢出检测与压缩恢复

##### 白话

工具执行结果太长、对话历史太多——LLM 的 context window 被撑爆了。这种情况重试没有意义（只会再次溢出），必须先"压缩"（把历史消息总结成摘要），再重试。

##### 具体实现

**溢出检测（`packages/ai/src/utils/overflow.ts:28-48`）：**

17 个正则模式覆盖所有主流 Provider 的溢出错误格式：

```typescript
const OVERFLOW_PATTERNS = [
  /prompt is too long/i,                    // Anthropic
  /request_too_large/i,                     // Anthropic HTTP 413
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i,            // OpenAI
  /input token count.*exceeds the maximum/i,// Google Gemini
  /maximum prompt length is \d+/i,          // xAI Grok
  /maximum context length is \d+ tokens/i,  // OpenRouter
  // ... 共 17 个
];

// 排除误判：限流错误有时也包含 "Too many tokens" 字样
const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
];
```

**静默溢出检测（行 122-129）：** 某些 Provider（如 z.ai）溢出时不报错，而是静默截断。通过比较 `usage.input + usage.cacheRead > contextWindow` 来检测。

**压缩恢复流程（`agent-session.ts:1748-1826`）：**

```typescript
private async _checkCompaction(assistantMessage): Promise<void> {
  // Case 1: 上下文溢出 → 移除错误消息 → 压缩 → 自动重试（仅一次）
  if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
    if (this._overflowRecoveryAttempted) {
      // 已经尝试过一次压缩+重试，仍然溢出 → 放弃
      this._emit({ type: "compaction_end", errorMessage: "Context overflow recovery failed..." });
      return;
    }
    this._overflowRecoveryAttempted = true;
    // 从 Agent 状态移除溢出错误消息
    this.agent.state.messages = messages.slice(0, -1);
    await this._runAutoCompaction("overflow", true); // willRetry=true
    return;
  }

  // Case 2: 接近阈值（contextWindow - reserveTokens）→ 压缩但不自动重试
  if (shouldCompact(contextTokens, contextWindow, settings)) {
    await this._runAutoCompaction("threshold", false); // willRetry=false
  }
}
```

**触发阈值计算：**

```
触发条件: contextTokens > contextWindow - reserveTokens(16,384)
实际百分比因模型而异:
  Claude Opus 4.6 (200K): 183,616 tokens → 91.8%
  GPT-4o (128K):          111,616 tokens → 87.2%
```

`reserveTokens = 16,384` 是为 LLM 压缩摘要生成 + 后续对话预留的空间。可通过 `settings.json` 的 `compaction.reserveTokens` 调整。

##### 原理

溢出恢复**最多一次**的硬限制是防御性的：如果压缩后仍然溢出，说明上下文中有无法压缩的超大内容（如 base64 图片、巨大的工具输出），再次压缩不会改善。此时告知用户是更负责任的行为。

---

#### 工具输出截断（防止上下文溢出）

每个工具的输出在发送给 LLM 之前都会经过截断处理（`packages/coding-agent/src/core/tools/truncate.ts`）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_MAX_LINES` | 2000 | 最大行数 |
| `DEFAULT_MAX_BYTES` | 50KB (51,200) | 最大字节数 |
| `GREP_MAX_LINE_LENGTH` | 500 | grep 每行最大字符数 |

**两种截断策略：**

| 策略 | 函数 | 适用场景 | 行为 |
|------|------|---------|------|
| 头部截断 | `truncateHead()` | read 工具（读文件看开头） | 保留前 N 行/字节，绝不返回半行。如果第一行就超过字节限制 → 返回空内容 + `firstLineExceedsLimit: true` |
| 尾部截断 | `truncateTail()` | bash 工具（看错误和最终输出） | 保留后 N 行/字节。边界情况：最后一行超长时从尾部截取部分内容（正确处理 UTF-8 多字节字符边界） |

**两个限制是"谁先到谁赢"的关系**——行数限制和字节限制独立检查，任一触发即截断。

---

#### 完整错误传播链路

```
Provider HTTP 错误
  │ SDK/Provider 内置或配置的请求级重试
  │ Gemini: 自定义 fetch 重试 (3次, 指数退避 1s→2s→4s)
  │ 失败 → push({ type: "error", reason: "error", error: message })
  ▼
AssistantMessageEventStream
  │ 终止条件: event.type === "done" || event.type === "error"
  │ result() → 返回包含 stopReason="error" + errorMessage 的 AssistantMessage
  ▼
agent-loop: streamAssistantResponse()
  │ 返回 AssistantMessage (stopReason="error")
  ▼
agent-loop: runLoop() 内层
  │ if stopReason === "error" || "aborted" → emit turn_end + agent_end → return(退出循环)
  ▼
agent-session: _handleAgentEvent("agent_end")
  │ → _isRetryableError() 判断是否可重试
  │   ├─ YES → _handleRetryableError() → 指数退避 sleep → agent.continue()
  │   └─ NO  → _resolveRetry() → _checkCompaction()
  │              ├─ 溢出 → _runAutoCompaction("overflow", willRetry=true)
  │              ├─ 接近阈值 → _runAutoCompaction("threshold", willRetry=false)
  │              └─ 正常 → 结束
  ▼
UI 层 (CLI TUI / Bot)
  │ 订阅事件: auto_retry_start/end, compaction_start/end
  │ 显示: 重试倒计时 / 压缩进度 / 最终错误信息
```

---

#### 汇总

| 层次 | 重试对象 | 重试次数 | 退避策略 | 可中止 | 失败后行为 |
|------|---------|---------|---------|--------|-----------|
| SDK（Anthropic/OpenAI） | HTTP 请求 | SDK 默认 | SDK 内置 | 通过 signal | 抛异常 → Agent 层接管 |
| Google Gemini CLI | HTTP fetch | 3 次 | 1s→2s→4s（或服务端指定延迟） | 通过 signal | 抛异常 → Agent 层接管 |
| Agent 层 | 整个 turn | 默认 3 次 | 2s→4s→8s | `abortRetry()` | 超过上限 → emit 失败事件 |
| 工具执行 | 单个工具 | **不重试** | N/A | 通过 signal | `isError: true` 返回给 LLM |
| 上下文溢出 | 压缩 + 重试 | **1 次** | N/A | 通过 signal | 仍失败 → 告知用户 |
| 空流（Gemini） | 重新 fetch | 2 次 | 500ms→1s | 通过 signal | 抛异常 |

**核心文件：** `packages/agent/src/agent-loop.ts:517-668`、`packages/coding-agent/src/core/agent-session.ts:2396-2510`、`packages/ai/src/providers/google-gemini-cli.ts:100-475`、`packages/ai/src/utils/overflow.ts`、`packages/coding-agent/src/core/tools/truncate.ts`、`packages/ai/src/utils/event-stream.ts`

---

### Q5: 多轮推理循环中如何防止无限循环或推理死锁？是否设置了最大轮次、超时机制或循环检测？

**A:**

**当前防无限循环机制：**

1. **自然终止**：当 LLM 不再返回 `toolCall` 且没有 followUp 消息时，循环自然退出
2. **`terminate` 钩子**：`afterToolCall` 可返回 `{ terminate: true }`，当批次内所有工具都标记 terminate 时，`shouldTerminateToolBatch()` 返回 true，强制退出
3. **`abort()` 机制**：用户可通过 `agent.abort()` 主动中止，设置 `AbortSignal`
4. **超时**：bash 工具支持 `timeout` 参数（默认无限制），LLM 调用支持 `timeoutMs` 配置
5. **上下文溢出保护**：Provider 返回 context overflow 错误时，`isContextOverflow()` 识别后触发一次压缩 + 重试；普通阈值压缩则由 `contextTokens > contextWindow - reserveTokens` 触发

**没有的机制：**
- **没有最大轮次限制**：没有硬编码的 "最多 N 轮工具调用" 限制
- **没有循环检测**：没有检测 "同一工具+同一参数反复调用" 的逻辑
- **没有全局超时**：没有 "整个推理过程最多 N 秒" 的限制

**实际风险缓解：**
- LLM 的 contextWindow 是天然上限——每次工具调用结果都占用 token，最终会触发阈值压缩或 context overflow 处理
- 用户可以随时按 Escape/abort 中止
- Bot 层有 `runner.abort()` 机制，新消息到达时可中止当前推理

**潜在改进方向：**
- 添加最大工具调用轮次配置（如 `maxToolRounds: 50`）
- 添加重复调用检测（同一工具+相同参数连续 N 次 → 警告或停止）
- 添加全局推理超时（如 `maxReasoningTimeMs: 300000`）

**结论：当前系统靠自然终止、abort、工具级超时和上下文压缩兜底，不靠硬性轮次上限。** 这能覆盖多数真实使用场景，但不能严格证明不会出现长时间重复工具调用；如果面向高并发 Bot 或生产托管，应补最大轮次和重复调用检测。

---

## 二、Skill 系统与上下文成本优化

### Q6: 为什么 FitClaw 要通过 Skills 实现运动教练功能？直接调用 LLM 不行吗？这样设计岂不是多此一举？

**A:**

**白话：** LLM 是推理引擎，但不是领域专家。Skill 的本质是把"数据锚定、状态持久化、工具执行"从 LLM 的"推理与表达"中分离出来——让 LLM 做它擅长的决策，让 Skill 保证数据和执行是正确的。

**具体场景：四个 LLM 单打独斗解决不了的问题——**

| 问题 | 纯 LLM 方案 | + Skill 方案 |
|------|------------|-------------|
| **知识幻觉** | LLM 能说杠铃卧推"怎么做"，但握距、轨迹、代偿模式、伤病替代动作等精确数据会编造 | bodybuilding Skill 内嵌 `free-exercise-db`（800+ 动作 JSON + 图片），Python 脚本做确定性查询，返回可溯源数据 |
| **无状态记忆** | 每次调用"失忆"，不知道用户上周练了什么、用了多重、哪里受过伤 | `data:` frontmatter 声明 namespace（如 `training_log`、`user_profile`），框架自动注册读写工具，数据落盘为 JSON 文件 |
| **职责耦合** | 推理 + 数据 + 执行全混在 prompt 里，一个聊天机器人"瞎编训练计划" | LLM 负责"判断与表达"（该记录什么、该推荐什么），Skill 负责"数据与执行"（记录到哪里、怎么查），各司其职 |
| **扩展僵化** | 每加一个运动领域要改 prompt、改代码、协调状态管理 | 新建 `swimming-coach/SKILL.md` + references，零改动核心 Agent 代码，CLI 和飞书 Bot 同时可用 |

**具体例子：一次典型的 Skill 调用链路——**

```
用户消息 → LLM (推理: 这个用户需要什么?)
  → 调用 data_bodybuilding_read({ namespace: "user_profile" })  ← Skill 提供持久化
  → 调用 scripts/query_exercises.py              ← Skill 提供数据查询
  → LLM (推理: 结合返回数据生成个性化计划)
  → 调用 data_bodybuilding_write({ namespace: "training_plan", data: plan }) ← Skill 提供写入
```

这和 RAG + Tool Calling 是一样的道理：LLM 做推理中枢，外部系统提供数据和执行能力。

**原理：关注点分离——**

这套设计背后是三个工程原则：

1. **确定性数据外挂**：LLM 的知识是概率性的（训练时见过的可能记住，没见过的会幻觉），运动数据（动作要领、肌肉群、器械要求）必须是确定性的。把数据放在 LLM 外部，通过工具调用获取，保证每次返回相同输入得到相同输出。

2. **状态外置**：LLM 是无状态的（每个请求独立），但私教需要持续跟踪用户状态。Skill 的 `data:` 机制把状态放在文件系统里，LLM 通过工具读写——框架保证持久化，LLM 保证决策质量。

3. **开放-封闭原则**：核心 Agent 代码对修改封闭（加新运动不改代码），对扩展开放（新增 Skill 目录即可）。这是通过声明式配置（SKILL.md frontmatter）+ 框架自动发现实现的。

**一句话总结：** 直接调 LLM = 能聊天的健身爱好者；LLM + Skill = 有数据、有记忆、有专业知识的 AI 私教。多出来的这层不是多余，是把"听起来像"变成"真能用"的关键。

---

### Q7: Skill 按需加载机制的完整执行链路是什么？关键函数 loadSkills / formatSkillsForPrompt 如何协作？LLM 如何决策？

**A:**

> **背景：Model A → Model B 架构演进**
>
> 在 Model A 架构中，每个 Skill 需要编写 TypeScript AgentTool（~800 行代码），通过 jiti 动态加载，`fitnessMode` 标志散落在 5 个文件中。bodybuilding 一个 Skill 就需要 11 个硬编码工具。新增运动项目意味着大量 TypeScript 代码和框架改动——Skill 作者必须理解框架内部机制。
>
> **Model B 纯 Skill 架构（2026-05-02）彻底删除了这些**：删除 fitness-coach（Model A）、删除 11 个 AgentTool + jiti 动态加载、删除 `fitnessMode` 标志。Skill 作者只需写 Markdown + 可选脚本，框架通过 `data:` frontmatter 声明自动注册工具。核心变化：**从"框架调用 Skill 代码"变为"LLM 读取 Skill 说明文档"**。
>
> 这次架构迁移的关键洞察：**Skill 不是程序逻辑分支，而是给 LLM 的"可选能力说明书"。**

---

#### 流水线全景

整个 Skill 系统是一条四步流水线，框架负责前两步（机械劳动），LLM 负责后两步（智能决策）：

```
loadSkills → formatSkillsForPrompt → LLM 决策 → read 工具
   发现           展示                  选择          使用
```

**没有 `selectSkill()` 函数，没有任何关键词匹配或向量检索**——LLM 凭 description 自行判断。这是整个设计中最关键、最容易误解的点。

---

#### 第一步：loadSkills — 发现 Skill

##### 白话

框架启动时扫描 `.fitclaw/skills/` 目录，找到每个 `SKILL.md`，只解析其 YAML frontmatter（name + description + data 声明），**不读 Markdown 正文**。结果是一组 `Skill{name, description, filePath}` 内存对象——Skill 已"注册"但还没给 LLM 看。

##### 调用链

```
loadSkills()                           # skills.ts:487 — 入口，协调加载顺序
  ↓
loadSkillsFromDirInternal()            # skills.ts:199 — 递归扫描目录
  ↓
loadSkillFromFile()                    # skills.ts:333 — 解析单个 SKILL.md
```

##### 关键函数详解

**`loadSkills()`（skills.ts:487-586）** — 入口函数，协调三层加载优先级：

1. 用户级 `~/.fitclaw/agent/skills/` — 最高优先
2. 项目级 `.fitclaw/skills/` — 次优先
3. 显式路径 `skillPaths` 参数 — 最低优先

同名 Skill 冲突时，先加载的保留（user > project > path），后加载的记录为 collision 诊断。用户级 Skill 可以覆盖同名项目 Skill。

**`loadSkillsFromDirInternal()`（skills.ts:199-301）** — 目录递归扫描，核心规则：

- 找到 `SKILL.md` → 该目录为 Skill 根目录，**不再递归进入子目录**
- 否则 → 扫描直接 `.md` 子文件 + 递归子目录
- 跳过 `.` 开头目录、`node_modules`
- 支持 `.gitignore`/`.ignore`/`.fdignore` 忽略规则和符号链接跟踪

**`loadSkillFromFile()`（skills.ts:333-412）** — 单文件解析，**只提取 frontmatter，不读正文**：

```typescript
function loadSkillFromFile(filePath, source) {
  const rawContent = readFileSync(filePath, "utf-8");
  const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
  const skillDir = dirname(filePath);
  const parentDirName = basename(skillDir);

  // 1. 验证 description（缺失 → 拒绝加载）
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    return { skill: null, diagnostics };
  }

  // 2. 检测 scripts/tools.ts（存在 → hasTools = true）
  const toolsPath = join(skillDir, "scripts", "tools.ts");
  const hasTools = existsSync(toolsPath);

  // 3. 构建 references/ 知识索引
  const knowledgeEntries = buildKnowledgeEntries(skillDir);

  // 4. 解析 data: 声明（Model B 专属）
  let dataNamespaces: Map<string, SkillDataDeclaration> | undefined;
  if (frontmatter.data && typeof frontmatter.data === "object") {
    dataNamespaces = new Map();
    for (const [key, decl] of Object.entries(frontmatter.data)) {
      const type = (decl as any).type === "array" ? "array" : "object";
      dataNamespaces.set(key, { type });
    }
  }

  return { skill: { name, description, filePath, baseDir: skillDir, ... }, diagnostics };
}
```

##### 输出的 Skill 内存结构

```typescript
Skill {
  name: string;                              // 来自 frontmatter 或父目录名
  description: string;                       // 来自 frontmatter（必须）
  filePath: string;                          // SKILL.md 绝对路径
  baseDir: string;                           // Skill 根目录
  sourceInfo: SourceInfo;                    // 来源（user/project/path）
  disableModelInvocation: boolean;           // 是否禁止 LLM 自动触发
  hasTools: boolean;                         // scripts/tools.ts 是否存在
  toolsPath?: string;                        // tools.ts 绝对路径
  knowledgeEntries?: KnowledgeEntryMeta[];   // references/ 目录索引
  dataNamespaces?: Map<string, SkillDataDeclaration>; // Model B data: 声明
}
```

##### 元数据字段要点

| 字段 | 必须 | 关键约束 |
|------|------|---------|
| `name` | 建议 | 最长 64 字符，`[a-z0-9-]+`，不能 `--`，需与目录名一致 |
| `description` | **是** | 最长 1024 字符，缺失或为空 → Skill 被拒绝加载。**LLM 决策的唯一依据** |
| `disable-model-invocation` | 否 | 为 true 时不出现在 `<available_skills>` 中，只能手动 `/skill:name` 激活 |
| `data` | 否 | Model B 专属。`type: "object"` = replace 写入，`type: "array"` = append 写入 |

---

#### 第二步：formatSkillsForPrompt — 展示 Skill

##### 白话

框架把 Skill 列表打包成一小段 XML，贴在系统提示词里。每个 Skill 至少包含 `name`、`description`、`location`；如果该 Skill 声明了 `data:` namespace，还会附带真实可调用的数据工具名和 namespace 清单。这相当于在 LLM 面前放一张"我能帮你做什么、能读写哪些数据"的清单，LLM 根据用户问题自行判断该不该去"翻"某个 SKILL.md。**这个函数不是给程序看的，是给 LLM 看的。**

##### 关键函数

**`formatSkillsForPrompt()`（`packages/coding-agent/src/core/skills.ts`）：**

```typescript
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
  // ↑ 关键：disableModelInvocation=true 的 Skill 对 LLM 不可见
  if (visibleSkills.length === 0) return "";

  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "",
    "<available_skills>",
  ];

  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    if (skill.dataNamespaces && skill.dataNamespaces.size > 0) {
      lines.push("    <data_tools>");
      lines.push(`      <read>data_${skill.name}_read</read>`);
      lines.push(`      <write>data_${skill.name}_write</write>`);
      lines.push("      <namespaces>");
      for (const [namespace, declaration] of skill.dataNamespaces) {
        lines.push(
          `        <namespace name="${escapeXml(namespace)}" type="${declaration.type}" />`,
        );
      }
      lines.push("      </namespaces>");
      lines.push("    </data_tools>");
    }
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}
```

**四个关键设计点：**

1. **`disableModelInvocation` 过滤**：为 true 的 Skill 不注入提示词，LLM 看不到它。用于实验性 Skill 或需要严格人工控制的场景。
2. **`escapeXml()` 处理**（skills.ts:450-457）：防止 Skill 名称或描述中的 `<`、`>`、`&` 破坏 XML 结构。
3. **data 工具索引**：对声明 `data:` 的 Skill 显式注入 `data_<skill>_read` / `data_<skill>_write`，避免 LLM 沿用旧式 `data:skill:write` 或幻觉 `data_fitness_read`。
4. **注入条件**（system-prompt.ts）：**只在 `read` 工具可用时才注入**，因为 LLM 需要通过 read 加载 SKILL.md。没有 read 工具，Skill 列表只是噪音。

##### 最终效果

```xml
<available_skills>
  <skill>
    <name>bodybuilding</name>
    <description>MUST use this skill when user asks about exercises, training plans,
muscle building, workout routines, or any fitness-related questions.</description>
    <location>.fitclaw/skills/bodybuilding/SKILL.md</location>
    <data_tools>
      <read>data_bodybuilding_read</read>
      <write>data_bodybuilding_write</write>
      <namespaces>
        <namespace name="user_profile" type="object" />
        <namespace name="training_log" type="array" />
      </namespaces>
    </data_tools>
  </skill>
  <skill>
    <name>swimming-coach</name>
    <description>Use when user asks about swimming technique, training plans for
swimming, stroke improvement, or any swimming-related questions.</description>
    <location>.fitclaw/skills/swimming-coach/SKILL.md</location>
  </skill>
</available_skills>
```

---

#### 第三步：LLM 决策 — 选择 Skill

##### 白话

**这里没有任何函数在做判断。** 没有 `selectSkill()`，没有 `if (message.includes("健身"))`，没有向量检索。LLM 自己读 description 做语义匹配。这是整个设计中最关键的认知转折点。

##### 这不是程序逻辑分支

```
不存在：if (message.includes("健身")) activateSkill("bodybuilding")
不存在：vectorSearch(userMessage).topK(3)
不存在：selectSkill(userIntent) → Skill
实际：LLM 读 <available_skills> → 语义匹配 → 决定 read 哪个 SKILL.md
```

##### LLM 的推理过程

```
用户消息: "给我设计一个胸肌训练计划"
  ↓
LLM 阅读系统提示词中的 <available_skills>
  ↓ 语义匹配
bodybuilding description: "...exercises, training plans, muscle building..."
  ↓ 匹配！
LLM 决定使用 bodybuilding Skill
  ↓
LLM 调用工具: read(.fitclaw/skills/bodybuilding/SKILL.md)
  ↓ 获取完整指令 (~3,200 tokens)
LLM 按 SKILL.md 指令执行:
  - 可能需要 read references/training_programs.md (~2,000 tokens)
  - 可能需要 bash query_exercises.py --muscle chest
  - 可能需要 data_bodybuilding_write({ namespace: "training_log", data: ..., mode: "append" })
```

##### 为什么不用关键词匹配或向量检索？

关键词匹配（`if (message.includes("健身")) activate("bodybuilding")`）脆弱且不可扩展——新增 Skill 需改框架代码。向量检索虽然更智能，但引入额外的 embedding 模型和向量数据库，增加系统复杂度。纯 LLM 推理的代价是 ~100 tokens per Skill，换来**零维护成本和无限扩展性**。

---

#### 第四步：read 工具 — 真正加载 Skill

##### 白话

之前 LLM 看到的只是 description（"简历"），调用 `read` 工具后才拿到 SKILL.md 全文（"操作手册"）。这就是两阶段设计的核心：**先判断，再加载，而不是先加载再判断。**

##### 两阶段对比

| 阶段 | 触发者 | 内容 | Token | 用途 |
|------|--------|------|-------|------|
| `formatSkillsForPrompt` | 框架 | description + data 工具索引 | ~100-200/Skill | 判断是否相关并暴露真实数据工具名 |
| `read` 工具 | LLM | SKILL.md 全文 | ~3,200 | 执行具体任务 |

##### 渐进式加载的完整层级与 Token 消耗

| 层级 | 内容 | 加载时机 | Token 开销 |
|------|------|----------|-----------|
| Layer 0 | Skill name + description + 可选 data 工具索引 | 始终在 system prompt | ~100-200/Skill |
| Layer 1 | SKILL.md 正文 | LLM 认为匹配时 read | ~3,200 |
| Layer 2 | references/*.md | LLM 按需 read | ~7,000（极少全读） |
| Layer 3 | scripts/ 输出 | LLM bash 调用 | 脚本本体不进 prompt；stdout 作为工具结果进入上下文并受截断控制 |

##### Token 节省量化

| 指标 | 数值 |
|------|------|
| bodybuilding Skill 全文（SKILL.md） | ~3,200 tokens |
| bodybuilding 知识库（references/*.md，9 份） | ~7,000 tokens |
| 元数据注入（name + description + 可选 data 工具索引） | ~100-200 tokens/Skill |
| 全量加载总开销 | ~10,200 tokens |
| 按需加载默认开销 | ~100-200 tokens（仅元数据和工具索引） |
| **Token 节省比例** | **约 98-99%**（100-200 vs 10,200） |

> 注意：这是理论最大节省。实际使用中 LLM 几乎总会读取 SKILL.md 全文（需要完整指令），真正的按需节省在 references/（~7,000 tokens）。项目中没有系统化的 token 消耗压测报告，上述数据基于文件大小估算（chars/4 近似）。

---

#### 补充：手动激活与 data 工具注册

除了 LLM 自动判断，Skill 还支持手动激活：

- 用户键入 `/skill:bodybuilding` → CLI 解析斜杠命令 → 直接注入 SKILL.md 全文到上下文
- `disable-model-invocation: true` 的 Skill **只能**通过此方式激活

**data 工具自动注册（sdk.ts）：** 如果 Skill 声明了 `data:` namespace，框架在 `createAgentSession()` 时自动注册 `data_{skillName}_read` 和 `data_{skillName}_write` 两个 Agent Tool。这两个工具接收 `namespace` 参数，实际操作 `{dataDir}/sport-data/{skillName}/{namespace}.json`，由 `FileSportDataStore` 实现。读写都会拒绝未声明 namespace；存储层还会校验 namespace 字符集和 resolved path 边界。Skill 作者不需要写任何 TypeScript 代码。

---

#### 设计哲学

##### 一句话本质

> **Skill = 给 LLM 的"可选能力说明书"，不是程序逻辑分支**

##### 四大模块分工

| 模块 | 职责 | 谁做 |
|------|------|------|
| `loadSkills` | 找到技能 | 框架（机械） |
| `formatSkillsForPrompt` | 展示技能 | 框架（机械） |
| LLM | 选择技能 | LLM（智能） |
| `read` 工具 | 使用技能 | LLM（智能） |

##### 为什么拆成两段（description + SKILL.md）

如果一次性加载所有 Skill 全文：prompt 巨大、token 爆炸、成本高。当前设计：description（~100 tokens）用于判断是否相关，SKILL.md（~3,200 tokens）只在需要时才加载。**先判断，再加载。**

**核心文件：** `packages/coding-agent/src/core/skills.ts`（完整 Skill 生命周期）、`packages/coding-agent/src/core/system-prompt.ts:158-160`（Skill 注入位置）、`packages/coding-agent/src/core/sdk.ts:390-408`（data 工具注册）

---

### Q8: 分层知识库的结构设计是怎样的？知识库与 Skills 之间是引用关系还是内嵌关系？

**A:**

**一句话结论：知识库是 Skill 目录的物理组成部分（内嵌关系），不是通过路径/URL 引用的独立系统。框架通过自动扫描 `references/` 子目录构建索引，LLM 按需读取具体文件。**

---

#### 一、为什么需要分层

核心矛盾：**LLM 需要足够的领域知识才能做好健身私教，但每条知识都占用 context window（即 token）。**

如果把 9 份 reference 文件（~7,000 tokens）全部塞进 system prompt，那么每次对话——即便是"你好"——都要为这些知识付费。而大多数对话根本不需要查阅"渐进超负荷原理"或"伤痛预防指南"。

分层的解决思路是：**先让 LLM 看到"目录"（索引），需要时再去读"正文"（具体文件）。**

---

#### 二、四层结构详解

以 bodybuilding Skill 为例，完整目录树：

```
.fitclaw/skills/bodybuilding/
├── SKILL.md                    # Layer 1+2: 元数据 + 完整指令
├── references/                 # Layer 3: 渐进式知识库
│   ├── exercise_science.md     #   运动科学基础
│   ├── training_programs.md    #   训练计划设计方法论
│   ├── nutrition_basics.md     #   营养学基础
│   ├── progression_principles.md # 渐进超负荷理论
│   ├── injury_prevention.md    #   伤痛预防策略
│   ├── bodybuilding_basics.md  #   健美入门概念
│   ├── muscle_groups.md        #   肌群解剖与功能
│   ├── equipment_guide.md      #   器械分类与使用
│   └── warmup_cooldown.md      #   热身与冷却原理
├── scripts/                    # Layer 4: 可执行脚本
│   └── query_exercises.py      #   动作数据库查询引擎
└── free-exercise-db/           #   静态数据资产（873 个动作 + 图片）
    ├── exercises/
    └── images/
```

| 层级 | 位置 | 加载时机 | 加载方式 | Token 开销 (bodybuilding) |
|------|------|----------|----------|--------------------------|
| **Layer 1 元数据** | SKILL.md frontmatter (`name` + `description`) | 框架启动时解析，始终注入 system prompt | 框架自动 | ~100 |
| **Layer 2 指令** | SKILL.md 正文 | Skill 被激活时 | LLM 调用 `read` 工具 | ~3,200 |
| **Layer 3 知识** | `references/*.md` | LLM 判断需要领域知识时 | LLM 按需 `read` | ~7,000（合计，实际按单文件读取） |
| **Layer 4 脚本** | `scripts/*` | LLM 需要查询/计算时 | LLM 通过 `bash` 执行 | 脚本代码本身不进 context；stdout 作为工具结果进入上下文并受截断控制 |

**关键设计：Layer 1 始终可见，Layer 2-4 按需触发。** 这让一次简单问候只消耗 ~100 tokens 的 Skill 开销，而不是 ~10,200 tokens。

---

#### 三、内嵌关系 vs 引用关系的选择

**当前设计是内嵌关系**——`references/*.md` 物理存储在 Skill 目录内部。这不是偶然，而是有意为之：

| 维度 | 内嵌（当前设计） | 引用（如指向外部 URL 或共享路径） |
|------|------------------|----------------------------------|
| **可移植性** | 复制整个 Skill 目录即完成迁移，知识库自动跟随 | 需要同时迁移外部依赖，路径可能失效 |
| **版本一致性** | SKILL.md 和 references/ 天然同步（同一目录，同一 git 提交） | 引用的外部文档可能独立更新，产生版本漂移 |
| **离线可用** | 全部本地文件，无网络依赖 | 外部 URL 可能不可达 |
| **去重能力** | 相同知识可能在不同 Skill 中重复存储 | 可共享一份知识源，避免冗余 |
| **跨 Skill 共享** | 不支持——游泳教练 Skill 无法直接引用健美 Skill 的知识 | 可以建立跨 Skill 的知识图谱 |

**内嵌的代价是可能冗余**（如"营养基础"可能同时适用于健美和游泳），但在当前规模下（2 个 Skill、12 份 reference），这个代价远小于引入引用系统带来的复杂度。内嵌也符合 Agent Skills 规范的设计哲学——每个 Skill 是自包含的完整单元。

---

#### 四、框架如何发现与索引知识库

这是 `skills.ts` 中 `buildKnowledgeEntries()` 的完整工作流：

```
1. loadSkillFromFile() 解析 SKILL.md
   ↓
2. 检查 {skillDir}/references/ 目录是否存在
   ↓
3. 遍历 references/ 下所有 .md 文件（按文件名排序）
   ↓
4. 对每个 .md 文件：
   a. 读取全文
   b. 按双换行（\n\n）分割，取第一段
   c. 去掉开头的 Markdown 标题行（# 开头）
   d. 截断到 200 字符
   e. 以此作为该知识条目的 description
   ↓
5. 构建 KnowledgeEntryMeta[]，挂载到 Skill 对象
```

代码实现（`skills.ts:307-331`）：

```typescript
function buildKnowledgeEntries(skillDir: string): KnowledgeEntryMeta[] {
  const refsDir = join(skillDir, "references");
  if (!existsSync(refsDir)) return [];

  const entries = readdirSync(refsDir, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return mdFiles.map((e) => {
    const raw = readFileSync(join(refsDir, e.name), "utf-8");
    const firstPara = raw.split(/\n\n|\r\n\r\n/)[0]
      ?.replace(/^#.*\n?/, "").trim() ?? "";
    return {
      filename: e.name,
      description: firstPara.length > 200
        ? `${firstPara.slice(0, 197)}...`
        : firstPara,
    };
  });
}
```

**注意**：当前知识索引（`knowledgeEntries`）构建后被挂载到 `Skill` 对象上，但 `formatSkillsForPrompt()` 并未将知识索引注入 system prompt。它注入的是 Skill 级索引：`name`、`description`、`location`，以及声明了 `data:` 时的数据工具和 namespace 清单。这意味着 Layer 3 的 references 目录仍然不会直接暴露给 LLM。LLM 是通过读取 SKILL.md 正文中列出的 references 文件清单才知道有哪些领域知识文件可用的。这是一种"二级索引"模式：system prompt 是 Skill 的目录，SKILL.md 正文是 references 的目录。

---

#### 五、数据流全链路

以用户问"如何设计增肌训练计划"为例：

```
1. 框架启动
   skills.ts:loadSkills()
     → 扫描 .fitclaw/skills/bodybuilding/
     → 找到 SKILL.md
     → parseFrontmatter() → name="bodybuilding", description="..."
     → buildKnowledgeEntries() → 索引 9 份 references
     → formatSkillsForPrompt() → 注入 system prompt:
       <available_skills>
         <skill>
           <name>bodybuilding</name>
           <description>增肌健美训练完整指导...</description>
           <location>.fitclaw/skills/bodybuilding/SKILL.md</location>
           <data_tools>
             <read>data_bodybuilding_read</read>
             <write>data_bodybuilding_write</write>
             <namespaces>
               <namespace name="user_profile" type="object" />
               <namespace name="training_log" type="array" />
             </namespaces>
           </data_tools>
         </skill>
       </available_skills>

2. 用户提问："如何设计增肌训练计划？"

3. LLM 推理
   → 看到 <available_skills> 中 bodybuilding 的 description 匹配
   → 调用 read(".fitclaw/skills/bodybuilding/SKILL.md")
   → 读完整 SKILL.md → 发现 references/ 下有 training_programs.md
   → 调用 read(".fitclaw/skills/bodybuilding/references/training_programs.md")
   → 获得训练计划设计方法论
   → 调用 bash("python .../query_exercises.py --muscle chest")
   → 获得动作列表
   → 结合知识 + 动作数据 → 生成个性化训练计划
```

---

#### 六、历史演变

| 阶段 | 方案 | 问题 |
|------|------|------|
| Model A（已废弃） | 独立知识库目录 `.fitclaw/prompts/`，与 Skill 分离 | 知识库和 Skill 无关联，LLM 不知道何时用什么知识 |
| Model B（当前） | 知识库迁移到 `references/`，内嵌在 Skill 目录内 | Skill 自包含，知识随 Skill 一起加载和卸载 |

Model A 时代，`.fitclaw/prompts/` 是独立的知识存储，Skill 需要手动引用这些外部路径，耦合松散且易出错。Model B 将其废除，知识作为 Skill 的有机组成部分管理。

**核心文件：** `packages/coding-agent/src/core/skills.ts`（`buildKnowledgeEntries` + `loadSkillFromFile`，完整知识库发现与索引逻辑）

---

### Q9: 若用户查询涉及多个 Skill 的交叉信息，加载策略是串行加载、并行加载还是合并加载？

**A:**

**一句话结论：框架层面不预设多 Skill 交叉加载策略，完全由 LLM 自主决策——它看到所有 Skill 的元数据后自行推理需要加载哪些。框架在工具执行层面同时支持串行和并行两种模式，默认并行。**

---

#### 一、当前机制：三步决策链

```
Step 1 — 框架注入元数据（启动时）
  system-prompt.ts:formatSkillsForPrompt(skills)
    → 遍历所有已加载 Skill
    → 为每个 Skill 输出 <skill> XML 块
    → 注入 system prompt（始终可见，~100 tokens/Skill）

  LLM 看到的内容示例：
    <available_skills>
      <skill>
        <name>bodybuilding</name>
        <description>增肌健美训练完整指导：训练计划、动作教学、营养、渐进超负荷...</description>
        <location>.fitclaw/skills/bodybuilding/SKILL.md</location>
      </skill>
      <skill>
        <name>swimming-coach</name>
        <description>游泳训练指导：泳姿教学、训练计划、技术改进...</description>
        <location>.fitclaw/skills/swimming-coach/SKILL.md</location>
      </skill>
    </available_skills>

Step 2 — LLM 语义匹配（接收用户消息时）
  LLM 分析用户意图 + 比对所有 Skill description
    → 匹配 bodybuilding？匹配 swimming-coach？都匹配？
    → 决策：调用哪个 read（几个 Skill 文件，一个还是多个）

Step 3 — 框架执行工具调用（agent-loop.ts）
  LLM 返回 toolCall(s) → executeToolCalls() 分发
    → 默认: executeToolCallsParallel() [并行]
    → 降级: executeToolCallsSequential() [串行]
```

---

#### 二、并行 vs 串行的框架决策逻辑

核心代码在 `packages/agent/src/agent-loop.ts:345-352`：

```typescript
function executeToolCalls(
  currentContext, assistantMessage, config, signal, emit
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter(c => c.type === "toolCall");
  const hasSequentialToolCall = toolCalls.some(
    tc => currentContext.tools?.find(t => t.name === tc.name)?.executionMode === "sequential"
  );
  // 降级条件：全局配置要求串行 OR 任一工具标记了 sequential
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(...);
  }
  return executeToolCallsParallel(...);
}
```

| 执行模式 | 触发条件 | 行为 |
|----------|----------|------|
| **并行（默认）** | `config.toolExecution !== "sequential"` 且无 sequential 工具 | 所有 toolCall 通过 `Promise.all` 并发执行 |
| **串行** | `config.toolExecution === "sequential"` 或工具声明了 `executionMode: "sequential"` | 按 LLM 返回顺序逐个执行（前一个完成才开始下一个） |

**对多 Skill 加载的影响**：如果 LLM 在一个 assistant message 中同时返回两个 `read` 工具调用（分别读取 bodybuilding 和 swimming-coach 的 SKILL.md），框架会并行读取两个文件——两个 `readFileSync` 同时发起，总耗时 ≈ max(单个文件读取时间) 而不是 sum。

---

#### 三、为什么没有"合并加载"策略

这是刻意的设计选择，有三层原因：

**1. 哲学层：LLM 是决策者，框架是执行者**

整个 Model B 架构的核心分工是"框架做机械的事，LLM 做智能的事"（参见 Q5 中的框架/LLM 分工图）。合并加载需要框架理解 Skill 内容之间的语义关系——这越过了分工线。判断"bodybuilding 的营养知识和 swimming-coach 的体能训练知识是否相关"是智能决策，归 LLM。

**2. 工程层：合并加载的收益不确定**

合并加载的假设是"减少来回轮次 = 更快"，但这个假设在多 Skill 场景下不一定成立：

| 策略 | 每次 Token 开销 | 适用场景 |
|------|----------------|---------|
| 合并加载 | 固定高（所有 Skill 全文） | 大多数对话确实需要多 Skill |
| 按需加载 | 弹性低（只读用到的） | 大多数对话只需单一 Skill |

实际效果：按需加载在 80%+ 的对话中只读一个 Skill，token 效率显著更好。

**3. 安全层：避免 context 污染**

两个 Skill 的指令可能产生冲突。例如 bodybuilding SKILL.md 可能说"使用 kg 作为单位"，swimming-coach SKILL.md 可能说"使用 meters/second 描述速度"。如果框架盲目合并，LLM 可能在同一个回复中看到矛盾的指令。让 LLM 自己按需读取，它可以在上下文中维护"当前活跃 Skill"的边界。

---

#### 四、多 Skill 场景的实际行为矩阵

| 用户查询类型 | LLM 典型行为 | 框架执行 | 轮次 |
|------------|-------------|---------|------|
| 单一领域（"帮我设计胸肌训练"） | 读 bodybuilding SKILL.md | 单文件 read | 1 |
| 单一领域但跨 reference（"增肌期怎么吃"） | 读 bodybuilding SKILL.md → 读 nutrition_basics.md | 两次串行 read（LLM 需要先看 SKILL.md 才知道有 nutrition_basics.md） | 2 |
| 多 Skill 交叉（"游泳和举铁怎么搭配训练"） | 读 bodybuilding SKILL.md + 读 swimming-coach SKILL.md | **并行 read**（LLM 一次返回两个 toolCall） | 1 |
| 模糊边界（"运动后肌肉酸痛怎么办"） | LLM 选择一个最匹配的 Skill（通常是 bodybuilding） | 单文件 read | 1 |

---

#### 五、当前设计的局限性

| 局限 | 影响 | 是否紧急 |
|------|------|---------|
| **无跨 Skill 知识图谱** | LLM 不知道 bodybuilding 的 nutrition_basics.md 和 swimming-coach 的 nutrition 知识有何重叠/冲突 | 低——当前 2 个 Skill，LLM 能自行比较 |
| **无去重机制** | 如果两个 Skill 都有 nutrition 知识，LLM 可能读了两份本质上相同的内容 | 低——规模小，冗余可控 |
| **无 Skill 优先级** | system prompt 中 Skill 按加载顺序排列，LLM 对排序敏感 | 中——可能影响匹配质量 |
| **依赖 LLM 判断** | LLM 可能漏匹配（该用但没用）或过度匹配（不该用却读了） | 中——依赖 SKILL.md description 的撰写质量 |
| **无冲突检测** | 两个 Skill 的指令矛盾时，LLM 可能困惑 | 低——当前 Skill 领域差异大（健美 vs 游泳），不易冲突 |

---

#### 六、未来演进方向（未实现）

如果 Skill 数量增长到 10+ 个，当前"全量元数据注入 + LLM 自主决策"模式可能需要增强：

1. **Skill 分组标签**：前端根据用户消息中的关键词预先过滤候选 Skill，减少元数据注入量
2. **跨 Skill 语义索引**：为 references/ 建立轻量级向量索引，支持"哪些 Skill 涉及营养知识"这类查询
3. **Skill 依赖声明**：在 SKILL.md frontmatter 中声明 `requires: [other-skill]`，确保交叉场景下依赖关系明确
4. **冲突标记**：声明互斥的 Skill（如"用 kg 的 skill" vs "用 lb 的 skill"），让 LLM 只激活一个

这些在当前 2 个 Skill 的规模下不需要，但架构上保留了扩展空间（Skill 对象已携带 `knowledgeEntries` 和 `dataNamespaces`，可作为索引的数据源）。

---

## 三、工具封装与执行编排

### Q10: 为何选择 bash 调用独立 CLI 而非直接内联调用？CLI 与主服务的进程间通信与异常传递如何处理？

**A:**

**一句话结论：当前有两条工具链，不能混在一起理解。**
动作库查询走 `bash → Python 脚本 → stdout`；用户训练数据持久化主要走 `data_bodybuilding_read/write → FileSportDataStore`。`fitclaw-data` 是额外提供的 CLI 桥，方便脚本或外部系统读写同一批 JSON 文件。

**为什么动作查询选择 bash 调独立脚本：**

1. **降低 Skill 作者门槛**：bodybuilding Skill 的动作查询是 `.fitclaw/skills/bodybuilding/scripts/query_exercises.py`，作者只写 Markdown + Python，不需要改 TypeScript Agent 核心。
2. **语言无关**：`scripts/` 下可以放 Python、bash、Node 等脚本，LLM 统一通过 `bash` 工具执行。
3. **进程隔离**：脚本作为子进程运行，解析 JSON 或查询失败只会变成工具错误，不会把主 Agent 进程带崩。
4. **输出可控**：脚本只把筛选结果写到 stdout，`bash` 工具再把 stdout/stderr/exit code 包装成 `ToolResultMessage`。

**进程间通信怎么发生：**

| 场景 | 通信方式 | 说明 |
|------|----------|------|
| 动作查询 | stdout / stderr / exit code | `query_exercises.py` 从本地 JSON 读数据，把表格或 JSON 输出到 stdout |
| 用户数据读写 | Agent Tool 调用 | `data_bodybuilding_read/write` 直接调用 `FileSportDataStore`，不需要 bash |
| 脚本/外部系统读写用户数据 | stdin / stdout + 环境变量 | `fitclaw-data` 从 stdin 读 JSON、向 stdout 输出 JSON，默认从 `FITCLAW_DATA_DIR` 找数据目录 |
| 数据共享 | 文件系统 | 数据落在 `{dataDir}/sport-data/{skillName}/{namespace}.json` |

**异常传递：**

- bash 工具捕获子进程的 `exit code`、`stdout` 和 `stderr`
- 非零 exit code → 返回 `isError: true` 的工具结果，错误文本给 LLM 处理
- 超时 → 终止子进程，返回超时错误
- `DANGEROUS_PATTERNS` 会在执行前拦截危险命令（如 `rm -rf /`、`dd`、`mkfs`、fork bomb、`curl | sh`）

**`fitclaw-data` CLI 示例：**
```bash
fitclaw-data read  --namespace bodybuilding/user_profile
echo '{"name":"John"}' | fitclaw-data write --namespace bodybuilding/user_profile
echo '{"exercise":"squat"}' | fitclaw-data write --namespace bodybuilding/training_log --mode append
```

**核心文件：** `packages/coding-agent/src/cli/fitclaw-data.ts`、`packages/coding-agent/src/core/tools/bash.ts`

---

### Q11: 800+ 动作数据库的存储方案是什么？按肌群/器械检索是基于关系型数据库查询、倒排索引还是向量检索？

**A:**

**一句话结论：存储采用纯 JSON 文件（每动作一个 JSON + 一份 1MB 合并文件），检索是 Python 内存列表推导式全量扫描——不需要关系型数据库、倒排索引或向量检索。873 个动作在内存中过滤耗时毫秒级，而 JSON 文件的部署成本为零。**

---

#### 一、数据来源

动作数据库来自开源项目 **free-exercise-db**，内嵌在 bodybuilding Skill 目录中，是 Skill 的静态数据资产——不是框架功能，不需要安装或配置。

```
.fitclaw/skills/bodybuilding/free-exercise-db/
├── dist/
│   └── exercises.json          # 合并文件 (~1MB, 873 个动作)
├── exercises/
│   ├── Barbell_Bench_Press_-_Medium_Grip/   # 动作目录（仅含图片）
│   │   ├── 0.jpg
│   │   └── 1.jpg
│   ├── Barbell_Bench_Press_-_Medium_Grip.json  # 动作数据（平级存放）
│   ├── Dumbbell_Curl/
│   │   ├── 0.jpg
│   │   └── 1.jpg
│   ├── Dumbbell_Curl.json
│   ├── ... (873 × 2 = 1,746 个条目：目录+JSON)
│   └── ...
└── images/                      # 旧版图片目录（可能为空）
```

**实际存储采用双轨制**：每个动作有一个 JSON 文件（元数据）和一个同名目录（示范图片），二者平级存放于 `exercises/` 下。同时维护一份 `dist/exercises.json` 合并文件作为脚本的主读取路径。

---

#### 二、动作数据 Schema

每个动作 JSON 包含 10 个字段：

```json
{
  "id": "Barbell_Bench_Press_-_Medium_Grip",
  "name": "Barbell Bench Press - Medium Grip",
  "force": "push",
  "level": "beginner",
  "mechanic": "compound",
  "equipment": "barbell",
  "primaryMuscles": ["chest"],
  "secondaryMuscles": ["shoulders", "triceps"],
  "instructions": [
    "Lie back on a flat bench. Using a medium width grip...",
    "From the starting position, breathe in and begin coming down...",
    "..."
  ],
  "category": "strength",
  "images": [
    "Barbell_Bench_Press_-_Medium_Grip/0.jpg",
    "Barbell_Bench_Press_-_Medium_Grip/1.jpg"
  ]
}
```

| 字段 | 类型 | 说明 | 示例值 |
|------|------|------|--------|
| `id` | string | 唯一标识（文件名去扩展名） | `Barbell_Bench_Press_-_Medium_Grip` |
| `name` | string | 英文名称 | `Barbell Bench Press - Medium Grip` |
| `force` | enum | 发力方向 | `push` / `pull` / `static` |
| `level` | enum | 难度等级 | `beginner` / `intermediate` / `expert` |
| `mechanic` | enum | 动作类型 | `compound`（复合）/ `isolation`（孤立） |
| `equipment` | string | 所需器械 | `barbell` / `dumbbell` / `body only` / `machine` / ... |
| `primaryMuscles` | string[] | 主要目标肌群 | `["chest"]` |
| `secondaryMuscles` | string[] | 辅助肌群 | `["shoulders", "triceps"]` |
| `instructions` | string[] | 分步动作说明 | 3-8 条英文步骤 |
| `category` | enum | 训练类别 | `strength` / `cardio` / `stretching` / ... |
| `images` | string[] | 示范图片相对路径 | `["Barbell_Bench_Press_-_Medium_Grip/0.jpg"]` |

---

#### 三、为什么选择 JSON 文件而不是数据库

这是刻意的工程决策，核心逻辑是"**数据规模不构成瓶颈，而引入数据库会显著增加部署复杂度**"：

| 维度 | JSON 文件（当前） | SQLite / 关系型数据库 | 倒排索引 (Elasticsearch) | 向量检索 (Pinecone/pgvector) |
|------|------------------|----------------------|------------------------|---------------------------|
| **部署成本** | 零——文件随 Skill 目录复制 | 需要安装/配置数据库引擎 | 需要独立服务进程 | 需要 Embedding 模型 + 向量服务 |
| **Docker 体积** | 无额外依赖 | +SQLite 驱动 | +ES 镜像 ~500MB | +模型文件 ~GB |
| **查询延迟** | <5ms（内存列表推导） | <1ms（B-tree 索引） | <10ms（网络往返） | <50ms（Embedding + ANN） |
| **查询类型** | 精确/子串匹配 | SQL 任意查询 | 全文搜索 | 语义相似度 |
| **数据更新** | 替换 JSON 文件 | INSERT/UPDATE | 索引文档 | 重新 Embedding |
| **离线可用** | 完全离线 | 完全离线 | 需要 ES 服务在线 | 需要 Embedding API 在线 |
| **技能可移植** | 最高——复制目录即可 | 需要导出/导入 | 需要重建索引 | 需要重建向量库 |

**核心判断**：873 个动作的元数据总量约 1MB，全部加载到 Python 内存中仅占用 ~2-3MB，列表推导式过滤耗时 <5ms。在这个规模下，任何数据库系统引入的运维成本都超过了它带来的性能收益。

---

#### 四、检索机制的完整实现

检索由 `scripts/query_exercises.py`（381 行 Python CLI）完成。LLM 不直接操作 JSON 文件，而是通过 bash 执行该脚本。

**加载路径（双轨 fallback）：**

```python
def load_all_exercises() -> List[Dict[str, Any]]:
    # 优先使用合并文件（单次 read，最快）
    dist_path = get_dist_path()  # .../dist/exercises.json
    if dist_path.exists():
        with open(dist_path, 'r', encoding='utf-8') as f:
            return json.load(f)  # 一次性加载全部 873 个动作

    # 回退到逐个读取（如果合并文件不存在）
    for exercise_dir in exercises_path.iterdir():
        if exercise_dir.is_dir():
            exercise_json = exercise_dir / "exercise.json"
            # ... 读取单个 JSON，附加 images/ 路径
```

**注意**：当前仓库实际数据是 `exercises/<id>.json` 与 `exercises/<id>/0.jpg` 平级双轨结构；脚本的 fallback 读取的是旧式 `exercises/<id>/exercise.json` 目录结构。因此当前查询实际依赖 `dist/exercises.json` 这份合并文件。只要合并文件存在，查询正常；如果未来删除 `dist/`，需要同步修正 fallback 逻辑或重新生成旧式目录结构。

**过滤逻辑（全量扫描 + 列表推导式链式过滤）：**

```python
def filter_exercises(exercises, muscle=None, equipment=None, level=None,
                     force=None, mechanic=None, category=None, name=None, id=None):
    filtered = exercises  # 从全部 873 个开始

    if id:        # 精确 ID 匹配 → 直接返回单个
        return [e for e in filtered if e["id"].lower() == id.lower()]

    if name:      # 名称子串模糊匹配
        filtered = [e for e in filtered if name.lower() in e["name"].lower()]

    if muscle:    # 肌群匹配（检查 primary + secondary 两个数组）
        filtered = [e for e in filtered
                    if muscle in [m.lower() for m in e.get("primaryMuscles", [])]
                    or muscle in [m.lower() for m in e.get("secondaryMuscles", [])]]

    if equipment: # 器械精确匹配
        filtered = [e for e in filtered if e["equipment"].lower() == equipment.lower()]

    if level:     # 难度精确匹配
        filtered = [e for e in filtered if e["level"].lower() == level.lower()]

    # force, mechanic, category 同理...
    return filtered
```

**组合查询的工作原理**：每个过滤条件是独立的列表推导式，链式应用。例如查询"胸部 + 杠铃 + 初学者 + 推类 + 复合动作"会经过 5 层过滤，每层缩小候选集。

**输出格式（4 种，由 `--format` 参数控制）：**

| 格式 | CLI 参数 | 示例输出 | 适用场景 |
|------|---------|---------|---------|
| **table**（默认） | `--format table` | Markdown 表格（# 名称 难度 器械 主要肌群） | LLM 生成用户回复 |
| **json** | `--format json` | JSON 数组 | 程序化消费 |
| **ids** | `--format ids` | 每行一个 ID | 管道给后续命令 |
| **detail** | `--detailed` | 完整动作说明 + 图片路径 | 单个动作教学 |

**辅助功能：**
- `--list-muscles`：遍历全部动作，提取去重后的肌群列表（帮助 LLM 了解可用肌群名称）
- `--list-equipment`：同上，提取可用器械列表
- `--check-db`：验证数据库完整性（检查 dist/exercises.json 或 exercises/ 目录是否存在）

---

#### 五、LLM → 数据的完整调用链路

以用户问"推荐几个哑铃练胸的动作"为例：

```
1. 用户消息到达 → LLM 匹配 bodybuilding Skill

2. LLM 读 SKILL.md → 发现 scripts/query_exercises.py 的使用说明：
   "python {skillDir}/scripts/query_exercises.py --muscle chest --equipment dumbbell"

3. LLM 调用 bash:
   bash("python .fitclaw/skills/bodybuilding/scripts/query_exercises.py
         --muscle chest --equipment dumbbell --format table")

4. Python 脚本执行:
   a. load_all_exercises() → json.load(dist/exercises.json) → 873 条记录
   b. filter: muscle=chest → 过滤 main/secondary muscles 含 "chest"
   c. filter: equipment=dumbbell → equipment == "dumbbell"
   d. output_table() → Markdown 表格

5. stdout 返回为工具结果（会进入 LLM context，受工具输出截断控制）:
   | # | 名称 | 难度 | 器械 | 主要肌群 |
   |---|------|------|------|----------|
   | 1 | Incline Dumbbell Press | beginner | dumbbell | chest |
   | 2 | Dumbbell Flyes | beginner | dumbbell | chest |
   | 3 | Decline Dumbbell Press | intermediate | dumbbell | chest |
   ...

6. LLM 读取 stdout → 结合训练知识 → 生成个性化推荐回复
```

**关键设计**：Python 脚本的内部扫描、过滤和计算过程不消耗 LLM token；只有 stdout 中返回给 Agent 的筛选结果会作为 `toolResult` 进入上下文。因此脚本应输出短表格或单个动作详情，而不是把整个动作库原样吐给 LLM。

---

#### 六、为什么不需要倒排索引或向量检索

这三种方案解决的是不同问题：

| 方案 | 解决的问题 | 本场景是否需要 |
|------|-----------|---------------|
| **关系型数据库** | 大量数据的高效 CRUD、事务、并发 | 不需要——数据只读、单用户、873 条 |
| **倒排索引** | 海量文档的全文搜索（TF-IDF/BM25） | 不需要——查询是精确字段匹配（"equipment=dumbbell"），不是自由文本搜索 |
| **向量检索** | 自然语言语义搜索（"练胸的动作" → 匹配 "Bench Press"） | 不需要——字段匹配已经足够精确，且 LLM 承担了"用户意图 → 查询条件"的语义转换 |

**LLM 就是最好的"语义搜索引擎"**：用户说"我想要练胸的动作"，LLM 理解后翻译为 `--muscle chest` 的精确查询条件。这比向量检索更可靠——不会有语义漂移，也不会有"搜'练胸'返回了'俯卧撑变体'"的不确定性。

**什么时候需要升级？** 当动作数量增长到 10 万+，全量内存扫描开始触及性能瓶颈（~50ms+），或者需要支持中文模糊搜索（用户直接输入"卧推"搜索动作名称）时，可以考虑：
- 加一层 SQLite FTS（全文搜索）索引用于名称模糊匹配
- 用轻量级嵌入（如 all-MiniLM-L6-v2）对动作名称做向量索引

当前 873 个动作的规模，这些都不是问题。

---

#### 七、当前设计的局限性

| 局限 | 影响 | 缓解措施 |
|------|------|---------|
| **名称仅英文** | 中文用户说"卧推"，LLM 需要自行翻译为 "bench press" 再查询 | LLM 的翻译能力很强，实际影响小 |
| **全量内存加载** | 每次查询都从磁盘读取 1MB JSON 并解析全部 873 条 | 毫秒级完成，用户无感知 |
| **无缓存机制** | 重复查询（如连续问两次胸部动作）每次重新加载 | Python 脚本是短生命周期的（bash 调用后退出），无法缓存。但 LLM 自身会缓存对话上下文中的查询结果 |
| **图片路径非绝对** | exercise JSON 中的 images 路径是相对的，Bot 场景下需要拼接完整路径才能发送 | Bot 的飞书图片上传功能尚未实现（见 CLAUDE.md 待完成项 #2） |
| **dist/exercises.json 需手动维护** | 如果新增动作到 exercises/ 目录，dist 合并文件不会自动更新 | 当前数据是静态导入的，不需要增量更新 |

---

#### 八、与数据持久化系统的关系

注意区分两个不同的"数据"：

| | 动作数据库（本题讨论） | 用户持久化数据 |
|------|---------------------|---------------|
| **存储位置** | `free-exercise-db/` | `{dataDir}/sport-data/bodybuilding/{namespace}.json` |
| **格式** | 873 × 单动作 JSON + 1 × 合并 JSON | 6 个 namespace JSON（user_profile, training_log 等） |
| **操作** | 只读查询 | CRUD（通过 `data_bodybuilding_read/write` 工具） |
| **访问方式** | LLM → bash → Python 脚本 | LLM → `data_bodybuilding_read/write` Agent Tool → FileSportDataStore |
| **管理者** | Skill 作者（静态数据） | 框架（动态数据，自动初始化 namespace 文件） |

动作数据库是只读的、随 Skill 分发的静态资产；用户训练日志是可读写的、存储在数据目录的动态记录。二者在物理和逻辑上完全独立。

**核心文件：** `.fitclaw/skills/bodybuilding/scripts/query_exercises.py`（381 行，查询引擎）、`.fitclaw/skills/bodybuilding/scripts/setup_db.py`（167 行，数据库验证工具）、`.fitclaw/skills/bodybuilding/free-exercise-db/dist/exercises.json`（1MB，合并数据文件）

---
### Q12: 参数 Schema 校验采用 JSON Schema 还是自定义 DSL？校验失败时的降级策略是什么？

**A:**

**采用 JSON Schema（通过 TypeBox 生成）。**

**校验流程（`packages/ai/src/utils/validation.ts`）：**

1. `validateToolArguments(tool, toolCall)` 接收工具定义和工具调用
2. 克隆参数，应用 `Value.Convert`（TypeBox 类型转换）
3. 对非 TypeBox schema，应用 JSON Schema 强制转换：
   - `allOf` / `anyOf` / `oneOf` 递归处理
   - 基本类型强制转换（string→number 等）
   - object/array 强制转换
4. 使用编译后的 validator 校验（`WeakMap` 缓存编译结果）
5. 返回格式化的校验错误（包含 JSON Path）

**校验失败的降级策略：**

- **不降级**：校验失败直接返回 `isError: true` 的 `ToolResultMessage`，包含格式化错误信息
- 错误信息返回给 LLM，由 LLM 决定修正参数重试或换工具
- 没有"使用默认值"或"忽略可选字段"的降级逻辑

**示例：**
```
Tool: data_bodybuilding_write
Arguments: { "namespace": 123 }  // 应为 string
校验结果: isError: true, content 中包含 "Validation failed for tool ..."
→ LLM 看到错误，修正为 { "namespace": "user_profile", "data": {...} }
```

**核心文件：** `packages/ai/src/utils/validation.ts`

---

### Q13: Follow-up 任务队列是内存队列还是持久化队列？如何保证应用重启后任务不丢失？

**A:**

**Follow-up 任务队列是纯内存队列，不持久化。**

**实现（`agent.ts`）：**
```typescript
class PendingMessageQueue {
  private items: PendingMessage[] = [];
  enqueue(message: PendingMessage): void { this.items.push(message); }
  hasItems(): boolean { return this.items.length > 0; }
  drain(mode: "all" | "one-at-a-time"): PendingMessage[] { ... }
  clear(): void { this.items = []; }
}
```

**两个队列：**
- **Steering 队列**：实时注入，在下一次 LLM 调用前插入
- **FollowUp 队列**：后置任务，Agent 完成当前任务后自动继续

**应用重启后任务丢失：**
- Agent 重启 → 队列清空
- Bot 容器重启 → 当前正在处理的消息丢失（但 `log.jsonl` 已记录用户消息，重启后可从 JSONL 恢复上下文）
- CLI 退出 → 队列丢失（但会话 JSONL 保留历史）

**不持久化的原因：**
- Steering/FollowUp 是瞬时指令，不是持久任务
- 持久化会增加复杂度（需要序列化/反序列化、去重、过期清理）
- 会话 JSONL 已经记录了所有消息历史，重启后可从历史恢复上下文

**核心文件：** `packages/agent/src/agent.ts`（PendingMessageQueue）

---

### Q14: 动态控制消息插入的实现机制是什么？人工干预的具体入口与权限控制如何设计？

**A:**

**动态控制消息插入的实现机制：**

1. **Steering（实时注入）**：
   - `agent.steer(message)` 将消息加入 Steering 队列
   - `runLoop()` 内层循环每次 LLM 返回后检查 `getSteeringMessages()`
   - 有消息 → 作为 `pendingMessages` 注入上下文 → 下一轮 LLM 调用前生效
   - `steeringMode` 控制排空策略：`"all"`（一次全部注入）或 `"one-at-a-time"`（每次一个）

2. **FollowUp（后置任务）**：
   - `agent.followUp(message)` 将消息加入 FollowUp 队列
   - `runLoop()` 外层循环在 Agent 停止后检查 `getFollowUpMessages()`
   - 有消息 → 继续推理循环

**人工干预入口：**

| 场景 | 入口 | 机制 |
|------|------|------|
| CLI 交互 | 用户直接输入 | 输入自动作为 steering 消息注入 |
| Bot 群聊 | 新消息到达 | `main.ts` 中新消息触发 `runner.abort()` 中止当前推理，或等待完成后处理 |
| Bot 私聊 | 新消息到达 | 同上 |
| 编程接口 | `agent.steer(msg)` / `agent.followUp(msg)` | 直接调用 API |

**权限控制：**
- **当前没有细粒度权限控制**。CLI 是本地工具，信任当前用户。Bot 是群聊机器人，任何能发消息的用户都能触发干预。
- Bot 通过 `channelId/userId` 隔离不同用户的会话状态，但同一频道内没有"管理员/普通用户"区分
- `beforeToolCall` 钩子可拦截工具调用（返回 `{ block: true }`），但当前未用于权限控制

**核心文件：** `packages/agent/src/agent.ts`（steer/followUp 方法）、`packages/mom/src/main.ts`（消息路由）

---

### Q15: 断点续跑的状态快照包含哪些字段？恢复时如何确保执行上下文与外部系统状态的一致性？

**A:**

**当前没有真正的“从某个正在执行的工具中间继续跑”的断点续跑。**
更准确地说，FitClaw 有的是 **JSONL 会话恢复**：它像聊天记录账本，能把历史消息、模型切换、压缩摘要、分支关系恢复出来；但如果进程正好死在某个工具执行中间，那个工具不会自动重放。

**JSONL 快照包含两层：**

第一行是 `SessionHeader`：

```json
{
  "type": "session",
  "version": 3,
  "id": "018f...",
  "timestamp": "2026-05-06T10:00:00.000Z",
  "cwd": "D:/Code/Project/FitClaw"
}
```

后续每行是一个 `SessionEntry`，通用字段是：

| 字段 | 说明 |
|------|------|
| `id` | 8 字符短 ID，冲突时退化为完整 UUID |
| `parentId` | 父节点 ID，用来形成会话树和分支 |
| `timestamp` | ISO 字符串时间戳 |
| `type` | `message` / `compaction` / `model_change` / `thinking_level_change` / `label` / `branch_summary` / `custom` / `custom_message` / `session_info` |

`message` 类型不会把 `role`、`content`、`usage` 平铺在顶层，而是包在 `message` 字段里：

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "e5f6a7b8",
  "timestamp": "2026-05-06T10:00:00.000Z",
  "message": {
    "role": "assistant",
    "content": [],
    "provider": "anthropic",
    "api": "anthropic-messages",
    "model": "claude-opus-4-6",
    "usage": {}
  }
}
```

**恢复流程：**

1. **CLI**：`SessionManager.continueRecent()` 查找最近的 session 文件，读取 JSONL 后由 `buildSessionContext()` 从当前 leaf 沿 `parentId` 回溯到 root，重建当前分支上的 `AgentMessage[]`、模型和 thinking level。
2. **Bot**：`syncLogToSessionManager()` 从 `log.jsonl` 同步用户消息到 SessionManager，`context.jsonl` 用于保存频道上下文。

**外部系统一致性：**

- **运动数据**：独立存储在 `sport-data/bodybuilding/*.json`，不靠会话回放恢复。
- **LLM 状态**：LLM 本身无状态，恢复靠系统提示词 + JSONL 消息历史重建上下文。
- **飞书 API**：消息发送/更新是外部副作用，不参与事务。JSONL 可以记录上下文，但不能保证飞书侧消息一定已经成功更新。

**局限性：**

- 恢复时不会重放中断的工具调用。如果 Agent 在执行工具时崩溃，缺失的工具结果需要用户或 LLM 重新触发。
- 没有跨文件事务。如果 `data_bodybuilding_write` 写入成功但 JSONL 追加失败，运动数据和会话日志可能短暂不一致。

**核心文件：** `packages/coding-agent/src/core/session-manager.ts`

---

## 四、长期记忆压缩管理

### Q16: Token 阈值是基于预估 Token 数还是 LLM API 返回的实际 usage 计算？不同模型的上下文长度差异如何适配？

**A:**

**Token 阈值基于实际 usage，辅以预估。**

**`estimateContextTokens()` 实现（`compaction.ts:167-214`）：**

1. **优先使用实际 usage**：从最后一条非 aborted 的 `AssistantMessage.usage` 获取 `totalTokens`（LLM API 返回的实际 token 数）
2. **降级使用预估**：如果没有 assistant usage（如刚开始会话），使用 `estimateTokens()` 基于 `chars/4` 启发式估算
3. **`shouldCompact()` 判断**：`contextTokens > contextWindow - reserveTokens(16,384)`

**不同模型的上下文长度适配：**

- `contextWindow` 来自 `Model` 类型定义（`packages/ai/src/types.ts`），每个模型有独立的 `contextWindow` 值
- 例如：Claude Opus 4.6 = 200K、GPT-4o = 128K、DeepSeek V3 = 128K
- `reserveTokens` 默认 16,384，可通过 `settings.json` 的 `compaction.reserveTokens` 配置
- `keepRecentTokens` 默认 20,000，可配置

**触发阈值计算：**

| 模型 | contextWindow | reserveTokens | 触发阈值 | 触发百分比 |
|------|--------------|---------------|---------|-----------|
| Claude Opus 4.6 | 200,000 | 16,384 | 183,616 | 91.8% |
| GPT-4o | 128,000 | 16,384 | 111,616 | 87.2% |
| DeepSeek V3 | 128,000 | 16,384 | 111,616 | 87.2% |

**核心文件：** `packages/coding-agent/src/core/compaction/compaction.ts:135-222`

---

### Q17: 触发压缩的 80% 阈值是如何确定的？有没有做过不同阈值对摘要质量与成本的对比实验？

**A:**

**澄清：阈值不是固定 80%，而是 `contextWindow - reserveTokens`。**

实际触发百分比因模型而异（见 Q16），大约在 87-92% 之间。

**阈值确定逻辑：**
- `reserveTokens = 16,384`：为模型输出预留空间，确保压缩摘要生成时不会再次溢出
- 这是一个经验值，确保 LLM 有足够的 token 空间来生成压缩摘要（通常 1-2K tokens）+ 后续对话

**没有做过对比实验：** 项目中没有找到不同阈值对摘要质量与成本的 A/B 测试数据。`reserveTokens = 16,384` 和 `keepRecentTokens = 20,000` 是默认值，可通过 `settings.json` 调整。

**可调整的配置：**
```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

**潜在优化方向：**
- 根据模型特性动态调整 reserveTokens（如输出 token 便宜的模型可以减小）
- 根据对话复杂度调整 keepRecentTokens（工具密集对话需要保留更多近期上下文）
- 分级压缩（先压缩到 70%，再压缩到 50%）

---

### Q18: LLM 摘要的 Prompt 如何设计以确保体测数据、历史 PR、渐进超负荷进度等关键信息不被遗漏？

**A:**

**一句话结论：当前真正生效的是“通用 Markdown 摘要 + 最近上下文保留 + 运动数据独立落盘”，不是强 Schema 的健身专用摘要。**
可以把 compaction 想成搬家：聊天历史会被装进一个“摘要箱”，但体重、训练日志、PR 这些关键数据不应该只放在箱子里，而应该同时写进专门的账本，也就是 `sport-data/bodybuilding/*.json`。

**第一层：通用摘要模板（已生效）**

```
Generate a structured context checkpoint summary with these sections:
- Goal: current objective
- Constraints & Preferences: user preferences and constraints
- Progress: Done / In Progress / Blocked
- Key Decisions: important decisions made
- Next Steps: planned next actions
- Critical Context: must-not-forget information
```

`packages/coding-agent/src/core/compaction/compaction.ts` 中的 `SUMMARIZATION_PROMPT` 要求 LLM 输出固定 Markdown 结构，保留目标、约束、进度、关键决策、下一步和关键上下文。这个模板是当前压缩流程的主路径。

**第二层：健身数据专用指令（存在，但当前未接入主流程）**

```
## Fitness Data
If the conversation includes fitness coaching (workouts logged, body metrics
recorded, training plans discussed, personal records set), extract the following
into the "fitnessProfile" field of the summary JSON:
- experienceLevel: user's training experience level
- trainingGoal: what they're training for
- availableEquipment: list of equipment they have access to
- injuriesOrLimitations: any mentioned injuries or physical limits
- daysPerWeek: how many days they train per week
- currentSplit: their training split type (ppl, full_body, etc.)
- personalRecords: array of notable PRs achieved
- recentWorkouts: last 5 workouts (date, exerciseCount, duration)
- latestBodyMetrics: most recent body weight and measurements
```

`packages/coding-agent/src/core/fitness/compaction.ts` 定义了 `FITNESS_COMPACTION_INSTRUCTION` 和 `extractFitnessProfile()`，但当前项目里没有找到它们被 `generateSummary()` 或 `compact()` 调用的链路。因此不能说健身专用字段已经稳定进入压缩摘要；更准确地说，这是一个已写好的辅助模块/未来接入点。

**第三层：数据独立存储（最重要的保障）**

关键体测数据应通过 `data_bodybuilding_write` 写入独立的 `sport-data/bodybuilding/*.json` 文件，**完全不受压缩影响**：
- `user_profile.json` — 用户画像
- `training_log.json` — 训练记录（数组，append 模式）
- `body_metrics.json` — 身体指标（数组，append 模式）
- `personal_records.json` — 个人记录（数组，append 模式）
- `progression.json` — 渐进超负荷事件（数组，append 模式）

**即使 LLM 摘要遗漏了某些信息，独立存储的 JSON 文件始终保留完整数据。**

**命名注意：** 当前 TypeScript 代码实际注册的工具名是 `data_bodybuilding_read` / `data_bodybuilding_write`（下划线形式）。系统提示词现在会把这些真实工具名连同 namespace 清单注入到对应 Skill 的 `<data_tools>` 中。回答和排错时应以 `skill-data-tools.ts` 中注册的下划线工具名为准。

**增量更新机制：** 如果已有旧摘要，使用 `UPDATE_SUMMARIZATION_PROMPT` 把新消息合并进旧摘要，而不是完全重新生成，减少信息丢失风险。

**当前风险：** 数据是否写入 `sport-data` 仍依赖 LLM 正确调用 `data_bodybuilding_write`。框架会限制 namespace 和路径边界，并在写入失败、权限错误或 JSON 损坏时返回工具错误，但不会强制每条体测信息都必须写入。更严谨的改进方向是：在健身 Skill 或工具层增加结构化 Schema 校验和必写字段检查。

**核心文件：** `packages/coding-agent/src/core/compaction/compaction.ts:454-524`、`packages/coding-agent/src/core/fitness/compaction.ts`

---

### Q19: 结构化 JSON 的 Schema 定义是什么？是否支持版本演进与向后兼容？

**A:**

**压缩摘要的结构：**

压缩输出是 Markdown 格式（不是 JSON），包含固定 6 个 section：
1. Goal
2. Constraints & Preferences
3. Progress（Done / In Progress / Blocked）
4. Key Decisions
5. Next Steps
6. Critical Context

末尾追加 XML 标签：
- `<read-files>` — 已读取的文件列表
- `<modified-files>` — 已修改的文件列表

**运动数据的 Schema：**

运动数据存储在独立 JSON 文件中，由 LLM 自行决定写入结构，没有强制 Schema。但 SKILL.md 中有示例结构指导 LLM：

```json
// user_profile.json (object, replace)
{
  "experienceLevel": "beginner",
  "trainingGoal": "muscle_gain",
  "availableEquipment": ["barbell", "dumbbell"],
  "injuriesOrLimitations": [],
  "daysPerWeek": 4
}

// training_log.json (array, append)
[{
  "date": "2026-05-03",
  "exercises": [
    {"name": "Squat", "sets": [{"weight": 60, "reps": 10}, ...]}
  ],
  "duration": 65
}]
```

**版本演进与向后兼容：**

- **Session JSONL**：有版本迁移机制（`CURRENT_SESSION_VERSION = 3`），`migrateV1ToV2()` 和 `migrateV2ToV3()` 处理历史格式
- **运动数据 JSON**：**没有版本控制**。Schema 由 LLM 自行决定，如果 LLM 改变了写入格式，旧数据可能不兼容
- **压缩摘要**：Markdown 格式，没有严格的 Schema 版本控制

**潜在风险：** 运动数据没有强制 Schema 校验，LLM 可能在不同会话中写入不同结构的数据。建议未来添加 JSON Schema 校验或版本字段。

**核心文件：** `packages/coding-agent/src/core/session-manager.ts:215-281`（迁移函数）、`packages/coding-agent/src/core/fitness/schemas.ts`（类型定义）

---

### Q20: 压缩后的记忆在跨会话恢复时如何与新会话上下文融合？是否存在旧记忆覆盖新指令的冲突问题？

**A:**

**跨会话恢复流程：**

1. **CLI**：`SessionManager.continueRecent()` 找到最近的 session 文件，`buildSessionContext()` 从 leaf 遍历到 root，遇到 `CompactionEntry` 时将其摘要作为上下文起点，然后追加后续消息
2. **Bot**：`context.jsonl` 固定路径，启动时自动加载。`syncLogToSessionManager()` 从 `log.jsonl` 同步新用户消息

**压缩摘要在恢复中的角色：**
- `buildSessionContext()` 遇到 `CompactionEntry` 时，将其 `summary` 作为 `customMessage` 加入上下文
- 后续消息（compaction 之后的）正常追加
- 最终上下文 = [压缩摘要] + [最近 N 条原始消息]

**是否存在旧记忆覆盖新指令的冲突？**

**可能存在的问题：**

1. **摘要过时**：如果压缩摘要包含 "用户目标是增肌"，但新会话用户说 "我要减脂"，旧摘要可能误导 LLM。但新消息排在摘要之后，LLM 通常能正确优先处理新指令。
2. **指令优先级**：系统提示词 > 用户消息 > 历史上下文。压缩摘要属于历史上下文，优先级最低。
3. **运动数据独立**：关键数据在 `sport-data/*.json` 中，不依赖压缩摘要，即使摘要过时也不影响数据准确性。

**缓解机制：**
- `UPDATE_SUMMARIZATION_PROMPT` 增量更新摘要，而非完全重新生成
- 最近 20K tokens 的原始消息保留完整，不受压缩影响
- 用户可通过 `/compact` 手动触发重新压缩

**核心文件：** `packages/coding-agent/src/core/session-manager.ts:315-422`（buildSessionContext）

---

### Q21: 记忆压缩的频率控制策略是什么？每次达阈值即压缩还是批量压缩？压缩过程是否阻塞用户请求？

**A:**

**频率控制策略：每次达阈值即压缩。**

**触发时机：**
- 在 Agent 循环的每个 turn 结束时检查 `shouldCompact()`
- 条件：`contextTokens > contextWindow - reserveTokens`
- 满足条件 → 立即执行压缩 → 压缩完成后继续下一个 turn

**压缩过程是否阻塞用户请求？**

**是的，压缩过程阻塞当前推理循环：**
1. `compact()` 调用 LLM 生成摘要（需要一次 LLM API 调用）
2. 生成摘要期间，Agent 不处理新消息
3. 摘要生成完成后，压缩结果写入 JSONL，继续推理

**但不阻塞其他频道（Bot 场景）：**
- 每个频道有独立的 AgentRunner
- 频道 A 压缩不影响频道 B 的推理

**压缩耗时：**
- 取决于被压缩消息的 token 数和 LLM 响应速度
- 通常 2-10 秒（一次 LLM 调用）
- 用户体验上表现为"Bot 思考时间变长"

**批量压缩？**
- 不支持。每次触发只压缩一次，不会连续压缩多次
- 如果压缩后仍然超过阈值（极端情况），会在下一个 turn 再次触发

**核心文件：** `packages/coding-agent/src/core/compaction/compaction.ts:717-797`（compact 函数）

---

## 五、动态 Prompt 与会话持久化

### Q22: System Prompt 动态组装流水线是模板引擎（如 Jinja）还是代码拼接？组装频率是每次请求触发还是缓存触发？

**A:**

**一句话结论：采用代码拼接，不是 Jinja 这类模板引擎；CLI 有“base system prompt”缓存，Bot 每次 run 前重建。**

**CLI 组装流水线（`system-prompt.ts` 的 `buildSystemPrompt()`）：**

```typescript
function buildSystemPrompt(options): string {
  let prompt = "";

  // 1. 基础角色描述
  prompt += "You are an expert coding assistant operating inside FitClaw.\n";

  // 2. 工具列表（根据 selectedTools 动态生成）
  for (const [name, snippet] of Object.entries(toolSnippets)) {
    prompt += `- ${name}: ${snippet}\n`;
  }

  // 3. 指导原则（根据可用工具动态添加）
  if (hasGrep) prompt += "Prefer grep over bash for searching.\n";
  if (hasFind) prompt += "Prefer find over bash for file discovery.\n";

  // 4. 项目上下文（CLAUDE.md 内容）
  for (const file of contextFiles) {
    prompt += `\n<${file.path}>\n${file.content}\n</${file.path}>\n`;
  }

  // 5. Skill 列表（XML 格式）
  prompt += formatSkillsForPrompt(skills);

  // 6. 日期和工作目录
  prompt += `\nCurrent date: ${date}\nWorking directory: ${cwd}\n`;

  return prompt;
}
```

**Bot 组装流水线（`agent.ts` 的 `buildSystemPrompt()`）：**
1. FitCoach 角色设定
2. Memory 读写说明 + 当前 Memory 内容
3. Skill 列表（同上 XML 格式）
4. 工具使用指南
5. Python 脚本调用示例

**组装频率：**

| 场景 | 频率 | 说明 |
|------|------|------|
| CLI | 会话创建、工具集合变化、模型/资源 reload、扩展资源变化时重建 | `AgentSession` 保存 `_baseSystemPrompt`，普通 `prompt()` 复用当前 prompt |
| Bot | 每次 `run()` 调用 | 用最新 memory 和 skills 更新 `agent.state.systemPrompt` |

**为什么 CLI 不每次请求都重组装：**
Prompt 像一张“开工说明书”。工具列表、Skill 列表、AGENTS/CLAUDE 上下文这些内容大多数时候不变，所以 CLI 把它拼成 `_baseSystemPrompt` 放在 `AgentSession` 里。只有影响说明书的资源变化时才重新拼：比如启用/禁用工具、`session.reload()`、扩展发现新 Skill、模型切换需要更新状态等。

**为什么 Bot 每次 run 重组装：**
Bot 的 memory 和 channel skill 可能在消息之间被文件系统修改，所以 `packages/mom/src/agent.ts` 的 `run()` 会重新加载 memory、重新加载 skills，再更新 `session.agent.state.systemPrompt`。这是用一点字符串拼接成本换配置新鲜度。

**核心文件：** `packages/coding-agent/src/core/system-prompt.ts`、`packages/mom/src/agent.ts:129-171`

---

### Q23: 可用工具、Skills 与项目上下文发生变更时，如何通知 Prompt 重新组装并清理旧缓存？

**A:**

**一句话结论：没有文件监听式通知，也没有自动清理旧 prompt 缓存；CLI 依赖显式 reload / 资源扩展 / 工具变更来重建，Bot 依赖每次 run 前重新加载。**

**变更生效时机：**

| 变更类型 | 生效时机 | 机制 |
|---------|---------|------|
| CLI 工具变更 | 立即重建 base prompt | `setActiveToolsByName()` 更新工具后调用 `_rebuildSystemPrompt()` |
| CLI Skill / 项目上下文变更 | `session.reload()` 后生效 | `DefaultResourceLoader.reload()` 重新扫描 skills、prompts、themes、AGENTS/CLAUDE 文件 |
| CLI 扩展临时资源变更 | 扩展触发资源发现后生效 | `extendResourcesFromExtensions()` 扩展资源后重建 system prompt |
| Memory 变更（Bot） | 下次 run 调用 | `run()` 时重新读取 MEMORY.md |
| 模型切换 | 立即生效 | 更新 `agent.state.model`，并写入 `model_change` 记录；通常不需要重建 system prompt |

**Bot 特殊处理：**
- `agent.ts` 的 `run()` 方法在每次执行前：
  1. 重新加载 memory（`loadMemory()`）
  2. 重新加载 skills（`loadSkills()`）
  3. 重新构建 system prompt（`buildSystemPrompt()`）
  4. 更新 `session.agent.state.systemPrompt`

**Skill 热加载：**
- Bot 的 Skill 文件修改后，下次 `run()` 会重新扫描并生效
- CLI 的 Skill 文件修改后，需要触发 `session.reload()` 或创建新 session，普通下一次 prompt 不会自动扫描磁盘
- `data:` 声明变更需要重启（因为 data 工具在 `createAgentSession()` 时注册，不在每次 prompt 时重新注册）

**核心文件：** `packages/coding-agent/src/core/resource-loader.ts`（资源扫描）、`packages/coding-agent/src/core/agent-session.ts:886-919`（CLI prompt 重建）、`packages/coding-agent/src/core/sdk.ts:390-408`（data 工具注册）、`packages/mom/src/agent.ts:129-171`（Bot run 方法）

---

### Q24: JSONL 持久化的单条记录格式定义包含哪些元信息（时间戳、版本、会话 ID、节点序号）？

**A:**

**JSONL 文件结构：**

第一行是 `SessionHeader`，注意 `type` 是 `"session"`，不是 `"header"`：
```json
{"type":"session","version":3,"id":"019234a5-b6c7-7d8e-9f0a-1b2c3d4e5f6a","timestamp":"2026-05-06T10:00:00.000Z","cwd":"/path/to/project"}
```

后续每行是一个 `SessionEntry`（联合类型）：

**通用字段（`SessionEntryBase`）：**
```json
{
  "type": "message | compaction | model_change | thinking_level_change | label | branch_summary | custom | custom_message | session_info",
  "id": "a1b2c3d4",
  "parentId": "e5f6a7b8",
  "timestamp": "2026-05-06T10:00:00.000Z"
}
```

**消息类型（`SessionMessageEntry`）额外字段：**
```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "e5f6a7b8",
  "timestamp": "2026-05-06T10:00:00.000Z",
  "message": {
    "role": "user | assistant | toolResult | custom | bashExecution",
    "content": [],
    "usage": { "input": 1000, "output": 500, "cacheRead": 200, "cacheWrite": 100, "totalTokens": 1800, "cost": {} },
    "stopReason": "stop | length | toolUse | error | aborted",
    "model": "claude-opus-4-6",
    "provider": "anthropic",
    "api": "anthropic-messages"
  }
}
```

**压缩类型（`CompactionEntry`）额外字段：**
```json
{
  "type": "compaction",
  "summary": "## Goal\n...",
  "firstKeptEntryId": "b2c3d4e5",
  "details": { "readFiles": [...], "modifiedFiles": [...] },
  "tokensBefore": 180000
}
```

**模型/思考级别变更：**
```json
{"type":"model_change","provider":"openai","modelId":"gpt-4o"}
{"type":"thinking_level_change","thinkingLevel":"high"}
```

**元信息总结：**

| 元信息 | 字段 | 说明 |
|--------|------|------|
| 时间戳 | `timestamp` | ISO 字符串时间戳 |
| 版本 | `version`（header） | 当前版本 3，支持 v1→v2→v3 迁移 |
| 会话 ID | `id`（header） | UUID v7，全局唯一 |
| 节点 ID | `id` | 8 字符十六进制，会话内唯一 |
| 父节点 | `parentId` | 树形结构，支持分支 |
| 节点类型 | `type` | message/compaction/model_change 等 |
| 消息内容 | `message`（message 类型） | 包含 role/content/usage/stopReason/model 等 |

**核心文件：** `packages/coding-agent/src/core/session-manager.ts:28-150`

---

### Q25: 跨会话冷启动恢复时，从 JSONL 加载到 Agent 状态完全恢复的平均耗时是多少？

**A:**

**没有官方基准测试数据。** 但可以根据实现推算：

**恢复流程：**
1. 读取 JSONL 文件（`fs.readFile`）— 取决于文件大小
2. `parseSessionEntries()`：逐行 JSON.parse — O(n)，n = 行数
3. `_buildIndex()`：构建 Map<id, FileEntry> — O(n)
4. `buildSessionContext()`：从 leaf 到 root 遍历树 — O(depth)
5. 重建 `AgentMessage[]` — O(depth)

**性能估算：**

| 场景 | 文件大小 | 行数 | 预估耗时 |
|------|---------|------|---------|
| 短会话（10 轮对话） | ~50 KB | ~50 | < 10 ms |
| 中等会话（100 轮对话） | ~500 KB | ~500 | < 50 ms |
| 长会话（1000 轮 + 压缩） | ~5 MB | ~5000 | < 200 ms |

**额外开销：**
- Skill 加载：扫描目录 + 解析 frontmatter — ~10-50 ms
- 系统提示词拼接：纯字符串操作 — < 1 ms
- LLM API 首次调用：取决于网络和 Provider — 500ms-5s

**瓶颈不在 JSONL 加载，而在 LLM API 首次调用。**

**Bot 冷启动额外步骤：**
- `syncLogToSessionManager()`：从 `log.jsonl` 同步消息 — 取决于日志大小
- 生成 `auth.json` 和 `models.json`（`entrypoint.sh`）— < 100 ms

---

### Q26: 节点回溯支持回溯到任意历史节点还是仅预设检查点？回溯后未来分支的状态如何处理？

**A:**

**支持回溯到任意历史节点，不限于预设检查点。**

**实现机制：**

每个 `SessionEntry` 都有 `id` 和 `parentId`，形成树形结构。`SessionManager` 提供：

1. **`branch(entryId)`**：将 `leafId` 指针移动到指定 entryId，创建新分支。历史不修改。
2. **`resetLeaf(entryId)`**：将 `leafId` 重置到指定节点。
3. **`branchWithSummary(entryId)`**：回溯并生成分支摘要。
4. **`getBranch(entryId)`**：从指定节点遍历到 root，返回路径上的所有 entries。
5. **`getChildren(entryId)`**：获取指定节点的所有子节点（分支）。

**树形结构示例：**
```
Entry A (id: "a1", parentId: null)
  └── Entry B (id: "b2", parentId: "a1")
        └── Entry C (id: "c3", parentId: "b2")  ← 当前 leaf
              ├── Entry D (id: "d4", parentId: "c3")  ← 分支 1
              └── Entry E (id: "e5", parentId: "c3")  ← 分支 2
```

**回溯后未来分支的状态：**
- **保留不删除**：回溯到节点 C 后创建新分支，D 和 E 仍然存在
- **不可见但可恢复**：新分支的 leaf 指针指向新节点，D/E 不在当前路径上，但可通过 `getChildren(c3)` 找到
- **CLI 支持会话树导航**：`InteractiveMode` 支持 `/fork` 命令和树形浏览

**Bot 场景：**
- Bot 使用固定路径的 `context.jsonl`，没有分支功能
- 每条消息追加到文件末尾，不支持回溯

**核心文件：** `packages/coding-agent/src/core/session-manager.ts`（branch/resetLeaf/getBranch/getChildren）

---

## 六、生产级接入

### Q27: WebSocket 长连接的稳定性保障措施有哪些？心跳检测间隔、断线重连策略、消息去重机制如何设计？

**A:**

**WebSocket 长连接由飞书 SDK（`@larksuiteoapi/node-sdk`）管理，FitClaw 不直接实现 WebSocket 逻辑。**

**飞书 SDK 提供的保障：**
- `Lark.WSClient` 使用飞书官方 WebSocket 长连接协议
- 内置心跳检测和断线重连
- 无需公网地址和 SSL 证书（相比 HTTP 回调模式的优势）

**FitClaw 实现的消息去重（`feishu.ts`）：**
```typescript
const seenEventIds = new Set<string>();
const MAX_SEEN_EVENTS = 1000;

// 收到消息时
if (seenEventIds.has(eventId)) return; // 去重
seenEventIds.add(eventId);
if (seenEventIds.size > MAX_SEEN_EVENTS) {
  // 清理旧事件 ID（简单丢弃，非 LRU）
  const first = seenEventIds.values().next().value;
  seenEventIds.delete(first);
}
```

**去重机制：**
- 基于 `event_id` 的有界集合（最多 1000 条）
- 飞书可能重复推送同一事件（网络抖动等），去重集合防止重复处理
- 简单的 FIFO 清理策略（非 LRU），极端情况下可能误删

**缺失的保障：**
- 没有显式的心跳检测间隔配置（依赖 SDK 默认值）
- 没有断线重连后的消息补偿机制（断线期间的消息丢失）
- 没有连接状态监控和告警

**核心文件：** `packages/mom/src/feishu.ts`

---

### Q28: 频道独立 AgentRunner 的隔离级别是进程级、线程级还是协程级？资源上限如何管控？

**A:**

**隔离级别：协程级（Node.js 单线程内的异步隔离）。**

**实现（`agent.ts`）：**
```typescript
const channelRunners = new Map<string, AgentRunner>();

function getOrCreateRunner(sandboxConfig, channelId, channelDir): AgentRunner {
  if (channelRunners.has(channelId)) return channelRunners.get(channelId);
  const runner = createRunner(sandboxConfig, channelId, channelDir);
  channelRunners.set(channelId, runner);
  return runner;
}
```

**每个 AgentRunner 拥有独立的：**
- `Agent` 实例（状态机）
- `SessionManager`（JSONL 文件）
- `FileSportDataStore`（运动数据）
- Skills 和 Memory
- 系统提示词

**隔离的实际含义：**
- 不同频道的 Agent 并发运行在同一个 Node.js 进程中
- 通过 `async/await` 实现协作式并发，不是真正的并行
- 一个频道的 Agent 执行 LLM 调用（I/O 阻塞）时，其他频道的 Agent 可以运行

**资源上限管控：**
- **当前没有显式的资源管控**：
  - 没有最大并发 Runner 数限制
  - 没有单个 Runner 的内存限制
  - 没有 LLM API 调用的并发限制（可能导致 API 限流）
- **隐式限制**：
  - Node.js 堆内存限制（默认 ~1.7 GB）
  - LLM Provider 的 API 限流（由 Provider 侧控制）
  - 文件描述符限制（每个 Runner 打开多个 JSONL 文件）

**潜在风险：**
- 大量频道同时活跃时，内存可能溢出
- 没有 Runner 回收机制——创建后一直存在于 Map 中
- 没有 LLM 调用排队机制——可能触发 Provider 限流

**核心文件：** `packages/mom/src/agent.ts:234-247`（channelRunners Map）

---

### Q29: 会话状态隔离在内存中的数据结构是怎样的？如何避免高并发场景下不同频道的会话数据串扰？

**A:**

**内存数据结构：**

```typescript
// main.ts
interface ChannelState {
  running: boolean;      // 当前是否正在处理消息
  runner: AgentRunner;   // 频道独立的 Agent 运行器
  store: ChannelStore;   // 频道独立的消息存储
}
const channelStates = new Map<string, ChannelState>();
```

**状态隔离方式：**

1. **Map 键隔离**：`channelStates` 以 `channelId`（或 `channelId/userId` for group mentions）为键，每个键对应完全独立的 `ChannelState`
2. **Agent 实例隔离**：每个 `AgentRunner` 创建独立的 `Agent` 实例，拥有独立的 `AgentState`（systemPrompt、model、messages、tools）
3. **文件系统隔离**：每个频道有独立的目录（`feishu-workspace/{channelId}/`），包含独立的 `context.jsonl`、`log.jsonl`、`sport-data/`
4. **SportDataStore 隔离**：每个 Runner 创建独立的 `FileSportDataStore`，内存缓存（Map）独立

**避免串扰的保障：**

- **无共享可变状态**：不同频道的 Agent 不共享任何可变对象
- **Node.js 单线程**：不存在真正的并发写入，async/await 是协作式的
- **文件路径隔离**：数据文件路径包含 channelId，不可能写错目录

**唯一潜在串扰点：**
- LLM Provider 的 API Key 共享——所有频道使用同一个 API Key，Provider 侧的 rate limit 是全局的
- `channelRunners` Map 是全局的——但每个 Runner 的内部状态独立

**核心文件：** `packages/mom/src/main.ts`（channelStates Map）、`packages/mom/src/agent.ts`（createRunner）

---

### Q30: Feishu Bot API 的限流策略与降级方案是什么？当飞书服务异常时系统行为如何？

**A:**

**当前限流策略：没有显式客户端限流。**

**飞书 API 调用：**
- `FeishuBot.sendMessage()` / `updateMessage()` / `sendThreadMessage()` / `downloadFile()` 直接调用 `@larksuiteoapi/node-sdk`
- 没有客户端侧的限流、排队或退避逻辑
- 飞书 API 的具体限额由飞书平台控制，项目代码中没有配置本地速率阈值

**降级方案：没有。**

**飞书服务异常时的系统行为：**

1. **发送/更新消息失败**：`sendMessage()` / `updateMessage()` / `sendThreadMessage()` / `sendCardMessage()` 在方法内部 catch，写 warning 日志；`sendMessage()` 失败时返回空字符串
2. **文件下载失败**：`downloadFile()` 会向上抛错，由 `main.ts` 的附件下载 try-catch 捕获并记录
3. **Bot 行为**：
   - 消息接收失败 → 依赖飞书 SDK 重连，项目没有补偿队列
   - 回复发送失败 → 用户看不到回复或后续更新丢失（无重试）
   - 文件下载失败 → 附件丢失（无重试）
4. **Agent 行为**：Agent 推理可能正常完成，但结果无法发送给用户

**缺失的保障：**
- 没有消息发送重试机制
- 没有飞书 API 限流的客户端退避
- 没有连接状态监控和告警
- 没有离线消息队列（断线期间的消息不补偿）

**核心文件：** `packages/mom/src/feishu.ts`、`packages/mom/src/main.ts`

---

### Q31: 部署架构是单机还是分布式？AgentRunner 的横向伸缩策略与负载均衡机制是什么？

**A:**

**当前部署架构：单机。**

**部署方式：**

| 方式 | 架构 | 说明 |
|------|------|------|
| Docker | 单容器 | `docker compose up -d` 启动一个容器 |
| PM2 | 单进程 | `pm2 start ecosystem.config.cjs` |
| 裸机 | 单进程 | `node packages/mom/dist/main.js` |

**没有横向伸缩：**
- 所有频道的 AgentRunner 运行在同一个进程中
- `channelStates` Map 是进程内存中的数据结构，无法跨进程共享
- 没有分布式锁、消息队列或服务发现机制
- `feishu-workspace/` 是本地文件系统（Docker volume），不支持多实例共享

**如果要横向伸缩，需要解决：**
1. **状态外置**：`channelStates` Map → Redis/数据库
2. **消息分发**：飞书消息路由到正确的实例（需要消息队列如 Kafka/RabbitMQ）
3. **数据共享**：`feishu-workspace/` → 分布式文件系统或对象存储
4. **会话锁**：同一频道的消息不能被多个实例同时处理

**当前架构的承载能力：**
- 单进程 Node.js 可以处理数十个并发频道（受 LLM API 延迟限制，不是 CPU 限制）
- 主要瓶颈是 LLM API 调用的并发数和飞书 API 的限流

---

### Q32: 生产环境的监控与日志体系如何设计？能否追踪一个用户请求在多轮 ReAct 中的完整调用链路？

**A:**

**当前监控与日志体系：最小化实现。**

**日志：**

| 类型 | 位置 | 内容 |
|------|------|------|
| 调试日志 | `~/.fitclaw/agent/fitclaw-debug.log` | 启动信息、模型选择、工具调用 |
| 会话日志 | `{channelDir}/log.jsonl` | 用户消息、Bot 回复（结构化 JSONL） |
| 会话上下文 | `{channelDir}/context.jsonl` | 完整的消息历史（含 toolCall + toolResult） |
| 容器日志 | `docker compose logs` | stdout/stderr |
| PM2 日志 | `pm2 logs` | stdout/stderr |

**Agent 生命周期事件：**

`Agent` 通过 `subscribe(listener)` 发出事件，Bot 的 `createRunner()` 订阅了：
- `tool_execution_start` / `tool_execution_end` → 日志 + 飞书线程回复
- `message_start` / `message_end` → 流式文本/思考输出
- `compaction` → 压缩事件
- `auto_retry` → 自动重试

**能否追踪完整调用链路？**

**可以，但需要手动拼接：**

1. `context.jsonl` 包含完整的消息序列（user → assistant → toolResult → assistant → ...），可以重建完整的推理链路
2. 每条 assistant 消息包含 `model`、`provider`、`api`、`usage`、`stopReason`
3. 每条 toolResult 消息包含 `toolCallId`、`toolName`、`content`、`isError`

**缺失的：**
- 没有分布式追踪（如 OpenTelemetry）
- 没有请求级别的 traceId（无法跨组件追踪）
- 没有性能指标采集（如 P50/P95 延迟、错误率）
- 没有告警机制
- 没有 Dashboard

**核心文件：** `packages/mom/src/agent.ts`（事件订阅）、`packages/coding-agent/src/core/session-manager.ts`（JSONL 结构）

---

## 七、项目整体与工程实践

### Q33: 项目完整技术栈是什么？Java 版本、Agent 框架选型、LLM 调用 SDK 分别是什么？

**A:**

**FitClaw 是纯 TypeScript 项目，不使用 Java。**

**完整技术栈：**

| 类别 | 技术 | 版本/说明 |
|------|------|----------|
| 语言 | TypeScript | 全栈统一 |
| 运行时 | Node.js | >= 20.0.0（coding-agent 要求 >= 20.6.0） |
| 编译器 | tsgo | 项目专用 TypeScript 编译器 |
| 包管理 | npm | monorepo workspace |
| 构建 | tsgo + copy-assets | 编译 + 静态资源复制 |
| Agent 框架 | 自研 `@fitclaw/agent-core` | 双层 while 循环 + Function Calling |
| LLM SDK | 多厂商原生 SDK | `@anthropic-ai/sdk`、`openai@6.26.0`、`@google/genai`、`@mistralai/mistralai`、`@aws-sdk/client-bedrock-runtime` |
| LLM 抽象 | 自研 `@fitclaw/ai` | 26 Provider 统一接入 |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | WebSocket 长连接模式 |
| CLI TUI | 自研 `@fitclaw/tui` | 终端 UI 组件库 |
| 类型校验 | TypeBox | JSON Schema 生成 + 校验 |
| 测试 | Vitest | 单元测试 + 集成测试 |
| 容器化 | Docker | node:22-slim 基础镜像 |
| 进程管理 | PM2 | 裸机部署时使用 |
| Python | Python 3（Dockerfile 通过 apt 安装，未固定小版本） | 仅用于 Skill 脚本（动作数据库查询） |

**7 个 npm 包：**

| 包 | npm 名 | 职责 |
|----|--------|------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM API 统一层 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：工具调用、状态管理 |
| `packages/coding-agent` | `@fitclaw/claw` | 主 CLI 应用（交互式 TUI） |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件库 |
| `packages/mom` | `@fitclaw/mom` | 飞书 Bot |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件 |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI |

---

### Q34: 系统的核心性能指标如何？平均响应延迟、并发用户数、长连接稳定性（如 7 天在线率）？

**A:**

**没有官方性能基准测试数据。** 以下是基于架构的推算：

**平均响应延迟：**

| 阶段 | 延迟 | 说明 |
|------|------|------|
| 飞书消息接收 | ~50-200 ms | WebSocket 推送 |
| Agent 初始化 | < 10 ms | 内存操作 |
| 系统提示词组装 | < 1 ms | 字符串拼接 |
| LLM API 首次响应 | 500 ms - 5 s | 取决于 Provider 和模型 |
| LLM 流式输出 | 2-30 s | 取决于回复长度 |
| 工具执行（bash） | 10 ms - 60 s | 取决于命令复杂度 |
| 飞书消息发送 | ~100-500 ms | API 调用 |
| **端到端（简单问答）** | **1-5 s** | 用户发消息到收到回复 |
| **端到端（工具密集）** | **10-60 s** | 涉及多次工具调用 |

**并发用户数：**
- 单进程 Node.js + async/await → 多频道可以协作式并发，但项目没有压测数据证明上限
- 实际瓶颈通常不在本地 CPU，而在 LLM API 调用延迟、Provider 限流和飞书 API 限流
- 项目没有客户端侧并发队列或限流器，因此高并发时会直接把压力传给外部 Provider

**长连接稳定性：**
- 飞书 WebSocket 由 SDK 管理，内置心跳和重连
- 没有 7 天在线率的监控数据
- Docker `restart: unless-stopped` 策略确保容器异常退出后自动重启

---

### Q35: 是否遇到过 LLM 幻觉导致的错误 Action 或危险指令？安全兜底机制如何设计？

**A:**

**已知的 LLM 幻觉问题（来自项目历史记录）：**

- **Bot Skill 修复（2026-05-03）**：LLM 曾幻觉工具名，例如虚构 `data_fitness_read`，或沿用冒号分隔的旧式数据工具写法。当前代码真实注册的是 `data_{skillName}_read` / `data_{skillName}_write`，例如 `data_bodybuilding_read` 和 `data_bodybuilding_write`。系统提示词现在会在 Skill 元数据中注入 `<data_tools>`，降低工具名幻觉风险。
- **Skill 数据边界加固（2026-05-07）**：`data_<skill>_read/write` 现在都会拒绝未声明 namespace；`FileSportDataStore` 校验 namespace 字符集并把 resolved path 限制在 `{dataDir}/sport-data/{skillName}/` 内；除文件不存在外，JSON 损坏、权限错误、路径越界和写入失败都会作为工具错误暴露给 LLM。

**安全兜底机制：**

1. **危险命令拦截（`bash.ts`）**：
   ```typescript
   const DANGEROUS_PATTERNS = [
     /rm\s+(-[rf]+\s+|.*\*\/)/,  // rm -rf /
     /dd\s+.*of=\/dev/,            // dd to block devices
     /mkfs/,                        // format filesystem
     /:\(\)\{.*\|/,                 // fork bomb
     /curl.*\|.*sh/,               // curl | sh
     // ...
   ];
   ```

2. **路径安全（`path-utils.ts`）**：
   - `resolveToCwd()` 验证路径在 cwd 或 home 目录内
   - 阻止 `..` 父目录遍历
   - `SECURITY_BLOCKED` 错误

3. **工具参数校验（`validation.ts`）**：
   - JSON Schema 校验，类型不匹配直接拒绝
   - 错误信息返回给 LLM 修正

4. **`beforeToolCall` 钩子**：
   - 可拦截任何工具调用（返回 `{ block: true }`）
   - 当前未用于安全控制，但架构支持

5. **`afterToolCall` 钩子**：
   - 可覆盖工具结果、标记错误、终止执行

6. **健身安全规则（`fitclaw.md`）**：
   - 不推荐无渐进的危险动作
   - 对有已知风险的动作发出警告
   - 不建议极端饮食或有害补充剂
   - 尊重用户报告的伤病和限制
   - 医疗问题建议咨询专业医生

**缺失的安全机制：**
- 没有 LLM 输出内容审核（如检测危险动作建议）
- 没有工具调用白名单/黑名单（除了 bash 的危险命令模式）
- 没有用户权限分级（所有用户权限相同）

---

### Q36: 如果动作数据库扩展至 10000+ 或接入多模态输入（如图片识别动作），当前架构的瓶颈在哪里？

**A:**

**动作数据库扩展至 10000+ 的瓶颈：**

| 瓶颈 | 当前实现 | 问题 | 解决方案 |
|------|---------|------|---------|
| 文件系统扫描 | `query_exercises.py` 遍历所有 JSON 文件 | 10K 文件 × ~2KB = 20MB，每次查询加载全量 | 引入 SQLite 或预构建索引 |
| 内存占用 | 所有 JSON 加载到内存 | 10K × ~2KB = ~20MB Python 对象 | 可接受，但需监控 |
| 查询性能 | 列表推导式过滤 | 10K 条目线性扫描 ~10-50ms | 可接受，但复合查询变慢 |
| 图片存储 | 本地文件系统 | 10K × 2 张图片 = 20K 文件，Docker 镜像膨胀 | 迁移到对象存储（S3/OSS） |
| 磁盘空间 | Docker 镜像内嵌 | 10K 动作 + 图片可能 > 1GB | 分离数据卷，按需下载 |

**接入多模态输入（图片识别动作）的瓶颈：**

| 瓶颈 | 当前实现 | 问题 | 解决方案 |
|------|---------|------|---------|
| 图片传输 | `read` 工具支持图片读取 + 自动 resize | 飞书图片需先 `downloadFile()` | 已支持，但 `uploadFile` 是空 stub |
| LLM 视觉能力 | `transformMessages` 检测非视觉模型并降级 | 需要视觉模型（GPT-4V、Claude Vision） | 配置视觉模型即可 |
| 图片识别精度 | 无 | 需要微调模型或 RAG | 集成动作图片向量检索 |
| 飞书图片发送 | `uploadFile` 是空 stub | Bot 无法发送动作示范图片 | 实现 `uploadFile` |
| 响应延迟 | N/A | 图片识别增加 2-5s 延迟 | 异步处理 + 缓存 |

**架构层面的瓶颈：**

1. **单机架构**：所有数据在本地文件系统，无法水平扩展
2. **无缓存层**：每次查询都读磁盘，无 Redis/内存缓存
3. **无向量检索**：纯关键词匹配，无法语义搜索（如"练胸的动作"→需要理解 primaryMuscles 字段）
4. **LLM 依赖**：动作推荐完全依赖 LLM 推理，无法利用推荐算法
5. **图片管道缺失**：`uploadFile` 空 stub，Bot 无法传递动作图片给用户

**推荐的架构演进路径：**
1. 短期：引入 SQLite 索引 + 实现 `uploadFile`
2. 中期：向量数据库（如 Qdrant）存储动作 embedding，支持语义搜索
3. 长期：对象存储（S3/OSS）分离图片 + 分布式部署

---

> 本文档基于 FitClaw 源码和项目文档编写，反映 2026-05-05 的代码状态。架构可能随版本迭代演进。
