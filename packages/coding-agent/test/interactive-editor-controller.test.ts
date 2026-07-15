import type { EditorComponent, TUI } from "@fitclaw/tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { AppKeybinding } from "../src/core/keybindings.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import type { FooterComponent } from "../src/modes/interactive/components/footer.js";
import type { InteractiveCommandController } from "../src/modes/interactive/interactive-command-controller.js";
import { InteractiveEditorController } from "../src/modes/interactive/interactive-editor-controller.js";
import type { InteractiveFeedbackController } from "../src/modes/interactive/interactive-feedback-controller.js";
import type { InteractiveMessageQueueController } from "../src/modes/interactive/interactive-message-queue-controller.js";
import type { InteractiveModelController } from "../src/modes/interactive/interactive-model-controller.js";
import type { InteractiveSessionNavigationController } from "../src/modes/interactive/interactive-session-navigation-controller.js";
import type { InteractiveSettingsController } from "../src/modes/interactive/interactive-settings-controller.js";
import type { InteractiveTerminalController } from "../src/modes/interactive/interactive-terminal-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const clipboardMocks = vi.hoisted(() => ({
	extensionForImageMimeType: vi.fn(() => "png"),
	readClipboardImage: vi.fn(),
}));

vi.mock("../src/utils/clipboard-image.js", () => clipboardMocks);

interface TestEditor extends EditorComponent {
	actionHandlers: Map<AppKeybinding, () => void>;
	onAction: (action: AppKeybinding, handler: () => void) => void;
	onCtrlD?: () => void;
	onEscape?: () => void;
	onPasteImage?: () => void;
}

function createEditor(): TestEditor {
	let text = "";
	const actionHandlers = new Map<AppKeybinding, () => void>();
	return {
		actionHandlers,
		borderColor: (value) => value,
		getText: () => text,
		handleInput: vi.fn(),
		invalidate: vi.fn(),
		onAction: (action, handler) => actionHandlers.set(action, handler),
		render: () => [],
		setText: vi.fn((value: string) => {
			text = value;
		}),
	};
}

function createEditorFixture() {
	const sessionState = {
		doubleEscapeAction: "tree" as "tree" | "fork" | "none",
		isBashRunning: false,
		isStreaming: false,
		thinkingLevel: "medium" as "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
		cycleResult: "high" as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined,
	};
	const abortBash = vi.fn();
	const cycleThinkingLevel = vi.fn(() => sessionState.cycleResult);
	const session = {
		abortBash,
		cycleThinkingLevel,
		get isBashRunning() {
			return sessionState.isBashRunning;
		},
		get isStreaming() {
			return sessionState.isStreaming;
		},
		settingsManager: { getDoubleEscapeAction: () => sessionState.doubleEscapeAction },
		get thinkingLevel() {
			return sessionState.thinkingLevel;
		},
	} as unknown as AgentSession;
	const editor = createEditor();
	const defaultEditor = editor as unknown as CustomEditor;
	const requestRender = vi.fn();
	const ui = { requestRender } as unknown as TUI;
	const invalidateFooter = vi.fn();
	const footer = { invalidate: invalidateFooter } as unknown as FooterComponent;
	const handleNewSession = vi.fn(async () => undefined);
	const commandController = { handleNewSession } as unknown as InteractiveCommandController;
	const showStatus = vi.fn();
	const writeDebugLog = vi.fn();
	const feedbackController = { showStatus, writeDebugLog } as unknown as InteractiveFeedbackController;
	const handleDequeue = vi.fn();
	const handleFollowUp = vi.fn(async () => undefined);
	const restoreQueuedMessagesToEditor = vi.fn();
	const messageQueueController = {
		handleDequeue,
		handleFollowUp,
		restoreQueuedMessagesToEditor,
	} as unknown as InteractiveMessageQueueController;
	const cycleModel = vi.fn(async () => undefined);
	const showModelSelector = vi.fn();
	const modelController = { cycle: cycleModel, showModelSelector } as unknown as InteractiveModelController;
	const showSessionSelector = vi.fn();
	const showTreeSelector = vi.fn();
	const showUserMessageSelector = vi.fn();
	const sessionNavigationController = {
		showSessionSelector,
		showTreeSelector,
		showUserMessageSelector,
	} as unknown as InteractiveSessionNavigationController;
	const toggleThinkingVisibility = vi.fn();
	const settingsController = { toggleThinkingVisibility } as unknown as InteractiveSettingsController;
	const handleExitKey = vi.fn();
	const handleInterruptKey = vi.fn();
	const openExternalEditor = vi.fn();
	const suspend = vi.fn();
	const terminalController = {
		handleExitKey,
		handleInterruptKey,
		openExternalEditor,
		suspend,
	} as unknown as InteractiveTerminalController;
	const toggleToolOutputExpansion = vi.fn();
	const controller = new InteractiveEditorController({
		getSession: () => session,
		ui,
		defaultEditor,
		getEditor: () => editor,
		footer,
		commandController,
		feedbackController,
		messageQueueController,
		modelController,
		sessionNavigationController,
		settingsController,
		terminalController,
		toggleToolOutputExpansion,
	});

	return {
		abortBash,
		controller,
		cycleModel,
		defaultEditor: editor,
		handleExitKey,
		handleInterruptKey,
		handleNewSession,
		invalidateFooter,
		requestRender,
		restoreQueuedMessagesToEditor,
		sessionState,
		showStatus,
		showTreeSelector,
		showUserMessageSelector,
		toggleThinkingVisibility,
		toggleToolOutputExpansion,
		ui,
		writeDebugLog,
	};
}

describe("InteractiveEditorController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		vi.clearAllMocks();
		clipboardMocks.readClipboardImage.mockResolvedValue(undefined);
	});

	it("registers application actions on the default editor", () => {
		const fixture = createEditorFixture();
		fixture.controller.setup();

		fixture.defaultEditor.actionHandlers.get("app.clear")?.();
		fixture.defaultEditor.actionHandlers.get("app.model.cycleForward")?.();
		fixture.defaultEditor.actionHandlers.get("app.tools.expand")?.();
		fixture.defaultEditor.actionHandlers.get("app.thinking.toggle")?.();
		fixture.defaultEditor.actionHandlers.get("app.session.new")?.();
		fixture.defaultEditor.onCtrlD?.();
		fixture.defaultEditor.onPasteImage?.();
		fixture.ui.onDebug?.();

		expect(fixture.handleInterruptKey).toHaveBeenCalledTimes(1);
		expect(fixture.cycleModel).toHaveBeenCalledWith("forward");
		expect(fixture.toggleToolOutputExpansion).toHaveBeenCalledTimes(1);
		expect(fixture.toggleThinkingVisibility).toHaveBeenCalledTimes(1);
		expect(fixture.handleNewSession).toHaveBeenCalledTimes(1);
		expect(fixture.handleExitKey).toHaveBeenCalledTimes(1);
		expect(clipboardMocks.readClipboardImage).toHaveBeenCalledTimes(1);
		expect(fixture.writeDebugLog).toHaveBeenCalledTimes(1);
	});

	it("restores queued messages before other escape actions while streaming", () => {
		const fixture = createEditorFixture();
		fixture.sessionState.isStreaming = true;
		fixture.sessionState.isBashRunning = true;
		fixture.controller.setup();

		fixture.defaultEditor.onEscape?.();

		expect(fixture.restoreQueuedMessagesToEditor).toHaveBeenCalledWith({ abort: true });
		expect(fixture.abortBash).not.toHaveBeenCalled();
	});

	it("aborts a running bash command on escape", () => {
		const fixture = createEditorFixture();
		fixture.sessionState.isBashRunning = true;
		fixture.controller.setup();

		fixture.defaultEditor.onEscape?.();

		expect(fixture.abortBash).toHaveBeenCalledTimes(1);
	});

	it("clears bash mode and restores the thinking border on escape", () => {
		const fixture = createEditorFixture();
		fixture.controller.setup();
		fixture.defaultEditor.onChange?.("!pwd");
		fixture.defaultEditor.setText("!pwd");

		fixture.defaultEditor.onEscape?.();

		expect(fixture.defaultEditor.setText).toHaveBeenLastCalledWith("");
		expect(fixture.requestRender).toHaveBeenCalledTimes(2);
	});

	it("opens the configured selector on double escape", () => {
		const fixture = createEditorFixture();
		fixture.controller.setup();
		const now = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);

		fixture.defaultEditor.onEscape?.();
		fixture.defaultEditor.onEscape?.();

		expect(fixture.showTreeSelector).toHaveBeenCalledTimes(1);
		expect(fixture.showUserMessageSelector).not.toHaveBeenCalled();
		now.mockRestore();
	});

	it("uses the fork selector when configured", () => {
		const fixture = createEditorFixture();
		fixture.sessionState.doubleEscapeAction = "fork";
		fixture.controller.setup();
		const now = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);

		fixture.defaultEditor.onEscape?.();
		fixture.defaultEditor.onEscape?.();

		expect(fixture.showUserMessageSelector).toHaveBeenCalledTimes(1);
		now.mockRestore();
	});

	it("updates thinking UI after cycling levels", () => {
		const fixture = createEditorFixture();
		fixture.controller.setup();

		fixture.defaultEditor.actionHandlers.get("app.thinking.cycle")?.();

		expect(fixture.invalidateFooter).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
		expect(fixture.showStatus).toHaveBeenCalledWith("Thinking level: high");
	});

	it("reports when the active model cannot cycle thinking levels", () => {
		const fixture = createEditorFixture();
		fixture.sessionState.cycleResult = undefined;
		fixture.controller.setup();

		fixture.defaultEditor.actionHandlers.get("app.thinking.cycle")?.();

		expect(fixture.invalidateFooter).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Current model does not support thinking");
	});

	it("clears the active editor and requests a render", () => {
		const fixture = createEditorFixture();

		fixture.controller.clear();

		expect(fixture.defaultEditor.setText).toHaveBeenCalledWith("");
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});
});
