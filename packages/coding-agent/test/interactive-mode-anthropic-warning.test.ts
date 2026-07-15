import { describe, expect, test, vi } from "vitest";
import { AnthropicAuthWarning } from "../src/modes/interactive/anthropic-auth-warning.js";

function createWarning(options?: {
	warnings?: { anthropicExtraUsage?: boolean };
	storedCredential?: { type: string };
	apiKey?: string;
}) {
	const getWarnings = vi.fn(() => options?.warnings ?? {});
	const getStoredCredential = vi.fn(() => options?.storedCredential);
	const getApiKeyForProvider = vi.fn(async () => options?.apiKey);
	const showWarning = vi.fn();
	const warning = new AnthropicAuthWarning({
		getWarnings,
		getStoredCredential,
		getApiKeyForProvider,
		showWarning,
	});
	return { warning, getStoredCredential, getApiKeyForProvider, showWarning };
}

describe("AnthropicAuthWarning", () => {
	test("warns once when Anthropic subscription auth is detected", async () => {
		const harness = createWarning({ apiKey: "sk-ant-oat01-test" });

		await harness.warning.maybeWarn({ provider: "anthropic" });
		await harness.warning.maybeWarn({ provider: "anthropic" });

		expect(harness.showWarning).toHaveBeenCalledTimes(1);
		expect(harness.getApiKeyForProvider).toHaveBeenCalledTimes(1);
	});

	test("warns when Anthropic OAuth is stored even if token refresh lookup would fail", async () => {
		const harness = createWarning({ storedCredential: { type: "oauth" } });

		await harness.warning.maybeWarn({ provider: "anthropic" });

		expect(harness.showWarning).toHaveBeenCalledTimes(1);
		expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
	});

	test("does not warn for non-Anthropic models", async () => {
		const harness = createWarning();

		await harness.warning.maybeWarn({ provider: "openai" });

		expect(harness.showWarning).not.toHaveBeenCalled();
		expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
	});

	test("does not warn when Anthropic extra usage warning is disabled", async () => {
		const harness = createWarning({ warnings: { anthropicExtraUsage: false } });

		await harness.warning.maybeWarn({ provider: "anthropic" });

		expect(harness.showWarning).not.toHaveBeenCalled();
		expect(harness.getStoredCredential).not.toHaveBeenCalled();
		expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
	});
});
