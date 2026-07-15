import type { Agent } from "@fitclaw/agent-core";
import type { AssistantMessage } from "@fitclaw/ai";
import { isContextOverflow } from "@fitclaw/ai";
import type { ModelRegistry } from "../auth/model-registry.js";
import {
	type CompactionPreparation,
	type CompactionResult,
	type CompactionSettings,
	calculateContextTokens,
	compact,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
} from "./compaction/index.js";
import {
	type CompactionEntry,
	getLatestCompactionEntry,
	type SessionEntry,
	type SessionManager,
} from "./session-manager.js";

export type AgentCompactionReason = "threshold" | "overflow";

export type AgentCompactionEvent =
	| { type: "compaction_start"; reason: AgentCompactionReason }
	| {
			type: "compaction_end";
			reason: AgentCompactionReason;
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  };

export interface AgentCompactionBeforeContext {
	preparation: CompactionPreparation;
	branchEntries: SessionEntry[];
	signal: AbortSignal;
}

export interface AgentCompactionBeforeResult {
	cancel?: boolean;
	compaction?: CompactionResult;
	fromHook?: boolean;
}

export interface AgentCompactionCompleteContext {
	compactionEntry: CompactionEntry;
	fromHook: boolean;
}

export interface AgentCompactionControllerOptions {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendCompaction" | "buildSessionContext" | "getBranch" | "getEntry">;
	modelRegistry: Pick<ModelRegistry, "getApiKeyAndHeaders">;
	getSettings: () => CompactionSettings;
	emit: (event: AgentCompactionEvent) => void;
	compact?: typeof compact;
	prepareCompaction?: typeof prepareCompaction;
	beforeCompact?: (context: AgentCompactionBeforeContext) => Promise<AgentCompactionBeforeResult | undefined>;
	afterCompact?: (context: AgentCompactionCompleteContext) => Promise<void>;
	requestCompaction?: (reason: AgentCompactionReason, willRetry: boolean) => Promise<boolean>;
}

const OVERFLOW_RECOVERY_FAILED_MESSAGE =
	"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.";

export class AgentCompactionController {
	private readonly agent: Agent;
	private readonly sessionManager: AgentCompactionControllerOptions["sessionManager"];
	private readonly modelRegistry: AgentCompactionControllerOptions["modelRegistry"];
	private readonly getSettings: () => CompactionSettings;
	private readonly emit: (event: AgentCompactionEvent) => void;
	private readonly compactSession: typeof compact;
	private readonly prepareSessionCompaction: typeof prepareCompaction;
	private readonly beforeCompact: AgentCompactionControllerOptions["beforeCompact"];
	private readonly afterCompact: AgentCompactionControllerOptions["afterCompact"];
	private readonly requestCompaction: (reason: AgentCompactionReason, willRetry: boolean) => Promise<boolean>;
	private compactionAbortController: AbortController | undefined;
	private continueTimer: ReturnType<typeof setTimeout> | undefined;
	private overflowRecoveryAttempted = false;
	private recoveryPromise: Promise<void> | undefined;
	private recoveryResolve: (() => void) | undefined;

	constructor(options: AgentCompactionControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.modelRegistry = options.modelRegistry;
		this.getSettings = options.getSettings;
		this.emit = options.emit;
		this.compactSession = options.compact ?? compact;
		this.prepareSessionCompaction = options.prepareCompaction ?? prepareCompaction;
		this.beforeCompact = options.beforeCompact;
		this.afterCompact = options.afterCompact;
		this.requestCompaction = options.requestCompaction ?? ((reason, willRetry) => this.run(reason, willRetry));
	}

	get isCompacting(): boolean {
		return this.compactionAbortController !== undefined;
	}

	resetOverflowRecovery(): void {
		this.overflowRecoveryAttempted = false;
	}

	async check(message: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		const settings = this.getSettings();
		if (!settings.enabled || (skipAbortedCheck && message.stopReason === "aborted")) {
			this.resolveRecovery();
			return false;
		}

		const model = this.agent.state.model;
		if (!model) {
			this.resolveRecovery();
			return false;
		}

		const latestCompaction = getLatestCompactionEntry(this.sessionManager.getBranch());
		const latestCompactionTimestamp = latestCompaction ? new Date(latestCompaction.timestamp).getTime() : undefined;
		if (latestCompactionTimestamp !== undefined && message.timestamp <= latestCompactionTimestamp) {
			this.resolveRecovery();
			return false;
		}

		const isCurrentModel = message.provider === model.provider && message.model === model.id;
		if (isCurrentModel && isContextOverflow(message, model.contextWindow)) {
			if (this.overflowRecoveryAttempted) {
				this.emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage: OVERFLOW_RECOVERY_FAILED_MESSAGE,
				});
				this.resolveRecovery();
				return false;
			}

			this.overflowRecoveryAttempted = true;
			const messages = this.agent.state.messages;
			if (messages.at(-1)?.role === "assistant") this.agent.state.messages = messages.slice(0, -1);
			this.createRecoveryPromise();
			const didScheduleRecovery = await this.requestCompaction("overflow", true);
			if (!didScheduleRecovery) this.resolveRecovery();
			return didScheduleRecovery;
		}
		this.overflowRecoveryAttempted = false;

		let contextTokens: number;
		if (message.stopReason === "error") {
			const estimate = estimateContextTokens(this.agent.state.messages);
			if (estimate.lastUsageIndex === null) {
				this.resolveRecovery();
				return false;
			}
			const usageMessage = this.agent.state.messages[estimate.lastUsageIndex];
			if (
				latestCompactionTimestamp !== undefined &&
				usageMessage.role === "assistant" &&
				usageMessage.timestamp <= latestCompactionTimestamp
			) {
				this.resolveRecovery();
				return false;
			}
			contextTokens = estimate.tokens;
		} else {
			contextTokens = calculateContextTokens(message.usage);
		}

		if (shouldCompact(contextTokens, model.contextWindow, settings)) {
			await this.requestCompaction("threshold", false);
		}
		this.resolveRecovery();
		return false;
	}

	async run(reason: AgentCompactionReason, willRetry: boolean): Promise<boolean> {
		this.emit({ type: "compaction_start", reason });
		const abortController = new AbortController();
		this.compactionAbortController = abortController;

		try {
			const model = this.agent.state.model;
			if (!model) {
				this.emitCompactionEnd(reason);
				return false;
			}

			const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				this.emitCompactionEnd(reason);
				return false;
			}

			const branchEntries = this.sessionManager.getBranch();
			const preparation = this.prepareSessionCompaction(branchEntries, this.getSettings());
			if (!preparation) {
				this.emitCompactionEnd(reason);
				return false;
			}

			const beforeResult = await this.beforeCompact?.({
				preparation,
				branchEntries,
				signal: abortController.signal,
			});
			if (beforeResult?.cancel || abortController.signal.aborted) {
				this.emitCompactionEnd(reason, { aborted: true });
				return false;
			}

			const result =
				beforeResult?.compaction ??
				(await this.compactSession(
					preparation,
					model,
					auth.apiKey,
					auth.headers,
					undefined,
					abortController.signal,
					this.agent.state.thinkingLevel,
				));
			if (abortController.signal.aborted) {
				this.emitCompactionEnd(reason, { aborted: true });
				return false;
			}

			const fromHook = beforeResult?.fromHook ?? false;
			const entryId = this.sessionManager.appendCompaction(
				result.summary,
				result.firstKeptEntryId,
				result.tokensBefore,
				result.details,
				fromHook,
			);
			this.agent.state.messages = this.sessionManager.buildSessionContext().messages;

			const compactionEntry = this.sessionManager.getEntry(entryId);
			if (compactionEntry?.type === "compaction") {
				await this.afterCompact?.({ compactionEntry, fromHook });
			}

			this.emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
			if (willRetry) this.removeTrailingAssistant();
			if (willRetry || this.agent.hasQueuedMessages()) this.scheduleContinue(reason, willRetry);
			return willRetry;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			this.emitCompactionEnd(reason, {
				aborted: abortController.signal.aborted,
				errorMessage: `${reason === "overflow" ? "Context overflow recovery" : "Auto-compaction"} failed: ${errorMessage}`,
			});
			this.resolveRecovery();
			return false;
		} finally {
			if (this.compactionAbortController === abortController) this.compactionAbortController = undefined;
		}
	}

	abort(): void {
		if (this.continueTimer) clearTimeout(this.continueTimer);
		this.continueTimer = undefined;
		this.compactionAbortController?.abort();
		this.resolveRecovery();
	}

	async waitForRecovery(): Promise<void> {
		if (this.recoveryPromise) await this.recoveryPromise;
	}

	private emitCompactionEnd(
		reason: AgentCompactionReason,
		options?: { aborted?: boolean; errorMessage?: string },
	): void {
		this.emit({
			type: "compaction_end",
			reason,
			result: undefined,
			aborted: options?.aborted ?? false,
			willRetry: false,
			errorMessage: options?.errorMessage,
		});
	}

	private removeTrailingAssistant(): void {
		const messages = this.agent.state.messages;
		const lastMessage = messages.at(-1);
		if (lastMessage?.role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}
	}

	private scheduleContinue(reason: AgentCompactionReason, willRetry: boolean): void {
		this.continueTimer = setTimeout(() => {
			this.continueTimer = undefined;
			this.agent.continue().catch((error: unknown) => {
				const errorMessage = error instanceof Error ? error.message : String(error);
				this.emitCompactionEnd(reason, {
					errorMessage: `${willRetry ? "Context overflow recovery" : "Auto-compaction continuation"} failed: ${errorMessage}`,
				});
				this.resolveRecovery();
			});
		}, 100);
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
}
