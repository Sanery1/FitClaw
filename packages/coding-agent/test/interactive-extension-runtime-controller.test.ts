import { Container, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { AutocompleteProviderFactory, ExtensionRunner } from "../src/core/extensions/index.js";
import type { KeybindingsManager } from "../src/core/keybindings.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import type { InteractiveAutocompleteController } from "../src/modes/interactive/interactive-autocomplete-controller.js";
import type { InteractiveExtensionChromeController } from "../src/modes/interactive/interactive-extension-chrome-controller.js";
import type { InteractiveExtensionDialogController } from "../src/modes/interactive/interactive-extension-dialog-controller.js";
import { InteractiveExtensionRuntimeController } from "../src/modes/interactive/interactive-extension-runtime-controller.js";
import type { InteractiveExtensionSurfaceController } from "../src/modes/interactive/interactive-extension-surface-controller.js";
import type { InteractiveWorkingController } from "../src/modes/interactive/interactive-working-controller.js";

function renderAll(container: Container): string {
	return container.children.flatMap((child) => child.render(160)).join("\n");
}

import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createExtensionRuntimeFixture() {
	let currentTheme = "dark";
	const setTheme = vi.fn((themeName: string) => {
		currentTheme = themeName;
	});
	const extensionRunner = {
		getCommandDiagnostics: () => [],
		getShortcutDiagnostics: () => [],
	} as unknown as ExtensionRunner;
	const session = {
		agent: { signal: new AbortController().signal },
		extensionRunner,
		modelRegistry: {},
		promptTemplates: [],
		resourceLoader: {
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getExtensions: () => ({ errors: [], extensions: [] }),
			getPrompts: () => ({ diagnostics: [], prompts: [] }),
			getSkills: () => ({ diagnostics: [], skills: [{ filePath: "/tmp/commit/SKILL.md", name: "commit" }] }),
			getThemes: () => ({ diagnostics: [], themes: [] }),
		},
		sessionManager: { getCwd: () => "/tmp/project" },
		settingsManager: {
			getTheme: () => currentTheme,
			getQuietStartup: () => false,
			setTheme,
		},
	} as unknown as AgentSession;
	const requestRender = vi.fn();
	const setTitle = vi.fn();
	const ui = { requestRender, terminal: { setTitle } } as unknown as TUI;
	const defaultEditor = { onExtensionShortcut: vi.fn() } as unknown as CustomEditor;
	const addProvider = vi.fn();
	const clearProviders = vi.fn();
	const setupAutocomplete = vi.fn();
	const autocompleteController = {
		addProvider,
		clearProviders,
		getBuiltInCommandConflictDiagnostics: () => [],
		setup: setupAutocomplete,
	} as unknown as InteractiveAutocompleteController;
	const resetChrome = vi.fn();
	const setStatus = vi.fn();
	const chromeController = { reset: resetChrome, setStatus } as unknown as InteractiveExtensionChromeController;
	const resetDialog = vi.fn();
	const dialogController = { reset: resetDialog } as unknown as InteractiveExtensionDialogController;
	const hideOverlay = vi.fn();
	const clearTerminalInputListeners = vi.fn();
	const setCustomEditor = vi.fn();
	const surfaceController = {
		clearTerminalInputListeners,
		hideOverlay,
		setCustomEditor,
	} as unknown as InteractiveExtensionSurfaceController;
	const resetWorking = vi.fn();
	const setMessage = vi.fn();
	const setVisible = vi.fn();
	const setIndicator = vi.fn();
	const workingController = {
		reset: resetWorking,
		setIndicator,
		setMessage,
		setVisible,
	} as unknown as InteractiveWorkingController;
	const updateTerminalTitle = vi.fn();
	const updateHiddenThinkingLabel = vi.fn();
	const showNotification = vi.fn();
	const chatContainer = new Container();
	const controller = new InteractiveExtensionRuntimeController({
		getSession: () => session,
		ui,
		chatContainer,
		defaultEditor,
		keybindings: { getEffectiveConfig: () => ({}) } as unknown as KeybindingsManager,
		autocompleteController,
		chromeController,
		dialogController,
		surfaceController,
		workingController,
		isVerbose: () => false,
		getToolOutputExpanded: () => false,
		setToolsExpanded: vi.fn(),
		deferShutdown: vi.fn(),
		updateTerminalTitle,
		updateHiddenThinkingLabel,
		showNotification,
		showError: vi.fn(),
	});

	return {
		addProvider,
		chatContainer,
		clearProviders,
		clearTerminalInputListeners,
		controller,
		defaultEditor,
		hideOverlay,
		requestRender,
		resetChrome,
		resetDialog,
		resetWorking,
		setCustomEditor,
		setIndicator,
		setMessage,
		setTheme,
		setVisible,
		setupAutocomplete,
		showNotification,
		updateHiddenThinkingLabel,
		updateTerminalTitle,
	};
}

describe("InteractiveExtensionRuntimeController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("persists valid theme changes", () => {
		const fixture = createExtensionRuntimeFixture();

		const result = fixture.controller.createUIContext().setTheme("light");

		expect(result.success).toBe(true);
		expect(fixture.setTheme).toHaveBeenCalledWith("light");
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});

	it("does not persist invalid theme names", () => {
		const fixture = createExtensionRuntimeFixture();

		const result = fixture.controller.createUIContext().setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(fixture.setTheme).not.toHaveBeenCalled();
		expect(fixture.requestRender).not.toHaveBeenCalled();
	});

	it("delegates autocomplete and working state changes", () => {
		const fixture = createExtensionRuntimeFixture();
		const wrapper: AutocompleteProviderFactory = (current) => current;
		const uiContext = fixture.controller.createUIContext();

		uiContext.addAutocompleteProvider(wrapper);
		uiContext.setWorkingMessage("Analyzing");
		uiContext.setWorkingVisible(false);
		uiContext.setWorkingIndicator({ frames: ["#"] });

		expect(fixture.addProvider).toHaveBeenCalledWith(wrapper);
		expect(fixture.setMessage).toHaveBeenCalledWith("Analyzing");
		expect(fixture.setVisible).toHaveBeenCalledWith(false);
		expect(fixture.setIndicator).toHaveBeenCalledWith({ frames: ["#"] });
	});

	it("routes notifications without changing their type", () => {
		const fixture = createExtensionRuntimeFixture();

		fixture.controller.createUIContext().notify("careful", "warning");

		expect(fixture.showNotification).toHaveBeenCalledWith("careful", "warning");
	});

	it("owns hidden thinking labels and resets extension UI", () => {
		const fixture = createExtensionRuntimeFixture();
		const uiContext = fixture.controller.createUIContext();
		uiContext.setHiddenThinkingLabel("Reasoning");
		expect(fixture.controller.hiddenThinkingLabel).toBe("Reasoning");

		fixture.controller.reset();

		expect(fixture.resetDialog).toHaveBeenCalledTimes(1);
		expect(fixture.hideOverlay).toHaveBeenCalledTimes(1);
		expect(fixture.clearTerminalInputListeners).toHaveBeenCalledTimes(1);
		expect(fixture.resetChrome).toHaveBeenCalledTimes(1);
		expect(fixture.clearProviders).toHaveBeenCalledTimes(1);
		expect(fixture.setCustomEditor).toHaveBeenCalledWith(undefined);
		expect(fixture.setupAutocomplete).toHaveBeenCalledTimes(1);
		expect(fixture.defaultEditor.onExtensionShortcut).toBeUndefined();
		expect(fixture.updateTerminalTitle).toHaveBeenCalledTimes(1);
		expect(fixture.resetWorking).toHaveBeenCalledTimes(1);
		expect(fixture.controller.hiddenThinkingLabel).toBe("Thinking...");
		expect(fixture.updateHiddenThinkingLabel).toHaveBeenLastCalledWith("Thinking...");
	});

	it("collects and renders resources from the current session", () => {
		const fixture = createExtensionRuntimeFixture();

		fixture.controller.showLoadedResources({ force: true });

		const output = renderAll(fixture.chatContainer);
		expect(output).toContain("[Skills]");
		expect(output).toContain("commit");
	});

	it("binds extension shortcuts with an interactive context", () => {
		const fixture = createExtensionRuntimeFixture();
		const handler = vi.fn();
		const extensionRunner = {
			getShortcuts: () => new Map([["ctrl+x", { handler }]]),
		} as unknown as ExtensionRunner;
		fixture.controller.setupShortcuts(extensionRunner);
		const shortcutHandler = fixture.defaultEditor.onExtensionShortcut;
		if (!shortcutHandler) throw new Error("Expected extension shortcut handler to be installed");

		const wasHandled = shortcutHandler("\x18");

		expect(wasHandled).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ hasUI: true, cwd: "/tmp/project" }));
	});
});
