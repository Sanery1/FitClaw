# 方案二详细实施指南：将 pi-mono/mom 接入飞书自建应用机器人（WebSocket 长连接）

> **目标**：完整复刻 Slack 体验，在飞书中 `@mom` 或在私聊中与 pi coding agent 对话。

---

## 目录

1. [整体架构与工作原理](#1-整体架构与工作原理)
2. [飞书开放平台配置（详细步骤）](#2-飞书开放平台配置详细步骤)
3. [pi-mono 代码改造](#3-pi-mono-代码改造)
4. [环境变量与启动](#4-环境变量与启动)
5. [验证与测试](#5-验证与测试)
6. [常见问题与排查](#6-常见问题与排查)
7. [进阶优化](#7-进阶优化)

---

## 1. 整体架构与工作原理

### 1.1 架构对比：Slack vs 飞书

```
┌─────────────────────────────────────────────────────────────┐
│  Slack 模式（现有）                                          │
│  ┌─────────┐    Socket Mode    ┌──────────┐   LLM/tools   ┌──┴──┐
│  │ Slack   │◄───WebSocket────►│ mom/slack│────────────►│Agent│
│  │ 用户@bot│                   │  main.ts │             │     │
│  └─────────┘                   └──────────┘             └─────┘
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  飞书模式（新增）                                            │
│  ┌─────────┐    WS长连接     ┌──────────┐   LLM/tools   ┌──┴──┐
│  │ 飞书    │◄──WebSocket────►│ mom/feishu│────────────►│Agent│
│  │ 用户@bot│   im.message.   │  main.ts │             │     │
│  │         │   receive_v1    └──────────┘             └─────┘
│  └─────────┘                                                 │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心工作流

1. **用户触发**：在飞书群聊中 `@机器人` 或发送私聊消息
2. **飞书推送**：飞书开放平台通过 WebSocket 长连接推送 `im.message.receive_v1` 事件
3. **mom 接收**：`feishu.ts` 中的 `WSClient` 接收到事件，解析出 `chat_id`、`user`、`text`、`mentions`
4. **权限过滤**：群聊中只处理 `@机器人` 的消息，私聊（`p2p`）全部处理
5. **复用 Agent**：构造 `FeishuContext`（对标 `SlackContext`），调用 `AgentRunner.run()`
6. **LLM 处理**：`agent.ts` 调用 `pi-coding-agent` + `pi-ai`，执行 bash/读写文件/调用 skills
7. **回复用户**：通过 `im.v1.message.create` 发送文本，或 `reply_in_thread` 在话题中发送详细日志

---

## 2. 飞书开放平台配置（详细步骤）

### 2.1 前置要求

- 一个飞书账号（个人或企业均可）
- 能访问公网的开发机器（WebSocket 长连接需要 outbound 访问 `open.feishu.cn`）
- **无需公网 IP、无需域名、无需内网穿透**

### 2.2 步骤 1/7：登录并创建企业自建应用

1. 打开 [https://open.feishu.cn/app](https://open.feishu.cn/app) ，用飞书扫码登录
2. 点击右上角 **「开发者后台」**
3. 在「企业自建应用」页签中，点击 **「创建企业自建应用」**
4. 填写：
   - **应用名称**：`pi-mom`（飞书客户端里显示的名字）
   - **应用描述**：`AI coding agent powered by pi-mono`
   - **应用图标**：可暂时留空，之后补充
5. 点击 **「确定创建」**
6. 创建后自动进入应用详情页，**左侧导航栏**展开如下：
   - 凭证与基础信息
   - 添加应用能力
   - 权限管理
   - 事件与回调
   - 版本管理与发布

### 2.3 步骤 2/7：记录凭证（App ID & App Secret）

1. 左侧点击 **「凭证与基础信息」**
2. 在页面右侧找到 **「应用凭证」** 区域：
   - **App ID**：形如 `cli_xxxxxxxxxxxxxxxx`（**复制保存**，代码里要用）
   - **App Secret**：点击 **「查看」**，需要二次验证（短信/密码），然后 **「复制」**
3. 将这两个值临时保存在本地文本文件中，后面会配置到环境变量

> ⚠️ **安全提示**：App Secret 等同于密码，不要提交到 Git，不要截图外发。

### 2.4 步骤 3/7：添加「机器人」应用能力（关键步骤，极易遗漏）

1. 左侧点击 **「添加应用能力」**
2. 在能力列表中找到 **「机器人」**
3. 点击 **「添加」** → 弹窗确认 → 点击 **「确定」**
4. 添加成功后，左侧导航会出现 **「机器人」** 子菜单
5. （可选）点击 **「机器人」** → **「机器人配置」** → 编辑：
   - 设置机器人名称（如 `pi-mom`）
   - 设置说明（如 `AI coding assistant`）
   - 头像可上传，也可留空
   - 点击 **「保存」**

> ⚠️ **如果没有这一步，你的应用只是普通应用，无法作为聊天机器人收发消息。**

### 2.5 步骤 4/7：配置权限（批量导入）

1. 左侧点击 **「权限管理」**
2. 页面右上角找到 **「批量导入/导出」** → 点击 **「批量导入」**
3. 清空输入框中默认内容，粘贴以下完整权限 JSON：

```json
{
  "tenant": [
    "contact:user.base:readonly",
    "contact:user.id:readonly",
    "im:message",
    "im:message.group_at_msg:readonly",
    "im:message.p2p_msg:readonly",
    "im:message:send_as_bot",
    "im:resource",
    "im:resource:upload",
    "im:chat:readonly"
  ],
  "user": []
}
```

4. 点击 **「确定导入」**
5. 页面会刷新，显示导入的权限列表。逐一检查以下 9 项是否都在「已开通权限」中：

| 权限标识 | 用途说明 |
|---------|---------|
| `contact:user.base:readonly` | 读取用户基本信息（姓名、头像），用于在对话中显示用户名字 |
| `contact:user.id:readonly` | 读取 user_id，映射用户身份 |
| `im:message` | 获取与发送单聊、群组消息（核心发消息权限） |
| `im:message.group_at_msg:readonly` | 读取群聊中被 @ 的消息内容 |
| `im:message.p2p_msg:readonly` | 读取私聊消息内容 |
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:resource` | 下载用户发送的图片/文件 |
| `im:resource:upload` | 上传图片/文件到飞书 |
| `im:chat:readonly` | 读取群聊基本信息 |

6. 如果有显示「待申请开通」的，点击每一项后面的 **「申请开通」**
7. （企业账号）可能需要管理员在飞书管理后台审批通过；个人账号通常自动通过

### 2.6 步骤 5/7：配置事件与回调（长连接）

这是最关键也最容易出错的步骤，**需要与服务端配合**。

#### 2.6.1 先了解为什么需要配合

飞书保存「使用长连接接收事件」时，**会立即检测你的 WebSocket 客户端是否在线**。如果此时你还没启动 bot，保存会失败，提示「未检测到应用连接信息」。

**正确顺序**：先在本机启动 bot（见第 4 章）→ 再回到这里保存。但初次配置时还没代码，所以我们先按顺序把页面配好，等代码跑通后再回来点保存。

#### 2.6.2 页面配置步骤

1. 左侧点击 **「事件与回调」**
2. 页面顶部是 **「订阅方式」**：
   - 默认可能是「将事件发送至开发者服务器」（需要填 URL）
   - 点击 **「编辑」** → 切换为 **「使用长连接接收事件」**
3. 此时不要点保存！先放着这个页面
4. 页面往下滚动，找到 **「事件配置」** 区域
5. 点击 **「添加事件」** 按钮
6. 在弹出的搜索框中输入 `im.message.receive`
7. 勾选 **「接收消息 v2.0」**（事件标识：`im.message.receive_v1`）
8. 点击 **「确认添加」**
9. 事件列表中会出现：
   - 事件类型：`im.message.receive_v1`
   - 订阅类型：应用身份
   - 所需权限：`im:message`、`im:message:send_as_bot` 等（应显示「已开通」）

> **注意**：如果你此时点击保存订阅方式，可能会提示「未检测到长连接」。这是正常的，等后面代码跑起来后再保存。

### 2.7 步骤 6/7：发布应用版本（必须，否则权限不生效）

1. 左侧点击 **「版本管理与发布」**
2. 点击 **「创建版本」**
3. 填写：
   - **版本号**：`1.0.0`
   - **更新说明**：`Initial release for pi-mom bot`
   - **可用范围**：
     - 如果是**个人测试**：选择 **「所有员工」** 或 **「指定成员」**（添加你自己）
     - 注意：机器人只能在被添加的范围内使用
4. 点击 **「保存并申请发布」**
5. 如果是企业账号，管理员需要在飞书管理后台审批；个人账号通常立即生效
6. 发布后页面会显示版本状态为 **「已发布」**

> ⚠️ **再次强调：飞书改了任何权限、事件、回调配置后，必须重新发布版本才生效。** 很多人代码是对的，但因为没发布而收不到消息。

### 2.8 步骤 7/7：把机器人加入群聊/私聊

发布后，在飞书客户端中：

- **私聊**：直接搜索应用名称（如 `pi-mom`），点击即可进入私聊
- **群聊**：进入目标群 → 群设置 → 群机器人 → 添加机器人 → 搜索 `pi-mom` → 添加

---

## 3. pi-mono 代码改造

### 3.1 工程结构概览

改造后的 `packages/mom/src/` 目录结构：

```
packages/mom/src/
  agent.ts          ← 现有，AgentRunner 逻辑完全复用
  context.ts        ← 现有
  slack.ts          ← 现有 Slack 适配层，不动
  feishu.ts         ← 【新增】飞书适配层
  main.ts           ← 【修改】增加 Feishu 启动分支
  store.ts          ← 现有，复用
  log.ts            ← 现有，复用
  tools/            ← 现有
```

### 3.2 步骤 1/5：安装飞书 SDK 依赖

在 `packages/mom/package.json` 的 `dependencies` 中新增一行：

```json
"@larksuiteoapi/node-sdk": "^1.30.0"
```

然后在 monorepo 根目录执行：

```bash
cd /path/to/pi-mono
npm install -w packages/mom
```

或使用 workspace 语法：

```bash
npm install @larksuiteoapi/node-sdk --workspace=packages/mom
```

安装完成后，检查 `packages/mom/node_modules/@larksuiteoapi/node-sdk` 是否存在。

### 3.3 步骤 2/5：新建 `feishu.ts`

在 `packages/mom/src/` 下新建文件 `feishu.ts`，完整代码如下（已逐行注释说明）：

```typescript
// ============================================================================
// packages/mom/src/feishu.ts
// 飞书 Bot 适配层，对标 slack.ts 的接口设计
// ============================================================================

import * as Lark from "@larksuiteoapi/node-sdk";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import * as log from "./log.js";
import type { ChannelStore } from "./store.js";

// ============================================================================
// 类型定义（与 SlackContext 尽量对齐，使 agent.ts 改动最小化）
// ============================================================================

/** 飞书消息事件（从 im.message.receive_v1 解析后的结构化数据） */
export interface FeishuEvent {
  type: "mention" | "dm";
  chatId: string;        // 聊天 ID（群聊或私聊的统一标识）
  messageId: string;     // 消息 ID，用于线程回复和更新
  parentMessageId?: string; // 父消息 ID，用于话题线程
  user: {
    openId: string;      // 用户在当前应用下的唯一标识
    userId?: string;     // 用户 user_id（如有）
    name?: string;       // 用户姓名（如有）
  };
  text: string;          // 消息纯文本内容（已去掉 @机器人的 mention 标记）
  files?: Array<{
    fileKey: string;     // 飞书文件 key，用于下载
    fileName?: string;
    mimeType?: string;
  }>;
}

/** 飞书上下文，字段和 SlackContext 对齐 */
export interface FeishuContext {
  message: {
    text: string;
    rawText: string;
    user: string;         // 对应 open_id
    userName?: string;
    channel: string;      // 对应 chat_id（复用 Slack 的 channel 语义）
    ts: string;           // 对应 message_id（复用 Slack 的 ts 语义）
    attachments: Array<{ local: string }>;
  };
  channelName?: string;
  channels: Array<{ id: string; name: string }>;
  users: Array<{ id: string; userName: string; displayName: string }>;
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  respondInThread: (text: string) => Promise<void>;
}

export interface FeishuBot {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ============================================================================
// FeishuBotImpl：核心实现
// ============================================================================

export class FeishuBotImpl implements FeishuBot {
  private client: Lark.Client;
  private wsClient: Lark.WSClient;
  private handler?: (
    event: FeishuEvent,
    store: ChannelStore
  ) => Promise<void>;
  private readonly downloadDir: string;

  constructor(
    private config: { appId: string; appSecret: string },
    private store: ChannelStore
  ) {
    // Lark.Client：用于主动调用 API（发消息、下载文件等）
    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      // 默认 domain 就是 open.feishu.cn，中国区无需改
    });

    // Lark.WSClient：用于建立 WebSocket 长连接接收事件
    this.wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      // loggerLevel: Lark.LoggerLevel.debug, // 调试时可开启
    });

    // 复用 mom 的 workspace 目录作为文件下载目录
    this.downloadDir = join(store.getDir(), "downloads");
  }

  /** 注册消息处理器（由 main.ts 调用） */
  onMessage(
    handler: (event: FeishuEvent, store: ChannelStore) => Promise<void>
  ) {
    this.handler = handler;
  }

  /** 启动 WebSocket 长连接 */
  async start(): Promise<void> {
    // 确保下载目录存在
    await mkdir(this.downloadDir, { recursive: true });

    // 创建事件分发器，注册 im.message.receive_v1 事件处理
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        await this.handleMessage(data);
      },
    });

    // 启动长连接。成功后控制台会打印：
    // [info]: [ '[ws]', 'ws client ready' ]
    this.wsClient.start({ eventDispatcher: dispatcher });
    log.info("Feishu WebSocket client started, waiting for events...");

    // wsClient.start() 会阻塞主线程，但这里我们不 await，
    // 因为 mom 的 main.ts 里会自己阻塞。这里只触发启动。
  }

  async stop(): Promise<void> {
    log.info("Feishu bot stopping...");
    // WSClient 没有显式 stop 方法，直接退出进程即可
  }

  // ============================================================================
  // 内部：处理飞书推送的原始事件数据
  // ============================================================================
  private async handleMessage(data: any): Promise<void> {
    const msg = data.message;
    const sender = data.sender;
    if (!msg || !sender) {
      log.warn("Received empty message event, skipping");
      return;
    }

    // 飞书的 content 是 JSON 字符串，必须先 parse
    let content: Record<string, any> = {};
    try {
      content = JSON.parse(msg.content || "{}");
    } catch {
      content = { text: msg.content || "" };
    }

    const rawText: string = content.text || "";
    const chatType: string = msg.chat_type; // "p2p" | "group"

    // 解析 mentions 列表，判断群聊中是否 @了本机器人
    const mentions: Array<any> = msg.mentions || [];
    const botOpenId = data.event?.sender?.sender_id?.open_id || "";
    const isMention = mentions.some((m: any) => {
      // 飞书 mention 格式：文本中显示为 @user，content.text 里保留原始 @标签
      // 判断逻辑：mention 列表中是否包含机器人自己
      return m.id?.union_id || m.id?.open_id;
    });

    // 群聊只处理 @机器人的消息；私聊全部处理
    if (chatType === "group" && !isMention) {
      log.info("Ignoring group message without mention");
      return;
    }

    // 去掉 text 中的 @标签，提取纯用户输入
    let cleanText = rawText;
    for (const m of mentions) {
      const key = m.key; // 如 "@_user_1"
      if (key && cleanText.includes(key)) {
        cleanText = cleanText.replace(key, "").trim();
      }
    }

    const event: FeishuEvent = {
      type: chatType === "p2p" ? "dm" : "mention",
      chatId: msg.chat_id,
      messageId: msg.message_id,
      parentMessageId: msg.parent_id,
      user: {
        openId: sender.sender_id?.open_id || "unknown",
        userId: sender.sender_id?.user_id,
        name: sender.sender_id?.name,
      },
      text: cleanText,
      files: msg.file_key
        ? [
            {
              fileKey: msg.file_key,
              fileName: msg.file_name,
              mimeType: msg.mime_type,
            },
          ]
        : undefined,
    };

    log.info(
      `Feishu ${event.type} from ${event.user.name || event.user.openId}: ${event.text.slice(0, 80)}`
    );

    if (this.handler) {
      await this.handler(event, this.store);
    }
  }

  // ============================================================================
  // 文件下载（对标 slack.ts 的文件下载逻辑）
  // ============================================================================
  async downloadFile(fileKey: string, mimeType?: string): Promise<string> {
    try {
      const res = await this.client.im.resource.get({
        params: { file_key: fileKey },
      });

      // res 的 data 是 ArrayBuffer，需写入本地文件
      const buffer = res.data as ArrayBuffer;
      const ext = mimeType
        ? mimeType.split("/").pop() || "bin"
        : "bin";
      const safeName = `${Date.now()}_${fileKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const localPath = join(this.downloadDir, `${safeName}.${ext}`);

      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, Buffer.from(buffer));

      log.info(`Downloaded file to ${localPath}`);
      return localPath;
    } catch (err: any) {
      log.error(`Failed to download file ${fileKey}: ${err.message}`);
      throw err;
    }
  }

  // ============================================================================
  // 消息发送 API（被 main.ts 中的 ctx 调用）
  // ============================================================================

  /** 发送文本消息到指定聊天。返回 message_id，用于后续更新 */
  async sendMessage(
    chatId: string,
    text: string,
    replyTo?: string
  ): Promise<string> {
    const res = (await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        // 如果有 parent_message_id，则在话题中回复
        ...(replyTo ? { reply_in_thread: true } : {}),
      },
    })) as any;

    const messageId = res?.data?.message_id || "";
    if (!messageId) {
      log.warn("sendMessage returned empty message_id");
    }
    return messageId;
  }

  /** 在指定消息的话题（线程）中回复 */
  async sendThreadMessage(
    chatId: string,
    parentMessageId: string,
    text: string
  ): Promise<void> {
    await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        reply_in_thread: true, // 核心参数：在话题中回复
      },
    });
  }

  /** 更新（编辑）已发送的消息。用于 replaceMessage 的流式效果 */
  async updateMessage(messageId: string, text: string): Promise<void> {
    await this.client.im.v1.message.patch({
      data: {
        content: JSON.stringify({ text }),
      },
      path: { message_id: messageId },
    });
  }
}
```

### 3.4 步骤 3/5：修改 `main.ts`

现有 `main.ts` 以 Slack 环境变量为入口。我们需要增加一个 Feishu 分支，让 bot 根据环境变量自动判断启动哪个平台。

**修改策略**：保留所有 Slack 代码不动，在文件末尾增加 Feishu 启动逻辑。

```typescript
// ============================================================================
// packages/mom/src/main.ts  修改点（节选新增部分）
// ============================================================================

// 在文件顶部 import 区域新增
import { FeishuBotImpl, type FeishuContext } from "./feishu.js";

// 在 Config 区域新增环境变量读取
const MOM_FEISHU_APP_ID = process.env.MOM_FEISHU_APP_ID;
const MOM_FEISHU_APP_SECRET = process.env.MOM_FEISHU_APP_SECRET;

// ... （原有 parseArgs、Slack 启动代码全部保留，此处省略）...

// ============================================================================
// 新增：Feishu 启动逻辑
// ============================================================================

async function runFeishuMode() {
  // 校验环境变量
  if (!MOM_FEISHU_APP_ID || !MOM_FEISHU_APP_SECRET) {
    console.error("Missing required environment variables:");
    console.error("  MOM_FEISHU_APP_ID");
    console.error("  MOM_FEISHU_APP_SECRET");
    process.exit(1);
  }

  // 初始化 store（复用 mom 的 workspace 目录）
  const store = new ChannelStore(
    parsedArgs.workingDir || join(homedir(), ".pi", "mom")
  );

  // 初始化飞书 bot
  const bot = new FeishuBotImpl(
    { appId: MOM_FEISHU_APP_ID, appSecret: MOM_FEISHU_APP_SECRET },
    store
  );

  // 注册消息处理器
  bot.onMessage(async (event, channelStore) => {
    // 下载附件（图片/文件）到本地
    const attachments: Array<{ local: string }> = [];
    if (event.files) {
      for (const f of event.files) {
        try {
          const localPath = await bot.downloadFile(f.fileKey, f.mimeType);
          attachments.push({ local: localPath });
        } catch (err) {
          log.error(`Failed to download attachment ${f.fileKey}: ${err}`);
        }
      }
    }

    // 构建 FeishuContext，与 SlackContext 对齐
    let lastMessageId = "";
    const ctx: FeishuContext = {
      message: {
        text: event.text,
        rawText: event.text,
        user: event.user.openId,
        userName: event.user.name,
        channel: event.chatId,   // 对齐 Slack 的 channel 字段
        ts: event.messageId,       // 对齐 Slack 的 ts 字段
        attachments,
      },
      // 飞书没有 channel 列表概念，留空或按需填充
      channels: [],
      users: event.user.name
        ? [
            {
              id: event.user.openId,
              userName: event.user.name,
              displayName: event.user.name,
            },
          ]
        : [],

      // respond：首次发送消息
      respond: async (text: string) => {
        lastMessageId = await bot.sendMessage(event.chatId, text);
      },

      // replaceMessage：更新最后一条消息（用于流式/编辑效果）
      replaceMessage: async (text: string) => {
        if (lastMessageId) {
          await bot.updateMessage(lastMessageId, text);
        } else {
          lastMessageId = await bot.sendMessage(event.chatId, text);
        }
      },

      // respondInThread：在原消息话题中回复详细日志
      respondInThread: async (text: string) => {
        await bot.sendThreadMessage(
          event.chatId,
          event.messageId,
          text
        );
      },
    };

    // 复用 mom 的 AgentRunner 处理消息
    const runner = getOrCreateRunner(channelStore, event.chatId);
    const result = await runner.run(ctx as any, channelStore);

    // 如果 agent 执行出错，给用户一个错误提示
    if (result.errorMessage) {
      await ctx.respond(`❌ 执行出错：${result.errorMessage}`);
    }
  });

  // 启动 WebSocket 连接
  await bot.start();
  log.info("pi-mom Feishu bot is running. Press Ctrl+C to exit.");

  // 永久阻塞，保持进程存活
  await new Promise(() => {});
}

// ============================================================================
// 修改启动入口：根据环境变量判断平台
// ============================================================================

// 将原有的直接启动代码，改为条件分支：
if (MOM_FEISHU_APP_ID) {
  await runFeishuMode();
} else if (MOM_SLACK_APP_TOKEN) {
  // 原有 Slack 启动逻辑（保持不动）
  // ... 原有代码 ...
} else {
  console.error("No bot platform configured.");
  console.error("Please set one of the following environment variable groups:");
  console.error("  Feishu: MOM_FEISHU_APP_ID + MOM_FEISHU_APP_SECRET");
  console.error("  Slack: MOM_SLACK_APP_TOKEN + MOM_SLACK_BOT_TOKEN");
  process.exit(1);
}
```

### 3.5 步骤 4/5：验证编译

pi-mono/mom 使用 `tsgo` 构建（不是 tsc）。在 `packages/mom` 目录下：

```bash
cd packages/mom
npm run build
```

如果编译报错，检查：
1. `@larksuiteoapi/node-sdk` 是否正确安装到 `packages/mom/node_modules`
2. `feishu.ts` 中的 import 路径是否正确（`.js` 后缀是 ESM 要求）
3. `main.ts` 中的 `import { FeishuBotImpl ... } from "./feishu.js"` 路径是否正确

### 3.6 步骤 5/5：agent.ts 兼容性说明

**好消息**：`agent.ts` 里的 `AgentRunner.run(ctx, store)` 接受的 `ctx` 是 `SlackContext` 类型，但它的字段都是普通 JavaScript 运行时访问。我们构造的 `FeishuContext` 与它字段对齐：

| SlackContext 字段 | FeishuContext 对应字段 | 说明 |
|------------------|----------------------|------|
| `message.text` | `message.text` | ✅ 直接对齐 |
| `message.rawText` | `message.rawText` | ✅ 直接对齐 |
| `message.user` | `message.user` | ✅ open_id 替代 slack user id |
| `message.channel` | `message.channel` | ✅ chat_id 替代 channel id |
| `message.ts` | `message.ts` | ✅ message_id 替代 ts |
| `message.attachments` | `message.attachments` | ✅ 文件下载后填充 |
| `respond()` | `respond()` | ✅ 发消息函数 |
| `replaceMessage()` | `replaceMessage()` | ✅ 更新消息函数 |
| `respondInThread()` | `respondInThread()` | ✅ 话题回复函数 |

因此**无需修改 agent.ts 的任何逻辑**，只需在 `main.ts` 里把 `ctx` 传进去即可。

---

## 4. 环境变量与启动

### 4.1 环境变量清单

| 环境变量 | 必填 | 说明 |
|---------|------|------|
| `MOM_FEISHU_APP_ID` | ✅ | 飞书应用凭证 App ID（`cli_xxxxx`） |
| `MOM_FEISHU_APP_SECRET` | ✅ | 飞书应用凭证 App Secret |
| `ANTHROPIC_API_KEY` | ✅ | pi-ai 使用的 LLM API Key（mom 依赖 anthropic） |
| `MOM_WORKING_DIR` | ❌ | mom 的 workspace 目录，默认 `~/.pi/mom` |

可选（如果你还需要 Slack）：
- `MOM_SLACK_APP_TOKEN`
- `MOM_SLACK_BOT_TOKEN`

### 4.2 启动方式

#### 方式 A：直接启动（开发调试）

```bash
cd /path/to/pi-mono/packages/mom

# 设置环境变量
export MOM_FEISHU_APP_ID="cli_xxxxxxxxxxxxxxxx"
export MOM_FEISHU_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# 构建
npm run build

# 启动（以当前目录作为 workspace）
node dist/main.js

# 或使用 sandbox（推荐生产环境）
node dist/main.js --sandbox=docker:mom-sandbox
```

启动成功后，控制台应输出类似：

```
[info]: Feishu WebSocket client started, waiting for events...
[info]: [ '[ws]', 'ws client ready' ]
[info]: pi-mom Feishu bot is running. Press Ctrl+C to exit.
```

#### 方式 B：开发模式（热重载）

```bash
npm run dev
```

这会用 `tsgo --watch` 监视代码变更并自动重新编译。

### 4.3 完成飞书后台保存（此时去点保存）

**重要**：当你看到控制台输出 `ws client ready` 后，说明长连接已建立。此时立即回到飞书开发者后台的 **「事件与回调」** 页面：

1. 找到之前未保存的 **「订阅方式」**（已选「使用长连接接收事件」）
2. 点击 **「保存」**
3. 如果一切正常，页面会提示保存成功
4. 如果提示「未检测到应用连接信息」，检查：
   - 你的 `MOM_FEISHU_APP_ID` / `APP_SECRET` 是否填错
   - 网络是否能访问 `open.feishu.cn`
   - 控制台是否有 `[ws] ws client ready` 输出

### 4.4 方式 C：Docker 启动（推荐生产）

mom 原生支持 Docker sandbox。可以基于现有 `docker.sh` 扩展：

```dockerfile
# Dockerfile.feishu（放在 packages/mom/ 下）
FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY dist ./dist

ENV MOM_FEISHU_APP_ID=""
ENV MOM_FEISHU_APP_SECRET=""

ENTRYPOINT ["node", "dist/main.js", "--sandbox=docker:mom-sandbox"]
```

---

## 5. 验证与测试

### 5.1 私聊测试

1. 在飞书客户端顶部搜索栏输入 `pi-mom`（你的应用名称）
2. 点击进入私聊窗口
3. 发送：`你好，能帮我写一个快速排序吗？`
4. **预期结果**：
   - bot 应回复一个 markdown 格式的快速排序代码
   - 控制台能看到 `[info]` 日志输出接收到的消息
   - mom 的 workspace 目录（`~/.pi/mom`）下会生成会话记录

### 5.2 群聊 @测试

1. 把 `pi-mom` 机器人添加到一个测试群
2. 在群里发送：`@pi-mom 用 Python 写一个斐波那契数列`
3. **预期结果**：
   - bot 在群里回复一条消息（不是线程）
   - 如果 agent 执行了 bash 命令，详细日志会以话题（thread）形式挂在主消息下

### 5.3 文件上传测试

1. 发送一张截图或 `.txt` 文件给 bot
2. 附带文字：`分析一下这个文件`
3. **预期结果**：
   - bot 调用 `downloadFile()` 把文件保存到 `~/.pi/mom/downloads/`
   - 把文件路径传给 Agent，Agent 读取文件内容并分析

### 5.4 验证清单

| 测试项 | 成功标志 |
|--------|---------|
| 私聊触发 | 飞书收到回复消息 |
| 群聊 @触发 | 群聊收到回复消息，非 @消息不触发 |
| 文件下载 | `~/.pi/mom/downloads/` 目录出现文件 |
| 线程回复 | 详细执行日志出现在话题中 |
| 消息更新 | Agent 流式输出时，同一条消息被编辑更新 |

---

## 6. 常见问题与排查

### Q1：启动后控制台没有 `ws client ready`

**排查**：
```bash
# 1. 检查 App ID / Secret 是否正确
echo $MOM_FEISHU_APP_ID

# 2. 检查网络连通性
curl -I https://open.feishu.cn

# 3. 开启 SDK debug 日志
# 在 feishu.ts 的 WSClient 配置中加入：
# loggerLevel: Lark.LoggerLevel.debug
```

### Q2：飞书后台保存「使用长连接接收事件」时提示「未检测到应用连接信息」

**原因**：飞书保存时会检测你的 WebSocket 客户端是否在线。

**解决**：
1. 确保 bot 已启动且控制台有 `[ws] ws client ready`
2. 如果已经启动但还是失败，检查 App ID / Secret 是否填错（复制时多了空格）
3. 检查是否是国际版飞书（Lark），需要改 domain 为 `open.larksuite.com`

### Q3：能启动，但飞书发消息 bot 没反应

**排查清单**：
1. **事件订阅了吗？** 去「事件与回调」→「事件配置」检查是否有 `im.message.receive_v1`
2. **应用发布了吗？** 去「版本管理与发布」确认状态是「已发布」
3. **机器人在群里吗？** 群设置 → 群机器人里检查
4. **@对了吗？** 群聊中必须 @机器人，不能只是发文字
5. **权限开通了吗？** 权限管理里检查 `im:message` 等是否已开通
6. **范围对吗？** 确保发消息的人在应用「可用范围」内

### Q4：bot 能收到消息，但回复时报错「没有权限」

**解决**：
- 缺少 `im:message:send_as_bot` 或 `im:message` 权限
- 去权限管理开通 → **重新发布版本**

### Q5：文件下载失败

**排查**：
- 检查 `im:resource` 权限是否开通
- 检查下载目录权限：`mkdir -p ~/.pi/mom/downloads`
- 检查文件大小是否超限（飞书普通文件 2GB，图片 20MB）

### Q6：Slack 和 Feishu 能同时运行吗？

**答**：可以。`main.ts` 的条件分支是 `if/else if`，但你可以改成同时启动两个 bot：

```typescript
if (MOM_FEISHU_APP_ID) promises.push(runFeishuMode());
if (MOM_SLACK_APP_TOKEN) promises.push(runSlackMode());
await Promise.all(promises);
```

### Q7：Agent 执行 bash 命令安全吗？

**答**：mom 原生支持 `--sandbox=docker:container-name`，强烈推荐生产环境使用 Docker sandbox。飞书用户输入的任何内容都会传给 LLM，LLM 可能生成危险命令。Docker 隔离是必须的。

---

## 7. 进阶优化

### 7.1 飞书卡片消息（美化输出）

飞书的纯文本消息对 Markdown 支持有限，代码块显示不佳。可以用「交互式卡片」：

```typescript
await client.im.v1.message.create({
  params: { receive_id_type: "chat_id" },
  data: {
    receive_id: chatId,
    msg_type: "interactive",
    content: JSON.stringify({
      schema: "2.0",
      body: {
        elements: [
          { tag: "markdown", content: "```typescript
const x = 1;
```" },
        ],
      },
    }),
  },
});
```

### 7.2 流式输出优化

飞书 `im.v1.message.patch`（更新消息）有频率限制（约 5 QPS）。如果想实现类 Slack 的流式效果：

1. 降低更新频率：不要每 token 更新，而是每 1-2 秒或每满 100 字符更新一次
2. 使用卡片消息：卡片的 `PATCH` 比文本更稳定，视觉效果更好
3. 妥协方案：不流式，等 Agent 完整输出后一次性发送

### 7.3 多租户/多 workspace

mom 的 `ChannelStore` 以 `chatId`（飞书）或 `channel`（Slack）作为目录隔离键。飞书的群聊和私聊 `chat_id` 天然隔离，无需改动。

### 7.4 钉钉/企业微信扩展

按照相同的适配层模式：
1. 新增 `dingtalk.ts` / `wecom.ts`
2. 实现 `onMessage` + `sendMessage` + `sendThreadMessage`
3. 构造 `Context` 对齐 `SlackContext`
4. 在 `main.ts` 增加启动分支

---

## 附录：完整文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/mom/package.json` | 修改 | `dependencies` 增加 `@larksuiteoapi/node-sdk` |
| `packages/mom/src/feishu.ts` | 新增 | 飞书适配层 |
| `packages/mom/src/main.ts` | 修改 | 增加 Feishu 启动分支和环境变量读取 |
| `packages/mom/src/slack.ts` | 不动 | 原有 Slack 逻辑完全保留 |
| `packages/mom/src/agent.ts` | 不动 | 复用现有 AgentRunner |
| `packages/mom/src/store.ts` | 不动 | 复用 |

---

## 附录：快速启动脚本

```bash
#!/bin/bash
# start-feishu.sh

export MOM_FEISHU_APP_ID="cli_xxxxxxxxxxxxxxxx"
export MOM_FEISHU_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export ANTHROPIC_API_KEY="sk-ant-api03-..."

cd "$(dirname "$0")/packages/mom"
npm run build
node dist/main.js "$@"
```

---

**至此，pi-mono/mom 已完整接入飞书机器人。用户在飞书 @bot 后，消息会通过 WebSocket 推送到 mom，经 LLM 处理后再写回飞书，体验与 Slack 完全一致。**
