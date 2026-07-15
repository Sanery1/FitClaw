import { type Component, Container, type EditorComponent, setKeybindings, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import type { FooterComponent } from "../src/modes/interactive/components/footer.js";
import type { SettingsSelectorComponent } from "../src/modes/interactive/components/settings-selector.js";
import { InteractiveSettingsController } from "../src/modes/interactive/interactive-settings-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

interface SettingsFixtureOptions {
	enableSkillCommands?: boolean;
	hideThinkingBlock?: boolean;
}

function createEditor(): EditorComponent {
	return {
		getText: () => "",
		handleInput: vi.fn(),
		invalidate: vi.fn(),
		render: () => [],
		setAutocompleteMaxVisible: vi.fn(),
		setPaddingX: vi.fn(),
		setText: vi.fn(),
	};
}

function createSettingsFixture(options: SettingsFixtureOptions = {}) {
	const settingsManager = SettingsManager.inMemory({
		enableSkillCommands: options.enableSkillCommands ?? false,
		hideThinkingBlock: options.hideThinkingBlock ?? false,
	});
	const setAutoCompactionEnabled = vi.fn();
	const setSteeringMode = vi.fn();
	const setFollowUpMode = vi.fn();
	const setThinkingLevel = vi.fn();
	const session = {
		agent: { transport: settingsManager.getTransport() },
		autoCompactionEnabled: true,
		followUpMode: "all",
		getAvailableThinkingLevels: () => ["off", "low"],
		setAutoCompactionEnabled,
		setFollowUpMode,
		setSteeringMode,
		setThinkingLevel,
		settingsManager,
		steeringMode: "all",
		thinkingLevel: "off",
	} as unknown as AgentSession;
	const defaultEditor = createEditor() as unknown as CustomEditor;
	const activeEditor = createEditor();
	const setAutoCompactEnabled = vi.fn();
	const invalidateFooter = vi.fn();
	const footer = { invalidate: invalidateFooter, setAutoCompactEnabled } as unknown as FooterComponent;
	const requestRender = vi.fn();
	const ui = {
		invalidate: vi.fn(),
		requestRender,
		setClearOnShrink: vi.fn(),
		setShowHardwareCursor: vi.fn(),
	} as unknown as TUI;
	const setupAutocomplete = vi.fn();
	const rebuildThinkingVisibility = vi.fn();
	const showError = vi.fn();
	const showStatus = vi.fn();
	let selector: SettingsSelectorComponent | undefined;
	let done: ReturnType<typeof vi.fn> | undefined;
	const showSelector = vi.fn((create: (done: () => void) => { component: Component; focus: Component }) => {
		done = vi.fn();
		selector = create(done).component as SettingsSelectorComponent;
	});
	const controller = new InteractiveSettingsController({
		getSession: () => session,
		getEditor: () => activeEditor,
		ui,
		chatContainer: new Container(),
		defaultEditor,
		footer,
		showSelector,
		setupAutocomplete,
		rebuildThinkingVisibility,
		updateEditorBorderColor: vi.fn(),
		showError,
		showStatus,
	});

	return {
		controller,
		done: () => done,
		rebuildThinkingVisibility,
		selector: () => selector,
		setAutoCompactEnabled,
		setAutoCompactionEnabled,
		settingsManager,
		setupAutocomplete,
		showStatus,
	};
}

describe("InteractiveSettingsController", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("builds the selector and applies auto-compaction changes", () => {
		const fixture = createSettingsFixture();

		fixture.controller.show();
		const settingsList = fixture.selector()?.getSettingsList();
		expect(settingsList).toBeDefined();
		settingsList?.handleInput(" ");

		expect(fixture.setAutoCompactionEnabled).toHaveBeenCalledWith(false);
		expect(fixture.setAutoCompactEnabled).toHaveBeenCalledWith(false);
	});

	it("rebuilds autocomplete when skill commands change", () => {
		const fixture = createSettingsFixture({ enableSkillCommands: false });

		fixture.controller.show();
		const settingsList = fixture.selector()?.getSettingsList();
		for (const character of "skillcommands") settingsList?.handleInput(character);
		settingsList?.handleInput(" ");

		expect(fixture.settingsManager.getEnableSkillCommands()).toBe(true);
		expect(fixture.setupAutocomplete).toHaveBeenCalledTimes(1);
	});

	it("owns and refreshes thinking visibility state", () => {
		const fixture = createSettingsFixture({ hideThinkingBlock: false });

		fixture.controller.toggleThinkingVisibility();
		expect(fixture.controller.hideThinkingBlock).toBe(true);
		expect(fixture.settingsManager.getHideThinkingBlock()).toBe(true);
		expect(fixture.rebuildThinkingVisibility).toHaveBeenCalledWith(true, true);
		expect(fixture.showStatus).toHaveBeenCalledWith("Thinking blocks: hidden");

		fixture.settingsManager.setHideThinkingBlock(false);
		fixture.controller.refresh();
		expect(fixture.controller.hideThinkingBlock).toBe(false);
	});

	it("restores the editor when the selector is cancelled", () => {
		const fixture = createSettingsFixture();
		fixture.controller.show();

		fixture.selector()?.getSettingsList().handleInput("\x1b");

		expect(fixture.done()).toHaveBeenCalledTimes(1);
	});
});
