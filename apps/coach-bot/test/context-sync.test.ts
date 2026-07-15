import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserMessage } from "@fitclaw/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CoachSessionHistory, syncLogToSessionManager } from "../src/context.js";

describe("coach context synchronization", () => {
	let channelDir: string;

	beforeEach(() => {
		channelDir = join(tmpdir(), `fitclaw-coach-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(channelDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(channelDir, { recursive: true, force: true });
	});

	it("adds unseen user messages in timestamp order and excludes the active message", () => {
		const appended: UserMessage[] = [];
		const history: CoachSessionHistory = {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "[Alice]: already stored" }],
					},
				},
			],
			appendMessage: (message) => appended.push(message),
		};

		const logEntries = [
			{ ts: "existing", date: "2026-07-15T10:00:00.000Z", userName: "Alice", text: "already stored" },
			{ ts: "later", date: "2026-07-15T10:02:00.000Z", userName: "Alice", text: "second unseen" },
			{ ts: "earlier", date: "2026-07-15T10:01:00.000Z", userName: "Bob", text: "first unseen" },
			{ ts: "active", date: "2026-07-15T10:03:00.000Z", userName: "Alice", text: "current message" },
			{ ts: "bot", date: "2026-07-15T10:04:00.000Z", userName: "FitCoach", text: "bot reply", isBot: true },
		];
		writeFileSync(join(channelDir, "log.jsonl"), logEntries.map((entry) => JSON.stringify(entry)).join("\n"));

		const syncedCount = syncLogToSessionManager(history, channelDir, "active");

		expect(syncedCount).toBe(2);
		expect(appended.map((message) => message.content)).toEqual([
			[{ type: "text", text: "[Bob]: first unseen" }],
			[{ type: "text", text: "[Alice]: second unseen" }],
		]);
	});
});
