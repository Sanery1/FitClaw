import type { Agent, AgentEvent, AgentMessage } from "@fitclaw/agent-core";
import type { AssistantMessage } from "@fitclaw/ai";
import { isContextOverflow } from "@fitclaw/ai";

export type AgentRetryEvent =
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

export interface AgentRetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}

export interface AgentRetryControllerOptions {
	agent: Agent;
	getSettings: () => AgentRetrySettings;
	emit: (event: AgentRetryEvent) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new Error("Retry cancelled"));
			},
			{ once: true },
		);
	});
}

export class AgentRetryController {
	private readonly agent: Agent;
	private readonly getSettings: () => AgentRetrySettings;
	private readonly emit: (event: AgentRetryEvent) => void;
	private retryAbortController: AbortController | undefined;
	private retryAttempt = 0;
	private retryPromise: Promise<void> | undefined;
	private retryResolve: (() => void) | undefined;
	private continueTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: AgentRetryControllerOptions) {
		this.agent = options.agent;
		this.getSettings = options.getSettings;
		this.emit = options.emit;
	}

	get attempt(): number {
		return this.retryAttempt;
	}

	get isRetrying(): boolean {
		return this.retryPromise !== undefined;
	}

	prepareForAgentEvent(event: AgentEvent): void {
		if (event.type !== "agent_end" || this.retryPromise || !this.getSettings().enabled) return;
		const assistantMessage = this.findLastAssistantMessage(event.messages);
		if (!assistantMessage || !this.isRetryableError(assistantMessage)) return;
		this.createRetryPromise();
	}

	onAssistantMessage(message: AssistantMessage): void {
		if (message.stopReason === "error" || this.retryAttempt === 0) return;
		this.emit({ type: "auto_retry_end", success: true, attempt: this.retryAttempt });
		this.retryAttempt = 0;
	}

	async handleAgentEnd(message: AssistantMessage): Promise<boolean> {
		if (!this.isRetryableError(message)) {
			this.resolveRetry();
			return false;
		}

		const settings = this.getSettings();
		if (!settings.enabled) {
			this.resolveRetry();
			return false;
		}

		this.createRetryPromise();
		this.retryAttempt++;
		if (this.retryAttempt > settings.maxRetries) {
			this.emit({
				type: "auto_retry_end",
				success: false,
				attempt: this.retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this.retryAttempt = 0;
			this.resolveRetry();
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
			if (this.retryPromise && attempt > 0) {
				this.emit({ type: "auto_retry_end", success: false, attempt, finalError: "Retry cancelled" });
			}
			this.resolveRetry();
			return false;
		} finally {
			this.retryAbortController = undefined;
		}

		this.continueTimer = setTimeout(() => {
			this.continueTimer = undefined;
			this.agent.continue().catch((error: unknown) => {
				if (!this.retryPromise) return;
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

	abort(): void {
		const attempt = this.retryAttempt;
		this.retryAttempt = 0;
		if (this.continueTimer) clearTimeout(this.continueTimer);
		this.continueTimer = undefined;
		this.retryAbortController?.abort();
		if (this.retryPromise && attempt > 0) {
			this.emit({ type: "auto_retry_end", success: false, attempt, finalError: "Retry cancelled" });
		}
		this.resolveRetry();
	}

	async waitForRetry(): Promise<void> {
		if (!this.retryPromise) return;
		await this.retryPromise;
		await this.agent.waitForIdle();
	}

	private createRetryPromise(): void {
		if (this.retryPromise) return;
		this.retryPromise = new Promise((resolve) => {
			this.retryResolve = resolve;
		});
	}

	private resolveRetry(): void {
		this.retryResolve?.();
		this.retryResolve = undefined;
		this.retryPromise = undefined;
	}

	private findLastAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (message.role === "assistant") return message;
		}
		return undefined;
	}

	private isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;
		if (isContextOverflow(message, this.agent.state.model?.contextWindow ?? 0)) return false;
		return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
			message.errorMessage,
		);
	}
}
