/**
 * Bot adapter types.
 * Decouples the IM layer (Feishu) from the Agent orchestration layer.
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
