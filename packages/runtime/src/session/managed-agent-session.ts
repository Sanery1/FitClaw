import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@fitclaw/agent-core";
import type { AssistantMessage, ImageContent } from "@fitclaw/ai";
import { isContextOverflow } from "@fitclaw/ai";
import type { ModelRegistry } from "../auth/model-registry.js";
import type { SettingsManager } from "../settings/settings-manager.js";
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
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

export type ManagedAgentSessionEventListener = (event: ManagedAgentSessionEvent) => void;

export interface ManagedAgentSessionOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	compact?: typeof compact;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Sleep aborted"));
			},
			{ once: true },
		);
	});
}

export class ManagedAgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;

	private readonly settingsManager: SettingsManager;
	private readonly modelRegistry: ModelRegistry;
	private readonly compactSession: typeof compact;
	private readonly eventListeners = new Set<ManagedAgentSessionEventListener>();
	private readonly unsubscribeAgent: () => void;
	private agentEventQueue: Promise<void> = Promise.resolve();
	private lastAssistantMessage: AssistantMessage | undefined;
	private retryAttempt = 0;
	private retryPromise: Promise<void> | undefined;
	private retryResolve: (() => void) | undefined;
	private retryAbortController: AbortController | undefined;
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
		await this.waitForRetry();
		await this.agentEventQueue;
		await this.waitForRecovery();
		await this.agent.waitForIdle();
		await this.agentEventQueue;
	}

	async abort(): Promise<void> {
		this.retryAbortController?.abort();
		this.compactionAbortController?.abort();
		this.resolveRetry();
		this.resolveRecovery();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	dispose(): void {
		this.unsubscribeAgent();
		this.eventListeners.clear();
	}

	private readonly handleAgentEvent = (event: AgentEvent): void => {
		this.createRetryPromiseForAgentEnd(event);
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
				if (event.message.stopReason !== "error") {
					if (this.retryAttempt > 0) {
						this.emit({ type: "auto_retry_end", success: true, attempt: this.retryAttempt });
						this.retryAttempt = 0;
					}
				}
			}
		}

		if (event.type !== "agent_end" || !this.lastAssistantMessage) return;

		const assistantMessage = this.lastAssistantMessage;
		this.lastAssistantMessage = undefined;
		if (this.isRetryableError(assistantMessage) && (await this.handleRetryableError(assistantMessage))) {
			return;
		}

		this.resolveRetry();
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

	private createRetryPromiseForAgentEnd(event: AgentEvent): void {
		if (event.type !== "agent_end" || this.retryPromise || !this.settingsManager.getRetrySettings().enabled) return;
		const assistantMessage = this.findLastAssistantMessage(event.messages);
		if (!assistantMessage || !this.isRetryableError(assistantMessage)) return;
		this.retryPromise = new Promise((resolve) => {
			this.retryResolve = resolve;
		});
	}

	private isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;
		if (isContextOverflow(message, this.agent.state.model.contextWindow)) return false;
		return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
			message.errorMessage,
		);
	}

	private async handleRetryableError(message: AssistantMessage): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) return false;

		this.retryAttempt++;
		if (this.retryAttempt > settings.maxRetries) {
			this.emit({
				type: "auto_retry_end",
				success: false,
				attempt: this.retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this.retryAttempt = 0;
			return false;
		}

		const delayMs = settings.baseDelayMs * 2 ** (this.retryAttempt - 1);
		this.emit({
			type: "auto_retry_start",
			attempt: this.retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		const messages = this.agent.state.messages;
		if (messages.at(-1)?.role === "assistant") this.agent.state.messages = messages.slice(0, -1);

		this.retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this.retryAbortController.signal);
		} catch {
			const attempt = this.retryAttempt;
			this.retryAttempt = 0;
			this.emit({ type: "auto_retry_end", success: false, attempt, finalError: "Retry cancelled" });
			this.resolveRetry();
			return false;
		} finally {
			this.retryAbortController = undefined;
		}

		setTimeout(() => {
			this.agent.continue().catch((error: unknown) => {
				const attempt = this.retryAttempt;
				this.retryAttempt = 0;
				this.emit({
					type: "auto_retry_end",
					success: false,
					attempt,
					finalError: error instanceof Error ? error.message : String(error),
				});
				this.resolveRetry();
			});
		}, 0);
		return true;
	}

	private resolveRetry(): void {
		this.retryResolve?.();
		this.retryResolve = undefined;
		this.retryPromise = undefined;
	}

	private async waitForRetry(): Promise<void> {
		if (!this.retryPromise) return;
		await this.retryPromise;
		await this.agent.waitForIdle();
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
