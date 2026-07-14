import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";

export interface Attachment {
	original: string;
	local: string;
}

export interface LoggedMessage {
	date: string;
	ts: string;
	user: string;
	userName?: string;
	displayName?: string;
	text: string;
	attachments: Attachment[];
	isBot: boolean;
}

export interface ChannelStoreConfig {
	workingDir: string;
}

export class ChannelStore {
	private workingDir: string;
	private recentlyLogged = new Map<string, number>();

	constructor(config: ChannelStoreConfig) {
		this.workingDir = config.workingDir;

		if (!existsSync(this.workingDir)) {
			mkdirSync(this.workingDir, { recursive: true });
		}
	}

	getChannelDir(channelId: string): string {
		const dir = join(this.workingDir, channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
		const dedupeKey = `${channelId}:${message.ts}`;
		if (this.recentlyLogged.has(dedupeKey)) {
			return false;
		}

		this.recentlyLogged.set(dedupeKey, Date.now());
		setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

		const logPath = join(this.getChannelDir(channelId), "log.jsonl");

		const messageToWrite = message.date
			? message
			: { ...message, date: new Date(parseInt(message.ts, 10) || Date.now()).toISOString() };

		const line = `${JSON.stringify(messageToWrite)}\n`;
		await appendFile(logPath, line, "utf-8");
		return true;
	}

	async logBotResponse(channelId: string, text: string, ts: string): Promise<void> {
		await this.logMessage(channelId, {
			date: new Date().toISOString(),
			ts,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	getLastTimestamp(channelId: string): string | null {
		const logPath = join(this.workingDir, channelId, "log.jsonl");
		if (!existsSync(logPath)) {
			return null;
		}

		try {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0 || lines[0] === "") {
				return null;
			}
			const lastLine = lines[lines.length - 1];
			const message = JSON.parse(lastLine) as LoggedMessage;
			return message.ts;
		} catch {
			return null;
		}
	}
}
