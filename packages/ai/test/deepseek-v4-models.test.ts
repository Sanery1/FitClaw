import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import type { OpenAICompletionsCompat } from "../src/types.js";

describe("DeepSeek V4 models", () => {
	it("registers V4 Pro with the official API contract and pricing", () => {
		const model = getModel("deepseek", "deepseek-v4-pro");
		const compat = model.compat as OpenAICompletionsCompat | undefined;

		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("https://api.deepseek.com");
		expect(model.reasoning).toBe(true);
		expect(model.input).toEqual(["text"]);
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(384_000);
		expect(model.cost).toEqual({
			input: 0.435,
			output: 0.87,
			cacheRead: 0.003625,
			cacheWrite: 0,
		});
		expect(compat?.thinkingFormat).toBe("deepseek");
		expect(compat?.requiresReasoningContentOnAssistantMessages).toBe(true);
	});

	it("uses the official V4 Flash cache-hit price", () => {
		const model = getModel("deepseek", "deepseek-v4-flash");

		expect(model.cost.cacheRead).toBe(0.0028);
	});
});
