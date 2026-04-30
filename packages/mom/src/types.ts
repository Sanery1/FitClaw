/**
 * Generic BotAdapter interface.
 * Decouples the IM layer (Slack, Feishu) from the Agent orchestration layer.
 */

export interface BotMessage {
	text: string;
	rawText: string;
	user: string;
	userName?: string;
	channel: string;
	ts: string;
	attachments?: Array<{ local?: string }>;
}

export interface BotChannel {
	id: string;
	name: string;
}

export interface BotUser {
	id: string;
	userName?: string;
	displayName?: string;
}

export interface BotContext {
	message: BotMessage;
	channelName?: string;
	channels: BotChannel[];
	users: BotUser[];
	respond: (text: string, shouldLog?: boolean) => Promise<void>;
	replaceMessage: (text: string) => Promise<void>;
	respondInThread: (text: string) => Promise<void>;
	setTyping: (isTyping: boolean) => Promise<void>;
	uploadFile: (filePath: string, title?: string) => Promise<void>;
	setWorking: (working: boolean) => Promise<void>;
	deleteMessage: () => Promise<void>;
}

export type BotProvider = "slack" | "feishu";

export function resolveBotProvider(): BotProvider {
	const env = process.env.FITCLAW_BOT_PROVIDER?.toLowerCase();
	if (env === "feishu") return "feishu";
	return "slack";
}
