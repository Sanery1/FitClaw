import type { EditorComponent, TUI } from "@fitclaw/tui";
import { Container } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import type { InteractiveAuthController } from "../src/modes/interactive/interactive-auth-controller.js";
import type { InteractiveBashController } from "../src/modes/interactive/interactive-bash-controller.js";
import { InteractiveCommandController } from "../src/modes/interactive/interactive-command-controller.js";
import type { InteractiveFeedbackController } from "../src/modes/interactive/interactive-feedback-controller.js";
import type { InteractiveInfoController } from "../src/modes/interactive/interactive-info-controller.js";
import type { InteractiveMessageQueueController } from "../src/modes/interactive/interactive-message-queue-controller.js";
import type { InteractiveModelController } from "../src/modes/interactive/interactive-model-controller.js";
import type { InteractiveReloadController } from "../src/modes/interactive/interactive-reload-controller.js";
import type { InteractiveSessionNavigationController } from "../src/modes/interactive/interactive-session-navigation-controller.js";
import type { InteractiveSessionTransferController } from "../src/modes/interactive/interactive-session-transfer-controller.js";
import type { InteractiveSettingsController } from "../src/modes/interactive/interactive-settings-controller.js";
import type { InteractiveTerminalController } from "../src/modes/interactive/interactive-terminal-controller.js";
import type { InteractiveWorkingController } from "../src/modes/interactive/interactive-working-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createCommandFixture() {
	const sessionState = {
		isBashRunning: false,
		isCompacting: false,
		isStreaming: false,
	};
	const prompt = vi.fn(async () => undefined);
	const compact = vi.fn(async () => undefined);
	const getEntries = vi.fn(() => [{ type: "message" }, { type: "message" }]);
	const session = {
		compact,
		get isBashRunning() {
			return sessionState.isBashRunning;
		},
		get isCompacting() {
			return sessionState.isCompacting;
		},
		get isStreaming() {
			return sessionState.isStreaming;
		},
		prompt,
		sessionManager: { getEntries },
	} as unknown as AgentSession;

	const setText = vi.fn();
	const addToHistory = vi.fn();
	const editor = { addToHistory, getText: vi.fn(() => ""), setText } as unknown as EditorComponent;
	const defaultEditor = {} as CustomEditor;
	const requestRender = vi.fn();
	const ui = { requestRender } as unknown as TUI;
	const chatContainer = new Container();

	const authShow = vi.fn();
	const authController = { show: authShow } as unknown as InteractiveAuthController;
	const bashHandle = vi.fn(async () => undefined);
	const bashController = { handle: bashHandle } as unknown as InteractiveBashController;
	const showWarning = vi.fn();
	const feedbackController = {
		showArmin: vi.fn(),
		showDementedDelves: vi.fn(),
		showWarning,
		writeDebugLog: vi.fn(),
	} as unknown as InteractiveFeedbackController;
	const infoController = {
		handleNameCommand: vi.fn(),
		showChangelog: vi.fn(),
		showHotkeys: vi.fn(),
		showSessionInfo: vi.fn(),
	} as unknown as InteractiveInfoController;
	const isExtensionCommand = vi.fn(() => false);
	const queueCompactionMessage = vi.fn();
	const updatePendingMessagesDisplay = vi.fn();
	const flushPendingBashComponents = vi.fn();
	const messageQueueController = {
		flushPendingBashComponents,
		isExtensionCommand,
		queueCompactionMessage,
		updatePendingMessagesDisplay,
	} as unknown as InteractiveMessageQueueController;
	const handleModelCommand = vi.fn(async () => undefined);
	const modelController = {
		handleCommand: handleModelCommand,
		showScopedModelsSelector: vi.fn(async () => undefined),
	} as unknown as InteractiveModelController;
	const reload = vi.fn(async () => undefined);
	const reloadController = { reload } as unknown as InteractiveReloadController;
	const sessionNavigationController = {
		handleCloneCommand: vi.fn(async () => undefined),
		showSessionSelector: vi.fn(),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
	} as unknown as InteractiveSessionNavigationController;
	const sessionTransferController = {
		handleCopyCommand: vi.fn(async () => undefined),
		handleExportCommand: vi.fn(async () => undefined),
		handleImportCommand: vi.fn(async () => undefined),
		handleShareCommand: vi.fn(async () => undefined),
	} as unknown as InteractiveSessionTransferController;
	const showSettings = vi.fn();
	const settingsController = { show: showSettings } as unknown as InteractiveSettingsController;
	const shutdown = vi.fn(async () => undefined);
	const terminalController = { shutdown } as unknown as InteractiveTerminalController;
	const stopWorking = vi.fn();
	const workingController = { stop: stopWorking } as unknown as InteractiveWorkingController;
	const newSession = vi.fn(async () => ({ cancelled: false }));
	const runtimeHost = { newSession } as unknown as Pick<AgentSessionRuntime, "newSession">;
	const renderCurrentSessionState = vi.fn();
	const resetBashMode = vi.fn();
	const handleFatalRuntimeError = vi.fn(async (): Promise<never> => {
		throw new Error("fatal");
	});

	const controller = new InteractiveCommandController({
		getSession: () => session,
		runtimeHost,
		ui,
		chatContainer,
		defaultEditor,
		getEditor: () => editor,
		authController,
		bashController,
		feedbackController,
		infoController,
		messageQueueController,
		modelController,
		reloadController,
		sessionNavigationController,
		sessionTransferController,
		settingsController,
		terminalController,
		workingController,
		renderCurrentSessionState,
		resetBashMode,
		handleFatalRuntimeError,
	});

	return {
		addToHistory,
		authShow,
		bashHandle,
		compact,
		controller,
		defaultEditor,
		flushPendingBashComponents,
		handleModelCommand,
		isExtensionCommand,
		newSession,
		prompt,
		queueCompactionMessage,
		renderCurrentSessionState,
		requestRender,
		resetBashMode,
		sessionState,
		setText,
		showSettings,
		showWarning,
		stopWorking,
		updatePendingMessagesDisplay,
	};
}

describe("InteractiveCommandController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("installs the submit handler and routes built-in commands", async () => {
		const fixture = createCommandFixture();
		fixture.controller.setup();
		expect(fixture.defaultEditor.onSubmit).toBeDefined();

		await fixture.controller.handleSubmit("  /settings  ");
		await fixture.controller.handleSubmit("/model sonnet");
		await fixture.controller.handleSubmit("/login");

		expect(fixture.showSettings).toHaveBeenCalledTimes(1);
		expect(fixture.handleModelCommand).toHaveBeenCalledWith("sonnet");
		expect(fixture.authShow).toHaveBeenCalledWith("login");
		expect(fixture.setText).toHaveBeenCalledWith("");
	});

	it("queues regular input during compaction", async () => {
		const fixture = createCommandFixture();
		fixture.sessionState.isCompacting = true;

		await fixture.controller.handleSubmit(" explain this ");

		expect(fixture.queueCompactionMessage).toHaveBeenCalledWith("explain this", "steer");
		expect(fixture.prompt).not.toHaveBeenCalled();
	});

	it("executes extension commands immediately during compaction", async () => {
		const fixture = createCommandFixture();
		fixture.sessionState.isCompacting = true;
		fixture.isExtensionCommand.mockReturnValue(true);

		await fixture.controller.handleSubmit("/deploy now");

		expect(fixture.addToHistory).toHaveBeenCalledWith("/deploy now");
		expect(fixture.setText).toHaveBeenCalledWith("");
		expect(fixture.prompt).toHaveBeenCalledWith("/deploy now");
		expect(fixture.queueCompactionMessage).not.toHaveBeenCalled();
	});

	it("steers submissions while the session is streaming", async () => {
		const fixture = createCommandFixture();
		fixture.sessionState.isStreaming = true;

		await fixture.controller.handleSubmit("change direction");

		expect(fixture.prompt).toHaveBeenCalledWith("change direction", { streamingBehavior: "steer" });
		expect(fixture.updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});

	it("preserves a bash command when another bash process is running", async () => {
		const fixture = createCommandFixture();
		fixture.sessionState.isBashRunning = true;

		await fixture.controller.handleSubmit(" !pwd ");

		expect(fixture.showWarning).toHaveBeenCalledWith(
			"A bash command is already running. Press Esc to cancel it first.",
		);
		expect(fixture.setText).toHaveBeenCalledWith("!pwd");
		expect(fixture.bashHandle).not.toHaveBeenCalled();
	});

	it("runs bash commands and resets bash mode", async () => {
		const fixture = createCommandFixture();

		await fixture.controller.handleSubmit("!! pwd");

		expect(fixture.bashHandle).toHaveBeenCalledWith("pwd", true);
		expect(fixture.addToHistory).toHaveBeenCalledWith("!! pwd");
		expect(fixture.resetBashMode).toHaveBeenCalledTimes(1);
	});

	it("resolves ordinary input after flushing pending bash output", async () => {
		const fixture = createCommandFixture();
		const input = fixture.controller.getUserInput();

		await fixture.controller.handleSubmit("  hello  ");

		await expect(input).resolves.toBe("hello");
		expect(fixture.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(fixture.addToHistory).toHaveBeenCalledWith("hello");
	});

	it("creates a new session and renders its success state", async () => {
		const fixture = createCommandFixture();

		await fixture.controller.handleNewSession();

		expect(fixture.stopWorking).toHaveBeenCalledTimes(1);
		expect(fixture.newSession).toHaveBeenCalledTimes(1);
		expect(fixture.renderCurrentSessionState).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});

	it("passes custom compact instructions to the session", async () => {
		const fixture = createCommandFixture();

		await fixture.controller.handleSubmit("/compact focus on tests");

		expect(fixture.stopWorking).toHaveBeenCalledTimes(1);
		expect(fixture.compact).toHaveBeenCalledWith("focus on tests");
	});
});
