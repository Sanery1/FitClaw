import { type Container, type EditorComponent, Spacer, TruncatedText, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { BashExecutionComponent } from "./components/bash-execution.js";
import { theme } from "./theme/theme.js";

type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

export interface InteractiveMessageQueueControllerOptions {
	getSession: () => AgentSession;
	getEditor: () => EditorComponent;
	ui: TUI;
	chatContainer: Container;
	pendingMessagesContainer: Container;
	getDequeueKeyDisplay: () => string;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
}

export class InteractiveMessageQueueController {
	private compactionQueuedMessages: CompactionQueuedMessage[] = [];
	private pendingBashComponents: BashExecutionComponent[] = [];

	constructor(private readonly options: InteractiveMessageQueueControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	private get editor(): EditorComponent {
		return this.options.getEditor();
	}

	async handleFollowUp(): Promise<void> {
		const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
		if (!text) return;

		if (this.session.isCompacting) {
			if (this.isExtensionCommand(text)) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.session.prompt(text);
			} else {
				this.queueCompactionMessage(text, "followUp");
			}
			return;
		}

		if (this.session.isStreaming) {
			this.editor.addToHistory?.(text);
			this.editor.setText("");
			await this.session.prompt(text, { streamingBehavior: "followUp" });
			this.updatePendingMessagesDisplay();
			this.options.ui.requestRender();
		} else if (this.editor.onSubmit) {
			this.editor.onSubmit(text);
		}
	}

	handleDequeue(): void {
		const restored = this.restoreQueuedMessagesToEditor();
		if (restored === 0) {
			this.options.showStatus("No queued messages to restore");
		} else {
			this.options.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
		}
	}

	clearCompactionQueue(): void {
		this.compactionQueuedMessages = [];
	}

	updatePendingMessagesDisplay(): void {
		this.options.pendingMessagesContainer.clear();
		const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
		if (steeringMessages.length === 0 && followUpMessages.length === 0) {
			return;
		}

		this.options.pendingMessagesContainer.addChild(new Spacer(1));
		for (const message of steeringMessages) {
			const text = theme.fg("dim", `Steering: ${message}`);
			this.options.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
		}
		for (const message of followUpMessages) {
			const text = theme.fg("dim", `Follow-up: ${message}`);
			this.options.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
		}
		const dequeueHint = this.options.getDequeueKeyDisplay();
		const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
		this.options.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
	}

	restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		const { steering, followUp } = this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) {
				this.session.agent.abort();
			}
			return 0;
		}

		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		const combinedText = [queuedText, currentText].filter((text) => text.trim()).join("\n\n");
		this.editor.setText(combinedText);
		this.updatePendingMessagesDisplay();
		if (options?.abort) {
			this.session.agent.abort();
		}
		return allQueued.length;
	}

	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.compactionQueuedMessages.push({ text, mode });
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.options.showStatus("Queued message for after compaction");
	}

	isExtensionCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return !!this.session.extensionRunner.getCommand(commandName);
	}

	async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		if (this.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...this.compactionQueuedMessages];
		this.compactionQueuedMessages = [];
		this.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			this.session.clearQueue();
			this.compactionQueuedMessages = queuedMessages;
			this.updatePendingMessagesDisplay();
			this.options.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				for (const message of queuedMessages) {
					if (this.isExtensionCommand(message.text)) {
						await this.session.prompt(message.text);
					} else if (message.mode === "followUp") {
						await this.session.followUp(message.text);
					} else {
						await this.session.steer(message.text);
					}
				}
				this.updatePendingMessagesDisplay();
				return;
			}

			const firstPromptIndex = queuedMessages.findIndex((message) => !this.isExtensionCommand(message.text));
			if (firstPromptIndex === -1) {
				for (const message of queuedMessages) {
					await this.session.prompt(message.text);
				}
				return;
			}

			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await this.session.prompt(message.text);
			}

			const promptPromise = this.session.prompt(firstPrompt.text).catch((error) => {
				restoreQueue(error);
			});

			for (const message of rest) {
				if (this.isExtensionCommand(message.text)) {
					await this.session.prompt(message.text);
				} else if (message.mode === "followUp") {
					await this.session.followUp(message.text);
				} else {
					await this.session.steer(message.text);
				}
			}
			this.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error: unknown) {
			restoreQueue(error);
		}
	}

	addPendingBashComponent(component: BashExecutionComponent): void {
		this.pendingBashComponents.push(component);
	}

	flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.options.pendingMessagesContainer.removeChild(component);
			this.options.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}

	private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return {
			steering: [
				...this.session.getSteeringMessages(),
				...this.compactionQueuedMessages
					.filter((message) => message.mode === "steer")
					.map((message) => message.text),
			],
			followUp: [
				...this.session.getFollowUpMessages(),
				...this.compactionQueuedMessages
					.filter((message) => message.mode === "followUp")
					.map((message) => message.text),
			],
		};
	}

	private clearAllQueues(): { steering: string[]; followUp: string[] } {
		const { steering, followUp } = this.session.clearQueue();
		const compactionSteering = this.compactionQueuedMessages
			.filter((message) => message.mode === "steer")
			.map((message) => message.text);
		const compactionFollowUp = this.compactionQueuedMessages
			.filter((message) => message.mode === "followUp")
			.map((message) => message.text);
		this.compactionQueuedMessages = [];
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}
}
