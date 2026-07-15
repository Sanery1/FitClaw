import { type Container, type EditorComponent, Spacer, Text, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { CustomEditor } from "./components/custom-editor.js";
import type { InteractiveAuthController } from "./interactive-auth-controller.js";
import type { InteractiveBashController } from "./interactive-bash-controller.js";
import type { InteractiveFeedbackController } from "./interactive-feedback-controller.js";
import type { InteractiveInfoController } from "./interactive-info-controller.js";
import type { InteractiveMessageQueueController } from "./interactive-message-queue-controller.js";
import type { InteractiveModelController } from "./interactive-model-controller.js";
import type { InteractiveReloadController } from "./interactive-reload-controller.js";
import type { InteractiveSessionNavigationController } from "./interactive-session-navigation-controller.js";
import type { InteractiveSessionTransferController } from "./interactive-session-transfer-controller.js";
import type { InteractiveSettingsController } from "./interactive-settings-controller.js";
import type { InteractiveTerminalController } from "./interactive-terminal-controller.js";
import type { InteractiveWorkingController } from "./interactive-working-controller.js";
import { theme } from "./theme/theme.js";

export interface InteractiveCommandControllerOptions {
	getSession: () => AgentSession;
	runtimeHost: Pick<AgentSessionRuntime, "newSession">;
	ui: TUI;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	getEditor: () => EditorComponent;
	authController: InteractiveAuthController;
	bashController: InteractiveBashController;
	feedbackController: InteractiveFeedbackController;
	infoController: InteractiveInfoController;
	messageQueueController: InteractiveMessageQueueController;
	modelController: InteractiveModelController;
	reloadController: InteractiveReloadController;
	sessionNavigationController: InteractiveSessionNavigationController;
	sessionTransferController: InteractiveSessionTransferController;
	settingsController: InteractiveSettingsController;
	terminalController: InteractiveTerminalController;
	workingController: InteractiveWorkingController;
	renderCurrentSessionState: () => void;
	resetBashMode: () => void;
	handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<never>;
}

export class InteractiveCommandController {
	private onInputCallback?: (text: string) => void;

	constructor(private readonly options: InteractiveCommandControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	private get editor(): EditorComponent {
		return this.options.getEditor();
	}

	setup(): void {
		this.options.defaultEditor.onSubmit = (text) => this.handleSubmit(text);
	}

	getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	async handleSubmit(text: string): Promise<void> {
		const trimmedText = text.trim();
		if (!trimmedText) return;

		if (await this.handleBuiltInCommand(trimmedText)) return;
		if (await this.handleBashCommand(trimmedText)) return;

		if (this.session.isCompacting) {
			if (this.options.messageQueueController.isExtensionCommand(trimmedText)) {
				this.editor.addToHistory?.(trimmedText);
				this.editor.setText("");
				await this.session.prompt(trimmedText);
			} else {
				this.options.messageQueueController.queueCompactionMessage(trimmedText, "steer");
			}
			return;
		}

		if (this.session.isStreaming) {
			this.editor.addToHistory?.(trimmedText);
			this.editor.setText("");
			await this.session.prompt(trimmedText, { streamingBehavior: "steer" });
			this.options.messageQueueController.updatePendingMessagesDisplay();
			this.options.ui.requestRender();
			return;
		}

		this.options.messageQueueController.flushPendingBashComponents();
		this.onInputCallback?.(trimmedText);
		this.editor.addToHistory?.(trimmedText);
	}

	async handleNewSession(): Promise<void> {
		this.options.workingController.stop();
		try {
			const result = await this.options.runtimeHost.newSession();
			if (result.cancelled) return;

			this.options.renderCurrentSessionState();
			this.options.chatContainer.addChild(new Spacer(1));
			this.options.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
			this.options.ui.requestRender();
		} catch (error: unknown) {
			await this.options.handleFatalRuntimeError("Failed to create session", error);
		}
	}

	private async handleBuiltInCommand(text: string): Promise<boolean> {
		if (text === "/settings") {
			this.options.settingsController.show();
			this.editor.setText("");
			return true;
		}
		if (text === "/scoped-models") {
			this.editor.setText("");
			await this.options.modelController.showScopedModelsSelector();
			return true;
		}
		if (text === "/model" || text.startsWith("/model ")) {
			const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
			this.editor.setText("");
			await this.options.modelController.handleCommand(searchTerm);
			return true;
		}
		if (text === "/export" || text.startsWith("/export ")) {
			await this.options.sessionTransferController.handleExportCommand(text);
			this.editor.setText("");
			return true;
		}
		if (text === "/import" || text.startsWith("/import ")) {
			await this.options.sessionTransferController.handleImportCommand(text);
			this.editor.setText("");
			return true;
		}
		if (text === "/share") {
			await this.options.sessionTransferController.handleShareCommand();
			this.editor.setText("");
			return true;
		}
		if (text === "/copy") {
			await this.options.sessionTransferController.handleCopyCommand();
			this.editor.setText("");
			return true;
		}
		if (text === "/name" || text.startsWith("/name ")) {
			this.options.infoController.handleNameCommand(text);
			this.editor.setText("");
			return true;
		}
		if (text === "/session") {
			this.options.infoController.showSessionInfo();
			this.editor.setText("");
			return true;
		}
		if (text === "/changelog") {
			this.options.infoController.showChangelog();
			this.editor.setText("");
			return true;
		}
		if (text === "/hotkeys") {
			this.options.infoController.showHotkeys();
			this.editor.setText("");
			return true;
		}
		if (text === "/fork") {
			this.options.sessionNavigationController.showUserMessageSelector();
			this.editor.setText("");
			return true;
		}
		if (text === "/clone") {
			this.editor.setText("");
			await this.options.sessionNavigationController.handleCloneCommand();
			return true;
		}
		if (text === "/tree") {
			this.options.sessionNavigationController.showTreeSelector();
			this.editor.setText("");
			return true;
		}
		if (text === "/login") {
			this.options.authController.show("login");
			this.editor.setText("");
			return true;
		}
		if (text === "/logout") {
			this.options.authController.show("logout");
			this.editor.setText("");
			return true;
		}
		if (text === "/new") {
			this.editor.setText("");
			await this.handleNewSession();
			return true;
		}
		if (text === "/compact" || text.startsWith("/compact ")) {
			const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
			this.editor.setText("");
			await this.handleCompactCommand(customInstructions);
			return true;
		}
		if (text === "/reload") {
			this.editor.setText("");
			await this.options.reloadController.reload();
			return true;
		}
		if (text === "/debug") {
			this.options.feedbackController.writeDebugLog();
			this.editor.setText("");
			return true;
		}
		if (text === "/arminsayshi") {
			this.options.feedbackController.showArmin();
			this.editor.setText("");
			return true;
		}
		if (text === "/dementedelves") {
			this.options.feedbackController.showDementedDelves();
			this.editor.setText("");
			return true;
		}
		if (text === "/resume") {
			this.options.sessionNavigationController.showSessionSelector();
			this.editor.setText("");
			return true;
		}
		if (text === "/quit") {
			this.editor.setText("");
			await this.options.terminalController.shutdown();
			return true;
		}
		return false;
	}

	private async handleBashCommand(text: string): Promise<boolean> {
		if (!text.startsWith("!")) return false;

		const isExcluded = text.startsWith("!!");
		const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
		if (!command) return false;

		if (this.session.isBashRunning) {
			this.options.feedbackController.showWarning(
				"A bash command is already running. Press Esc to cancel it first.",
			);
			this.editor.setText(text);
			return true;
		}

		this.editor.addToHistory?.(text);
		await this.options.bashController.handle(command, isExcluded);
		this.options.resetBashMode();
		return true;
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		const entries = this.session.sessionManager.getEntries();
		const messageCount = entries.filter((entry) => entry.type === "message").length;

		if (messageCount < 2) {
			this.options.feedbackController.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		this.options.workingController.stop();
		try {
			await this.session.compact(customInstructions);
		} catch {
			// Compaction failures are rendered from the emitted session event.
		}
	}
}
