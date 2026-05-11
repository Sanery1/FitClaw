import { describe, expect, it } from "vitest";
import { getApiKeyProviderDisplayName, isApiKeyLoginProvider } from "../src/modes/interactive/provider-login-policy.js";

describe("provider login policy", () => {
	it("classifies built-in, oauth, and custom providers outside interactive mode", () => {
		const oauthProviderIds = new Set(["github-copilot", "custom-oauth"]);
		const builtInProviderIds = new Set(["anthropic", "github-copilot", "openai"]);

		expect(isApiKeyLoginProvider("anthropic", oauthProviderIds, builtInProviderIds)).toBe(true);
		expect(getApiKeyProviderDisplayName("anthropic")).toBe("Anthropic");
		expect(isApiKeyLoginProvider("openai", oauthProviderIds, builtInProviderIds)).toBe(true);
		expect(isApiKeyLoginProvider("github-copilot", oauthProviderIds, builtInProviderIds)).toBe(false);
		expect(isApiKeyLoginProvider("custom-oauth", oauthProviderIds, builtInProviderIds)).toBe(false);
		expect(isApiKeyLoginProvider("custom-api", oauthProviderIds, builtInProviderIds)).toBe(true);
	});
});
