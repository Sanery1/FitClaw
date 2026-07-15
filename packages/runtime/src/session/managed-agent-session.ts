import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@fitclaw/agent-core";
import type { AssistantMessage, ImageContent } from "@fitclaw/ai";
import type { ModelRegistry } from "../auth/model-registry.js";
import type { SettingsManager } from "../settings/settings-manager.js";
import { AgentCompactionController, type AgentCompactionEvent } from "./agent-compaction-controller.js";
import { AgentRetryController, type AgentRetryEvent } from "./agent-retry-controller.js";
import type { compact } from "./compaction/index.js";
import type { SessionManager } from "./session-manager.js";

export type ManagedAgentSessionEvent = AgentEvent | AgentCompactionEvent | AgentRetryEvent;

export type ManagedAgentSessionEventListener = (event: ManagedAgentSessionEvent) => void;

export interface ManagedAgentSessionOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	compact?: typeof compact;
}

export class ManagedAgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;

	private readonly settingsManager: SettingsManager;
	private readonly modelRegistry: ModelRegistry;
	private readonly compactionController: AgentCompactionController;
	private readonly retryController: AgentRetryController;
	private readonly eventListeners = new Set<ManagedAgentSessionEventListener>();
	private readonly unsubscribeAgent: () => void;
	private agentEventQueue: Promise<void> = Promise.resolve();
	private lastAssistantMessage: AssistantMessage | undefined;

	constructor(options: ManagedAgentSessionOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.modelRegistry = options.modelRegistry;
		this.compactionController = new AgentCompactionController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			getSettings: () => this.settingsManager.getCompactionSettings(),
			emit: (event) => this.emit(event),
			compact: options.compact,
			requestCompaction: (reason, willRetry) => this.runAutoCompaction(reason, willRetry),
		});
		this.retryController = new AgentRetryController({
			agent: this.agent,
			getSettings: () => this.settingsManager.getRetrySettings(),
			emit: (event) => this.emit(event),
		});
		this.unsubscribeAgent = this.agent.subscribe(this.handleAgentEvent);
	}

	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	subscribe(listener: ManagedAgentSessionEventListener): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	updateRuntime(systemPrompt: string, tools: AgentTool[]): void {
		this.agent.state.systemPrompt = systemPrompt;
		this.agent.state.tools = tools.slice();
	}

	async prompt(text: string, images?: ImageContent[]): Promise<void> {
		const lastAssistantMessage = this.findLastAssistantMessage(this.agent.state.messages);
		if (lastAssistantMessage) {
			const didScheduleRecovery = await this.compactionController.check(lastAssistantMessage, false);
			if (didScheduleRecovery) {
				await this.compactionController.waitForRecovery();
				await this.agent.waitForIdle();
				await this.agentEventQueue;
			}
		}

		const model = this.agent.state.model;
		if (!this.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key found for "${model.provider}".`);
		}

		await this.agent.prompt(text, images);
		await this.retryController.waitForRetry();
		await this.agentEventQueue;
		await this.compactionController.waitForRecovery();
		await this.agent.waitForIdle();
		await this.agentEventQueue;
	}

	async abort(): Promise<void> {
		this.retryController.abort();
		this.compactionController.abort();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	dispose(): void {
		this.retryController.abort();
		this.compactionController.abort();
		this.unsubscribeAgent();
		this.eventListeners.clear();
	}

	private readonly handleAgentEvent = (event: AgentEvent): void => {
		this.retryController.prepareForAgentEvent(event);
		this.agentEventQueue = this.agentEventQueue.then(
			() => this.processAgentEvent(event),
			() => this.processAgentEvent(event),
		);
		this.agentEventQueue.catch(() => {});
	};

	private async processAgentEvent(event: AgentEvent): Promise<void> {
		if (event.type === "message_start" && event.message.role === "user") {
			this.compactionController.resetOverflowRecovery();
		}

		this.emit(event);

		if (event.type === "message_end") {
			if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				this.sessionManager.appendMessage(event.message);
			}

			if (event.message.role === "assistant") {
				this.lastAssistantMessage = event.message;
				this.retryController.onAssistantMessage(event.message);
			}
		}

		if (event.type !== "agent_end" || !this.lastAssistantMessage) return;

		const assistantMessage = this.lastAssistantMessage;
		this.lastAssistantMessage = undefined;
		if (await this.retryController.handleAgentEnd(assistantMessage)) return;
		await this.compactionController.check(assistantMessage);
	}

	private emit(event: ManagedAgentSessionEvent): void {
		for (const listener of this.eventListeners) listener(event);
	}

	private findLastAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.role === "assistant") return message;
		}
		return undefined;
	}

	private async runAutoCompaction(reason: "threshold" | "overflow", willRetry: boolean): Promise<boolean> {
		return this.compactionController.run(reason, willRetry);
	}
}
