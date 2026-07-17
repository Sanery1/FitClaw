import type { AgentMessage } from "@fitclaw/agent-core";
import type { Message, TextContent } from "@fitclaw/ai";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { getAgentDir as getDefaultAgentDir, getSessionsDir } from "../paths.js";
import type {
	FileEntry,
	SessionEntryBase,
	SessionHeader,
	SessionInfoEntry,
	SessionMessageEntry,
} from "./session-format.js";

export interface SessionInfo {
	path: string;
	id: string;
	/** Working directory where the session was started. Empty string for old sessions. */
	cwd: string;
	/** User-defined display name from session_info entries. */
	name?: string;
	/** Path to the parent session (if this session was forked). */
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
}

export type SessionListProgress = (loaded: number, total: number) => void;

/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.fitclaw/agent/sessions/.
 */
export function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}
	return sessionDir;
}

/** Exported for testing */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf8");
	const entries: FileEntry[] = [];
	const lines = content.trim().split("\n");

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as FileEntry);
		} catch {
			// Skip malformed lines
		}
	}

	if (entries.length === 0) return entries;
	const header = entries[0];
	if (header.type !== "session" || typeof (header as { id?: unknown }).id !== "string") {
		return [];
	}

	return entries;
}

function isValidSessionFile(filePath: string): boolean {
	try {
		const fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		closeSync(fd);
		const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
		if (!firstLine) return false;
		const header = JSON.parse(firstLine);
		return header.type === "session" && typeof header.id === "string";
	} catch {
		return false;
	}
}

/** Exported for testing */
export function findMostRecentSession(sessionDir: string): string | null {
	try {
		const files = readdirSync(sessionDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => join(sessionDir, file))
			.filter(isValidSessionFile)
			.map((path) => ({ path, mtime: statSync(path).mtime }))
			.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

		return files[0]?.path || null;
	} catch {
		return null;
	}
}

function isMessageWithContent(message: AgentMessage): message is Message {
	return typeof (message as Message).role === "string" && "content" in message;
}

function extractTextContent(message: Message): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

function getLastActivityTime(entries: FileEntry[]): number | undefined {
	let lastActivityTime: number | undefined;

	for (const entry of entries) {
		if (entry.type !== "message") continue;

		const message = (entry as SessionMessageEntry).message;
		if (!isMessageWithContent(message)) continue;
		if (message.role !== "user" && message.role !== "assistant") continue;

		const msgTimestamp = (message as { timestamp?: number }).timestamp;
		if (typeof msgTimestamp === "number") {
			lastActivityTime = Math.max(lastActivityTime ?? 0, msgTimestamp);
			continue;
		}

		const entryTimestamp = (entry as SessionEntryBase).timestamp;
		if (typeof entryTimestamp === "string") {
			const timestamp = new Date(entryTimestamp).getTime();
			if (!Number.isNaN(timestamp)) {
				lastActivityTime = Math.max(lastActivityTime ?? 0, timestamp);
			}
		}
	}

	return lastActivityTime;
}

function getSessionModifiedDate(entries: FileEntry[], header: SessionHeader, statsMtime: Date): Date {
	const lastActivityTime = getLastActivityTime(entries);
	if (typeof lastActivityTime === "number" && lastActivityTime > 0) {
		return new Date(lastActivityTime);
	}

	const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
	return !Number.isNaN(headerTime) ? new Date(headerTime) : statsMtime;
}

async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
	try {
		const content = await readFile(filePath, "utf8");
		const entries: FileEntry[] = [];
		const lines = content.trim().split("\n");

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line) as FileEntry);
			} catch {
				// Skip malformed lines
			}
		}

		if (entries.length === 0) return null;
		const header = entries[0];
		if (header.type !== "session") return null;

		const stats = await stat(filePath);
		let messageCount = 0;
		let firstMessage = "";
		const allMessages: string[] = [];
		let name: string | undefined;

		for (const entry of entries) {
			if (entry.type === "session_info") {
				const infoEntry = entry as SessionInfoEntry;
				name = infoEntry.name?.trim() || undefined;
			}

			if (entry.type !== "message") continue;
			messageCount++;

			const message = (entry as SessionMessageEntry).message;
			if (!isMessageWithContent(message)) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;

			const textContent = extractTextContent(message);
			if (!textContent) continue;

			allMessages.push(textContent);
			if (!firstMessage && message.role === "user") {
				firstMessage = textContent;
			}
		}

		const sessionHeader = header as SessionHeader;
		const modified = getSessionModifiedDate(entries, sessionHeader, stats.mtime);

		return {
			path: filePath,
			id: sessionHeader.id,
			cwd: typeof sessionHeader.cwd === "string" ? sessionHeader.cwd : "",
			name,
			parentSessionPath: sessionHeader.parentSession,
			created: new Date(sessionHeader.timestamp),
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
			allMessagesText: allMessages.join(" "),
		};
	} catch {
		return null;
	}
}

export async function listSessionsFromDir(
	dir: string,
	onProgress?: SessionListProgress,
	progressOffset = 0,
	progressTotal?: number,
): Promise<SessionInfo[]> {
	const sessions: SessionInfo[] = [];
	if (!existsSync(dir)) {
		return sessions;
	}

	try {
		const dirEntries = await readdir(dir);
		const files = dirEntries.filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file));
		const total = progressTotal ?? files.length;

		let loaded = 0;
		const results = await Promise.all(
			files.map(async (file) => {
				const info = await buildSessionInfo(file);
				loaded++;
				onProgress?.(progressOffset + loaded, total);
				return info;
			}),
		);
		for (const info of results) {
			if (info) {
				sessions.push(info);
			}
		}
	} catch {
		// Return empty list on error
	}

	return sessions;
}

export async function listAllSessions(onProgress?: SessionListProgress): Promise<SessionInfo[]> {
	const sessionsDir = getSessionsDir();

	try {
		if (!existsSync(sessionsDir)) {
			return [];
		}
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsDir, entry.name));

		let totalFiles = 0;
		const dirFiles: string[][] = [];
		for (const dir of dirs) {
			try {
				const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
				dirFiles.push(files.map((file) => join(dir, file)));
				totalFiles += files.length;
			} catch {
				dirFiles.push([]);
			}
		}

		let loaded = 0;
		const sessions: SessionInfo[] = [];
		const results = await Promise.all(
			dirFiles.flat().map(async (file) => {
				const info = await buildSessionInfo(file);
				loaded++;
				onProgress?.(loaded, totalFiles);
				return info;
			}),
		);

		for (const info of results) {
			if (info) {
				sessions.push(info);
			}
		}

		sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		return sessions;
	} catch {
		return [];
	}
}
