/**
 * Feishu Bot API type definitions (placeholder).
 * Fill in when Feishu Bot API integration is needed.
 */

export interface FeishuMessage {
	messageId: string;
	chatId: string;
	userId: string;
	content: string;
	timestamp: number;
}

export interface FeishuConfig {
	appId: string;
	appSecret: string;
	verificationToken: string;
}

export interface FeishuBotAdapter {
	sendMessage(chatId: string, content: string): Promise<void>;
	onMessage(handler: (message: FeishuMessage) => Promise<void>): void;
	start(): Promise<void>;
	stop(): Promise<void>;
}
