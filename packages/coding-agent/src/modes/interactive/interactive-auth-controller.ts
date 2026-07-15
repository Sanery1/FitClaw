import * as path from "node:path";
import type { Api, Model, OAuthProviderId } from "@fitclaw/ai";
import type { Component, Container, EditorComponent, TUI } from "@fitclaw/tui";
import { getAuthPath, getDocsPath } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { defaultModelPerProvider } from "../../core/model-resolver.js";
import { AnthropicAuthWarning } from "./anthropic-auth-warning.js";
import { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { LoginDialogComponent } from "./components/login-dialog.js";
import { type AuthSelectorProvider, OAuthSelectorComponent } from "./components/oauth-selector.js";
import {
	BEDROCK_PROVIDER_ID,
	getApiKeyProviderDisplayName,
	hasDefaultModelProvider,
	isApiKeyLoginProvider,
} from "./provider-login-policy.js";
import { theme } from "./theme/theme.js";

type SelectorFactory = (done: () => void) => { component: Component; focus: Component };

export interface InteractiveAuthControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	editorContainer: Container;
	getEditor: () => EditorComponent;
	showSelector: (create: SelectorFactory) => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	showWarning: (message: string) => void;
	updateAvailableProviderCount: () => Promise<void>;
	invalidateFooter: () => void;
	updateEditorBorderColor: () => void;
	checkModelEasterEgg: (model: { provider: string; id: string }) => void;
}

function isUnknownModel(model: Model<Api> | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

export class InteractiveAuthController {
	private readonly anthropicWarning: AnthropicAuthWarning;

	constructor(private readonly options: InteractiveAuthControllerOptions) {
		this.anthropicWarning = new AnthropicAuthWarning({
			getWarnings: () => this.session.settingsManager.getWarnings(),
			getStoredCredential: () => this.session.modelRegistry.authStorage.get("anthropic"),
			getApiKeyForProvider: (provider) => this.session.modelRegistry.getApiKeyForProvider(provider),
			showWarning: options.showWarning,
		});
	}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	show(mode: "login" | "logout"): void {
		if (mode === "login") {
			this.showLoginAuthTypeSelector();
			return;
		}

		const providerOptions = this.getLogoutProviderOptions();
		if (providerOptions.length === 0) {
			this.options.showStatus(
				"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
			);
			return;
		}

		this.options.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				this.session.modelRegistry.authStorage,
				providerOptions,
				async (providerId) => {
					done();
					const providerOption = providerOptions.find((provider) => provider.id === providerId);
					if (!providerOption) return;

					try {
						this.session.modelRegistry.authStorage.logout(providerOption.id);
						this.session.modelRegistry.refresh();
						await this.options.updateAvailableProviderCount();
						const message =
							providerOption.authType === "oauth"
								? `Logged out of ${providerOption.name}`
								: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
						this.options.showStatus(message);
					} catch (error: unknown) {
						this.options.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				},
				() => {
					done();
					this.options.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	async maybeWarnAboutAnthropicSubscriptionAuth(
		model: { provider: string } | undefined = this.session.model,
	): Promise<void> {
		await this.anthropicWarning.maybeWarn(model);
	}

	private getLoginProviderOptions(authType: "oauth" | "api_key"): AuthSelectorProvider[] {
		const authStorage = this.session.modelRegistry.authStorage;
		const oauthProviders = authStorage.getOAuthProviders();
		const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
		const providerOptions: AuthSelectorProvider[] = oauthProviders.map((provider) => ({
			id: provider.id,
			name: provider.name,
			authType: "oauth",
		}));

		const modelProviders = new Set(this.session.modelRegistry.getAll().map((model) => model.provider));
		for (const providerId of modelProviders) {
			if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) continue;
			providerOptions.push({
				id: providerId,
				name: getApiKeyProviderDisplayName(providerId),
				authType: "api_key",
			});
		}

		return providerOptions
			.filter((provider) => provider.authType === authType)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getLogoutProviderOptions(): AuthSelectorProvider[] {
		const authStorage = this.session.modelRegistry.authStorage;
		const oauthNameById = new Map(authStorage.getOAuthProviders().map((provider) => [provider.id, provider.name]));
		const providerOptions: AuthSelectorProvider[] = [];

		for (const providerId of authStorage.list()) {
			const credential = authStorage.get(providerId);
			if (!credential) continue;
			providerOptions.push({
				id: providerId,
				name:
					credential.type === "oauth"
						? (oauthNameById.get(providerId) ?? providerId)
						: getApiKeyProviderDisplayName(providerId),
				authType: credential.type,
			});
		}

		return providerOptions.sort((a, b) => a.name.localeCompare(b.name));
	}

	private showLoginAuthTypeSelector(): void {
		const subscriptionLabel = "Use a subscription";
		const apiKeyLabel = "Use an API key";
		this.options.showSelector((done) => {
			const selector = new ExtensionSelectorComponent(
				"Select authentication method:",
				[subscriptionLabel, apiKeyLabel],
				(option) => {
					done();
					this.showLoginProviderSelector(option === subscriptionLabel ? "oauth" : "api_key");
				},
				() => {
					done();
					this.options.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private showLoginProviderSelector(authType: "oauth" | "api_key"): void {
		const providerOptions = this.getLoginProviderOptions(authType);
		if (providerOptions.length === 0) {
			this.options.showStatus(
				authType === "oauth" ? "No subscription providers available." : "No API key providers available.",
			);
			return;
		}

		this.options.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				"login",
				this.session.modelRegistry.authStorage,
				providerOptions,
				async (providerId) => {
					done();
					const providerOption = providerOptions.find((provider) => provider.id === providerId);
					if (!providerOption) return;

					if (providerOption.authType === "oauth") {
						await this.showLoginDialog(providerOption.id, providerOption.name);
					} else if (providerOption.id === BEDROCK_PROVIDER_ID) {
						this.showBedrockSetupDialog(providerOption.id, providerOption.name);
					} else {
						await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
					}
				},
				() => {
					done();
					this.showLoginAuthTypeSelector();
				},
				(providerId) => this.session.modelRegistry.getProviderAuthStatus(providerId),
			);
			return { component: selector, focus: selector };
		});
	}

	private async completeProviderAuthentication(
		providerId: string,
		providerName: string,
		authType: "oauth" | "api_key",
		previousModel: Model<Api> | undefined,
	): Promise<void> {
		this.session.modelRegistry.refresh();
		const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

		let selectedModel: Model<Api> | undefined;
		let selectionError: string | undefined;
		if (isUnknownModel(previousModel)) {
			const providerModels = this.session.modelRegistry
				.getAvailable()
				.filter((model) => model.provider === providerId);
			if (!hasDefaultModelProvider(providerId)) {
				selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
			} else if (providerModels.length === 0) {
				selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
			} else {
				const defaultModelId = defaultModelPerProvider[providerId];
				selectedModel = providerModels.find((model) => model.id === defaultModelId);
				if (!selectedModel) {
					selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
				} else {
					try {
						await this.session.setModel(selectedModel);
					} catch (error: unknown) {
						selectedModel = undefined;
						const errorMessage = error instanceof Error ? error.message : String(error);
						selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
					}
				}
			}
		}

		await this.options.updateAvailableProviderCount();
		this.options.invalidateFooter();
		this.options.updateEditorBorderColor();
		if (selectedModel) {
			this.options.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
			void this.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
			this.options.checkModelEasterEgg(selectedModel);
			return;
		}

		this.options.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
		if (selectionError) {
			this.options.showError(selectionError);
		} else {
			void this.maybeWarnAboutAnthropicSubscriptionAuth();
		}
	}

	private restoreEditor(): void {
		const editor = this.options.getEditor();
		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(editor);
		this.options.ui.setFocus(editor);
		this.options.ui.requestRender();
	}

	private showBedrockSetupDialog(providerId: string, providerName: string): void {
		const dialog = new LoginDialogComponent(
			this.options.ui,
			providerId,
			() => this.restoreEditor(),
			providerName,
			"Amazon Bedrock setup",
		);
		dialog.showInfo([
			theme.fg("text", "Amazon Bedrock uses AWS credentials instead of a single API key."),
			theme.fg("text", "Configure an AWS profile, IAM keys, bearer token, or role-based credentials."),
			theme.fg("muted", "See:"),
			theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
		]);

		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(dialog);
		this.options.ui.setFocus(dialog);
		this.options.ui.requestRender();
	}

	private async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
		const previousModel = this.session.model;
		const dialog = new LoginDialogComponent(this.options.ui, providerId, () => undefined, providerName);

		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(dialog);
		this.options.ui.setFocus(dialog);
		this.options.ui.requestRender();

		try {
			const apiKey = (await dialog.showPrompt("Enter API key:")).trim();
			if (!apiKey) throw new Error("API key cannot be empty.");
			this.session.modelRegistry.authStorage.set(providerId, { type: "api_key", key: apiKey });

			this.restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
		} catch (error: unknown) {
			this.restoreEditor();
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage !== "Login cancelled") {
				this.options.showError(`Failed to save API key for ${providerName}: ${errorMessage}`);
			}
		}
	}

	private async showLoginDialog(providerId: string, providerName: string): Promise<void> {
		const providerInfo = this.session.modelRegistry.authStorage
			.getOAuthProviders()
			.find((provider) => provider.id === providerId);
		const previousModel = this.session.model;
		const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;
		const dialog = new LoginDialogComponent(this.options.ui, providerId, () => undefined, providerName);

		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(dialog);
		this.options.ui.setFocus(dialog);
		this.options.ui.requestRender();

		let manualCodeResolve: ((code: string) => void) | undefined;
		let manualCodeReject: ((error: Error) => void) | undefined;
		const manualCodePromise = new Promise<string>((resolve, reject) => {
			manualCodeResolve = resolve;
			manualCodeReject = reject;
		});

		try {
			await this.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
				onAuth: (info) => {
					dialog.showAuth(info.url, info.instructions);
					if (usesCallbackServer) {
						dialog
							.showManualInput("Paste redirect URL below, or complete login in browser:")
							.then((value) => {
								if (value && manualCodeResolve) {
									manualCodeResolve(value);
									manualCodeResolve = undefined;
								}
							})
							.catch(() => {
								if (manualCodeReject) {
									manualCodeReject(new Error("Login cancelled"));
									manualCodeReject = undefined;
								}
							});
					} else if (providerId === "github-copilot") {
						dialog.showWaiting("Waiting for browser authentication...");
					}
				},
				onPrompt: (prompt) => dialog.showPrompt(prompt.message, prompt.placeholder),
				onProgress: (message) => dialog.showProgress(message),
				onManualCodeInput: () => manualCodePromise,
				signal: dialog.signal,
			});

			this.restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
		} catch (error: unknown) {
			this.restoreEditor();
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage !== "Login cancelled") {
				this.options.showError(`Failed to login to ${providerName}: ${errorMessage}`);
			}
		}
	}
}
