import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import * as log from "./log.js";
import { assertFeishuPathId } from "./runtime/coach-scope.js";
import type { BotUpload } from "./types.js";

export interface FeishuEvent {
	type: "mention" | "dm";
	chatType: "group" | "p2p";
	tenantKey: string;
	chatId: string;
	messageId: string;
	rootId?: string;
	threadId?: string;
	user: {
		openId: string;
		unionId?: string;
		userId?: string;
		name?: string;
	};
	text: string;
	files?: Array<{
		messageId: string;
		fileKey: string;
		fileName?: string;
		type: "image" | "file";
		downloadedPath?: string;
	}>;
}

export interface FeishuUserLifecycleEvent {
	type: "joined" | "left";
	tenantKey: string;
	openId: string;
}

export interface FeishuConfig {
	appId: string;
	appSecret: string;
	botName?: string;
}

export interface FeishuBotDependencies {
	client?: Lark.Client;
	wsClient?: Lark.WSClient;
}

type FeishuFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

const FEISHU_IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);
const FEISHU_FILE_TYPES: Readonly<Record<string, FeishuFileType>> = {
	".doc": "doc",
	".docx": "doc",
	".mp4": "mp4",
	".opus": "opus",
	".pdf": "pdf",
	".ppt": "ppt",
	".pptx": "ppt",
	".xls": "xls",
	".xlsx": "xls",
};
const MAX_FEISHU_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FEISHU_FILE_BYTES = 30 * 1024 * 1024;

export class FeishuBot {
	private readonly client: Lark.Client;
	private readonly wsClient: Lark.WSClient;
	private messageHandler?: (event: FeishuEvent) => Promise<void>;
	private userJoinedHandler?: (event: FeishuUserLifecycleEvent) => Promise<void>;
	private userLeftHandler?: (event: FeishuUserLifecycleEvent) => Promise<void>;
	private readonly downloadDir: string;
	private readonly botName: string;
	private readonly seenMessageIds = new Set<string>();

	constructor(config: FeishuConfig, workingDir: string, dependencies: FeishuBotDependencies = {}) {
		this.botName = config.botName || "FitClaw";
		this.downloadDir = join(workingDir, "feishu-downloads");
		this.client =
			dependencies.client ??
			new Lark.Client({ appId: config.appId, appSecret: config.appSecret, domain: Lark.Domain.Feishu });
		this.wsClient =
			dependencies.wsClient ??
			new Lark.WSClient({ appId: config.appId, appSecret: config.appSecret, domain: Lark.Domain.Feishu });
	}

	onMessage(handler: (event: FeishuEvent) => Promise<void>): void {
		this.messageHandler = handler;
	}

	onUserJoined(handler: (event: FeishuUserLifecycleEvent) => Promise<void>): void {
		this.userJoinedHandler = handler;
	}

	onUserLeft(handler: (event: FeishuUserLifecycleEvent) => Promise<void>): void {
		this.userLeftHandler = handler;
	}

	async start(): Promise<void> {
		await mkdir(this.downloadDir, { recursive: true });
		const dispatcher = new Lark.EventDispatcher({}).register({
			"im.message.receive_v1": async (data: unknown) => this.handleMessage(data),
			"contact.user.created_v3": async (data: unknown) => this.handleLifecycle(data, "joined"),
			"contact.user.deleted_v3": async (data: unknown) => this.handleLifecycle(data, "left"),
		});
		this.wsClient.start({ eventDispatcher: dispatcher });
		log.logInfo("Feishu WebSocket client started, waiting for events...");
	}

	async stop(): Promise<void> {
		log.logInfo("FeishuBot stopping...");
	}

	async sendMessage(chatId: string, text: string): Promise<string> {
		assertFeishuPathId(chatId, "chatId");
		return this.createTextMessage("chat_id", chatId, text);
	}

	async sendDirectMessage(openId: string, text: string): Promise<string> {
		assertFeishuPathId(openId, "openId");
		return this.createTextMessage("open_id", openId, text);
	}

	private async createTextMessage(
		receiveIdType: "chat_id" | "open_id",
		receiveId: string,
		text: string,
	): Promise<string> {
		try {
			const response = await this.client.im.v1.message.create({
				params: { receive_id_type: receiveIdType },
				data: { receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text }) },
			});
			if (response.code !== undefined && response.code !== 0) {
				throw new Error(`code ${response.code}: ${response.msg || "unknown error"}`);
			}
			const messageId = response.data?.message_id;
			if (!messageId) throw new Error("empty message_id");
			return messageId;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Feishu ${receiveIdType} message failed: ${reason}`, { cause: error });
		}
	}

	async updateMessage(messageId: string, text: string): Promise<void> {
		try {
			await this.client.im.v1.message.patch({
				path: { message_id: messageId },
				data: { content: JSON.stringify({ text }) },
			});
		} catch (error) {
			log.logWarning("Feishu updateMessage error", error instanceof Error ? error.message : String(error));
		}
	}

	async sendThreadMessage(parentMessageId: string, text: string): Promise<void> {
		try {
			const response = await this.client.im.message.reply({
				path: { message_id: parentMessageId },
				data: { content: JSON.stringify({ text }), msg_type: "text" },
			});
			if (response.code !== undefined && response.code !== 0) {
				throw new Error(`code ${response.code}: ${response.msg || "unknown error"}`);
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Feishu reply failed: ${reason}`, { cause: error });
		}
	}

	async sendCardMessage(parentMessageId: string, card: Record<string, unknown>): Promise<void> {
		const response = await this.client.im.message.reply({
			path: { message_id: parentMessageId },
			data: { content: JSON.stringify(card), msg_type: "interactive" },
		});
		if (response.code !== undefined && response.code !== 0) {
			throw new Error(`Feishu card reply failed with code ${response.code}: ${response.msg || "unknown error"}`);
		}
	}

	async updateCardMessage(messageId: string, card: Record<string, unknown>): Promise<void> {
		try {
			await this.client.im.v1.message.patch({
				path: { message_id: messageId },
				data: { content: JSON.stringify(card) },
			});
		} catch (error) {
			log.logWarning("Feishu updateCardMessage error", error instanceof Error ? error.message : String(error));
		}
	}

	async sendMediaReply(parentMessageId: string, upload: BotUpload, signal?: AbortSignal): Promise<void> {
		if (!parentMessageId) throw new Error("Feishu media reply requires a parent message ID");
		if (upload.data.length === 0) throw new Error("Feishu cannot upload an empty file");
		signal?.throwIfAborted();

		const extension = extname(upload.fileName).toLowerCase();
		let msgType: "image" | "file";
		let content: string;
		if (FEISHU_IMAGE_EXTENSIONS.has(extension)) {
			if (upload.data.length > MAX_FEISHU_IMAGE_BYTES) {
				throw new Error(`Feishu image exceeds the ${MAX_FEISHU_IMAGE_BYTES} byte limit`);
			}
			const response = await this.client.im.v1.image.create({ data: { image_type: "message", image: upload.data } });
			if (!response?.image_key) throw new Error("Feishu image upload returned no image_key");
			msgType = "image";
			content = JSON.stringify({ image_key: response.image_key });
		} else {
			if (upload.data.length > MAX_FEISHU_FILE_BYTES) {
				throw new Error(`Feishu file exceeds the ${MAX_FEISHU_FILE_BYTES} byte limit`);
			}
			const requestedTitle = upload.title?.trim().replace(/\\/g, "/");
			const fileName = basename(requestedTitle || upload.fileName);
			if (!fileName) throw new Error("Feishu file upload requires a filename");
			const response = await this.client.im.v1.file.create({
				data: { file_type: FEISHU_FILE_TYPES[extension] ?? "stream", file_name: fileName, file: upload.data },
			});
			if (!response?.file_key) throw new Error("Feishu file upload returned no file_key");
			msgType = "file";
			content = JSON.stringify({ file_key: response.file_key });
		}

		signal?.throwIfAborted();
		const response = await this.client.im.message.reply({
			path: { message_id: parentMessageId },
			data: { content, msg_type: msgType },
		});
		if (response.code !== undefined && response.code !== 0) {
			throw new Error(`Feishu media reply failed with code ${response.code}: ${response.msg || "unknown error"}`);
		}
	}

	async downloadFile(
		messageId: string,
		fileKey: string,
		type: "image" | "file",
		destinationDir = this.downloadDir,
	): Promise<string> {
		const response = await this.client.im.messageResource.get({
			path: { message_id: messageId, file_key: fileKey },
			params: { type },
		});
		const extension = type === "image" ? "png" : "bin";
		const safeName = `${Date.now()}_${fileKey.replace(/[^a-zA-Z0-9]/g, "_")}.${extension}`;
		const localPath = join(destinationDir, safeName);
		await mkdir(destinationDir, { recursive: true });
		await response.writeFile(localPath);
		log.logInfo(`Feishu attachment downloaded for message ${messageId}`);
		return localPath;
	}

	private async handleMessage(data: unknown): Promise<void> {
		let event: FeishuEvent | null;
		try {
			event = parseFeishuMessageEvent(data, this.botName);
		} catch (error) {
			log.logWarning(
				"Rejected invalid Feishu message event",
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		if (!event) return;
		if (this.seenMessageIds.has(event.messageId)) {
			log.logInfo(`Feishu skipping duplicate message ${event.messageId}`);
			return;
		}
		this.rememberMessageId(event.messageId);
		log.logInfo(
			`Feishu ${event.type} event accepted: tenant=${event.tenantKey}, chat=${event.chatId}, message=${event.messageId}`,
		);
		await this.messageHandler?.(event);
	}

	private async handleLifecycle(data: unknown, type: FeishuUserLifecycleEvent["type"]): Promise<void> {
		let event: FeishuUserLifecycleEvent;
		try {
			event = parseFeishuUserLifecycleEvent(data, type);
		} catch (error) {
			log.logWarning(
				"Rejected invalid Feishu user lifecycle event",
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		log.logInfo(`Feishu user ${type} event accepted: tenant=${event.tenantKey}, openId=${event.openId}`);
		if (type === "joined") await this.userJoinedHandler?.(event);
		else await this.userLeftHandler?.(event);
	}

	private rememberMessageId(messageId: string): void {
		this.seenMessageIds.add(messageId);
		if (this.seenMessageIds.size <= 1000) return;
		const iterator = this.seenMessageIds.values();
		for (let index = 0; index < 200; index++) {
			const value = iterator.next().value;
			if (value) this.seenMessageIds.delete(value);
		}
	}
}

export function parseFeishuMessageEvent(data: unknown, botName: string): FeishuEvent | null {
	const event = requireRecord(data, "event");
	const message = requireRecord(event.message, "message");
	const sender = requireRecord(event.sender, "sender");
	const senderId = requireRecord(sender.sender_id, "sender.sender_id");
	const tenantKey = event.tenant_key;
	const openId = senderId.open_id;
	const chatId = message.chat_id;
	const messageId = message.message_id;
	assertFeishuPathId(tenantKey, "tenantKey");
	assertFeishuPathId(openId, "openId");
	assertFeishuPathId(chatId, "chatId");
	assertFeishuPathId(messageId, "messageId");

	const chatType = message.chat_type;
	if (chatType !== "p2p" && chatType !== "group") throw new Error("Invalid or missing Feishu chatType");
	const mentions = Array.isArray(message.mentions)
		? message.mentions.filter((mention): mention is Record<string, unknown> => isRecord(mention))
		: [];
	if (chatType === "group" && !mentions.some((mention) => mention.name === botName)) return null;

	const content = parseMessageContent(message.content);
	let cleanText = typeof content.text === "string" ? content.text : "";
	for (const mention of mentions) {
		if (typeof mention.key === "string") cleanText = cleanText.replaceAll(mention.key, "").trim();
	}

	const rootId = optionalFeishuId(message.root_id, "rootId");
	const threadId = optionalFeishuId(message.thread_id, "threadId");
	const unionId = optionalFeishuId(senderId.union_id, "unionId");
	const userId = optionalFeishuId(senderId.user_id, "userId");
	const files = extractFiles(messageId, content);
	return {
		type: chatType === "p2p" ? "dm" : "mention",
		chatType,
		tenantKey,
		chatId,
		messageId,
		...(rootId ? { rootId } : {}),
		...(threadId ? { threadId } : {}),
		user: {
			openId,
			...(unionId ? { unionId } : {}),
			...(userId ? { userId } : {}),
			...(typeof sender.name === "string" && sender.name ? { name: sender.name } : {}),
		},
		text: cleanText,
		...(files.length > 0 ? { files } : {}),
	};
}

export function parseFeishuUserLifecycleEvent(
	data: unknown,
	type: FeishuUserLifecycleEvent["type"],
): FeishuUserLifecycleEvent {
	const event = requireRecord(data, "event");
	const object = requireRecord(event.object, "object");
	const tenantKey = event.tenant_key;
	const openId = object.open_id;
	assertFeishuPathId(tenantKey, "tenantKey");
	assertFeishuPathId(openId, "openId");
	return { type, tenantKey, openId };
}

function parseMessageContent(value: unknown): Record<string, unknown> {
	if (typeof value !== "string") throw new Error("Invalid or missing Feishu message content");
	try {
		const parsed = JSON.parse(value) as unknown;
		return requireRecord(parsed, "message content");
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("Invalid Feishu message content JSON");
		throw error;
	}
}

function extractFiles(messageId: string, content: Record<string, unknown>): NonNullable<FeishuEvent["files"]> {
	const files: NonNullable<FeishuEvent["files"]> = [];
	if (typeof content.image_key === "string" && content.image_key) {
		files.push({ messageId, fileKey: content.image_key, fileName: "image", type: "image" });
	}
	if (typeof content.file_key === "string" && content.file_key) {
		files.push({
			messageId,
			fileKey: content.file_key,
			...(typeof content.file_name === "string" ? { fileName: content.file_name } : {}),
			type: "file",
		});
	}
	return files;
}

function optionalFeishuId(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	assertFeishuPathId(value, field);
	return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`Invalid or missing Feishu ${field}`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
