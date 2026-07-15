import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent } from "@fitclaw/agent-core";
import { type AssistantMessage, getModel, type Usage } from "@fitclaw/ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { CURRENT_SESSION_VERSION, SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(text: string, totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp,
	};
}

function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRegistry: ModelRegistry.inMemory(authStorage),
		resourceLoader: createTestResourceLoader(),
	});

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("AgentSession.getSessionStats", () => {
	it("exposes the current context usage alongside token totals", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			expect(stats.contextUsage?.tokens).toBe(200);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports unknown current context usage immediately after compaction", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(195_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBeNull();
			expect(stats.contextUsage?.percent).toBeNull();
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(220_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});
});

describe("AgentSession reporting", () => {
	it("exports only the current branch to JSONL", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "fitclaw-session-export-"));
		const { session, sessionManager } = createSession();

		try {
			const rootId = sessionManager.appendMessage(createUserMessage("root", 1));
			sessionManager.appendMessage(createAssistantMessage("abandoned", 10, 2));
			sessionManager.branch(rootId);
			const activeId = sessionManager.appendMessage(createAssistantMessage("active", 20, 3));

			const requestedPath = join(tempDir, "nested", "session.jsonl");
			const exportedPath = session.exportToJsonl(requestedPath);
			const lines = readFileSync(exportedPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			expect(exportedPath).toBe(resolve(requestedPath));
			expect(lines[0]).toMatchObject({
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: sessionManager.getSessionId(),
				cwd: sessionManager.getCwd(),
			});
			expect(lines.slice(1).map((entry) => entry.id)).toEqual([rootId, activeId]);
			expect(lines.slice(1).map((entry) => entry.parentId)).toEqual([null, rootId]);
			expect(lines[2].message.content[0].text).toBe("active");
		} finally {
			session.dispose();
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("returns text from the last non-empty assistant response", () => {
		const { session } = createSession();
		const previous = createAssistantMessage(" previous response ", 10, 1);
		const aborted = {
			...createAssistantMessage("", 0, 2),
			content: [],
			stopReason: "aborted" as const,
		};

		try {
			session.agent.state.messages = [previous, aborted];
			expect(session.getLastAssistantText()).toBe("previous response");

			session.agent.state.messages = [
				previous,
				{
					...createAssistantMessage("", 20, 3),
					content: [
						{ type: "text", text: " latest " },
						{ type: "text", text: "response " },
					],
				},
			];
			expect(session.getLastAssistantText()).toBe("latest response");
		} finally {
			session.dispose();
		}
	});
});
