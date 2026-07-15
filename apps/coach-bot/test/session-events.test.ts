import type { AssistantMessage } from "@fitclaw/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CoachResponseQueue, createCoachRunState, createCoachSessionEventHandler } from "../src/runtime/events.js";
import type { BotContext } from "../src/types.js";

vi.mock("../src/log.js", () => ({
	logInfo: vi.fn(),
	logWarning: vi.fn(),
	logToolStart: vi.fn(),
	logToolError: vi.fn(),
	logToolSuccess: vi.fn(),
	logResponseStart: vi.fn(),
	logResponse: vi.fn(),
	logThinking: vi.fn(),
}));

function createAssistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "check saved context" },
			{ type: "text", text: "Training" },
			{ type: "text", text: "summary" },
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-test",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			totalTokens: 18,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createContext(): BotContext {
	return {
		message: { text: "", rawText: "", user: "user", channel: "channel", ts: "1" },
		channels: [],
		users: [],
		respond: vi.fn(async () => {}),
		replaceMessage: vi.fn(async () => {}),
		respondInThread: vi.fn(async () => {}),
		setTyping: vi.fn(async () => {}),
		uploadFile: vi.fn(async () => {}),
		setWorking: vi.fn(async () => {}),
		deleteMessage: vi.fn(async () => {}),
	};
}

describe("coach session events", () => {
	let queuedTasks: Array<{ fn: () => Promise<void>; errorContext: string }>;
	let queuedMessages: Array<{ text: string; target: "main" | "thread"; errorContext: string; doLog?: boolean }>;
	let queue: CoachResponseQueue;

	beforeEach(() => {
		queuedTasks = [];
		queuedMessages = [];
		queue = {
			enqueue: (fn, errorContext) => queuedTasks.push({ fn, errorContext }),
			enqueueMessage: (text, target, errorContext, doLog) =>
				queuedMessages.push({ text, target, errorContext, doLog }),
		};
	});

	it("records assistant usage and queues thinking and text responses", () => {
		const runState = createCoachRunState();
		runState.ctx = createContext();
		runState.logCtx = { channelId: "channel" };
		runState.queue = queue;

		createCoachSessionEventHandler(runState)({ type: "message_end", message: createAssistantMessage() });

		expect(runState.stopReason).toBe("stop");
		expect(runState.totalUsage).toEqual({
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		});
		expect(queuedMessages).toEqual([
			{ text: "_check saved context_", target: "thread", errorContext: "thinking thread", doLog: false },
			{ text: "Training\nsummary", target: "main", errorContext: "response main", doLog: undefined },
			{ text: "Training\nsummary", target: "thread", errorContext: "response thread", doLog: false },
		]);
	});

	it("queues a user-visible status when the session retries", async () => {
		const runState = createCoachRunState();
		const context = createContext();
		runState.ctx = context;
		runState.logCtx = { channelId: "channel" };
		runState.queue = queue;

		createCoachSessionEventHandler(runState)({
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 2000,
			errorMessage: "rate limited",
		});

		expect(queuedTasks).toHaveLength(1);
		expect(queuedTasks[0].errorContext).toBe("retry");
		await queuedTasks[0].fn();
		expect(context.respond).toHaveBeenCalledWith("_Retrying (2/3)..._", false);
	});
});
