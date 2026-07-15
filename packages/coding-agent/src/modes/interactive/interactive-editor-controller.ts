import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EditorComponent, TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import { extensionForImageMimeType, readClipboardImage } from "../../utils/clipboard-image.js";
import type { CustomEditor } from "./components/custom-editor.js";
import type { FooterComponent } from "./components/footer.js";
import type { InteractiveCommandController } from "./interactive-command-controller.js";
import type { InteractiveFeedbackController } from "./interactive-feedback-controller.js";
import type { InteractiveMessageQueueController } from "./interactive-message-queue-controller.js";
import type { InteractiveModelController } from "./interactive-model-controller.js";
import type { InteractiveSessionNavigationController } from "./interactive-session-navigation-controller.js";
import type { InteractiveSettingsController } from "./interactive-settings-controller.js";
import type { InteractiveTerminalController } from "./interactive-terminal-controller.js";
import { theme } from "./theme/theme.js";

export interface InteractiveEditorControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	defaultEditor: CustomEditor;
	getEditor: () => EditorComponent;
	footer: FooterComponent;
	commandController: InteractiveCommandController;
	feedbackController: InteractiveFeedbackController;
	messageQueueController: InteractiveMessageQueueController;
	modelController: InteractiveModelController;
	sessionNavigationController: InteractiveSessionNavigationController;
	settingsController: InteractiveSettingsController;
	terminalController: InteractiveTerminalController;
	toggleToolOutputExpansion: () => void;
}

export class InteractiveEditorController {
	private isBashMode = false;
	private lastEscapeTime = 0;

	constructor(private readonly options: InteractiveEditorControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	private get editor(): EditorComponent {
		return this.options.getEditor();
	}

	setup(): void {
		this.options.defaultEditor.onEscape = () => this.handleEscape();
		this.options.defaultEditor.onAction("app.clear", () => this.options.terminalController.handleInterruptKey());
		this.options.defaultEditor.onCtrlD = () => this.options.terminalController.handleExitKey();
		this.options.defaultEditor.onAction("app.suspend", () => this.options.terminalController.suspend());
		this.options.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
		this.options.defaultEditor.onAction("app.model.cycleForward", () =>
			this.options.modelController.cycle("forward"),
		);
		this.options.defaultEditor.onAction("app.model.cycleBackward", () =>
			this.options.modelController.cycle("backward"),
		);
		this.options.ui.onDebug = () => this.options.feedbackController.writeDebugLog();
		this.options.defaultEditor.onAction("app.model.select", () => this.options.modelController.showModelSelector());
		this.options.defaultEditor.onAction("app.tools.expand", () => this.options.toggleToolOutputExpansion());
		this.options.defaultEditor.onAction("app.thinking.toggle", () =>
			this.options.settingsController.toggleThinkingVisibility(),
		);
		this.options.defaultEditor.onAction("app.editor.external", () =>
			this.options.terminalController.openExternalEditor(),
		);
		this.options.defaultEditor.onAction("app.message.followUp", () =>
			this.options.messageQueueController.handleFollowUp(),
		);
		this.options.defaultEditor.onAction("app.message.dequeue", () =>
			this.options.messageQueueController.handleDequeue(),
		);
		this.options.defaultEditor.onAction("app.session.new", () => this.options.commandController.handleNewSession());
		this.options.defaultEditor.onAction("app.session.tree", () =>
			this.options.sessionNavigationController.showTreeSelector(),
		);
		this.options.defaultEditor.onAction("app.session.fork", () =>
			this.options.sessionNavigationController.showUserMessageSelector(),
		);
		this.options.defaultEditor.onAction("app.session.resume", () =>
			this.options.sessionNavigationController.showSessionSelector(),
		);
		this.options.defaultEditor.onChange = (text) => this.updateBashMode(text);
		this.options.defaultEditor.onPasteImage = () => {
			void this.handleClipboardImagePaste();
		};
	}

	clear(): void {
		this.editor.setText("");
		this.options.ui.requestRender();
	}

	resetBashMode(): void {
		this.isBashMode = false;
		this.updateBorderColor();
	}

	updateBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.options.ui.requestRender();
	}

	private handleEscape(): void {
		if (this.session.isStreaming) {
			this.options.messageQueueController.restoreQueuedMessagesToEditor({ abort: true });
			return;
		}
		if (this.session.isBashRunning) {
			this.session.abortBash();
			return;
		}
		if (this.isBashMode) {
			this.editor.setText("");
			this.resetBashMode();
			return;
		}
		if (this.editor.getText().trim()) return;

		const action = this.session.settingsManager.getDoubleEscapeAction();
		if (action === "none") return;

		const now = Date.now();
		if (now - this.lastEscapeTime >= 500) {
			this.lastEscapeTime = now;
			return;
		}

		if (action === "tree") {
			this.options.sessionNavigationController.showTreeSelector();
		} else {
			this.options.sessionNavigationController.showUserMessageSelector();
		}
		this.lastEscapeTime = 0;
	}

	private updateBashMode(text: string): void {
		const isBashMode = text.trimStart().startsWith("!");
		if (isBashMode === this.isBashMode) return;

		this.isBashMode = isBashMode;
		this.updateBorderColor();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.options.feedbackController.showStatus("Current model does not support thinking");
			return;
		}

		this.options.footer.invalidate();
		this.updateBorderColor();
		this.options.feedbackController.showStatus(`Thinking level: ${newLevel}`);
	}

	private async handleClipboardImagePaste(): Promise<void> {
		try {
			const image = await readClipboardImage();
			if (!image) return;

			const extension = extensionForImageMimeType(image.mimeType) ?? "png";
			const filePath = path.join(os.tmpdir(), `pi-clipboard-${crypto.randomUUID()}.${extension}`);
			fs.writeFileSync(filePath, Buffer.from(image.bytes));
			this.editor.insertTextAtCursor?.(filePath);
			this.options.ui.requestRender();
		} catch {
			// Clipboard access can fail when the terminal lacks OS clipboard permissions.
		}
	}
}
