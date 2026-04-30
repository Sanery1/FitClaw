
```FitClaw/FEISHU_INTEGRATION_CORRECTIONS.md#L1-300
# FitClaw 飞书集成计划修正文档

> 基于对 `FEISHU_INTEGRATION_PLAN.md`、`pi-mono-feishu-detailed-guide.md` 及当前代码库的对比分析，列出所有需要修正的问题。
>
> 严重程度：**Critical**（编译失败或运行崩溃）/ **High**（逻辑错误，行为不符预期）/ **Medium**（与计划描述不符）/ **Low**（规范问题）

---

## 问题一：`types.ts` 现状分析有误 [Medium]

### 原因

`FEISHU_INTEGRATION_PLAN.md` Step 3 声称 `BotContext` 缺少 4 个方法（`replaceMessage`、`setWorking`、`deleteMessage`、`uploadFile`），但实际当前文件已包含其中 3 个：

```typescript
// packages/mom/src/types.ts - 当前实际内容
export interface BotContext {
    respond: (text: string) => Promise<void>;           // 已存在，但签名不完整
    respondInThread: (text: string) => Promise<void>;
    setTyping: (isTyping: boolean) => Promise<void>;
    uploadFile: (filePath: string, title?: string) => Promise<void>;  // 已存在
    setWorking: (working: boolean) => Promise<void>;    // 已存在
    deleteMessage: () => Promise<void>;                 // 已存在
    // replaceMessage 确实缺失
}
```

### 实际缺失项

| 缺失项 | 说明 |
|--------|------|
| `replaceMessage(text: string): Promise<void>` | 确实缺失 |
| `respond` 的 `shouldLog?` 参数 | `agent.ts` 内部调用 `ctx.respond(text, false)`，`BotContext` 签名中缺少此参数 |

### 解决办法

```typescript
// packages/mom/src/types.ts - 只需改这两处

export interface BotContext {
    message: BotMessage;
    channelName?: string;
    channels: BotChannel[];
    users: BotUser[];
    respond: (text: string, shouldLog?: boolean) => Promise<void>;  // 补 shouldLog
    replaceMessage: (text: string) => Promise<void>;                // 新增
    respondInThread: (text: string) => Promise<void>;
    setTyping: (isTyping: boolean) => Promise<void>;
    uploadFile: (filePath: string, title?: string) => Promise<void>;
    setWorking: (working: boolean) => Promise<void>;
    deleteMessage: () => Promise<void>;
}
```

---

## 问题二：`agent.ts` 中 `ChannelInfo`/`UserInfo` 未迁移 [Critical]

### 原因

计划书 Step 4 只提到将 `SlackContext` 改为 `BotContext`，但 `agent.ts` 第 22 行还 import 了 `ChannelInfo` 和 `UserInfo`：

```typescript
// packages/mom/src/agent.ts - 当前第 22 行
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";
```

这两个类型用于 `buildSystemPrompt()` 函数签名和 `AgentRunner.run()` 的 ctx 参数。若只改 `SlackContext` 而不改这两个，飞书模式下若 `slack.ts` 被条件性剔除则编译失败。

`types.ts` 中已有等价类型：

| `slack.ts` | `types.ts` | 字段 |
|------------|-----------|------|
| `ChannelInfo { id, name }` | `BotChannel { id, name }` | 完全相同 |
| `UserInfo { id, userName, displayName }` | `BotUser { id, userName?, displayName? }` | 兼容 |

### 解决办法

```typescript
// 改前（agent.ts line 22）
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";

// 改后
import type { BotChannel, BotContext, BotUser } from "./types.js";
```

同时全局替换：
- `SlackContext` → `BotContext`（位置：`AgentRunner.run()` 签名）
- `ChannelInfo` → `BotChannel`（位置：`buildSystemPrompt()` 签名）
- `UserInfo` → `BotUser`（位置：`buildSystemPrompt()` 签名）

---

## 问题三：`ChannelStore` 在飞书模式下会崩溃 [Critical]

### 原因

`main.ts` 的 `getState()` 函数用非空断言构造 `ChannelStore`：

```typescript
store: new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN! }),
```

飞书模式下 `MOM_SLACK_BOT_TOKEN` 为 `undefined`，`botToken` 实际是 `undefined`。`ChannelStore.downloadAttachment()` 中：

```typescript
Authorization: `Bearer ${this.botToken}`,  // 变为 "Bearer undefined"
```

虽然飞书模式下 `processAttachments()` 不会被调用（附件由 `FeishuBot.downloadFile()` 提前处理），但 TypeScript 严格模式下构造时的类型不匹配会产生编译警告，且 `ChannelStoreConfig.botToken` 要求 `string` 非 optional。

### 解决办法

```typescript
// packages/mom/src/store.ts

export interface ChannelStoreConfig {
    workingDir: string;
    botToken?: string;  // 改为可选
}

// downloadAttachment 加防护
private async downloadAttachment(localPath: string, url: string): Promise<void> {
    if (!this.botToken) {
        log.logWarning("ChannelStore: botToken not set, skipping download", localPath);
        return;
    }
    // ... 原有逻辑不变
}
```

`main.ts` 中去掉非空断言：

```typescript
store: new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN }),
```

---

## 问题四：`events.ts` 对 `SlackBot` 的硬依赖未处理 [High]

### 原因

`EventsWatcher` 构造函数强依赖 `SlackBot`：

```typescript
// packages/mom/src/events.ts
constructor(
    private eventsDir: string,
    private slack: SlackBot,  // Slack 专用
) {}
```

内部构造 `SlackEvent` 合成事件并调用 `this.slack.enqueueEvent()`，无法对接 `FeishuBot`。

计划书的 `runFeishuMode()` 完全跳过了 `createEventsWatcher()` 调用，即飞书模式下**定时事件功能完全不可用**，但计划书中未注明这是已知限制。

### 解决办法

**首版（最小改动）：** 在 `runFeishuMode()` 内添加注释，明确标注限制：

```typescript
async function runFeishuMode() {
    // NOTE: Events watcher (scheduled/periodic events) is not supported in Feishu mode.
    // EventsWatcher is tightly coupled to SlackBot. This is a known limitation for v1.
    // ...
}
```

**二期完整修复：** 提取最小接口解耦：

```typescript
// packages/mom/src/events.ts 新增
export interface IBotEventEmitter {
    enqueueEvent(event: { channelId: string; text: string; ts: string }): boolean;
}

// EventsWatcher 构造函数改为接收 IBotEventEmitter
constructor(private eventsDir: string, private bot: IBotEventEmitter) {}
```

`SlackBot` 已实现兼容（字段超集），`FeishuBot` 同样实现即可。

---

## 问题五：`@mention` 检测逻辑错误——计划书识别了 Bug 但自身代码重复了它 [High]

### 原因

`FEISHU_INTEGRATION_PLAN.md` Section 7 正确指出参考指南中 `mentions.some(m => m.id?.open_id)` 恒为真的问题。但计划书自己的 `feishu.ts`（Step 2.3）代码仍然写的是：

```typescript
// 计划书 feishu.ts - 仍然有同样的错误
const isMention = mentions.some((m: any) => {
    return m.id?.union_id || m.id?.open_id;  // 只要 id 存在就为真
});
```

且 `FeishuBotImpl` 构造函数中没有接收 `botName` 参数，无从比较。

### 解决办法

`FeishuBotImpl` 接收 `botName`，`handleMessage` 中比较名称：

```typescript
export class FeishuBotImpl {
    constructor(
        private config: { appId: string; appSecret: string; botName: string },
        private workingDir: string,
    ) { ... }

    private async handleMessage(data: unknown): Promise<void> {
        // ...
        const mentions = (msg as Record<string, unknown>).mentions as
            Array<{ key?: string; name?: string }> || [];

        // 正确检测：按 bot 名称匹配
        const isMention = mentions.some((m) => m.name === this.config.botName);

        if (chatType === "group" && !isMention) return;

        // 清除 @标签
        let cleanText = rawText;
        for (const m of mentions) {
            if (m.key) cleanText = cleanText.replace(m.key, "").trim();
        }
    }
}
```

---

## 问题六：`downloadFile` API 错误——计划书识别了 Bug 但自身代码重复了它 [High]

### 原因

`FEISHU_INTEGRATION_PLAN.md` Section 7 正确指出应使用 `client.im.message.resource.get()`，但计划书自己的 `feishu.ts` 代码仍然写的是：

```typescript
// 计划书 feishu.ts - 仍然错误
const res = await this.client.im.resource.get({
    params: { file_key: fileKey },
});
```

此外，`FeishuEvent.files` 元素（参考指南版本）只有 `fileKey`/`fileName`/`mimeType`，**没有 `messageId`**，而正确 API 需要 `message_id`。计划书 Step 2.1 的类型定义有 `messageId` 字段，但 `downloadFile` 方法签名却只接受 `fileKey` 和 `mimeType`，两处不一致。

### 解决办法

**1. `FeishuEvent.files` 元素必须含 `messageId`：**

```typescript
export interface FeishuEvent {
    files?: Array<{
        messageId: string;       // 下载 API 必需，值为所在消息的 message_id
        fileKey: string;
        fileName?: string;
        type: "image" | "file";  // 下载 API 必需
        downloadedPath?: string;
    }>;
}
```

**2. `downloadFile` 使用正确 API：**

```typescript
async downloadFile(messageId: string, fileKey: string, type: "image" | "file"): Promise<string> {
    const res = await this.client.im.message.resource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
    });
    // 写入本地文件...
}
```

---

## 问题七：`sendThreadMessage` API 错误——计划书内部矛盾 [High]

### 原因

`FEISHU_INTEGRATION_PLAN.md` Section 7 正确指出话题回复应用 `message.reply`。但计划书自己的 `feishu.ts` 代码仍然写的是：

```typescript
// 计划书 feishu.ts - 错误的话题回复
await this.client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },  // chat_id 模式下 reply_in_thread 无效
    data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        reply_in_thread: true,
    },
});
```

`message.create` + `chat_id` + `reply_in_thread: true` 的组合不能实现线程回复，实际只是发了一条普通消息。

### 解决办法

```typescript
async sendThreadMessage(parentMessageId: string, text: string): Promise<void> {
    await this.client.im.message.reply({
        path: { message_id: parentMessageId },
        data: {
            content: JSON.stringify({ text }),
            msg_type: "text",
            reply_in_thread: true,
        },
    });
}
```

注意：参数签名去掉了 `chatId`，`message.reply` 通过 `message_id` 定位，不需要 `chat_id`。调用方 `main.ts` 中 `respondInThread` 的实现需同步修改。

---

## 问题八：`ChannelStore.getDir()` 方法不存在 [Critical]

### 原因

参考指南的 `FeishuBotImpl` 构造函数中有：

```typescript
this.downloadDir = join(store.getDir(), "downloads");
```

但 `ChannelStore` 中**不存在 `getDir()` 方法**，只有 `getChannelDir(channelId)` 和私有的 `workingDir`。编译时直接报错。

### 解决办法

`FeishuBotImpl` 不依赖 `ChannelStore` 获取工作目录，直接接收 `workingDir`：

```typescript
export class FeishuBotImpl {
    private readonly downloadDir: string;

    constructor(
        private config: { appId: string; appSecret: string; botName: string },
        workingDir: string,  // 直接传入
    ) {
        this.downloadDir = join(workingDir, "feishu-downloads");
        // ...
    }
}
```

---

## 问题九：`log` 模块 API 调用名称全部错误 [Critical]

### 原因

参考指南和计划书 `feishu.ts` 中使用 `log.info()`、`log.warn()`、`log.error()`，但 `log.ts` 实际导出：

```typescript
export function logInfo(message: string): void { ... }
export function logWarning(message: string, details?: string): void { ... }
// 无 logError、无 info、无 warn
```

运行时会抛 `log.info is not a function`。

### 解决办法

| 错误写法 | 正确写法 |
|---------|---------|
| `log.info("msg")` | `log.logInfo("msg")` |
| `log.warn("msg", detail)` | `log.logWarning("msg", detail)` |
| `log.error("msg")` | `log.logWarning("msg")` |

---

## 问题十：`adapters/feishu/` 目录处理方式未说明 [Medium]

### 原因

项目中已存在：

```
packages/mom/src/adapters/feishu/
├── types.ts     (含 verificationToken，旧 HTTP 回调模式的设计，与新 WebSocket 模式冲突)
├── listener.ts  (throw Error 的 stub)
└── renderer.ts  (飞书卡片消息渲染，有后期价值)
```

计划书要求删除这 3 个文件并创建扁平的 `src/feishu.ts`，但没有解释决策原因，也没有说明 `renderer.ts` 中的卡片渲染占位是否保留。

### 解决办法

```bash
# 删除与新设计冲突的旧设计文件
rm packages/mom/src/adapters/feishu/types.ts
rm packages/mom/src/adapters/feishu/listener.ts

# 保留卡片渲染占位，重命名并更新注释
mv packages/mom/src/adapters/feishu/renderer.ts \
   packages/mom/src/adapters/feishu/card-renderer.ts
```

主实现 `src/feishu.ts` 放在 `src/` 根目录（与 `slack.ts` 平级）。

---

## 问题十一：代码中含 emoji，违反项目规范 [Low]

### 原因

计划书 `runFeishuMode()` 中：

```typescript
await ctx.respond(`❌ 执行出错：${result.errorMessage}`);
```

`AGENTS.md` 明确规定：No emojis in code。

### 解决办法

```typescript
await ctx.respond(`Error: ${result.errorMessage}`);
```

---

## 问题十二：SDK 版本需在安装前确认 [Medium]

### 原因

计划书建议安装 `@larksuiteoapi/node-sdk@^1.30.0`，当前 npm 最新为 `1.60+`。两版本间 `WSClient.start()` 的阻塞行为可能有变化，需实测确认。

### 解决办法

```bash
# 安装前查看最新版本
npm info @larksuiteoapi/node-sdk dist-tags
# 使用最新稳定版，不固定小版本
npm install @larksuiteoapi/node-sdk --workspace=packages/mom
```

在 `feishu.ts` 文件顶部注释记录测试时的 SDK 版本。

---

## 修正后的完整改动清单

| 步骤 | 文件 | 操作 | 改动量 |
|------|------|------|--------|
| 0 | `package.json` | 安装 SDK 最新版 | +1 依赖 |
| 1 | `src/types.ts` | 补 `replaceMessage`，修 `respond` 签名 | +2 行 |
| 2 | `src/store.ts` | `botToken` 改可选，`downloadAttachment` 加防护 | ~5 行 |
| 3 | `src/feishu.ts` | 新建（修正全部 API 错误） | ~280 行 |
| 4 | `src/agent.ts` | 替换 3 个类型 import 及全部引用 | ~8 处 |
| 5 | `src/main.ts` | 新增 `createFeishuContext()`、`runFeishuMode()`，入口改条件分支 | +~130 行 |
| 6 | `src/adapters/feishu/types.ts` | 删除 | -27 行 |
| 7 | `src/adapters/feishu/listener.ts` | 删除 | -13 行 |
| 8 | `src/adapters/feishu/renderer.ts` | 重命名为 `card-renderer.ts` | 改注释 |

**不改动：** `slack.ts`、`context.ts`、`sandbox.ts`、`events.ts`（首版接受限制）、`tools/`、`log.ts`

---

## 首版已知限制

| 功能 | 状态 | 原因 |
|------|------|------|
| 定时事件（Events Watcher） | 不支持 | `events.ts` 强依赖 `SlackBot` |
| 文件上传（Bot → 飞书） | 空实现 | 需单独实现飞书文件上传 API |
| 消息删除 | 空实现 | 飞书消息撤回权限要求较高 |
| 富文本卡片消息 | 纯文本降级 | `card-renderer.ts` 待后续完善 |
| 用户/频道列表 | 仅当前用户 | 飞书私聊无频道概念 |
```

---

文档内容完整，共 12 个问题，请将上述内容保存到 `FitClaw/FEISHU_INTEGRATION_CORRECTIONS.md`。

**关键问题优先级速查：**

- **Critical（必须修复才能编译/运行）：** 问题二（`ChannelInfo`/`UserInfo` 迁移）、三（`ChannelStore` token 崩溃）、八（`getDir()` 不存在）、九（`log` API 名称错误）
- **High（会导致功能异常）：** 问题四（Events 不可用未说明）、五（`@mention` 检测恒真）、六（`downloadFile` 用错 API）、七（`sendThreadMessage` 用错 API）
- **Medium/Low：** 问题一（现状分析有误）、十（目录处理未说明）、十一（emoji 违规）、十二（SDK 版本未确认）
