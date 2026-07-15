// ============================================================================
// Legacy Feishu helpers retained while callers migrate to adapters/feishu.
// Feishu Bot adapter using WebSocket long-connection mode.
// SDK: @larksuiteoapi/node-sdk
// ============================================================================

import * as Lark from "@larksuiteoapi/node-sdk";
import { mkdir } from "fs/promises";
import { basename, extname, join } from "path";
import * as log from "./log.js";
import type { BotUpload } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface FeishuEvent {
	type: "mention" | "dm";
	chatId: string;
	messageId: string;
	user: {
		openId: string;
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

// ============================================================================
// FeishuBot
// ============================================================================

export class FeishuBot {
	private readonly client: Lark.Client;
	private readonly wsClient: Lark.WSClient;
	private handler?: (event: FeishuEvent) => Promise<void>;
	private readonly downloadDir: string;
	private readonly botName: string;
	private seenEventIds = new Set<string>();

	constructor(config: FeishuConfig, workingDir: string, dependencies: FeishuBotDependencies = {}) {
		this.botName = config.botName || "FitCoach";
		this.downloadDir = join(workingDir, "feishu-downloads");

		this.client =
			dependencies.client ??
			new Lark.Client({
				appId: config.appId,
				appSecret: config.appSecret,
				domain: Lark.Domain.Feishu,
			});

		this.wsClient =
			dependencies.wsClient ??
			new Lark.WSClient({
				appId: config.appId,
				appSecret: config.appSecret,
				domain: Lark.Domain.Feishu,
			});
	}

	onMessage(handler: (event: FeishuEvent) => Promise<void>): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		await mkdir(this.downloadDir, { recursive: true });

		const dispatcher = new Lark.EventDispatcher({}).register({
			"im.message.receive_v1": async (data: unknown) => {
				await this.handleMessage(data);
			},
		});

		this.wsClient.start({ eventDispatcher: dispatcher });
		log.logInfo("Feishu WebSocket client started, waiting for events...");
	}

	async stop(): Promise<void> {
		log.logInfo("FeishuBot stopping...");
	}

	// ========================================================================
	// Message sending
	// ========================================================================

	async sendMessage(chatId: string, text: string): Promise<string> {
		try {
			const res = (await this.client.im.v1.message.create({
				params: { receive_id_type: "chat_id" },
				data: {
					receive_id: chatId,
					msg_type: "text",
					content: JSON.stringify({ text }),
				},
			})) as Record<string, unknown>;

			const data = res?.data as Record<string, unknown> | undefined;
			const messageId = (data?.message_id as string) || "";
			if (!messageId) {
				log.logWarning("Feishu sendMessage returned empty message_id");
			}
			return messageId;
		} catch (err) {
			log.logWarning("Feishu sendMessage error", err instanceof Error ? err.message : String(err));
			return "";
		}
	}

	async updateMessage(messageId: string, text: string): Promise<void> {
		try {
			await this.client.im.v1.message.patch({
				path: { message_id: messageId },
				data: { content: JSON.stringify({ text }) },
			});
		} catch (err) {
			log.logWarning("Feishu updateMessage error", err instanceof Error ? err.message : String(err));
		}
	}

	async sendThreadMessage(parentMessageId: string, text: string): Promise<void> {
		try {
			await this.client.im.message.reply({
				path: { message_id: parentMessageId },
				data: {
					content: JSON.stringify({ text }),
					msg_type: "text",
				},
			});
		} catch (err) {
			log.logWarning("Feishu sendThreadMessage error", err instanceof Error ? err.message : String(err));
		}
	}

	async sendCardMessage(parentMessageId: string, card: Record<string, unknown>): Promise<void> {
		try {
			await this.client.im.message.reply({
				path: { message_id: parentMessageId },
				data: {
					content: JSON.stringify(card),
					msg_type: "interactive",
				},
			});
		} catch (err) {
			log.logWarning("Feishu sendCardMessage error", err instanceof Error ? err.message : String(err));
		}
	}

	async updateCardMessage(messageId: string, card: Record<string, unknown>): Promise<void> {
		try {
			await this.client.im.v1.message.patch({
				path: { message_id: messageId },
				data: { content: JSON.stringify(card) },
			});
		} catch (err) {
			log.logWarning("Feishu updateCardMessage error", err instanceof Error ? err.message : String(err));
		}
	}

	async sendMediaReply(parentMessageId: string, upload: BotUpload): Promise<void> {
		if (!parentMessageId) throw new Error("Feishu media reply requires a parent message ID");
		if (upload.data.length === 0) throw new Error("Feishu cannot upload an empty file");

		const extension = extname(upload.fileName).toLowerCase();
		let msgType: "image" | "file";
		let content: string;

		if (FEISHU_IMAGE_EXTENSIONS.has(extension)) {
			if (upload.data.length > MAX_FEISHU_IMAGE_BYTES) {
				throw new Error(`Feishu image exceeds the ${MAX_FEISHU_IMAGE_BYTES} byte limit`);
			}
			const response = await this.client.im.v1.image.create({
				data: { image_type: "message", image: upload.data },
			});
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
				data: {
					file_type: FEISHU_FILE_TYPES[extension] ?? "stream",
					file_name: fileName,
					file: upload.data,
				},
			});
			if (!response?.file_key) throw new Error("Feishu file upload returned no file_key");
			msgType = "file";
			content = JSON.stringify({ file_key: response.file_key });
		}

		const response = await this.client.im.message.reply({
			path: { message_id: parentMessageId },
			data: { content, msg_type: msgType },
		});
		if (response.code !== undefined && response.code !== 0) {
			throw new Error(`Feishu media reply failed with code ${response.code}: ${response.msg || "unknown error"}`);
		}
	}

	// ========================================================================
	// File download
	// ========================================================================

	async downloadFile(messageId: string, fileKey: string, type: "image" | "file"): Promise<string> {
		const resp = await this.client.im.messageResource.get({
			path: { message_id: messageId, file_key: fileKey },
			params: { type },
		});

		const ext = type === "image" ? "png" : "bin";
		const safeName = `${Date.now()}_${fileKey.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;
		const localPath = join(this.downloadDir, safeName);

		await mkdir(this.downloadDir, { recursive: true });
		await resp.writeFile(localPath);

		log.logInfo(`Feishu: downloaded file to ${localPath}`);
		return localPath;
	}

	// ========================================================================
	// Internal: message event parsing
	//
	// Security model: This Bot uses Feishu WebSocket long-connection mode (not
	// HTTP webhooks). The WebSocket is authenticated with appId + appSecret at
	// connection time and runs over TLS. Events arriving on this channel are
	// trusted by the SDK. Per-event X-Lark-Signature verification is only
	// applicable to HTTP webhook mode and is not needed here.
	// ========================================================================

	private async handleMessage(data: unknown): Promise<void> {
		if (!data || typeof data !== "object") {
			log.logWarning("Feishu received non-object event data, ignoring");
			return;
		}
		const dataObj = data as Record<string, unknown>;

		// Deduplicate: Feishu WS may re-send events with same event_id
		const eventId = dataObj?.event_id as string | undefined;
		if (eventId) {
			if (this.seenEventIds.has(eventId)) {
				log.logInfo(`Feishu skipping duplicate event: ${eventId}`);
				return;
			}
			this.seenEventIds.add(eventId);
			// Keep set bounded (max 1000 events)
			if (this.seenEventIds.size > 1000) {
				const it = this.seenEventIds.values();
				for (let i = 0; i < 200; i++) {
					const v = it.next().value;
					if (v) this.seenEventIds.delete(v);
				}
			}
		}

		log.logInfo(`Feishu raw event: ${JSON.stringify(data).slice(0, 500)}`);

		// Validate event schema: required top-level fields
		if (!dataObj.message || typeof dataObj.message !== "object") {
			log.logWarning(`Feishu event missing or invalid message field`);
			return;
		}
		if (!dataObj.sender || typeof dataObj.sender !== "object") {
			log.logWarning(`Feishu event missing or invalid sender field`);
			return;
		}

		const msg = dataObj.message as Record<string, unknown>;
		const sender = dataObj.sender as Record<string, unknown>;

		// content is a JSON string from Feishu
		let content: Record<string, unknown> = {};
		try {
			content = JSON.parse((msg.content as string) || "{}");
		} catch {
			content = { text: (msg.content as string) || "" };
		}

		const rawText: string = (content.text as string) || "";
		const chatType: string = (msg.chat_type as string) || "";
		const mentions: Array<{ key?: string; name?: string }> =
			(msg.mentions as Array<{ key?: string; name?: string }>) || [];

		// Correct mention detection: compare mention name with bot name
		const isBotMentioned = mentions.some((m) => m.name === this.botName);

		if (chatType === "group" && !isBotMentioned) {
			return; // ignore group messages without @bot
		}

		// Strip @mention tags from text
		let cleanText = rawText;
		for (const m of mentions) {
			if (m.key && cleanText.includes(m.key)) {
				cleanText = cleanText.replace(m.key, "").trim();
			}
		}

		// Extract file info
		const files = this.extractFiles((msg.message_id as string) || "", content, msg);

		const senderId = (sender.sender_id as Record<string, string>) || {};

		const event: FeishuEvent = {
			type: chatType === "p2p" ? "dm" : "mention",
			chatId: (msg.chat_id as string) || "",
			messageId: (msg.message_id as string) || "",
			user: {
				openId: senderId.open_id || "unknown",
				userId: senderId.user_id,
				name: senderId.name,
			},
			text: cleanText,
			files,
		};

		log.logInfo(`Feishu ${event.type} from ${event.user.name || event.user.openId}: ${event.text.slice(0, 80)}`);

		if (this.handler) {
			await this.handler(event);
		}
	}

	private extractFiles(
		messageId: string,
		content: Record<string, unknown>,
		msg: Record<string, unknown>,
	): FeishuEvent["files"] {
		const files: NonNullable<FeishuEvent["files"]> = [];

		if (content.image_key) {
			files.push({
				messageId,
				fileKey: content.image_key as string,
				fileName: (msg.image_name as string) || "image",
				type: "image",
			});
		}
		if (msg.file_key) {
			files.push({
				messageId,
				fileKey: msg.file_key as string,
				fileName: msg.file_name as string | undefined,
				type: "file",
			});
		}

		return files;
	}
}
