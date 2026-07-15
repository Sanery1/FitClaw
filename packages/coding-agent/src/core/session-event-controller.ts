import type { Agent, AgentEvent } from "@fitclaw/agent-core";
import type { AssistantMessage } from "@fitclaw/ai";
import type { AgentCompactionController, AgentRetryController } from "@fitclaw/runtime";
import type { SessionManager } from "./session-manager.js";
import type { SessionMessageQueueController } from "./session-message-queue-controller.js";

interface SessionEventControllerOptions {
	agent: Agent;
	sessionManager: SessionManager;
	retryController: AgentRetryController;
	compactionController: AgentCompactionController;
	messageQueueController: SessionMessageQueueController;
	emitExtensionEvent: (event: AgentEvent) => Promise<void>;
	emit: (event: AgentEvent) => void;
	checkCompaction: (message: AssistantMessage) => Promise<boolean>;
}

export class SessionEventController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly retryController: AgentRetryController;
	private readonly compactionController: AgentCompactionController;
	private readonly messageQueueController: SessionMessageQueueController;
	private readonly emitExtensionEvent: SessionEventControllerOptions["emitExtensionEvent"];
	private readonly emit: SessionEventControllerOptions["emit"];
	private readonly checkCompaction: SessionEventControllerOptions["checkCompaction"];
	private unsubscribeAgent: (() => void) | undefined;
	private eventQueue: Promise<void> = Promise.resolve();
	private lastAssistantMessage: AssistantMessage | undefined;

	constructor(options: SessionEventControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.retryController = options.retryController;
		this.compactionController = options.compactionController;
		this.messageQueueController = options.messageQueueController;
		this.emitExtensionEvent = options.emitExtensionEvent;
		this.emit = options.emit;
		this.checkCompaction = options.checkCompaction;
	}

	connect(): void {
		if (this.unsubscribeAgent) return;
		this.unsubscribeAgent = this.agent.subscribe(this.handleAgentEvent);
	}

	disconnect(): void {
		this.unsubscribeAgent?.();
		this.unsubscribeAgent = undefined;
	}

	async waitForPendingEvents(): Promise<void> {
		await this.eventQueue;
	}

	private handleAgentEvent = (event: AgentEvent): void => {
		// Register retry work before async extension handlers so prompt() cannot miss the retry promise.
		this.retryController.prepareForAgentEvent(event);
		this.eventQueue = this.eventQueue.then(
			() => this.processAgentEvent(event),
			() => this.processAgentEvent(event),
		);
		// The rejection handler above keeps later events moving; this prevents an unhandled rejection meanwhile.
		this.eventQueue.catch(() => {});
	};

	private async processAgentEvent(event: AgentEvent): Promise<void> {
		if (event.type === "message_start" && event.message.role === "user") {
			this.compactionController.resetOverflowRecovery();
			this.messageQueueController.removeDeliveredUserMessage(event.message);
		}

		await this.emitExtensionEvent(event);
		this.emit(event);

		if (event.type === "message_end") {
			this.persistMessage(event);
			if (event.message.role === "assistant") {
				this.lastAssistantMessage = event.message;
				this.retryController.onAssistantMessage(event.message);
			}
		}

		if (event.type === "agent_end" && this.lastAssistantMessage) {
			const message = this.lastAssistantMessage;
			this.lastAssistantMessage = undefined;
			if (await this.retryController.handleAgentEnd(message)) return;
			await this.checkCompaction(message);
		}
	}

	private persistMessage(event: Extract<AgentEvent, { type: "message_end" }>): void {
		const { message } = event;
		if (message.role === "custom") {
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
		} else if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
			this.sessionManager.appendMessage(message);
		}
	}
}
