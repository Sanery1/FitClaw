// ============================================================================
// packages/mom/src/feishu.ts
// Feishu Bot adapter, mirrors slack.ts design.
// SDK: @larksuiteoapi/node-sdk, using WebSocket long-connection mode.
// ============================================================================

import * as Lark from "@larksuiteoapi/node-sdk";
import { mkdir } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

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

// ============================================================================
// FeishuBot
// ============================================================================

export class FeishuBot {
	private client: Lark.Client;
	private wsClient: Lark.WSClient;
	private handler?: (event: FeishuEvent) => Promise<void>;
	private readonly downloadDir: string;
	private readonly botName: string;
	private seenEventIds = new Set<string>();

	constructor(config: FeishuConfig, workingDir: string) {
		this.botName = config.botName || "FitCoach";
		this.downloadDir = join(workingDir, "feishu-downloads");

		this.client = new Lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			domain: Lark.Domain.Feishu,
		});

		this.wsClient = new Lark.WSClient({
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
	// ========================================================================

	private async handleMessage(data: unknown): Promise<void> {
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

		const msg = dataObj?.message as Record<string, unknown> | undefined;
		const sender = dataObj?.sender as Record<string, unknown> | undefined;
		if (!msg || !sender) {
			log.logWarning(`Feishu event missing msg or sender, keys: ${JSON.stringify(Object.keys(dataObj || {}))}`);
			return;
		}

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
