import type { Agent } from "@fitclaw/agent-core";
import type { Api, Model } from "@fitclaw/ai";
import { collectEntriesForBranchSummary, generateBranchSummary } from "./compaction/index.js";
import type { ExtensionRunner, SessionBeforeTreeResult, TreePreparation } from "./extensions/index.js";
import type { BranchSummaryEntry, SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";

export interface SessionTreeNavigationOptions {
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface SessionTreeNavigationResult {
	editorText?: string;
	cancelled: boolean;
	aborted?: boolean;
	summaryEntry?: BranchSummaryEntry;
}

export interface ForkableUserMessage {
	entryId: string;
	text: string;
}

interface SessionTreeControllerOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: Pick<SettingsManager, "getBranchSummarySettings">;
	getModel: () => Model<Api> | undefined;
	getRequiredRequestAuth: (model: Model<Api>) => Promise<{ apiKey: string; headers?: Record<string, string> }>;
	getExtensionRunner: () => ExtensionRunner;
}

export class SessionTreeController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly settingsManager: SessionTreeControllerOptions["settingsManager"];
	private readonly getModel: SessionTreeControllerOptions["getModel"];
	private readonly getRequiredRequestAuth: SessionTreeControllerOptions["getRequiredRequestAuth"];
	private readonly getExtensionRunner: SessionTreeControllerOptions["getExtensionRunner"];
	private branchSummaryAbortController: AbortController | undefined;

	constructor(options: SessionTreeControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.getModel = options.getModel;
		this.getRequiredRequestAuth = options.getRequiredRequestAuth;
		this.getExtensionRunner = options.getExtensionRunner;
	}

	get isSummarizing(): boolean {
		return this.branchSummaryAbortController !== undefined;
	}

	abort(): void {
		this.branchSummaryAbortController?.abort();
	}

	async navigate(targetId: string, options: SessionTreeNavigationOptions = {}): Promise<SessionTreeNavigationResult> {
		const oldLeafId = this.sessionManager.getLeafId();
		if (targetId === oldLeafId) return { cancelled: false };

		const model = this.getModel();
		if (options.summarize && !model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);
		let customInstructions = options.customInstructions;
		let replaceInstructions = options.replaceInstructions;
		let label = options.label;
		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
			customInstructions,
			replaceInstructions,
			label,
		};

		const abortController = new AbortController();
		this.branchSummaryAbortController = abortController;

		try {
			let extensionSummary: { summary: string; details?: unknown } | undefined;
			let fromExtension = false;

			const beforeTreeRunner = this.getExtensionRunner();
			if (beforeTreeRunner.hasHandlers("session_before_tree")) {
				const result = (await beforeTreeRunner.emit({
					type: "session_before_tree",
					preparation,
					signal: abortController.signal,
				})) as SessionBeforeTreeResult | undefined;

				if (result?.cancel) return { cancelled: true };
				if (result?.summary && options.summarize) {
					extensionSummary = result.summary;
					fromExtension = true;
				}
				if (result?.customInstructions !== undefined) customInstructions = result.customInstructions;
				if (result?.replaceInstructions !== undefined) replaceInstructions = result.replaceInstructions;
				if (result?.label !== undefined) label = result.label;
			}

			let summaryText: string | undefined;
			let summaryDetails: unknown;
			if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
				if (!model) throw new Error("No model available for summarization");
				const { apiKey, headers } = await this.getRequiredRequestAuth(model);
				const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
				const result = await generateBranchSummary(entriesToSummarize, {
					model,
					apiKey,
					headers,
					signal: abortController.signal,
					customInstructions,
					replaceInstructions,
					reserveTokens: branchSummarySettings.reserveTokens,
				});
				if (result.aborted) return { cancelled: true, aborted: true };
				if (result.error) throw new Error(result.error);
				summaryText = result.summary;
				summaryDetails = {
					readFiles: result.readFiles || [],
					modifiedFiles: result.modifiedFiles || [],
				};
			} else if (extensionSummary) {
				summaryText = extensionSummary.summary;
				summaryDetails = extensionSummary.details;
			}

			let newLeafId: string | null;
			let editorText: string | undefined;
			if (targetEntry.type === "message" && targetEntry.message.role === "user") {
				newLeafId = targetEntry.parentId;
				editorText = this.extractUserMessageText(targetEntry.message.content);
			} else if (targetEntry.type === "custom_message") {
				newLeafId = targetEntry.parentId;
				editorText = this.extractUserMessageText(targetEntry.content);
			} else {
				newLeafId = targetId;
			}

			let summaryEntry: BranchSummaryEntry | undefined;
			if (summaryText) {
				const summaryId = this.sessionManager.branchWithSummary(
					newLeafId,
					summaryText,
					summaryDetails,
					fromExtension,
				);
				const savedSummary = this.sessionManager.getEntry(summaryId);
				if (savedSummary?.type !== "branch_summary") {
					throw new Error(`Branch summary ${summaryId} was not saved`);
				}
				summaryEntry = savedSummary;
				if (label) this.sessionManager.appendLabelChange(summaryId, label);
			} else if (newLeafId === null) {
				this.sessionManager.resetLeaf();
			} else {
				this.sessionManager.branch(newLeafId);
			}

			if (label && !summaryText) this.sessionManager.appendLabelChange(targetId, label);
			this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
			await this.getExtensionRunner().emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
			});

			return { editorText, cancelled: false, summaryEntry };
		} finally {
			if (this.branchSummaryAbortController === abortController) {
				this.branchSummaryAbortController = undefined;
			}
		}
	}

	getUserMessagesForForking(): ForkableUserMessage[] {
		const result: ForkableUserMessage[] = [];
		for (const entry of this.sessionManager.getEntries()) {
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			const text = this.extractUserMessageText(entry.message.content);
			if (text) result.push({ entryId: entry.id, text });
		}
		return result;
	}

	private extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		return content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("");
	}
}
