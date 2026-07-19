import { describe, expect, it } from "vitest";
import { createDeploymentModelsConfig, parseDeploymentApi } from "../src/runtime/deployment-model-config.js";

describe("deployment model config", () => {
	it("accepts a registered API transport", () => {
		expect(parseDeploymentApi("openai-completions")).toBe("openai-completions");
	});

	it("rejects an unknown API transport", () => {
		expect(() => parseDeploymentApi("openai-typo")).toThrow('Unsupported model API transport: "openai-typo"');
	});

	it("preserves built-in DeepSeek model metadata by using a provider override", () => {
		expect(
			createDeploymentModelsConfig({
				provider: "deepseek",
				modelId: "deepseek-v4-pro",
				baseUrl: "https://api.deepseek.com",
				api: "openai-completions",
				apiKeyEnvName: "MOM_LLM_API_KEY",
			}),
		).toEqual({
			providers: {
				deepseek: {
					baseUrl: "https://api.deepseek.com",
					api: "openai-completions",
				},
			},
		});
	});

	it("registers an unknown model on a built-in provider", () => {
		const config = createDeploymentModelsConfig({
			provider: "deepseek",
			modelId: "deepseek-future-model",
			baseUrl: "https://api.deepseek.com",
			api: "openai-completions",
			apiKeyEnvName: "MOM_LLM_API_KEY",
		});

		expect(config.providers.deepseek.models).toEqual([{ id: "deepseek-future-model" }]);
		expect(config.providers.deepseek.apiKey).toBeUndefined();
	});

	it("registers an unknown provider with an environment-backed API key", () => {
		expect(
			createDeploymentModelsConfig({
				provider: "custom-provider",
				modelId: "custom-model",
				baseUrl: "https://llm.example.com/v1",
				api: "openai-completions",
				apiKeyEnvName: "MOM_LLM_API_KEY",
			}),
		).toEqual({
			providers: {
				"custom-provider": {
					baseUrl: "https://llm.example.com/v1",
					api: "openai-completions",
					apiKey: "MOM_LLM_API_KEY",
					models: [{ id: "custom-model" }],
				},
			},
		});
	});
});
