import type { Api, Model } from "@fitclaw/ai";
import type { Component, TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import { findExactModelReferenceMatch, resolveModelScope } from "../../core/model-resolver.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.js";

type SelectorFactory = (done: () => void) => { component: Component; focus: Component };

export interface InteractiveModelControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	showSelector: (create: SelectorFactory) => void;
	invalidateFooter: () => void;
	setAvailableProviderCount: (count: number) => void;
	updateEditorBorderColor: () => void;
	warnAboutAnthropicSubscriptionAuth: (model?: Model<Api>) => Promise<void>;
	checkModelEasterEgg: (model: Model<Api>) => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
}

export class InteractiveModelController {
	constructor(private readonly options: InteractiveModelControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	async handleCommand(searchTerm?: string): Promise<void> {
		if (!searchTerm) {
			this.showModelSelector();
			return;
		}

		const model = findExactModelReferenceMatch(searchTerm, await this.getModelCandidates());
		if (model) {
			await this.selectModel(model);
			return;
		}

		this.showModelSelector(searchTerm);
	}

	async cycle(direction: "forward" | "backward"): Promise<void> {
		try {
			const result = await this.session.cycleModel(direction);
			if (result === undefined) {
				const message =
					this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.options.showStatus(message);
				return;
			}

			this.options.invalidateFooter();
			this.options.updateEditorBorderColor();
			const thinking =
				result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
			this.options.showStatus(`Switched to ${result.model.name || result.model.id}${thinking}`);
			void this.options.warnAboutAnthropicSubscriptionAuth(result.model);
		} catch (error: unknown) {
			this.options.showError(error instanceof Error ? error.message : String(error));
		}
	}

	showModelSelector(initialSearchInput?: string): void {
		this.options.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				this.options.ui,
				this.session.model,
				this.session.settingsManager,
				this.session.modelRegistry,
				this.session.scopedModels,
				(model) => this.selectModel(model, done),
				() => {
					done();
					this.options.ui.requestRender();
				},
				initialSearchInput,
			);
			return { component: selector, focus: selector };
		});
	}

	async showScopedModelsSelector(): Promise<void> {
		this.session.modelRegistry.refresh();
		const allModels = this.session.modelRegistry.getAvailable();
		if (allModels.length === 0) {
			this.options.showStatus("No models available");
			return;
		}

		const sessionScopedModels = this.session.scopedModels;
		let currentEnabledIds: string[] | null = null;
		if (sessionScopedModels.length > 0) {
			currentEnabledIds = sessionScopedModels.map(({ model }) => `${model.provider}/${model.id}`);
		} else {
			const patterns = this.session.settingsManager.getEnabledModels();
			if (patterns !== undefined && patterns.length > 0) {
				const scopedModels = await resolveModelScope(patterns, this.session.modelRegistry);
				currentEnabledIds = scopedModels.map(({ model }) => `${model.provider}/${model.id}`);
			}
		}

		const updateSessionModels = async (enabledIds: string[] | null) => {
			currentEnabledIds = enabledIds === null ? null : [...enabledIds];
			if (enabledIds && enabledIds.length > 0 && enabledIds.length < allModels.length) {
				const scopedModels = await resolveModelScope(enabledIds, this.session.modelRegistry);
				this.session.setScopedModels(scopedModels.map((scoped) => ({ ...scoped })));
			} else {
				this.session.setScopedModels([]);
			}
			await this.updateAvailableProviderCount();
			this.options.ui.requestRender();
		};

		this.options.showSelector((done) => {
			const selector = new ScopedModelsSelectorComponent(
				{ allModels, enabledModelIds: currentEnabledIds },
				{
					onChange: updateSessionModels,
					onPersist: (enabledIds) => {
						const patterns =
							enabledIds === null || enabledIds.length === allModels.length ? undefined : [...enabledIds];
						this.session.settingsManager.setEnabledModels(patterns);
						this.options.showStatus("Model selection saved to settings");
					},
					onCancel: () => {
						done();
						this.options.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector };
		});
	}

	async updateAvailableProviderCount(): Promise<void> {
		const models = await this.getModelCandidates();
		this.options.setAvailableProviderCount(new Set(models.map(({ provider }) => provider)).size);
	}

	private async getModelCandidates(): Promise<Model<Api>[]> {
		if (this.session.scopedModels.length > 0) {
			return this.session.scopedModels.map(({ model }) => model);
		}

		this.session.modelRegistry.refresh();
		try {
			return await this.session.modelRegistry.getAvailable();
		} catch {
			return [];
		}
	}

	private async selectModel(model: Model<Api>, onSettled?: () => void): Promise<void> {
		try {
			await this.session.setModel(model);
			this.options.invalidateFooter();
			this.options.updateEditorBorderColor();
			onSettled?.();
			this.options.showStatus(`Model: ${model.id}`);
			void this.options.warnAboutAnthropicSubscriptionAuth(model);
			this.options.checkModelEasterEgg(model);
		} catch (error: unknown) {
			onSettled?.();
			this.options.showError(error instanceof Error ? error.message : String(error));
		}
	}
}
