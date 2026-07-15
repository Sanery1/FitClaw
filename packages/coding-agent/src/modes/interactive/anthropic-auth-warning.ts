export interface AnthropicAuthWarningOptions {
	getWarnings: () => { anthropicExtraUsage?: boolean };
	getStoredCredential: () => { type: string } | undefined;
	getApiKeyForProvider: (provider: string) => Promise<string | undefined>;
	showWarning: (message: string) => void;
}

const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
	"Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
	return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

export class AnthropicAuthWarning {
	private isShown = false;

	constructor(private readonly options: AnthropicAuthWarningOptions) {}

	async maybeWarn(model: { provider: string } | undefined): Promise<void> {
		if (this.options.getWarnings().anthropicExtraUsage === false || this.isShown || model?.provider !== "anthropic") {
			return;
		}

		const storedCredential = this.options.getStoredCredential();
		if (storedCredential?.type === "oauth") {
			this.isShown = true;
			this.options.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
			return;
		}

		try {
			const apiKey = await this.options.getApiKeyForProvider(model.provider);
			if (!isAnthropicSubscriptionAuthKey(apiKey)) return;
			this.isShown = true;
			this.options.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
		} catch {
			// Warning-only auth lookups must not interrupt the active session.
		}
	}
}
