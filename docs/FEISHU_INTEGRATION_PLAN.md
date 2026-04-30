# FitClaw 接入飞书 Bot — 详细改造计划书

> 状态：待实施
> 前置条件：飞书开放平台已配置完毕（应用已创建，权限已导入，事件已订阅，版本已发布）
> Bot 名称：**FitCoach** | 平台：**中国区飞书** (`open.feishu.cn`)

---

## 一、架构现状

```
main.ts  ← 硬编码 SlackBot 启动
  ├── slack.ts      (SlackBot 类, SlackContext, MomHandler) ← 不动
  ├── agent.ts      (AgentRunner.run(ctx: SlackContext))    ← 需解耦 1 行
  ├── types.ts      (BotContext 接口 — 定义了但无人使用)    ← 需补齐方法
  └── adapters/feishu/
      ├── types.ts      (stub — throw Error)
      ├── listener.ts   (stub — throw Error)
      └── renderer.ts   (stub — throw Error)
```

**三大耦合点：**
1. `main.ts` 直接 `import { SlackBot }` 启动，无 provider 分发
2. `agent.ts` 的 `AgentRunner.run()` 参数类型写死 `SlackContext`
3. `MomHandler` 接口定义在 `slack.ts`，参数含 `SlackBot` — 飞书绕过此接口即可

---

## 二、改造策略

**原则：Slack 代码一行不改，飞书做并行适配层。改动最小化，约 +420 行 / -0 行。**

### 改动文件总览

| # | 文件 | 操作 | 改动量 |
|---|------|------|--------|
| 1 | `packages/mom/package.json` | 修改 | +1 dependency |
| 2 | `packages/mom/src/feishu.ts` | **新建** | ~300 行 |
| 3 | `packages/mom/src/types.ts` | 修改 | `BotContext` 补齐 4 个方法签名 |
| 4 | `packages/mom/src/agent.ts` | 修改 | 1 行 import + 1 行类型 |
| 5 | `packages/mom/src/main.ts` | 修改 | + ~120 行（Feishu 分支） |
| 6 | `packages/mom/src/adapters/feishu/` | 删除 | 3 个 stub 文件 |

**不动的文件：** `slack.ts`, `store.ts`, `context.ts`, `sandbox.ts`, `events.ts`, `tools/`, `log.ts`

---

## 三、详细步骤

### Step 1: 安装 SDK 依赖

```bash
npm install @larksuiteoapi/node-sdk --workspace=packages/mom
```

在 `packages/mom/package.json` 的 `dependencies` 中新增：
```json
"@larksuiteoapi/node-sdk": "^1.30.0"
```

**SDK 关键类：**

| 类 | 用途 |
|----|------|
| `Lark.Client` | HTTP API 调用（发消息、下载文件），自动管理 `tenant_access_token` |
| `Lark.WSClient` | WebSocket 长连接（接收事件），`autoReconnect: true`（默认），无需公网 URL |
| `Lark.EventDispatcher` | 注册 `im.message.receive_v1` 事件处理器 |

---

### Step 2: 新建 `src/feishu.ts` — 飞书适配层 (~300 行)

对标 `slack.ts` 的 `SlackBot` 类设计。

#### 2.1 类型定义

```typescript
/** 飞书消息事件（从 im.message.receive_v1 解析后的结构化数据） */
export interface FeishuEvent {
  type: "mention" | "dm";             // 群聊@ = "mention", 私聊 = "dm"
  chatId: string;                     // 聊天 ID（群聊/私聊统一标识）
  messageId: string;                  // 消息 ID，用于话题回复&文件下载
  user: {
    openId: string;                   // 用户在当前应用下的唯一标识
    userId?: string;                  // 用户 user_id（如有）
    name?: string;                    // 用户姓名（如有）
  };
  text: string;                       // 纯文本内容（已去掉 @mention 标记）
  files?: Array<{
    messageId: string;                // 所属消息 ID（下载时必需）
    fileKey: string;                  // 飞书文件 key
    fileName?: string;
    type: "image" | "file";          // 文件类型（下载 API 参数）
    downloadedPath?: string;          // 下载后的本地路径（处理后填充）
  }>;
}

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;                   // Bot 名称，用于 @检测（默认 "FitCoach"）
}
```

#### 2.2 FeishuBot 类

```typescript
export class FeishuBot {
  private client: Lark.Client;        // HTTP API 客户端
  private wsClient: Lark.WSClient;    // WebSocket 长连接客户端
  private handler?: (event: FeishuEvent) => Promise<void>;
  private readonly downloadDir: string;
  private readonly botName: string;

  constructor(config: FeishuConfig, downloadDir: string) {
    this.botName = config.botName || "FitCoach";
    this.downloadDir = join(downloadDir, "downloads");

    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Lark.Domain.Feishu,     // 中国区飞书
    });

    this.wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: Lark.Domain.Feishu,
      autoReconnect: true,             // 默认值，显式声明
    });
  }
```

#### 2.3 关键方法

**消息处理器注册：**
```typescript
onMessage(handler: (event: FeishuEvent) => Promise<void>): void {
  this.handler = handler;
}
```

**启动 WebSocket 长连接：**
```typescript
async start(): Promise<void> {
  await mkdir(this.downloadDir, { recursive: true });

  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: any) => {
      await this.handleMessage(data);
    },
  });

  this.wsClient.start({ eventDispatcher: dispatcher });
  log.info("Feishu WebSocket client started, waiting for events...");
}
```

**核心：消息解析与 @检测（修正版）**

指南中的 `isMention` 检测有 bug（`m.id?.open_id` 恒为真）。修正为比较 Bot 名称：

```typescript
private async handleMessage(data: any): Promise<void> {
  const msg = data.message;
  const sender = data.sender;
  if (!msg || !sender) return;

  // content 是 JSON 字符串，必须 parse
  let content: Record<string, any> = {};
  try {
    content = JSON.parse(msg.content || "{}");
  } catch {
    content = { text: msg.content || "" };
  }

  const rawText: string = content.text || "";
  const chatType: string = msg.chat_type;           // "p2p" | "group"
  const mentions: Array<any> = msg.mentions || [];

  // ✅ 正确逻辑：检查 Bot 自身是否被 @
  // mentions 中每项包含 key (如 "@_user_1") 和 name (用户/Bot 的名称)
  const isBotMentioned = mentions.some((m: any) => m.name === this.botName);

  // 群聊：只处理 @Bot 的消息；私聊：全部处理
  if (chatType === "group" && !isBotMentioned) {
    log.info("Ignoring group message without bot mention");
    return;
  }

  // 去掉 text 中的 @mention 标记，提取纯用户输入
  let cleanText = rawText;
  for (const m of mentions) {
    if (m.key && cleanText.includes(m.key)) {
      cleanText = cleanText.replace(m.key, "").trim();
    }
  }

  // 构造 FeishuEvent
  const event: FeishuEvent = {
    type: chatType === "p2p" ? "dm" : "mention",
    chatId: msg.chat_id,
    messageId: msg.message_id,
    user: {
      openId: sender.sender_id?.open_id || "unknown",
      userId: sender.sender_id?.user_id,
      name: sender.sender_id?.name,
    },
    text: cleanText,
    files: this.extractFiles(msg.message_id, content, msg),
  };

  if (this.handler) {
    await this.handler(event);
  }
}
```

**提取文件信息：**
```typescript
private extractFiles(messageId: string, content: Record<string, any>, msg: any)
  : FeishuEvent["files"] {
  const files: FeishuEvent["files"] = [];

  if (content.image_key) {
    files.push({
      messageId,
      fileKey: content.image_key,
      fileName: msg.image_name || "image",
      type: "image",
    });
  }
  if (msg.file_key) {
    files.push({
      messageId,
      fileKey: msg.file_key,
      fileName: msg.file_name,
      type: "file",
    });
  }
  return files.length > 0 ? files : undefined;
}
```

**发送消息 API：**
```typescript
/** 发送文本消息到指定聊天。返回 message_id 用于后续更新 */
async sendMessage(chatId: string, text: string): Promise<string> {
  const res = await this.client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
  return (res as any)?.data?.message_id ?? "";
}
```

**更新消息（流式效果）：**
```typescript
async updateMessage(messageId: string, text: string): Promise<void> {
  await this.client.im.v1.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify({ text }) },
  });
}
```

**话题回复（详细日志）：**
```typescript
async sendThreadMessage(chatId: string, parentMessageId: string, text: string): Promise<void> {
  await this.client.im.v1.message.reply({
    path: { message_id: parentMessageId },
    data: {
      content: JSON.stringify({ text }),
      msg_type: "text",
    },
  });
}
```

> ⚠️ 注意：飞书 SDK 中 topic 回复应使用 `message.reply()` 而非 `message.create({ reply_in_thread })`。实际编码时需根据 SDK 版本确认 API 签名。

**文件下载（修正版）：**

指南使用 `client.im.resource.get()` — API 路径不正确。正确用法：
```typescript
async downloadFile(messageId: string, fileKey: string, type: "image" | "file"): Promise<string> {
  try {
    const resp = await this.client.im.message.resource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    });

    const ext = type === "image" ? "png" : "bin";
    const safeName = `${Date.now()}_${fileKey.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;
    const localPath = join(this.downloadDir, safeName);

    await resp.writeFile(localPath);
    log.info(`Downloaded file to ${localPath}`);
    return localPath;
  } catch (err: any) {
    log.error(`Failed to download file ${fileKey}: ${err.message}`);
    throw err;
  }
}
```

---

### Step 3: 更新 `src/types.ts` — 补齐 BotContext 接口

当前 `BotContext` 缺少 `replaceMessage`、`setWorking`、`deleteMessage`、`uploadFile` 方法。补齐为：

```typescript
export interface BotContext {
  message: BotMessage;
  channelName?: string;
  channels: BotChannel[];
  users: BotUser[];
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;    // 新增
  respondInThread: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => Promise<void>;
  uploadFile: (filePath: string, title?: string) => Promise<void>;  // 新增
  setWorking: (working: boolean) => Promise<void>;    // 新增
  deleteMessage: () => Promise<void>;                 // 新增
}
```

---

### Step 4: 解耦 `src/agent.ts` — AgentRunner 使用 BotContext

**改动量：2 行。**

改前（`src/agent.ts` line 30-43）：
```typescript
import type { SlackContext } from "./slack.js";

export interface AgentRunner {
  run(
    ctx: SlackContext,
    store: ChannelStore,
    pendingMessages?: PendingMessage[],
  ): Promise<{ stopReason: string; errorMessage?: string }>;
  abort(): void;
}
```

改后：
```typescript
import type { BotContext } from "./types.js";

export interface AgentRunner {
  run(
    ctx: BotContext,
    store: ChannelStore,
    pendingMessages?: PendingMessage[],
  ): Promise<{ stopReason: string; errorMessage?: string }>;
  abort(): void;
}
```

**验证：** `AgentRunner.run()` 内部实际访问的 ctx 字段和方法的完整列表：

| ctx 字段/方法 | SlackContext | BotContext（新） | FeishuContext |
|--------------|-------------|-----------------|---------------|
| `ctx.message.ts` | ✅ | ✅ | ✅ |
| `ctx.message.channel` | ✅ | ✅ | ✅ |
| `ctx.message.text` | ✅ | ✅ | ✅ |
| `ctx.message.userName` | ✅ | ✅ | ✅ |
| `ctx.channelName` | ✅ | ✅ | ✅ |
| `ctx.channels` | ✅ | ✅ | ✅ |
| `ctx.users` | ✅ | ✅ | ✅ |
| `ctx.uploadFile()` | ✅ | ✅ | ✅ |
| `ctx.respond()` | ✅ | ✅ | ✅ |
| `ctx.respondInThread()` | ✅ | ✅ | ✅ |

全部对齐，**零风险**。

---

### Step 5: 重构 `src/main.ts` — Provider 分发

#### 5.1 新增环境变量读取

```typescript
const MOM_FEISHU_APP_ID = process.env.MOM_FEISHU_APP_ID;
const MOM_FEISHU_APP_SECRET = process.env.MOM_FEISHU_APP_SECRET;
const MOM_FEISHU_BOT_NAME = process.env.MOM_FEISHU_BOT_NAME || "FitCoach";
```

#### 5.2 新增 `createFeishuContext()` 函数

对标现有 `createSlackContext()`（line 114-274），返回 `BotContext`。核心逻辑：

```typescript
function createFeishuContext(
  event: FeishuEvent,
  bot: FeishuBot,
  state: ChannelState
): BotContext {
  let messageId: string | null = null;
  let accumulatedText = "";
  let isWorking = true;
  const workingIndicator = " ...";
  let updatePromise = Promise.resolve();

  return {
    message: {
      text: event.text,
      rawText: event.text,
      user: event.user.openId,
      userName: event.user.name,
      channel: event.chatId,                 // 对齐 Slack 的 channel 字段
      ts: event.messageId,                   // 对齐 Slack 的 ts 字段
      attachments: (event.files || []).map(f => ({ local: f.downloadedPath || "" })),
    },
    channels: [],    // 飞书无 channel 列表概念
    users: event.user.name
      ? [{ id: event.user.openId, userName: event.user.name, displayName: event.user.name }]
      : [],

    respond: async (text, shouldLog = true) => {
      updatePromise = updatePromise.then(async () => {
        accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;
        const MAX_MAIN_LENGTH = 30000;   // 飞书 30KB 限制（Slack 40KB）
        if (accumulatedText.length > MAX_MAIN_LENGTH) {
          accumulatedText = accumulatedText.substring(0, MAX_MAIN_LENGTH - 50) + "\n\n_(已截断)_";
        }
        const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
        if (messageId) {
          await bot.updateMessage(messageId, displayText);
        } else {
          messageId = await bot.sendMessage(event.chatId, displayText);
        }
      });
      await updatePromise;
    },

    replaceMessage: async (text) => {
      updatePromise = updatePromise.then(async () => {
        accumulatedText = text;
        const displayText = isWorking ? text + workingIndicator : text;
        if (messageId) {
          await bot.updateMessage(messageId, displayText);
        } else {
          messageId = await bot.sendMessage(event.chatId, displayText);
        }
      });
      await updatePromise;
    },

    respondInThread: async (text) => {
      updatePromise = updatePromise.then(async () => {
        if (messageId) {
          const MAX_THREAD_LENGTH = 20000;
          const threadText = text.length > MAX_THREAD_LENGTH
            ? text.substring(0, MAX_THREAD_LENGTH - 50) + "\n\n_(已截断)_"
            : text;
          await bot.sendThreadMessage(event.chatId, event.messageId, threadText);
        }
      });
      await updatePromise;
    },

    setTyping: async () => {
      if (!messageId) {
        accumulatedText = "_思考中_";
        messageId = await bot.sendMessage(event.chatId, accumulatedText + workingIndicator);
      }
    },

    uploadFile: async (filePath, title) => {
      // 飞书文件上传（首版可为空实现，后续完善）
      log.warn(`Feishu uploadFile not implemented: ${filePath}`);
    },

    setWorking: async (working) => {
      updatePromise = updatePromise.then(async () => {
        isWorking = working;
        if (messageId) {
          const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
          await bot.updateMessage(messageId, displayText);
        }
      });
      await updatePromise;
    },

    deleteMessage: async () => {
      // 飞书消息删除（首版可为空实现）
    },
  };
}
```

#### 5.3 新增 `runFeishuMode()` 函数

```typescript
async function runFeishuMode() {
  if (!MOM_FEISHU_APP_ID || !MOM_FEISHU_APP_SECRET) {
    console.error("Missing required environment variables:");
    console.error("  MOM_FEISHU_APP_ID");
    console.error("  MOM_FEISHU_APP_SECRET");
    process.exit(1);
  }

  const config: FeishuConfig = {
    appId: MOM_FEISHU_APP_ID,
    appSecret: MOM_FEISHU_APP_SECRET,
    botName: MOM_FEISHU_BOT_NAME,
  };

  const bot = new FeishuBot(config, workingDir);

  bot.onMessage(async (event) => {
    // 下载附件到本地
    if (event.files) {
      for (const f of event.files) {
        try {
          f.downloadedPath = await bot.downloadFile(f.messageId, f.fileKey, f.type);
        } catch (err) {
          log.error(`Failed to download attachment: ${err}`);
        }
      }
    }

    const state = getState(event.chatId);
    state.running = true;

    log.logInfo(`[${event.chatId}] Feishu ${event.type}: ${event.text.substring(0, 50)}`);

    try {
      const ctx = createFeishuContext(event, bot, state);
      await ctx.setTyping(true);
      await ctx.setWorking(true);
      const result = await state.runner.run(ctx, state.store);
      await ctx.setWorking(false);

      if (result.errorMessage) {
        await ctx.respond(`❌ 执行出错：${result.errorMessage}`);
      }
    } catch (err) {
      log.logWarning(`[${event.chatId}] Run error`, err instanceof Error ? err.message : String(err));
    } finally {
      state.running = false;
    }
  });

  await bot.start();
  log.info("FitClaw Feishu Bot (FitCoach) is running. Press Ctrl+C to exit.");
  await new Promise(() => {}); // 永久阻塞
}
```

#### 5.4 启动入口改为条件分支

将 `main.ts` 末尾的 Slack 启动代码（line 338-367）包裹在 `else` 分支中：

```typescript
log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

if (MOM_FEISHU_APP_ID) {
  // === 飞书模式 ===
  await runFeishuMode();
} else if (MOM_SLACK_APP_TOKEN && MOM_SLACK_BOT_TOKEN) {
  // === Slack 模式（原有代码，一行不改）===
  const sharedStore = new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN! });
  const bot = new SlackBotClass(handler, {
    appToken: MOM_SLACK_APP_TOKEN,
    botToken: MOM_SLACK_BOT_TOKEN,
    workingDir,
    store: sharedStore,
  });
  const eventsWatcher = createEventsWatcher(workingDir, bot);
  eventsWatcher.start();
  process.on("SIGINT", () => { eventsWatcher.stop(); process.exit(0); });
  process.on("SIGTERM", () => { eventsWatcher.stop(); process.exit(0); });
  bot.start();
} else {
  console.error("No bot platform configured.");
  console.error("  Feishu: MOM_FEISHU_APP_ID + MOM_FEISHU_APP_SECRET");
  console.error("  Slack: MOM_SLACK_APP_TOKEN + MOM_SLACK_BOT_TOKEN");
  process.exit(1);
}
```

---

### Step 6: 删除 stub 文件

```bash
rm packages/mom/src/adapters/feishu/types.ts
rm packages/mom/src/adapters/feishu/listener.ts
rm packages/mom/src/adapters/feishu/renderer.ts
rmdir packages/mom/src/adapters/feishu
```

---

## 四、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MOM_FEISHU_APP_ID` | ✅ | 飞书 App ID（`cli_a...`） |
| `MOM_FEISHU_APP_SECRET` | ✅ | 飞书 App Secret |
| `MOM_FEISHU_BOT_NAME` | ❌ | Bot 名称，用于 @检测（默认 "FitCoach"） |
| `ANTHROPIC_API_KEY` | ✅ | LLM API Key |
| `MOM_SLACK_APP_TOKEN` | ❌ | Slack 模式（兼容，与飞书互斥） |
| `MOM_SLACK_BOT_TOKEN` | ❌ | Slack 模式（兼容，与飞书互斥） |

---

## 五、启动命令

```bash
cd D:/Code/Project/FitClaw
npm install -w packages/mom
npm run build -w packages/mom

export MOM_FEISHU_APP_ID="cli_xxxxxxxx"
export MOM_FEISHU_APP_SECRET="xxxxxxxx"
export ANTHROPIC_API_KEY="sk-ant-..."

node packages/mom/dist/main.js ./feishu-workspace
```

**预期启动日志：**
```
[info]: FitClaw Feishu Bot (FitCoach) starting...
[info]: Feishu WebSocket client started, waiting for events...
[info]: [ '[ws]', 'ws client ready' ]
[info]: FitClaw Feishu Bot (FitCoach) is running. Press Ctrl+C to exit.
```

---

## 六、验证清单

| # | 测试场景 | 预期结果 |
|---|---------|---------|
| 1 | 启动 bot | 控制台输出 `ws client ready` |
| 2 | 飞书私聊 "你好，请介绍一下自己" | Bot 回复（身份为 FitClaw 健身私教） |
| 3 | 群聊 @FitCoach "今天练什么" | Bot 在群里回复 |
| 4 | 群聊不 @ 直接发消息 | Bot **不**回复 |
| 5 | 私聊发送图片/文件 | Bot 下载到 `./feishu-workspace/<chatId>/downloads/` |
| 6 | Slack 模式回归 | 设置 `MOM_SLACK_APP_TOKEN` + `MOM_SLACK_BOT_TOKEN`，走原有 Slack 逻辑 |
| 7 | Ctrl+C 退出 | Bot 正常关闭 |

---

## 七、对参考指南的修正

对照官方 SDK 文档 (`@larksuiteoapi/node-sdk` DeepWiki) 和实际源代码验证后，发现参考指南 (`pi-mono-feishu-detailed-guide.md`) 存在以下问题，已在本文档中修正：

| # | 问题 | 指南写法 | 本计划修正 |
|---|------|---------|-----------|
| 1 | **文件下载 API** | `client.im.resource.get({ params: { file_key } })` | `client.im.message.resource.get({ path: { message_id, file_key }, params: { type } })` — 需 message_id + type 参数 |
| 2 | **@提及检测** | `mentions.some(m => m.id?.open_id)` — 恒为真 | `mentions.some(m => m.name === this.botName)` — 比较 Bot 名称 |
| 3 | **AgentRunner 类型** | `runner.run(ctx as any)` — 绕开类型检查 | 改 AgentRunner 接口签名 `SlackContext` → `BotContext`（2 行） |
| 4 | **话题回复 API** | `message.create({ reply_in_thread: true })` | `message.reply({ path: { message_id } })` — 使用正确 API |

---

## 八、风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| SDK 版本差异（指南 v1.30 vs 最新 v1.60） | API 签名可能不同 | 编码时对照 `@larksuiteoapi/node-sdk` 实际导出确认 |
| 飞书文本消息 30KB 限制 | 长回复截断 | `respond` 中已做截断处理（同 Slack 40KB 限制模式） |
| PATCH 频率限制 ~5 QPS | 流式更新过快可能被限 | 建议按 100 字符/批或 1-2 秒间隔更新 |
| WebSocket 断线 | 消息丢失 | SDK `autoReconnect: true` 自动重连 |
| 飞书 topic 回复必须用 `message.reply` | 用 `message.create` 无法正确回复 | 编码时验证 API 签名 |
