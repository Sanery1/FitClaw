import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@fitclaw/agent-core";
import type { AssistantMessage, ImageContent } from "@fitclaw/ai";
import { isContextOverflow } from "@fitclaw/ai";
import type { ModelRegistry } from "../auth/model-registry.js";
import type { SettingsManager } from "../settings/settings-manager.js";
import { AgentRetryController, type AgentRetryEvent } from "./agent-retry-controller.js";
import {
	type CompactionResult,
	calculateContextTokens,
	compact,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
} from "./compaction/index.js";
import { getLatestCompactionEntry, type SessionManager } from "./session-manager.js";

export type ManagedAgentSessionEvent =
	| AgentEvent
	| { type: "compaction_start"; reason: "threshold" | "overflow" }
	| {
			type: "compaction_end";
			reason: "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| AgentRetryEvent;

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
	private readonly compactSession: typeof compact;
	private readonly retryController: AgentRetryController;
	private readonly eventListeners = new Set<ManagedAgentSessionEventListener>();
	private readonly unsubscribeAgent: () => void;
	private agentEventQueue: Promise<void> = Promise.resolve();
	private lastAssistantMessage: AssistantMessage | undefined;
	private recoveryPromise: Promise<void> | undefined;
	private recoveryResolve: (() => void) | undefined;
	private compactionAbortController: AbortController | undefined;
	private overflowRecoveryAttempted = false;

	constructor(options: ManagedAgentSessionOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.modelRegistry = options.modelRegistry;
		this.compactSession = options.compact ?? compact;
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
			const didScheduleRecovery = await this.checkCompaction(lastAssistantMessage, false);
			if (didScheduleRecovery) {
				await this.waitForRecovery();
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
		await this.waitForRecovery();
		await this.agent.waitForIdle();
		await this.agentEventQueue;
	}

	async abort(): Promise<void> {
		this.retryController.abort();
		this.compactionAbortController?.abort();
		this.resolveRecovery();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	dispose(): void {
		this.retryController.abort();
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
			this.overflowRecoveryAttempted = false;
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
		const didScheduleRecovery = await this.checkCompaction(assistantMessage);
		if (!didScheduleRecovery) {
			if (!isContextOverflow(assistantMessage, this.agent.state.model.contextWindow)) {
				this.overflowRecoveryAttempted = false;
			}
			this.resolveRecovery();
		}
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

	private createRecoveryPromise(): void {
		if (this.recoveryPromise) return;
		this.recoveryPromise = new Promise((resolve) => {
			this.recoveryResolve = resolve;
		});
	}

	private resolveRecovery(): void {
		this.recoveryResolve?.();
		this.recoveryResolve = undefined;
		this.recoveryPromise = undefined;
	}

	private async waitForRecovery(): Promise<void> {
		if (this.recoveryPromise) await this.recoveryPromise;
	}

	private async checkCompaction(message: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled || (skipAbortedCheck && message.stopReason === "aborted")) return false;

		const model = this.agent.state.model;
		const latestCompaction = getLatestCompactionEntry(this.sessionManager.getBranch());
		if (latestCompaction && message.timestamp <= new Date(latestCompaction.timestamp).getTime()) return false;

		const isCurrentModel = message.provider === model.provider && message.model === model.id;
		if (isCurrentModel && isContextOverflow(message, model.contextWindow)) {
			if (this.overflowRecoveryAttempted) {
				this.emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage:
						"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
				});
				return false;
			}

			this.overflowRecoveryAttempted = true;
			const messages = this.agent.state.messages;
			if (messages.at(-1)?.role === "assistant") this.agent.state.messages = messages.slice(0, -1);
			this.createRecoveryPromise();
			return this.runAutoCompaction("overflow", true);
		}

		let contextTokens: number;
		if (message.stopReason === "error") {
			const estimate = estimateContextTokens(this.agent.state.messages);
			if (estimate.lastUsageIndex === null) return false;
			const usageMessage = this.agent.state.messages[estimate.lastUsageIndex];
			if (
				latestCompaction &&
				usageMessage.role === "assistant" &&
				usageMessage.timestamp <= new Date(latestCompaction.timestamp).getTime()
			) {
				return false;
			}
			contextTokens = estimate.tokens;
		} else {
			contextTokens = calculateContextTokens(message.usage);
		}

		if (!shouldCompact(contextTokens, model.contextWindow, settings)) return false;
		await this.runAutoCompaction("threshold", false);
		return false;
	}

	private async runAutoCompaction(reason: "threshold" | "overflow", willRetry: boolean): Promise<boolean> {
		this.emit({ type: "compaction_start", reason });
		this.compactionAbortController = new AbortController();

		try {
			const model = this.agent.state.model;
			const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				this.emit({ type: "compaction_end", reason, result: undefined, aborted: false, willRetry: false });
				return false;
			}

			const preparation = prepareCompaction(
				this.sessionManager.getBranch(),
				this.settingsManager.getCompactionSettings(),
			);
			if (!preparation) {
				this.emit({ type: "compaction_end", reason, result: undefined, aborted: false, willRetry: false });
				return false;
			}

			const result = await this.compactSession(
				preparation,
				model,
				auth.apiKey,
				auth.headers,
				undefined,
				this.compactionAbortController.signal,
				this.agent.state.thinkingLevel,
			);
			if (this.compactionAbortController.signal.aborted) {
				this.emit({ type: "compaction_end", reason, result: undefined, aborted: true, willRetry: false });
				return false;
			}

			this.sessionManager.appendCompaction(
				result.summary,
				result.firstKeptEntryId,
				result.tokensBefore,
				result.details,
				false,
			);
			this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
			this.emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

			if (willRetry) {
				const messages = this.agent.state.messages;
				if (messages.at(-1)?.role === "assistant") this.agent.state.messages = messages.slice(0, -1);
				setTimeout(() => {
					this.agent.continue().catch((error: unknown) => {
						this.emit({
							type: "compaction_end",
							reason,
							result: undefined,
							aborted: false,
							willRetry: false,
							errorMessage: `Context overflow recovery failed: ${error instanceof Error ? error.message : String(error)}`,
						});
						this.resolveRecovery();
					});
				}, 100);
				return true;
			}
			return false;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			this.emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: this.compactionAbortController.signal.aborted,
				willRetry: false,
				errorMessage: `${reason === "overflow" ? "Context overflow recovery" : "Auto-compaction"} failed: ${errorMessage}`,
			});
			return false;
		} finally {
			this.compactionAbortController = undefined;
		}
	}
}
