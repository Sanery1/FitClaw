import type { AssistantMessage } from "@fitclaw/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CoachResponseQueue, createCoachRunState, createCoachSessionEventHandler } from "../src/runtime/events.js";
import { buildRunTrace } from "../src/runtime/run-trace.js";
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

	it("records only redacted tool status and safe knowledge metadata", () => {
		const runState = createCoachRunState();
		runState.ctx = createContext();
		runState.logCtx = { channelId: "channel" };
		runState.queue = queue;
		const handle = createCoachSessionEventHandler(runState);

		handle({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "knowledge_search",
			args: { query: "private prompt", collection: "kinesiology" },
		});
		handle({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "knowledge_search",
			isError: false,
			result: {
				content: [{ type: "text", text: "private textbook body" }],
				details: {
					collection: "kinesiology",
					resultCount: 1,
					pageIds: ["basic-kinesiology-3e:pdf:0100"],
				},
			},
		});

		expect(queuedMessages).toEqual([
			expect.objectContaining({ text: expect.stringMatching(/^\*✓ knowledge_search\* \(\d+\.\d+s\)$/) }),
		]);
		expect(JSON.stringify(queuedMessages)).not.toContain("private prompt");
		expect(JSON.stringify(queuedMessages)).not.toContain("private textbook body");
		expect(runState.toolTraces).toEqual([
			expect.objectContaining({
				toolName: "knowledge_search",
				status: "success",
				collection: "kinesiology",
				resultCount: 1,
				pageIds: ["basic-kinesiology-3e:pdf:0100"],
			}),
		]);
	});

	it("builds a RunTraceV1 without user content, local paths, or textbook text", () => {
		const runState = createCoachRunState();
		runState.startedAtMs = 1_000;
		runState.modelId = "provider/model";
		runState.skillFilesRead.add("bodybuilding/SKILL.md");
		runState.toolTraces.push({
			toolName: "knowledge_read",
			status: "success",
			durationMs: 20,
			collection: "kinesiology",
			resultCount: 1,
			pageIds: ["basic-kinesiology-3e:pdf:0100"],
		});

		const trace = buildRunTrace(runState, 1_050);
		const serialized = JSON.stringify(trace);
		expect(trace).toMatchObject({ duration_ms: 50, model_id: "provider/model", status: "success" });
		expect(serialized).not.toMatch(/private prompt|textbook body|[A-Z]:\\|user_id|channel/);
	});

	it("treats unavailable visual rendering as a successful text-only degradation", () => {
		const runState = createCoachRunState();
		runState.ctx = createContext();
		runState.logCtx = { channelId: "channel" };
		runState.queue = queue;
		const handle = createCoachSessionEventHandler(runState);

		handle({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "knowledge_read", args: {} });
		handle({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "knowledge_read",
			isError: false,
			result: {
				content: [{ type: "text", text: "safe extracted text" }],
				details: { resultCount: 1, pageIds: ["basic-kinesiology-3e:pdf:0100"], errorCode: "render_unavailable" },
			},
		});

		expect(runState.toolTraces[0]).toMatchObject({ status: "success", errorCode: "render_unavailable" });
		expect(runState.errorCode).toBeUndefined();
	});
});
