# FitClaw 项目完整文档

> **说明**：本文档基于对项目源代码的完整阅读与理解编写，供其他 Agent 复现项目结构与逻辑。以下内容已排除与 GitHub 平台相关的文件（如 `.github/` 目录、CI 工作流、Issue/PR 模板、贡献者门禁等），仅保留项目业务代码与开发运行相关的核心信息。

---

## 一、项目概述

**FitClaw** 是一个用于构建 AI Agent 和管理 LLM 部署的 TypeScript monorepo，采用 MIT 许可证。

项目的核心产品是一个名为 **pi** 的交互式编码 Agent CLI，具备以下能力：
- 多 LLM 提供商统一接入（OpenAI、Anthropic、Google、Mistral、Azure、Bedrock、Cloudflare 等）
- 交互式 TUI（终端用户界面）与 Print/RPC 模式
- 内置编码工具集（read、bash、edit、write、grep、find、ls）
- 会话管理（JSONL 格式持久化）
- 扩展系统（Extensions）与技能系统（Skills）
- 会话压缩（Compaction）与上下文管理
- HTML 导出与分享

### 排除的内容（不涉及业务代码）
以下文件/目录在本文档中被排除，因它们仅与 GitHub 平台同步相关：
- `.github/` 目录（工作流、Issue 模板、PR 门禁、贡献者审批）
- `CONTRIBUTING.md`（仅涉及 GitHub 贡献流程）
- `AGENTS.md` 中仅与 GitHub Issue/PR 操作相关的段落

---

## 二、Monorepo 架构

项目使用 **npm workspaces** 管理 7 个子包，统一版本号（lockstep versioning，当前版本 `0.70.5`）。

### 2.1 包依赖关系

```
FitClaw monorepo (root)
│
├── packages/ai          (@fitclaw/ai)
│   └── 被 agent、tui、web-ui、coding-agent、mom、pods 依赖
│
├── packages/agent       (@fitclaw/agent-core)
│   └── 依赖 ai；被 coding-agent、mom、pods 依赖
│
├── packages/tui         (@fitclaw/pods-tui)
│   └── 被 coding-agent、web-ui 依赖
│
├── packages/coding-agent (@fitclaw/claw)
│   └── 依赖 ai + agent + tui
│
├── packages/web-ui      (@fitclaw/web-ui)
│   └── 依赖 ai + tui
│
├── packages/mom         (@fitclaw/mom)
│   └── 依赖 ai + agent + coding-agent
│
└── packages/pods        (@fitclaw/pods)
    └── 依赖 agent
```

### 2.2 各包职责

| 包 | 名称 | 职责 |
|---|---|---|
| `packages/ai` | `@fitclaw/ai` | 统一多提供商 LLM API，标准化流式协议与模型注册 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：状态管理、工具调用、事件循环 |
| `packages/coding-agent` | `@fitclaw/claw` | 编码 Agent CLI（pi），含 TUI、工具、会话、扩展 |
| `packages/tui` | `@fitclaw/pods-tui` | 终端 UI 库，差异渲染，组件化设计 |
| `packages/web-ui` | `@fitclaw/web-ui` | AI 聊天界面的 Web Components（基于 Lit） |
| `packages/mom` | `@fitclaw/mom` | Slack Bot，将消息委托给 coding agent |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 上的 vLLM 部署管理 CLI |

---

## 三、技术栈与构建配置

### 3.1 技术栈

- **语言**：TypeScript 5.9+（目标 ES2022，模块 Node16）
- **运行时**：Node.js >= 20.0.0（coding-agent 要求 >= 20.6.0）
- **构建器**：`tsgo`（自定义快速 TypeScript 编译器，替代 tsc）
- **Linter/Formatter**：Biome 2.3.5（缩进：Tab，行宽：120）
- **测试**：Vitest（ai、agent、coding-agent）；Node.js 内置 test runner（tui）
- **包管理**：npm workspaces
- **Git Hooks**：Husky 9

### 3.2 根目录配置

**`tsconfig.base.json`**：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "inlineSources": true,
    "moduleResolution": "Node16",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "types": ["node"]
  }
}
```

**`biome.json`**：关键规则
- `noNonNullAssertion`: off
- `useConst`: error
- `noExplicitAny`: off（允许 any）
- 缩进使用 Tab，行宽 120

### 3.3 根目录 scripts

```json
{
  "clean": "npm run clean --workspaces",
  "build": "cd packages/tui && npm run build && cd ../ai && npm run build && cd ../agent && npm run build && cd ../coding-agent && npm run build && cd ../mom && npm run build && cd ../web-ui && npm run build && cd ../pods && npm run build",
  "dev": "concurrently 启动 ai/agent/coding-agent/mom/web-ui/tui 的 dev 模式",
  "check": "biome check --write --error-on-warnings . && tsgo --noEmit && npm run check:browser-smoke && cd packages/web-ui && npm run check",
  "test": "npm run test --workspaces --if-present"
}
```

**注意**：`npm run check` 要求先 `npm run build`，因为 `web-ui` 依赖其他包的 `.d.ts` 文件。

### 3.4 构建顺序

由于包间依赖关系，构建必须按以下顺序执行：
1. `packages/tui`
2. `packages/ai`
3. `packages/agent`
4. `packages/coding-agent`
5. `packages/mom`
6. `packages/web-ui`
7. `packages/pods`

---

## 四、核心包详解

### 4.1 packages/ai — 统一 LLM API

#### 4.1.1 目录结构
```
packages/ai/src/
├── api-registry.ts          # API 提供商注册表
├── cli.ts                   # pi-ai CLI（模型生成等）
├── env-api-keys.ts          # 环境变量 API Key 检测
├── index.ts                 # 公开导出
├── models.generated.ts      # 自动生成的模型数据（巨大文件 ~400KB）
├── models.ts                # 模型注册表与工具函数
├── oauth.ts                 # OAuth 导出
├── stream.ts                # stream/complete/streamSimple/completeSimple 入口
├── types.ts                 # 核心类型定义
├── providers/               # 各提供商实现
│   ├── register-builtins.ts # 内置提供商懒加载注册
│   ├── anthropic.ts
│   ├── openai-completions.ts
│   ├── openai-responses.ts
│   ├── openai-codex-responses.ts
│   ├── azure-openai-responses.ts
│   ├── google.ts
│   ├── google-gemini-cli.ts
│   ├── google-vertex.ts
│   ├── mistral.ts
│   ├── amazon-bedrock.ts
│   ├── cloudflare.ts
│   ├── faux.ts              # 假/测试提供商
│   └── ...
└── utils/                   # 工具函数
    ├── event-stream.ts      # AssistantMessageEventStream 实现
    ├── json-parse.ts
    ├── oauth/
    ├── overflow.ts
    ├── typebox-helpers.ts
    └── validation.ts
```

#### 4.1.2 核心类型（types.ts）

**API 类型**：
```typescript
type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex";
```

**消息内容类型**：
```typescript
interface TextContent { type: "text"; text: string; textSignature?: string; }
interface ThinkingContent { type: "thinking"; thinking: string; redacted?: boolean; }
interface ImageContent { type: "image"; data: string; mimeType: string; }
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
```

**消息类型**：
```typescript
interface UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number; }
interface AssistantMessage { role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[]; api; provider; model; usage; stopReason; errorMessage?; timestamp; }
interface ToolResultMessage { role: "toolResult"; toolCallId; toolName; content; details?; isError; timestamp; }
type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

**流式事件协议**：
```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex; partial }
  | { type: "text_delta"; contentIndex; delta; partial }
  | { type: "text_end"; contentIndex; content; partial }
  | { type: "thinking_start"; contentIndex; partial }
  | { type: "thinking_delta"; contentIndex; delta; partial }
  | { type: "thinking_end"; contentIndex; content; partial }
  | { type: "toolcall_start"; contentIndex; partial }
  | { type: "toolcall_delta"; contentIndex; delta; partial }
  | { type: "toolcall_end"; contentIndex; toolCall; partial }
  | { type: "done"; reason; message: AssistantMessage }
  | { type: "error"; reason; error: AssistantMessage };
```

**模型接口**：
```typescript
interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input, output, cacheRead, cacheWrite }; // $/million tokens
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
}
```

**上下文**：
```typescript
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

#### 4.1.3 流式 API 入口（stream.ts）

```typescript
export function stream(model, context, options?): AssistantMessageEventStream;
export function complete(model, context, options?): Promise<AssistantMessage>;
export function streamSimple(model, context, options?): AssistantMessageEventStream;
export function completeSimple(model, context, options?): Promise<AssistantMessage>;
```

- `stream` / `complete`：使用完整 `StreamOptions`
- `streamSimple` / `completeSimple`：使用 `SimpleStreamOptions`，额外支持 `reasoning?: ThinkingLevel` 和 `thinkingBudgets`

#### 4.1.4 API 注册表（api-registry.ts）

采用运行时注册机制：
```typescript
export function registerApiProvider(provider: ApiProvider, sourceId?: string): void;
export function getApiProvider(api: Api): ApiProviderInternal | undefined;
export function unregisterApiProviders(sourceId: string): void;
```

每个提供商实现 `ApiProvider` 接口：
```typescript
interface ApiProvider {
  api: Api;
  stream: StreamFunction;       // 使用完整 StreamOptions
  streamSimple: StreamFunction; // 使用 SimpleStreamOptions
}
```

#### 4.1.5 模型注册表（models.ts）

模型数据来自 `models.generated.ts`（由 `scripts/generate-models.ts` 生成），运行时注册到 Map 中：
```typescript
export function getModel(provider, modelId): Model;
export function getProviders(): KnownProvider[];
export function getModels(provider): Model[];
export function calculateCost(model, usage): Cost;
export function supportsXhigh(model): boolean;
export function modelsAreEqual(a, b): boolean;
```

#### 4.1.6 关键依赖

- `@anthropic-ai/sdk`：Anthropic 官方 SDK
- `@aws-sdk/client-bedrock-runtime`：AWS Bedrock
- `@google/genai`：Google GenAI
- `@mistralai/mistralai`：Mistral
- `openai`：OpenAI SDK
- `typebox`：运行时类型验证（被所有包共用）
- `partial-json`：流式 JSON 解析
- `proxy-agent`：代理支持
- `undici`：HTTP 客户端
- `zod-to-json-schema`：Zod 转 JSON Schema

---

### 4.2 packages/agent — Agent 运行时

#### 4.2.1 目录结构
```
packages/agent/src/
├── agent.ts       # Agent 类：状态管理、事件、队列
├── agent-loop.ts  # 核心 Agent 循环：LLM 调用、工具执行
├── index.ts       # 导出
├── proxy.ts       # 代理工具
└── types.ts       # Agent 类型定义
```

#### 4.2.2 Agent 类（agent.ts）

`Agent` 是一个有状态包装器，围绕底层 `agent-loop.ts` 实现：

```typescript
class Agent {
  // 状态
  state: AgentState;        // systemPrompt, model, thinkingLevel, tools, messages
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: ReadonlySet<string>;
  errorMessage?: string;

  // 方法
  subscribe(listener): () => void;  // 订阅生命周期事件
  prompt(message): Promise<void>;   // 开始新提示
  continue(): Promise<void>;        // 从当前会话继续
  steer(message): void;             // 排队 steering 消息（当前 turn 后注入）
  followUp(message): void;          // 排队 follow-up 消息（agent 停止后注入）
  abort(): void;                    // 中止当前运行
  waitForIdle(): Promise<void>;
  reset(): void;
}
```

**AgentState**：
```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel; // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: ReadonlySet<string>;
  errorMessage?: string;
}
```

#### 4.2.3 Agent 循环（agent-loop.ts）

核心逻辑分为两层循环：

**外层循环**：处理 follow-up 消息队列。当 agent 完成所有工具调用且没有 steering 消息后，检查 follow-up 队列；如有消息则继续循环。

**内层循环**：处理单个 turn：
1. 处理 pending steering 消息
2. 流式调用 LLM（`streamAssistantResponse`）
3. 解析 assistant message 中的 tool calls
4. 执行工具调用（串行或并行）
5. 发出 tool results
6. 检查 steering 消息

**工具执行模式**：
- `sequential`：逐个准备、执行、终结
- `parallel`：逐个准备，然后并发执行允许并行的工具；`tool_execution_end` 按完成顺序发出，tool-result message 按 assistant 源顺序发出

**关键事件（AgentEvent）**：
```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId; toolName; args }
  | { type: "tool_execution_update"; toolCallId; toolName; args; partialResult }
  | { type: "tool_execution_end"; toolCallId; toolName; result; isError };
```

#### 4.2.4 AgentLoopConfig（types.ts）

```typescript
interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode; // "sequential" | "parallel"
  beforeToolCall?: (context, signal?) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context, signal?) => Promise<AfterToolCallResult | undefined>;
}
```

#### 4.2.5 工具定义（AgentTool）

```typescript
interface AgentTool<TParameters extends TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;                    // UI 显示标签
  prepareArguments?: (args: unknown) => Static<TParameters>; // 参数兼容 shim
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode; // 覆盖默认执行模式
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean; // 若一批中所有 tool 都设 true，则提前终止
}
```

---

### 4.3 packages/tui — 终端 UI 库

#### 4.3.1 目录结构
```
packages/tui/src/
├── autocomplete.ts          # 自动完成
├── components/              # UI 组件
│   ├── box.ts
│   ├── cancellable-loader.ts
│   ├── editor.ts            # 文本编辑器组件
│   ├── image.ts
│   ├── input.ts
│   ├── loader.ts
│   ├── markdown.ts
│   ├── select-list.ts
│   ├── settings-list.ts
│   ├── spacer.ts
│   ├── text.ts
│   └── truncated-text.ts
├── editor-component.ts      # 编辑器组件接口
├── fuzzy.ts                 # 模糊匹配
├── index.ts                 # 导出
├── keybindings.ts           # 键位绑定管理
├── keys.ts                  # 键盘输入解析（含 Kitty 协议）
├── kill-ring.ts             # Emacs kill ring
├── stdin-buffer.ts          # 标准输入缓冲
├── terminal.ts              # 终端抽象（ProcessTerminal）
├── terminal-image.ts        # 终端图像（Kitty/iTerm2 协议）
├── tui.ts                   # 核心 TUI 引擎与差异渲染
├── undo-stack.ts            # 撤销栈
└── utils.ts                 # 工具函数（宽度计算、文本换行等）
```

#### 4.3.2 核心设计

- **差异渲染（Differential Rendering）**：TUI 引擎只渲染变更的部分，大幅提升终端性能
- **组件化**：基于 `Container` / `Component` 的声明式组件系统
- **Kitty 键盘协议**：支持完整的键盘输入（含修饰键、释放事件）
- **终端图像协议**：支持 Kitty 和 iTerm2 图像协议，可内联显示图片/GIF

#### 4.3.3 核心类

```typescript
class TUI extends Container {
  // 管理组件树、焦点、事件循环
}

class Container implements Component {
  addChild(child): void;
  removeChild(child): void;
  setFocus(child): void;
  render(): void;
}
```

#### 4.3.4 关键依赖

- `chalk`：ANSI 颜色
- `get-east-asian-width`：CJK 字符宽度计算
- `marked`：Markdown 解析
- `mime-types`：MIME 类型检测
- `koffi`（可选）：Native 库绑定（用于图像解码加速）

---

### 4.4 packages/coding-agent — 编码 Agent CLI（核心产品）

这是项目最核心的包，实现了 `pi` 命令行工具。

#### 4.4.1 目录结构
```
packages/coding-agent/src/
├── bun/                     # Bun 特定入口（编译二进制用）
├── cli.ts                   # CLI 入口（Node.js）
├── cli/                     # CLI 参数解析等
│   ├── args.ts
│   ├── file-processor.ts
│   ├── initial-message.ts
│   ├── list-models.ts
│   └── session-picker.ts
├── config.ts                # 配置路径、版本、安装方式检测
├── core/                    # 核心业务逻辑
│   ├── agent-session.ts     # AgentSession 类（~100KB，核心）
│   ├── agent-session-runtime.ts
│   ├── agent-session-services.ts
│   ├── auth-storage.ts      # 认证存储（API Key / OAuth）
│   ├── bash-executor.ts
│   ├── compaction/          # 会话压缩
│   ├── event-bus.ts
│   ├── exec.ts
│   ├── export-html/         # HTML 导出
│   ├── extensions/          # 扩展系统
│   ├── footer-data-provider.ts
│   ├── keybindings.ts
│   ├── messages.ts          # 消息转换
│   ├── model-registry.ts    # 模型注册表
│   ├── model-resolver.ts    # 模型解析
│   ├── output-guard.ts
│   ├── package-manager.ts   # 包管理器集成
│   ├── prompt-templates.ts
│   ├── resource-loader.ts   # 资源加载（扩展、技能、主题、模板）
│   ├── sdk.ts               # 编程式 SDK
│   ├── session-manager.ts   # 会话管理器（JSONL 持久化）
│   ├── session-cwd.ts
│   ├── settings-manager.ts  # 设置管理
│   ├── skills.ts            # 技能系统
│   ├── slash-commands.ts
│   ├── source-info.ts
│   ├── system-prompt.ts     # 系统提示词构建
│   ├── telemetry.ts
│   ├── timings.ts
│   └── tools/               # 内置工具实现
│       ├── bash.ts
│       ├── edit.ts
│       ├── find.ts
│       ├── grep.ts
│       ├── ls.ts
│       ├── read.ts
│       ├── write.ts
│       └── truncate.ts
├── index.ts                 # 公开导出（SDK 接口）
├── main.ts                  # 主入口：参数解析 → 模式选择 → 运行
├── migrations.ts            # 配置迁移
├── modes/                   # 运行模式
│   ├── index.ts
│   ├── interactive/         # 交互式 TUI 模式
│   ├── print-mode.ts        # Print 模式（非交互）
│   └── rpc/                 # RPC 模式（JSON-RPC）
├── package-manager-cli.ts   # 包管理器 CLI 命令
└── utils/                   # 工具函数
    ├── clipboard.ts
    ├── frontmatter.ts
    ├── paths.ts
    └── shell.ts
```

#### 4.4.2 运行模式

**三种运行模式**：

1. **Interactive 模式**（默认）：
   - 启动 TUI，提供聊天界面
   - 支持文件附件、图片、工具执行可视化
   - 会话选择器、模型选择器、设置面板
   - 支持 Vim/Emacs 风格键位

2. **Print 模式**（`--print` 或管道输入）：
   - 非交互式，直接输出到 stdout
   - 支持 `text` 和 `json` 输出格式

3. **RPC 模式**（`--mode rpc`）：
   - JSON-RPC over stdin/stdout
   - 用于 IDE 集成

#### 4.4.3 核心工具集

编码 Agent 提供 7 个内置工具：

```typescript
type ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
```

| 工具 | 功能 |
|---|---|
| `read` | 读取文件内容，支持行范围、最大字节/行数限制 |
| `bash` | 执行 shell 命令，支持超时、工作目录 |
| `edit` | 编辑文件（查找替换、追加、删除行等） |
| `write` | 写入新文件 |
| `grep` | 在文件中搜索匹配内容 |
| `find` | 查找文件路径 |
| `ls` | 列出目录内容 |

工具定义使用 `typebox` 进行运行时参数验证，输出支持文本和图片。

#### 4.4.4 AgentSession（核心类）

`AgentSession` 是编码 Agent 的核心，管理整个会话生命周期：

- **消息管理**：维护对话历史，支持用户消息、助手消息、工具结果、自定义消息
- **工具执行**：调用 Agent 运行时执行工具
- **会话压缩**：当上下文过长时，自动压缩历史（summarize 旧消息）
- **模型切换**：支持 Ctrl+P 循环切换模型
- **扩展集成**：加载并管理扩展
- **事件总线**：通过 EventBus 分发内部事件

#### 4.4.5 会话管理（SessionManager）

会话以 **JSONL** 格式持久化到磁盘：

```typescript
// 会话文件：~/.pi/agent/sessions/<session-id>.jsonl
// 每行是一个 JSON 对象，类型包括：
type SessionEntry =
  | SessionHeader
  | SessionMessageEntry
  | CustomMessageEntry
  | FileEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | CustomEntry;
```

会话支持：
- 创建、打开、继续最近会话
- Fork（从现有会话分支）
- 按项目目录隔离
- 缺失工作目录检测与恢复

#### 4.4.6 扩展系统（Extensions）

扩展系统允许第三方为 pi 添加功能：

- **动态加载**：从指定目录加载 JS/TS 扩展
- **自定义工具**：扩展可注册新工具
- **自定义命令**：斜杠命令（/command）
- **自定义组件**：TUI 组件覆盖
- **生命周期钩子**：beforeAgentStart、beforeProviderRequest 等
- **事件监听**：监听 Agent 事件并响应

#### 4.4.7 技能系统（Skills）

技能是以 Markdown 文件定义的提示词模板：

```markdown
---
name: skill-name
description: What this skill does
type: skill
---

# Instructions
...
```

- 存放在 `~/.pi/agent/skills/` 或项目 `.pi/skills/`
- 通过 `@skill-name` 语法在对话中调用
- 支持技能参数（`@skill-name arg1 arg2`）

#### 4.4.8 认证存储（AuthStorage）

支持多种认证方式：
- **API Key**：直接存储在 `auth.json` 中
- **OAuth**：GitHub Copilot、Google 等 OAuth 流程
- **运行时 API Key**：通过 `--api-key` 传入

#### 4.4.9 配置路径

所有用户数据存储在 `~/.pi/agent/`（可通过环境变量覆盖）：
```
~/.pi/agent/
├── auth.json           # 认证信息
├── settings.json       # 用户设置
├── models.json         # 自定义模型
├── sessions/           # 会话文件
├── themes/             # 自定义主题
├── tools/              # 自定义工具
├── prompts/            # 提示词模板
└── <app>-debug.log     # 调试日志
```

#### 4.4.10 关键依赖

- `@mariozechner/jiti`：JIT 编译（用于加载扩展）
- `@fitclaw/agent-core`：Agent 运行时
- `@fitclaw/ai`：LLM API
- `@fitclaw/pods-tui`：TUI 库
- `@silvia-odwyer/photon-node`：图像处理
- `chalk`：终端颜色
- `cli-highlight`：代码高亮
- `diff`：文本差异
- `extract-zip`：ZIP 解压
- `file-type`：文件类型检测
- `glob` / `minimatch`：文件匹配
- `marked`：Markdown 渲染
- `proper-lockfile`：文件锁
- `strip-ansi`：ANSI 剥离
- `undici`：HTTP 客户端
- `uuid`：UUID 生成
- `yaml`：YAML 解析

---

### 4.5 packages/web-ui — Web UI 组件

基于 **Lit**（Web Components）的 AI 聊天界面组件库。

#### 4.5.1 核心组件

- **ChatPanel**：主聊天面板，集成消息列表、输入框、工具渲染
- **MessageList / Messages**：消息渲染（用户、助手、工具、Artifact）
- **AgentInterface**：Agent 交互接口
- **SandboxIframe**：沙箱 iframe，用于安全运行生成代码
- **ThinkingBlock**：思考/推理内容展示
- **Various Dialogs**：模型选择、设置、附件、API Key 输入等

#### 4.5.2 架构特点

- 使用 `@mariozechner/mini-lit` 和 `lit` 作为 peer dependency
- 支持自定义提供商（Custom Provider）配置
- 支持附件上传与渲染
- 支持多种 Artifact 类型（HTML、SVG、Markdown、Image、Text）
- 集成 IndexedDB 持久化存储
- 支持沙箱运行时（Artifacts、Attachments、Console、FileDownload）

#### 4.5.3 关键依赖

- `@fitclaw/ai` / `@fitclaw/pods-tui`
- `@lmstudio/sdk`：LM Studio 集成
- `ollama`：Ollama 集成
- `pdfjs-dist`：PDF 渲染
- `lucide`：图标
- `docx-preview`：DOCX 预览
- `jszip`：ZIP 处理
- `xlsx`：Excel 处理
- Tailwind CSS 用于样式

---

### 4.6 packages/mom — Slack Bot

**Mom** 是一个 Slack Bot，将 Slack 消息委托给 coding agent 处理。

#### 4.6.1 架构

```
Slack Socket Mode → SlackBot → MomHandler → AgentRunner
                                    ↓
                              ChannelStore (持久化)
```

#### 4.6.2 核心模块

- **main.ts**：CLI 入口，解析参数，启动 SlackBot 和 EventWatcher
- **slack.ts**：Slack 客户端封装（Socket Mode、Web API）
- **agent.ts**：AgentRunner，封装 coding agent 的执行逻辑
- **events.ts**：文件系统事件监听器（用于外部触发）
- **context.ts**：Slack 上下文适配（消息发送、文件上传、线程回复等）
- **store.ts**：ChannelStore，按频道持久化数据
- **sandbox.ts**：沙箱配置（host 或 docker）
- **tools/**：Mom 特有的工具（如下载频道历史）

#### 4.6.3 环境变量

```bash
MOM_SLACK_APP_TOKEN=      # Slack App Token (Socket Mode)
MOM_SLACK_BOT_TOKEN=      # Slack Bot Token (Web API)
```

#### 4.6.4 关键依赖

- `@slack/socket-mode` / `@slack/web-api`：Slack SDK
- `@fitclaw/claw`：复用 coding agent 核心
- `@anthropic-ai/sandbox-runtime`：沙箱运行时
- `croner`：定时任务
- `diff`：文本差异

---

### 4.7 packages/pods — vLLM GPU Pod 管理

**pi-pods** 是一个 CLI 工具，用于在远程 GPU 服务器（Pod）上管理 vLLM 部署。

#### 4.7.1 功能

- **Pod 管理**：`pi pods setup/list/active/remove`
- **SSH/Shell**：`pi shell`、`pi ssh`
- **模型生命周期**：`pi start/stop/list/logs`
- **Agent 聊天**：`pi agent <model> [messages...]`

#### 4.7.2 核心模块

- **cli.ts**：命令解析与分发
- **commands/pods.ts**：Pod CRUD
- **commands/models.ts**：模型启动/停止/日志
- **commands/prompt.ts**：Agent 聊天模式
- **config.ts**：配置加载
- **ssh.ts**：SSH 命令执行与流式输出
- **models.json**：预定义模型配置

#### 4.7.3 环境变量

```bash
HF_TOKEN         # HuggingFace Token
PI_API_KEY       # vLLM API Key
PI_CONFIG_DIR    # 配置目录（默认 ~/.pi）
```

---

## 五、数据流与交互流程

### 5.1 交互式编码 Agent 完整流程

```
[User Input]
    ↓
[CLI args.ts] 解析参数 (--model, --provider, --session, etc.)
    ↓
[main.ts]
    - 创建 SessionManager（新建/恢复/分叉会话）
    - 创建 SettingsManager
    - 创建 AuthStorage
    - 加载扩展与技能（ResourceLoader）
    - 解析模型范围（ModelRegistry）
    - 创建 AgentSessionRuntime
    ↓
[AgentSession]
    - 初始化 Agent（@fitclaw/agent-core）
    - 绑定工具（read/bash/edit/write/grep/find/ls）
    - 设置系统提示词
    - 绑定事件监听（UI 更新、工具执行等）
    ↓
[InteractiveMode]
    - 启动 TUI（@fitclaw/pods-tui）
    - 渲染聊天界面
    - 等待用户输入
    ↓
[User sends message]
    ↓
[AgentSession.prompt()]
    ↓
[Agent.prompt()]
    - 将消息加入 state.messages
    - 调用 runAgentLoop()
    ↓
[agent-loop.ts]
    1. emit "agent_start", "turn_start"
    2. 调用 streamSimple() → @fitclaw/ai
    3. pi-ai 根据 model.api 路由到对应 Provider
    4. Provider 调用上游 API（OpenAI/Anthropic/...）
    5. 流式返回 AssistantMessageEvent（text_delta, toolcall_start, ...）
    6. Agent 转发事件到 AgentSession
    7. AgentSession 更新 UI（通过 TUI 组件）
    8. 若消息包含 tool calls：
       - 串行或并行执行工具
       - 发出 tool_execution_start/update/end 事件
       - 将 tool results 加入上下文
       - 继续下一轮（continue）
    9. 若 agent 停止：检查 steering / follow-up 队列
    10. emit "agent_end"
    ↓
[SessionManager] 自动将消息追加到 JSONL 会话文件
    ↓
[Compaction] 若上下文过长，触发自动压缩（ summarize 旧消息 ）
```

### 5.2 工具执行流程

```
[AssistantMessage contains tool calls]
    ↓
[AgentLoopConfig.toolExecution = "parallel" | "sequential"]
    ↓
[prepareToolCall]
    - 查找工具定义
    - validateToolArguments（typebox schema 验证）
    - 调用 beforeToolCall 钩子（可 block）
    ↓
[executePreparedToolCall]
    - 调用 tool.execute(toolCallId, params, signal, onUpdate)
    - onUpdate 发送 tool_execution_update 事件（流式进度）
    ↓
[finalizeExecutedToolCall]
    - 调用 afterToolCall 钩子（可覆盖 result）
    ↓
[createToolResultMessage]
    - 构造 ToolResultMessage
    - emit tool_execution_end
    - emit message_start / message_end（tool result）
    - 加入上下文，继续 LLM 调用
```

### 5.3 扩展事件流

```
[Extension System]
    - 扩展通过 ExtensionRuntime 注册事件监听
    - 事件类型：
      - AgentStartEvent / AgentEndEvent
      - BeforeAgentStartEvent（可阻止启动）
      - BeforeProviderRequestEvent（可修改请求）
      - ToolCallEvent / ToolResultEvent
      - TurnStartEvent / TurnEndEvent
      - InputEvent（可拦截用户输入）
      - SessionBeforeCompactEvent / SessionCompactEvent
      - SessionBeforeForkEvent / SessionBeforeSwitchEvent
      - SessionBeforeTreeEvent / SessionTreeEvent
      - SessionShutdownEvent
```

---

## 六、开发指南

### 6.1 初始化开发环境

```bash
# 安装依赖
npm install

# 构建所有包（必须按顺序，因依赖关系）
npm run build

# 运行代码检查（lint + format + type check）
npm run check

# 运行测试
./test.sh

# 从源码运行 pi（可在任意目录执行）
./pi-test.sh
```

### 6.2 单包开发

```bash
# 进入具体包目录
cd packages/ai
npm run dev      # tsgo watch 模式
npm run build    # 编译
npm run test     # 运行测试
```

### 6.3 添加新 LLM 提供商（packages/ai）

根据 AGENTS.md 中的规范（非 GitHub 部分），添加新提供商需要修改：

1. **types.ts**：添加 API 标识符到 `KnownApi` 和 `KnownProvider`
2. **providers/<provider>.ts**：实现 `stream()` 和 `streamSimple()`
3. **providers/register-builtins.ts**：懒加载注册
4. **env-api-keys.ts**：添加凭证检测
5. **scripts/generate-models.ts**：添加模型生成逻辑
6. **package.json**：添加子路径导出
7. **coding-agent**：更新 model-resolver、CLI 参数文档、README

### 6.4 测试策略

- **单元测试**：Vitest，覆盖核心逻辑
- **集成测试**：流式 API 测试（stream.test.ts）、提供商矩阵测试
- **E2E 测试**：TUI 测试（使用 tmux 控制终端环境）
- **测试要求**：覆盖率 >= 80%

---

## 七、关键设计决策

### 7.1 为什么使用 typebox 而非 Zod

项目使用 `typebox`（`^1.1.24`）作为运行时类型验证库，而非更流行的 Zod。原因：
- typebox 生成标准 JSON Schema，天然兼容 LLM 工具调用格式
- 性能更优，包体积更小
- 项目早期选型，已形成惯性

### 7.2 为什么使用 tsgo 而非 tsc

tsgo 是一个更快的 TypeScript 编译器（可能是基于 Go 或 Rust 的实现）：
- 大幅缩短编译时间（对大型 monorepo 至关重要）
- 支持 watch 模式（`--watch --preserveWatchOutput`）
- 生成 `.d.ts` 和 source map

### 7.3 为什么使用 JSONL 而非数据库存会话

- 简单、可移植、可版本控制
- 每行一个事件，便于追加和读取
- 人类可读（可用 `cat` / `jq` 查看）
- 支持会话分叉（fork）只需复制文件

### 7.4 事件驱动架构

整个 Agent 和编码 Agent 采用事件驱动设计：
- 所有状态变更通过事件通知订阅者
- UI 组件订阅事件并更新视图
- 扩展系统通过事件 hook 进生命周期
- 便于调试（事件流可序列化）

---

## 八、复现检查清单

若另一个 Agent 需要复现此项目，需确保以下文件和结构完整：

### 8.1 必需文件（业务代码）

```
FitClaw/
├── package.json                    # root package.json（workspaces 定义）
├── tsconfig.base.json              # 基础 TS 配置
├── tsconfig.json                   # root TS 配置（paths 映射）
├── biome.json                      # Biome 配置
├── test.sh                         # 测试脚本
├── pi-test.sh                      # 源码运行脚本
├── scripts/                        # 构建/发布脚本
│   ├── check-browser-smoke.mjs
│   ├── cost.ts
│   ├── edit-tool-stats.mjs
│   ├── profile-coding-agent-node.mjs
│   ├── release.mjs
│   ├── session-transcripts.ts
│   └── sync-versions.js
├── packages/
│   ├── ai/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── api-registry.ts
│   │       ├── cli.ts
│   │       ├── env-api-keys.ts
│   │       ├── index.ts
│   │       ├── models.ts
│   │       ├── stream.ts
│   │       ├── types.ts
│   │       ├── providers/        # 所有提供商实现
│   │       └── utils/
│   ├── agent/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── agent.ts
│   │       ├── agent-loop.ts
│   │       ├── index.ts
│   │       ├── proxy.ts
│   │       └── types.ts
│   ├── coding-agent/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── cli.ts
│   │       ├── config.ts
│   │       ├── index.ts
│   │       ├── main.ts
│   │       ├── migrations.ts
│   │       ├── cli/
│   │       ├── core/
│   │       │   ├── agent-session.ts
│   │       │   ├── auth-storage.ts
│   │       │   ├── compaction/
│   │       │   ├── extensions/
│   │       │   ├── model-registry.ts
│   │       │   ├── model-resolver.ts
│   │       │   ├── resource-loader.ts
│   │       │   ├── sdk.ts
│   │       │   ├── session-manager.ts
│   │       │   ├── settings-manager.ts
│   │       │   ├── skills.ts
│   │       │   ├── system-prompt.ts
│   │       │   └── tools/
│   │       ├── modes/
│   │       │   ├── interactive/
│   │       │   ├── print-mode.ts
│   │       │   └── rpc/
│   │       └── utils/
│   ├── tui/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── components/
│   │       ├── tui.ts
│   │       ├── terminal.ts
│   │       ├── terminal-image.ts
│   │       ├── keys.ts
│   │       └── index.ts
│   ├── web-ui/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── ChatPanel.ts
│   │       ├── components/
│   │       ├── dialogs/
│   │       ├── prompts/
│   │       ├── storage/
│   │       ├── tools/
│   │       └── index.ts
│   ├── mom/
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── src/
│   │       ├── agent.ts
│   │       ├── main.ts
│   │       ├── slack.ts
│   │       └── tools/
│   └── pods/
│       ├── package.json
│       ├── tsconfig.build.json
│       └── src/
│           ├── cli.ts
│           ├── commands/
│           ├── config.ts
│           └── ssh.ts
```

### 8.2 可排除文件（GitHub / 平台相关）

以下文件**不应**包含在复现中：

```
.github/                      # GitHub 工作流、模板、门禁
CONTRIBUTING.md               # GitHub 贡献指南（纯流程）
AGENTS.md 中 GitHub 相关段落  # Issue/PR 操作、GitHub Actions 引用
```

---

## 九、附录：使用的 Skills / Plugins

在本次分析过程中，使用的工具与技能包括：

1. **`using-superpowers`**（Skill）：
   - 用于确认技能调用规则与流程
   - 确保在开发前检查适用的 skill

2. **代码探索工具**：
   - `Glob`：文件模式匹配（查找 `.json`, `.md`, `.ts` 文件）
   - `Grep`：代码搜索（查找符号、关键字）
   - `Read`：文件读取（读取核心源代码）
   - `Bash`：目录列表、环境检查

3. **任务管理**：
   - `TaskCreate` / `TaskUpdate`：跟踪探索与文档编写进度

---

*文档生成时间：2026-04-28*
*基于 FitClaw 项目源代码完整阅读*
