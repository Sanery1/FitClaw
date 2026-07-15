import type { AgentMessage } from "@fitclaw/agent-core";
import type { AssistantMessage, Message } from "@fitclaw/ai";
import { type Container, type EditorComponent, Loader, type MarkdownTheme, Spacer, Text, type TUI } from "@fitclaw/tui";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { createCompactionSummaryMessage } from "../../core/messages.js";
import type { SessionContext } from "../../core/session-manager.js";
import { parseSkillBlock } from "../../core/skill-block.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CountdownTimer } from "./components/countdown-timer.js";
import type { CustomEditor } from "./components/custom-editor.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { keyText } from "./components/keybinding-hints.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { theme } from "./theme/theme.js";

export interface InteractiveSessionViewControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	chatContainer: Container;
	statusContainer: Container;
	defaultEditor: CustomEditor;
	getEditor: () => EditorComponent;
	isInitialized: () => boolean;
	initialize: () => Promise<void>;
	invalidateFooter: () => void;
	updateEditorBorderColor: () => void;
	startAgentActivity: () => void;
	stopAgentActivity: () => void;
	updatePendingMessagesDisplay: () => void;
	updateTerminalTitle: () => void;
	checkShutdownRequested: () => Promise<void>;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	flushCompactionQueue: (options?: { willRetry?: boolean }) => Promise<void>;
	getHideThinkingBlock: () => boolean;
	getHiddenThinkingLabel: () => string;
	getToolOutputExpanded: () => boolean;
	getMarkdownTheme: () => MarkdownTheme;
}

export class InteractiveSessionViewController {
	private streamingComponent: AssistantMessageComponent | undefined;
	private streamingMessage: AssistantMessage | undefined;
	private readonly pendingTools = new Map<string, ToolExecutionComponent>();
	private autoCompactionLoader: Loader | undefined;
	private autoCompactionEscapeHandler: (() => void) | undefined;
	private retryLoader: Loader | undefined;
	private retryCountdown: CountdownTimer | undefined;
	private retryEscapeHandler: (() => void) | undefined;

	constructor(private readonly options: InteractiveSessionViewControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	async handle(event: AgentSessionEvent): Promise<void> {
		if (!this.options.isInitialized()) {
			await this.options.initialize();
		}

		this.options.invalidateFooter();
		switch (event.type) {
			case "agent_start":
				this.setTerminalProgress(true);
				this.clearRetryStatus();
				this.options.startAgentActivity();
				this.options.ui.requestRender();
				break;

			case "queue_update":
				this.options.updatePendingMessagesDisplay();
				this.options.ui.requestRender();
				break;

			case "session_info_changed":
				this.options.updateTerminalTitle();
				this.options.invalidateFooter();
				this.options.ui.requestRender();
				break;

			case "message_start":
				this.handleMessageStart(event.message);
				break;

			case "message_update":
				this.handleMessageUpdate(event.message);
				break;

			case "message_end":
				this.handleMessageEnd(event.message);
				break;

			case "tool_execution_start":
				this.handleToolExecutionStart(event.toolName, event.toolCallId, event.args);
				break;

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true);
					this.options.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError });
					this.pendingTools.delete(event.toolCallId);
					this.options.ui.requestRender();
				}
				break;
			}

			case "agent_end":
				this.setTerminalProgress(false);
				this.options.stopAgentActivity();
				if (this.streamingComponent) {
					this.options.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
				}
				this.pendingTools.clear();
				await this.options.checkShutdownRequested();
				this.options.ui.requestRender();
				break;

			case "compaction_start":
				this.handleCompactionStart(event.reason);
				break;

			case "compaction_end":
				this.handleCompactionEnd(event);
				break;

			case "auto_retry_start":
				this.handleRetryStart(event.attempt, event.maxAttempts, event.delayMs);
				break;

			case "auto_retry_end":
				this.clearRetryStatus();
				if (!event.success) {
					this.options.showError(
						`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
					);
				}
				this.options.ui.requestRender();
				break;
		}
	}

	resetSessionState(): void {
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
	}

	updateHiddenThinkingLabel(label: string): void {
		for (const child of this.options.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHiddenThinkingLabel(label);
			}
		}
		this.streamingComponent?.setHiddenThinkingLabel(label);
		this.options.ui.requestRender();
	}

	rebuildForThinkingVisibility(hidden: boolean, includeStreaming: boolean): void {
		for (const child of this.options.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHideThinkingBlock(hidden);
			}
		}
		this.options.chatContainer.clear();
		this.rebuildChatFromMessages();
		if (includeStreaming && this.streamingComponent && this.streamingMessage) {
			this.streamingComponent.setHideThinkingBlock(hidden);
			this.streamingComponent.updateContent(this.streamingMessage);
			this.options.chatContainer.addChild(this.streamingComponent);
		}
	}

	renderInitialMessages(): void {
		const sessionManager = this.session.sessionManager;
		this.renderSessionContext(sessionManager.buildSessionContext(), {
			updateFooter: true,
			populateHistory: true,
		});

		const compactionCount = sessionManager.getEntries().filter((entry) => entry.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.options.showStatus(`Session compacted ${times}`);
		}
	}

	rebuildChatFromMessages(): void {
		this.renderSessionContext(this.session.sessionManager.buildSessionContext());
	}

	private setTerminalProgress(isActive: boolean): void {
		if (this.session.settingsManager.getShowTerminalProgress()) {
			this.options.ui.terminal.setProgress(isActive);
		}
	}

	private clearRetryStatus(): void {
		if (this.retryEscapeHandler) {
			this.options.defaultEditor.onEscape = this.retryEscapeHandler;
			this.retryEscapeHandler = undefined;
		}
		this.retryCountdown?.dispose();
		this.retryCountdown = undefined;
		if (this.retryLoader) {
			this.retryLoader.stop();
			this.retryLoader = undefined;
			this.options.statusContainer.clear();
		}
	}

	private handleMessageStart(message: AgentMessage): void {
		if (message.role === "custom") {
			this.addMessageToChat(message);
			this.options.ui.requestRender();
		} else if (message.role === "user") {
			this.addMessageToChat(message);
			this.options.updatePendingMessagesDisplay();
			this.options.ui.requestRender();
		} else if (message.role === "assistant") {
			this.streamingComponent = new AssistantMessageComponent(
				undefined,
				this.options.getHideThinkingBlock(),
				this.options.getMarkdownTheme(),
				this.options.getHiddenThinkingLabel(),
			);
			this.streamingMessage = message;
			this.options.chatContainer.addChild(this.streamingComponent);
			this.streamingComponent.updateContent(message);
			this.options.ui.requestRender();
		}
	}

	private handleMessageUpdate(message: AgentMessage): void {
		if (!this.streamingComponent || message.role !== "assistant") return;
		this.streamingMessage = message;
		this.streamingComponent.updateContent(message);

		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			const component = this.pendingTools.get(content.id);
			if (component) {
				component.updateArgs(content.arguments);
			} else {
				this.pendingTools.set(content.id, this.createToolComponent(content.name, content.id, content.arguments));
			}
		}
		this.options.ui.requestRender();
	}

	private handleMessageEnd(message: AgentMessage): void {
		if (message.role === "user") return;
		if (this.streamingComponent && message.role === "assistant") {
			this.streamingMessage = message;
			let errorMessage: string | undefined;
			if (message.stopReason === "aborted") {
				const retryAttempt = this.session.retryAttempt;
				errorMessage =
					retryAttempt > 0
						? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
						: "Operation aborted";
				message.errorMessage = errorMessage;
			}
			this.streamingComponent.updateContent(message);

			if (message.stopReason === "aborted" || message.stopReason === "error") {
				errorMessage ??= message.errorMessage || "Error";
				for (const component of this.pendingTools.values()) {
					component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
				}
				this.pendingTools.clear();
			} else {
				for (const component of this.pendingTools.values()) {
					component.setArgsComplete();
				}
			}
			this.streamingComponent = undefined;
			this.streamingMessage = undefined;
			this.options.invalidateFooter();
		}
		this.options.ui.requestRender();
	}

	private handleToolExecutionStart(toolName: string, toolCallId: string, args: unknown): void {
		let component = this.pendingTools.get(toolCallId);
		if (!component) {
			component = this.createToolComponent(toolName, toolCallId, args);
			this.pendingTools.set(toolCallId, component);
		}
		component.markExecutionStarted();
		this.options.ui.requestRender();
	}

	private createToolComponent(toolName: string, toolCallId: string, args: unknown): ToolExecutionComponent {
		const settingsManager = this.session.settingsManager;
		const component = new ToolExecutionComponent(
			toolName,
			toolCallId,
			args,
			{
				showImages: settingsManager.getShowImages(),
				imageWidthCells: settingsManager.getImageWidthCells(),
			},
			this.session.getToolDefinition(toolName),
			this.options.ui,
			this.session.sessionManager.getCwd(),
		);
		component.setExpanded(this.options.getToolOutputExpanded());
		this.options.chatContainer.addChild(component);
		return component;
	}

	private handleCompactionStart(reason: "manual" | "threshold" | "overflow"): void {
		this.setTerminalProgress(true);
		this.autoCompactionEscapeHandler = this.options.defaultEditor.onEscape;
		this.options.defaultEditor.onEscape = () => this.session.abortCompaction();
		this.options.statusContainer.clear();
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		this.autoCompactionLoader = new Loader(
			this.options.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
		this.options.statusContainer.addChild(this.autoCompactionLoader);
		this.options.ui.requestRender();
	}

	private handleCompactionEnd(event: Extract<AgentSessionEvent, { type: "compaction_end" }>): void {
		this.setTerminalProgress(false);
		if (this.autoCompactionEscapeHandler) {
			this.options.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
			this.autoCompactionEscapeHandler = undefined;
		}
		if (this.autoCompactionLoader) {
			this.autoCompactionLoader.stop();
			this.autoCompactionLoader = undefined;
			this.options.statusContainer.clear();
		}

		if (event.aborted) {
			if (event.reason === "manual") {
				this.options.showError("Compaction cancelled");
			} else {
				this.options.showStatus("Auto-compaction cancelled");
			}
		} else if (event.result) {
			this.options.chatContainer.clear();
			this.rebuildChatFromMessages();
			this.addMessageToChat(
				createCompactionSummaryMessage(event.result.summary, event.result.tokensBefore, new Date().toISOString()),
			);
			this.options.invalidateFooter();
		} else if (event.errorMessage) {
			if (event.reason === "manual") {
				this.options.showError(event.errorMessage);
			} else {
				this.options.chatContainer.addChild(new Spacer(1));
				this.options.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
			}
		}

		void this.options.flushCompactionQueue({ willRetry: event.willRetry });
		this.options.ui.requestRender();
	}

	private handleRetryStart(attempt: number, maxAttempts: number, delayMs: number): void {
		this.retryEscapeHandler = this.options.defaultEditor.onEscape;
		this.options.defaultEditor.onEscape = () => this.session.abortRetry();
		this.options.statusContainer.clear();
		this.retryCountdown?.dispose();
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		this.retryLoader = new Loader(
			this.options.ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.retryCountdown = new CountdownTimer(
			delayMs,
			this.options.ui,
			(seconds) => this.retryLoader?.setMessage(retryMessage(seconds)),
			() => {
				this.retryCountdown = undefined;
			},
		);
		this.options.statusContainer.addChild(this.retryLoader);
		this.options.ui.requestRender();
	}

	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((content: { type: string }) => content.type === "text");
		return textBlocks.map((content) => (content as { text: string }).text).join("");
	}

	private addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.options.ui, message.excludeFromContext);
				if (message.output) component.appendOutput(message.output);
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
					message.fullOutputPath,
				);
				this.options.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const renderer = this.session.extensionRunner.getMessageRenderer(message.customType);
					const component = new CustomMessageComponent(message, renderer, this.options.getMarkdownTheme());
					component.setExpanded(this.options.getToolOutputExpanded());
					this.options.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.options.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(message, this.options.getMarkdownTheme());
				component.setExpanded(this.options.getToolOutputExpanded());
				this.options.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.options.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(message, this.options.getMarkdownTheme());
				component.setExpanded(this.options.getToolOutputExpanded());
				this.options.chatContainer.addChild(component);
				break;
			}
			case "user": {
				const textContent = this.getUserMessageText(message);
				if (!textContent) break;
				if (this.options.chatContainer.children.length > 0) {
					this.options.chatContainer.addChild(new Spacer(1));
				}
				const skillBlock = parseSkillBlock(textContent);
				if (skillBlock) {
					const component = new SkillInvocationMessageComponent(skillBlock, this.options.getMarkdownTheme());
					component.setExpanded(this.options.getToolOutputExpanded());
					this.options.chatContainer.addChild(component);
					if (skillBlock.userMessage) {
						this.options.chatContainer.addChild(
							new UserMessageComponent(skillBlock.userMessage, this.options.getMarkdownTheme()),
						);
					}
				} else {
					this.options.chatContainer.addChild(
						new UserMessageComponent(textContent, this.options.getMarkdownTheme()),
					);
				}
				if (options?.populateHistory) {
					this.options.getEditor().addToHistory?.(textContent);
				}
				break;
			}
			case "assistant":
				this.options.chatContainer.addChild(
					new AssistantMessageComponent(
						message,
						this.options.getHideThinkingBlock(),
						this.options.getMarkdownTheme(),
						this.options.getHiddenThinkingLabel(),
					),
				);
				break;
			case "toolResult":
				break;
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	private renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.pendingTools.clear();
		if (options.updateFooter) {
			this.options.invalidateFooter();
			this.options.updateEditorBorderColor();
		}

		for (const message of sessionContext.messages) {
			if (message.role === "assistant") {
				this.addMessageToChat(message);
				for (const content of message.content) {
					if (content.type !== "toolCall") continue;
					const component = this.createToolComponent(content.name, content.id, content.arguments);
					if (message.stopReason === "aborted" || message.stopReason === "error") {
						let errorMessage: string;
						if (message.stopReason === "aborted") {
							const retryAttempt = this.session.retryAttempt;
							errorMessage =
								retryAttempt > 0
									? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
									: "Operation aborted";
						} else {
							errorMessage = message.errorMessage || "Error";
						}
						component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
					} else {
						this.pendingTools.set(content.id, component);
					}
				}
			} else if (message.role === "toolResult") {
				const component = this.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					this.pendingTools.delete(message.toolCallId);
				}
			} else {
				this.addMessageToChat(message, options);
			}
		}

		this.pendingTools.clear();
		this.options.ui.requestRender();
	}
}
