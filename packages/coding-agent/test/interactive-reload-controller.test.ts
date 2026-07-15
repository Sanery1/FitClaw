import { type Component, Container, type EditorComponent, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { FooterDataProvider } from "../src/core/footer-data-provider.js";
import type { KeybindingsManager } from "../src/core/keybindings.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import type { FooterComponent } from "../src/modes/interactive/components/footer.js";
import { InteractiveReloadController } from "../src/modes/interactive/interactive-reload-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

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

interface ReloadFixtureOptions {
	isCompacting?: boolean;
	isStreaming?: boolean;
	modelsJsonError?: string;
	reloadError?: Error;
}

function createReloadFixture(options: ReloadFixtureOptions = {}) {
	const settingsManager = SettingsManager.inMemory();
	settingsManager.setTheme("dark");
	settingsManager.setEditorPaddingX(3);
	settingsManager.setAutocompleteMaxVisible(7);
	settingsManager.setShowHardwareCursor(true);
	settingsManager.setClearOnShrink(true);
	const extensionRunner = {};
	const reload = options.reloadError
		? vi.fn(async () => {
				throw options.reloadError;
			})
		: vi.fn(async () => undefined);
	const session = {
		autoCompactionEnabled: true,
		extensionRunner,
		isCompacting: options.isCompacting ?? false,
		isStreaming: options.isStreaming ?? false,
		modelRegistry: { getError: () => options.modelsJsonError },
		reload,
		resourceLoader: { getThemes: () => ({ themes: [], diagnostics: [] }) },
		sessionManager: { getCwd: () => "D:/workspace" },
		settingsManager,
	} as unknown as AgentSession;
	const defaultEditor = createEditor() as unknown as CustomEditor;
	const activeEditor = createEditor();
	const editorContainer = new Container();
	editorContainer.addChild(activeEditor as Component);
	const requestRender = vi.fn();
	const setFocus = vi.fn();
	const setShowHardwareCursor = vi.fn();
	const setClearOnShrink = vi.fn();
	const ui = {
		requestRender,
		setClearOnShrink,
		setFocus,
		setShowHardwareCursor,
	} as unknown as TUI;
	const reloadKeybindings = vi.fn();
	const keybindings = { reload: reloadKeybindings } as unknown as KeybindingsManager;
	const setSession = vi.fn();
	const setAutoCompactEnabled = vi.fn();
	const footer = { setAutoCompactEnabled, setSession } as unknown as FooterComponent;
	const setCwd = vi.fn();
	const footerDataProvider = { setCwd } as unknown as FooterDataProvider;
	const setHeaderExpanded = vi.fn();
	const refreshSettings = vi.fn();
	const setupAutocomplete = vi.fn();
	const setupExtensionShortcuts = vi.fn();
	const resetExtensionUI = vi.fn();
	const rebuildChatFromMessages = vi.fn();
	const showLoadedResources = vi.fn();
	const showWarning = vi.fn();
	const showError = vi.fn();
	const showStatus = vi.fn();
	const controller = new InteractiveReloadController({
		getSession: () => session,
		ui,
		editorContainer,
		defaultEditor,
		getEditor: () => activeEditor,
		keybindings,
		footer,
		footerDataProvider,
		getToolOutputExpanded: () => true,
		setHeaderExpanded,
		refreshSettings,
		setupAutocomplete,
		setupExtensionShortcuts,
		resetExtensionUI,
		rebuildChatFromMessages,
		showLoadedResources,
		showWarning,
		showError,
		showStatus,
	});

	return {
		activeEditor,
		controller,
		defaultEditor,
		editorContainer,
		rebuildChatFromMessages,
		refreshSettings,
		reload,
		reloadKeybindings,
		requestRender,
		resetExtensionUI,
		session,
		setAutoCompactEnabled,
		setClearOnShrink,
		setCwd,
		setHeaderExpanded,
		setSession,
		setShowHardwareCursor,
		setupAutocomplete,
		setupExtensionShortcuts,
		showError,
		showLoadedResources,
		showStatus,
		showWarning,
	};
}

describe("InteractiveReloadController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("applies session and display settings when the active session changes", () => {
		const fixture = createReloadFixture();

		fixture.controller.applyRuntimeSettings();

		expect(fixture.setSession).toHaveBeenCalledWith(fixture.session);
		expect(fixture.setAutoCompactEnabled).toHaveBeenCalledWith(true);
		expect(fixture.setCwd).toHaveBeenCalledWith("D:/workspace");
		expect(fixture.refreshSettings).toHaveBeenCalledTimes(1);
		expect(fixture.defaultEditor.setPaddingX).toHaveBeenCalledWith(3);
		expect(fixture.activeEditor.setPaddingX).toHaveBeenCalledWith(3);
		expect(fixture.setShowHardwareCursor).toHaveBeenCalledWith(true);
		expect(fixture.setClearOnShrink).toHaveBeenCalledWith(true);
	});

	it("blocks reload while a response is streaming", async () => {
		const fixture = createReloadFixture({ isStreaming: true });

		await fixture.controller.reload();

		expect(fixture.showWarning).toHaveBeenCalledWith("Wait for the current response to finish before reloading.");
		expect(fixture.reload).not.toHaveBeenCalled();
		expect(fixture.resetExtensionUI).not.toHaveBeenCalled();
	});

	it("blocks reload while compaction is running", async () => {
		const fixture = createReloadFixture({ isCompacting: true });

		await fixture.controller.reload();

		expect(fixture.showWarning).toHaveBeenCalledWith("Wait for compaction to finish before reloading.");
		expect(fixture.reload).not.toHaveBeenCalled();
		expect(fixture.resetExtensionUI).not.toHaveBeenCalled();
	});

	it("reloads resources, reapplies display settings, and restores the editor", async () => {
		const fixture = createReloadFixture({ modelsJsonError: "invalid models file" });

		await fixture.controller.reload();

		expect(fixture.reload).toHaveBeenCalledTimes(1);
		expect(fixture.reloadKeybindings).toHaveBeenCalledTimes(1);
		expect(fixture.setHeaderExpanded).toHaveBeenCalledWith(true);
		expect(fixture.setupAutocomplete).toHaveBeenCalledTimes(1);
		expect(fixture.setupExtensionShortcuts).toHaveBeenCalledTimes(1);
		expect(fixture.rebuildChatFromMessages).toHaveBeenCalledTimes(1);
		expect(fixture.editorContainer.children).toEqual([fixture.activeEditor]);
		expect(fixture.showLoadedResources).toHaveBeenCalledTimes(1);
		expect(fixture.showError).toHaveBeenCalledWith("models.json error: invalid models file");
		expect(fixture.showStatus).toHaveBeenCalledWith("Reloaded keybindings, extensions, skills, prompts, themes");
	});

	it("restores the previous editor when reload fails", async () => {
		const fixture = createReloadFixture({ reloadError: new Error("reload exploded") });

		await fixture.controller.reload();

		expect(fixture.editorContainer.children).toEqual([fixture.activeEditor]);
		expect(fixture.showLoadedResources).not.toHaveBeenCalled();
		expect(fixture.showError).toHaveBeenCalledWith("Reload failed: reload exploded");
		expect(fixture.showStatus).not.toHaveBeenCalled();
		expect(fixture.requestRender).toHaveBeenCalledWith(true);
	});
});
