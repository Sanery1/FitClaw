import { Agent, type AgentTool } from "@fitclaw/agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@fitclaw/ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { AuthStorage, ManagedAgentSession, ModelRegistry, SessionManager, SettingsManager } from "../src/index.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function createTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
	};
}

function createSession(options?: {
	failCount?: number;
	retryEnabled?: boolean;
	maxRetries?: number;
	compactionEnabled?: boolean;
	inputTokens?: number;
	compact?: ConstructorParameters<typeof ManagedAgentSession>[0]["compact"];
}) {
	const model = getModel("anthropic", "claude-sonnet-4-5");
	const authStorage = AuthStorage.inMemory({ anthropic: { type: "api_key", key: "test-key" } });
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const settingsManager = SettingsManager.inMemory({
		retry: { enabled: options?.retryEnabled ?? false, maxRetries: options?.maxRetries ?? 2, baseDelayMs: 1 },
		compaction: {
			enabled: options?.compactionEnabled ?? false,
			reserveTokens: 100,
			keepRecentTokens: 1,
		},
	});
	let callCount = 0;
	const agent = new Agent({
		initialState: { model, systemPrompt: "initial prompt", tools: [] },
		getApiKey: () => "test-key",
		streamFn: () => {
			callCount++;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message =
					callCount <= (options?.failCount ?? 0)
						? createAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" })
						: createAssistantMessage("success", {
								usage: {
									input: options?.inputTokens ?? 10,
									output: 5,
									cacheRead: 0,
									cacheWrite: 0,
									totalTokens: (options?.inputTokens ?? 10) + 5,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								},
							});
				stream.push({ type: "start", partial: message });
				if (message.stopReason === "error") {
					stream.push({ type: "error", reason: "error", error: message });
				} else {
					stream.push({ type: "done", reason: "stop", message });
				}
			});
			return stream;
		},
	});
	const sessionManager = SessionManager.inMemory();
	const session = new ManagedAgentSession({
		agent,
		sessionManager,
		settingsManager,
		modelRegistry,
		compact: options?.compact,
	});
	return { agent, session, sessionManager, getCallCount: () => callCount };
}

describe("ManagedAgentSession", () => {
	it("updates prompt and tools without retaining caller-owned arrays", () => {
		const { agent, session } = createSession();
		const tools = [createTool("training_log")];

		session.updateRuntime("updated prompt", tools);
		tools.length = 0;

		expect(agent.state.systemPrompt).toBe("updated prompt");
		expect(agent.state.tools.map((tool) => tool.name)).toEqual(["training_log"]);
		session.dispose();
	});

	it("persists events and completes an automatic retry before returning", async () => {
		const { session, sessionManager, getCallCount } = createSession({ failCount: 1, retryEnabled: true });
		const eventTypes: string[] = [];
		session.subscribe((event) => eventTypes.push(event.type));

		await session.prompt("build a training plan");

		expect(getCallCount()).toBe(2);
		expect(eventTypes).toContain("auto_retry_start");
		expect(eventTypes).toContain("auto_retry_end");
		expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
		expect(sessionManager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(3);
		session.dispose();
	});

	it("stops after the shared retry policy is exhausted", async () => {
		const { session, getCallCount } = createSession({ failCount: 99, retryEnabled: true, maxRetries: 2 });
		const retryEndEvents: Array<{ success: boolean; attempt: number }> = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_end") retryEndEvents.push(event);
		});

		await session.prompt("build a training plan");

		expect(getCallCount()).toBe(3);
		expect(retryEndEvents).toContainEqual(expect.objectContaining({ success: false, attempt: 2 }));
		session.dispose();
	});

	it("compacts a session after a response crosses the context threshold", async () => {
		const contextWindow = getModel("anthropic", "claude-sonnet-4-5").contextWindow;
		const compactSession = vi.fn(async (preparation) => ({
			summary: "Earlier training context",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const { session, sessionManager } = createSession({
			compactionEnabled: true,
			inputTokens: contextWindow - 50,
			compact: compactSession,
		});
		const eventTypes: string[] = [];
		session.subscribe((event) => eventTypes.push(event.type));

		await session.prompt("summarize my recent training");

		expect(compactSession).toHaveBeenCalledOnce();
		expect(eventTypes).toContain("compaction_start");
		expect(eventTypes).toContain("compaction_end");
		expect(sessionManager.getEntries().at(-1)).toMatchObject({
			type: "compaction",
			summary: "Earlier training context",
		});
		session.dispose();
	});

	it("stops overflow recovery after one compact-and-retry attempt", async () => {
		const contextWindow = getModel("anthropic", "claude-sonnet-4-5").contextWindow;
		const compactSession = vi.fn(async (preparation) => ({
			summary: "Earlier training context",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		}));
		const { session, getCallCount } = createSession({
			compactionEnabled: true,
			inputTokens: contextWindow + 1,
			compact: compactSession,
		});
		const overflowFailures: string[] = [];
		session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) overflowFailures.push(event.errorMessage);
		});

		await session.prompt("summarize my recent training");

		expect(getCallCount()).toBe(2);
		expect(compactSession).toHaveBeenCalledOnce();
		expect(overflowFailures).toEqual([
			"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
		]);
		session.dispose();
	});
});
