import type { Agent } from "@fitclaw/agent-core";
import type { Api, Model } from "@fitclaw/ai";
import { formatNoModelSelectedMessage } from "./auth-guidance.js";
import { type CompactionResult, compact as compactSession, prepareCompaction } from "./compaction/index.js";
import type { ExtensionRunner, SessionBeforeCompactResult } from "./extensions/index.js";
import type { SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";

export type ManualCompactionEvent =
	| { type: "compaction_start"; reason: "manual" }
	| {
			type: "compaction_end";
			reason: "manual";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: false;
			errorMessage?: string;
	  };

interface ManualCompactionControllerOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: Pick<SettingsManager, "getCompactionSettings">;
	getModel: () => Model<Api> | undefined;
	getRequiredRequestAuth: (model: Model<Api>) => Promise<{ apiKey: string; headers?: Record<string, string> }>;
	getExtensionRunner: () => ExtensionRunner;
	emit: (event: ManualCompactionEvent) => void;
}

export class ManualCompactionController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly settingsManager: ManualCompactionControllerOptions["settingsManager"];
	private readonly getModel: ManualCompactionControllerOptions["getModel"];
	private readonly getRequiredRequestAuth: ManualCompactionControllerOptions["getRequiredRequestAuth"];
	private readonly getExtensionRunner: ManualCompactionControllerOptions["getExtensionRunner"];
	private readonly emit: ManualCompactionControllerOptions["emit"];
	private compactionAbortController: AbortController | undefined;

	constructor(options: ManualCompactionControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.getModel = options.getModel;
		this.getRequiredRequestAuth = options.getRequiredRequestAuth;
		this.getExtensionRunner = options.getExtensionRunner;
		this.emit = options.emit;
	}

	get isCompacting(): boolean {
		return this.compactionAbortController !== undefined;
	}

	abort(): void {
		this.compactionAbortController?.abort();
	}

	async compact(customInstructions?: string): Promise<CompactionResult> {
		const abortController = new AbortController();
		this.compactionAbortController = abortController;
		this.emit({ type: "compaction_start", reason: "manual" });

		try {
			const model = this.getModel();
			if (!model) throw new Error(formatNoModelSelectedMessage());
			const { apiKey, headers } = await this.getRequiredRequestAuth(model);
			const branchEntries = this.sessionManager.getBranch();
			const preparation = prepareCompaction(branchEntries, this.settingsManager.getCompactionSettings());
			if (!preparation) {
				if (branchEntries.at(-1)?.type === "compaction") throw new Error("Already compacted");
				throw new Error("Nothing to compact (session too small)");
			}

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;
			const beforeCompactRunner = this.getExtensionRunner();
			if (beforeCompactRunner.hasHandlers("session_before_compact")) {
				const result = (await beforeCompactRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries,
					customInstructions,
					signal: abortController.signal,
				})) as SessionBeforeCompactResult | undefined;
				if (result?.cancel) throw new Error("Compaction cancelled");
				if (result?.compaction) {
					extensionCompaction = result.compaction;
					fromExtension = true;
				}
			}

			const result =
				extensionCompaction ??
				(await compactSession(
					preparation,
					model,
					apiKey,
					headers,
					customInstructions,
					abortController.signal,
					this.agent.state.thinkingLevel,
				));
			if (abortController.signal.aborted) throw new Error("Compaction cancelled");

			const entryId = this.sessionManager.appendCompaction(
				result.summary,
				result.firstKeptEntryId,
				result.tokensBefore,
				result.details,
				fromExtension,
			);
			this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
			const compactionEntry = this.sessionManager.getEntry(entryId);
			if (compactionEntry?.type !== "compaction") {
				throw new Error(`Compaction ${entryId} was not saved`);
			}
			await this.getExtensionRunner().emit({
				type: "session_compact",
				compactionEntry,
				fromExtension,
			});
			this.emit({
				type: "compaction_end",
				reason: "manual",
				result,
				aborted: false,
				willRetry: false,
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isAborted =
				abortController.signal.aborted ||
				message === "Compaction cancelled" ||
				(error instanceof Error && error.name === "AbortError");
			this.emit({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted: isAborted,
				willRetry: false,
				errorMessage: isAborted ? undefined : `Compaction failed: ${message}`,
			});
			throw error;
		} finally {
			if (this.compactionAbortController === abortController) {
				this.compactionAbortController = undefined;
			}
		}
	}
}
