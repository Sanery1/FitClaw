import type { Api, Model } from "@fitclaw/ai";
import { type Component, setKeybindings, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { ScopedModelsSelectorComponent } from "../src/modes/interactive/components/scoped-models-selector.js";
import { InteractiveModelController } from "../src/modes/interactive/interactive-model-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createModel(provider: string, id: string, reasoning = false): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.com",
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

interface ModelFixtureOptions {
	models?: Model<Api>[];
	scopedModels?: Model<Api>[];
	mountSelectors?: boolean;
	cycleResult?: {
		model: Model<Api>;
		thinkingLevel: "off" | "high";
		isScoped: boolean;
	};
	setModelError?: Error;
}

function createModelFixture(options: ModelFixtureOptions = {}) {
	const models = options.models ?? [createModel("openai", "model-a"), createModel("anthropic", "model-b")];
	let scopedModels = (options.scopedModels ?? []).map((model) => ({ model }));
	const settingsManager = SettingsManager.inMemory();
	const refresh = vi.fn();
	const setModel = options.setModelError
		? vi.fn(async () => {
				throw options.setModelError;
			})
		: vi.fn(async () => undefined);
	const setScopedModels = vi.fn((next: typeof scopedModels) => {
		scopedModels = next.map((entry) => ({ ...entry }));
	});
	const cycleModel = vi.fn(async () => options.cycleResult);
	const session = {
		cycleModel,
		model: models[0],
		modelRegistry: {
			find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
			getAvailable: () => models,
			getError: () => undefined,
			refresh,
		},
		get scopedModels() {
			return scopedModels;
		},
		setModel,
		setScopedModels,
		settingsManager,
	} as unknown as AgentSession;
	const requestRender = vi.fn();
	const ui = { requestRender } as unknown as TUI;
	const done = vi.fn();
	let selector: Component | undefined;
	const showSelector = vi.fn((create: (done: () => void) => { component: Component; focus: Component }) => {
		if (!options.mountSelectors) return;
		selector = create(done).component;
	});
	const invalidateFooter = vi.fn();
	const setAvailableProviderCount = vi.fn();
	const updateEditorBorderColor = vi.fn();
	const warnAboutAnthropicSubscriptionAuth = vi.fn(async () => undefined);
	const checkModelEasterEgg = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const controller = new InteractiveModelController({
		getSession: () => session,
		ui,
		showSelector,
		invalidateFooter,
		setAvailableProviderCount,
		updateEditorBorderColor,
		warnAboutAnthropicSubscriptionAuth,
		checkModelEasterEgg,
		showStatus,
		showError,
	});

	return {
		checkModelEasterEgg,
		controller,
		cycleModel,
		invalidateFooter,
		selector: () => selector,
		setAvailableProviderCount,
		setModel,
		setScopedModels,
		settingsManager,
		showError,
		showSelector,
		showStatus,
		updateEditorBorderColor,
		warnAboutAnthropicSubscriptionAuth,
	};
}

describe("InteractiveModelController", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("selects an exact model reference and updates model UI state", async () => {
		const fixture = createModelFixture();

		await fixture.controller.handleCommand("anthropic/model-b");

		expect(fixture.setModel).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic", id: "model-b" }));
		expect(fixture.invalidateFooter).toHaveBeenCalledTimes(1);
		expect(fixture.updateEditorBorderColor).toHaveBeenCalledTimes(1);
		expect(fixture.showStatus).toHaveBeenCalledWith("Model: model-b");
		expect(fixture.warnAboutAnthropicSubscriptionAuth).toHaveBeenCalledTimes(1);
		expect(fixture.checkModelEasterEgg).toHaveBeenCalledTimes(1);
	});

	it("opens the model selector with unmatched search text", async () => {
		const fixture = createModelFixture();

		await fixture.controller.handleCommand("missing-model");

		expect(fixture.setModel).not.toHaveBeenCalled();
		expect(fixture.showSelector).toHaveBeenCalledTimes(1);
	});

	it("reports model selection failures without applying UI side effects", async () => {
		const fixture = createModelFixture({ setModelError: new Error("missing credentials") });

		await fixture.controller.handleCommand("openai/model-a");

		expect(fixture.showError).toHaveBeenCalledWith("missing credentials");
		expect(fixture.invalidateFooter).not.toHaveBeenCalled();
		expect(fixture.showStatus).not.toHaveBeenCalled();
	});

	it("reports a single scoped model when cycling cannot advance", async () => {
		const model = createModel("openai", "model-a");
		const fixture = createModelFixture({ models: [model], scopedModels: [model] });

		await fixture.controller.cycle("forward");

		expect(fixture.cycleModel).toHaveBeenCalledWith("forward");
		expect(fixture.showStatus).toHaveBeenCalledWith("Only one model in scope");
	});

	it("counts providers from the active model scope", async () => {
		const fixture = createModelFixture({
			scopedModels: [createModel("openai", "model-a"), createModel("openai", "model-c")],
		});

		await fixture.controller.updateAvailableProviderCount();

		expect(fixture.setAvailableProviderCount).toHaveBeenCalledWith(1);
	});

	it("persists scoped model selection through the selector", async () => {
		const fixture = createModelFixture({ mountSelectors: true });
		await fixture.controller.showScopedModelsSelector();
		const selector = fixture.selector();
		if (!(selector instanceof ScopedModelsSelectorComponent)) {
			throw new Error("Expected scoped models selector to be mounted");
		}

		selector.handleInput("\r");
		selector.handleInput("\x13");

		expect(fixture.settingsManager.getEnabledModels()).toEqual(["openai/model-a"]);
		expect(fixture.showStatus).toHaveBeenCalledWith("Model selection saved to settings");
	});
});
