import type { Agent, ThinkingLevel } from "@fitclaw/agent-core";
import type { Api, Model } from "@fitclaw/ai";
import { modelsAreEqual, supportsXhigh } from "@fitclaw/ai";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import type { ExtensionRunner } from "./extensions/index.js";
import type { ModelRegistry } from "./model-registry.js";
import type { SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";

export interface SessionScopedModel {
	model: Model<Api>;
	thinkingLevel?: ThinkingLevel;
}

export interface ModelCycleResult {
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	isScoped: boolean;
}

interface SessionModelControllerOptions {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendModelChange" | "appendThinkingLevelChange">;
	settingsManager: Pick<
		SettingsManager,
		"getDefaultThinkingLevel" | "setDefaultModelAndProvider" | "setDefaultThinkingLevel"
	>;
	modelRegistry: Pick<ModelRegistry, "find" | "getAvailable" | "hasConfiguredAuth">;
	getExtensionRunner: () => ExtensionRunner;
	scopedModels?: readonly SessionScopedModel[];
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const THINKING_LEVELS_WITH_XHIGH: readonly ThinkingLevel[] = [...THINKING_LEVELS, "xhigh"];

export class SessionModelController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionModelControllerOptions["sessionManager"];
	private readonly settingsManager: SessionModelControllerOptions["settingsManager"];
	private readonly modelRegistry: SessionModelControllerOptions["modelRegistry"];
	private readonly getExtensionRunner: SessionModelControllerOptions["getExtensionRunner"];
	private scopedModelEntries: SessionScopedModel[];

	constructor(options: SessionModelControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.modelRegistry = options.modelRegistry;
		this.getExtensionRunner = options.getExtensionRunner;
		this.scopedModelEntries = this.copyScopedModels(options.scopedModels ?? []);
	}

	get model(): Model<Api> | undefined {
		return this.agent.state.model;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	get scopedModels(): ReadonlyArray<SessionScopedModel> {
		return this.copyScopedModels(this.scopedModelEntries);
	}

	setScopedModels(scopedModels: readonly SessionScopedModel[]): void {
		this.scopedModelEntries = this.copyScopedModels(scopedModels);
	}

	async setModel(model: Model<Api>): Promise<void> {
		if (!this.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		const previousModel = this.model;
		const thinkingLevel = this.getThinkingLevelForModelSwitch();
		this.applyModel(model, thinkingLevel);
		await this.emitModelSelect(model, previousModel, "set");
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this.scopedModelEntries.length > 0) return this.cycleScopedModel(direction);
		return this.cycleAvailableModel(direction);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		const availableLevels = this.getAvailableThinkingLevels();
		const effectiveLevel = availableLevels.includes(level) ? level : this.clampThinkingLevel(level, availableLevels);
		const isChanging = effectiveLevel !== this.agent.state.thinkingLevel;
		this.agent.state.thinkingLevel = effectiveLevel;

		if (!isChanging) return;
		this.sessionManager.appendThinkingLevelChange(effectiveLevel);
		if (this.supportsThinking() || effectiveLevel !== "off") {
			this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
		}
	}

	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;
		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextLevel = levels[(currentIndex + 1) % levels.length];
		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	getAvailableThinkingLevels(): ThinkingLevel[] {
		if (!this.supportsThinking()) return ["off"];
		return [...(this.supportsXhighThinking() ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS)];
	}

	supportsXhighThinking(): boolean {
		return this.model ? supportsXhigh(this.model) : false;
	}

	supportsThinking(): boolean {
		return !!this.model?.reasoning;
	}

	refreshCurrentModelFromRegistry(): void {
		const currentModel = this.model;
		if (!currentModel) return;
		const refreshedModel = this.modelRegistry.find(currentModel.provider, currentModel.id);
		if (refreshedModel && refreshedModel !== currentModel) this.agent.state.model = refreshedModel;
	}

	private async cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = this.scopedModelEntries.filter((entry) => this.modelRegistry.hasConfiguredAuth(entry.model));
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = scopedModels.findIndex((entry) => modelsAreEqual(entry.model, currentModel));
		if (currentIndex === -1) currentIndex = 0;
		const nextIndex =
			direction === "forward"
				? (currentIndex + 1) % scopedModels.length
				: (currentIndex - 1 + scopedModels.length) % scopedModels.length;
		const next = scopedModels[nextIndex];
		const thinkingLevel = this.getThinkingLevelForModelSwitch(next.thinkingLevel);
		this.applyModel(next.model, thinkingLevel);
		await this.emitModelSelect(next.model, currentModel, "cycle");
		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	private async cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = this.modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex((model) => modelsAreEqual(model, currentModel));
		if (currentIndex === -1) currentIndex = 0;
		const nextIndex =
			direction === "forward"
				? (currentIndex + 1) % availableModels.length
				: (currentIndex - 1 + availableModels.length) % availableModels.length;
		const nextModel = availableModels[nextIndex];
		const thinkingLevel = this.getThinkingLevelForModelSwitch();
		this.applyModel(nextModel, thinkingLevel);
		await this.emitModelSelect(nextModel, currentModel, "cycle");
		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	private applyModel(model: Model<Api>, thinkingLevel: ThinkingLevel): void {
		this.agent.state.model = model;
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.setThinkingLevel(thinkingLevel);
	}

	private async emitModelSelect(
		nextModel: Model<Api>,
		previousModel: Model<Api> | undefined,
		source: "set" | "cycle",
	): Promise<void> {
		if (modelsAreEqual(previousModel, nextModel)) return;
		await this.getExtensionRunner().emit({ type: "model_select", model: nextModel, previousModel, source });
	}

	private getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
		if (explicitLevel !== undefined) return explicitLevel;
		if (!this.supportsThinking()) {
			return this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		}
		return this.thinkingLevel;
	}

	private clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
		const available = new Set(availableLevels);
		const requestedIndex = THINKING_LEVELS_WITH_XHIGH.indexOf(level);
		if (requestedIndex === -1) return availableLevels[0] ?? "off";
		for (let index = requestedIndex; index < THINKING_LEVELS_WITH_XHIGH.length; index++) {
			const candidate = THINKING_LEVELS_WITH_XHIGH[index];
			if (available.has(candidate)) return candidate;
		}
		for (let index = requestedIndex - 1; index >= 0; index--) {
			const candidate = THINKING_LEVELS_WITH_XHIGH[index];
			if (available.has(candidate)) return candidate;
		}
		return availableLevels[0] ?? "off";
	}

	private copyScopedModels(scopedModels: readonly SessionScopedModel[]): SessionScopedModel[] {
		return scopedModels.map((entry) => ({ ...entry }));
	}
}
