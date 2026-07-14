import type { AgentMessage } from "@fitclaw/agent-core";
import { describe, expect, it } from "vitest";
import { getCoachContextWindowOptions, windowCoachContext } from "../src/context-window.js";

function userMessage(id: number, content = `user ${id}`): AgentMessage {
	return {
		role: "user",
		content,
		timestamp: id,
	};
}

function assistantMessage(id: number, content = `assistant ${id}`): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: content }],
		api: "anthropic-messages",
		provider: "Anthropic",
		model: "claude-test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: id,
	};
}

describe("windowCoachContext", () => {
	it("returns all messages when the context is already inside the window", () => {
		const messages = [userMessage(1), assistantMessage(2)];

		const result = windowCoachContext(messages, { maxMessages: 10, maxSerializedChars: 10_000 });

		expect(result.messages).toEqual(messages);
		expect(result.messages).not.toBe(messages);
		expect(result.originalCount).toBe(2);
		expect(result.retainedCount).toBe(2);
		expect(result.wasTrimmed).toBe(false);
	});

	it("trims old complete user turns when message count exceeds the window", () => {
		const messages = [
			userMessage(1),
			assistantMessage(2),
			userMessage(3),
			assistantMessage(4),
			userMessage(5),
			assistantMessage(6),
		];

		const result = windowCoachContext(messages, { maxMessages: 4, maxSerializedChars: 10_000 });

		expect(result.messages).toEqual([userMessage(3), assistantMessage(4), userMessage(5), assistantMessage(6)]);
		expect(result.originalCount).toBe(6);
		expect(result.retainedCount).toBe(4);
		expect(result.wasTrimmed).toBe(true);
	});

	it("retains the newest message even when it exceeds the character window", () => {
		const messages = [userMessage(1, "old"), userMessage(2, "x".repeat(200))];

		const result = windowCoachContext(messages, { maxMessages: 10, maxSerializedChars: 80 });

		expect(result.messages).toEqual([userMessage(2, "x".repeat(200))]);
		expect(result.wasTrimmed).toBe(true);
	});
});

describe("getCoachContextWindowOptions", () => {
	it("uses defaults when environment variables are absent", () => {
		expect(getCoachContextWindowOptions({})).toEqual({
			maxMessages: 80,
			maxSerializedChars: 120_000,
		});
	});

	it("reads positive integer overrides from the environment", () => {
		expect(
			getCoachContextWindowOptions({
				MOM_CONTEXT_MAX_MESSAGES: "12",
				MOM_CONTEXT_MAX_CHARS: "3456",
			}),
		).toEqual({
			maxMessages: 12,
			maxSerializedChars: 3456,
		});
	});
});
