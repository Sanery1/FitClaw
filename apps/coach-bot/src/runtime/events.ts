import { randomUUID } from "node:crypto";
import { COACH_PERSONALITY_POLICY_VERSION, type CoachPersonalityId } from "@fitclaw/coach-core";
import * as log from "../log.js";
import type { BotContext } from "../types.js";
import type { CoachSessionEvent } from "./session.js";

export interface CoachResponseQueue {
	enqueue(fn: () => Promise<void>, errorContext: string): void;
	enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog?: boolean): void;
}

export interface CoachUsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export interface CoachRunState {
	ctx: BotContext | null;
	logCtx: { channelId: string; userName?: string } | null;
	queue: CoachResponseQueue | null;
	pendingTools: Map<string, { toolName: string; startTime: number }>;
	toolTraces: Array<{
		toolName: string;
		status: "success" | "error";
		durationMs: number;
		collection?: string;
		resultCount?: number;
		pageIds: readonly string[];
		errorCode?: string;
	}>;
	skillFilesRead: Set<string>;
	traceId: string;
	startedAtMs: number;
	modelId: string;
	personalityId: CoachPersonalityId | "unknown";
	personalityPolicyVersion: string;
	errorCode?: string;
	totalUsage: CoachUsageTotals;
	stopReason: string;
	errorMessage?: string;
}

export function createEmptyUsageTotals(): CoachUsageTotals {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createCoachRunState(): CoachRunState {
	return {
		ctx: null,
		logCtx: null,
		queue: null,
		pendingTools: new Map(),
		toolTraces: [],
		skillFilesRead: new Set(),
		traceId: randomUUID(),
		startedAtMs: Date.now(),
		modelId: "unknown",
		personalityId: "unknown",
		personalityPolicyVersion: COACH_PERSONALITY_POLICY_VERSION,
		totalUsage: createEmptyUsageTotals(),
		stopReason: "stop",
		errorMessage: undefined,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeSkillFile(args: unknown): string | undefined {
	const path = asRecord(args)?.path;
	if (typeof path !== "string") return undefined;
	const match = path.replace(/\\/g, "/").match(/(?:^|\/)skills\/([^/]+)\/(.+)$/);
	return match ? `${match[1]}/${match[2]}` : undefined;
}

function safeToolDetails(result: unknown): {
	collection?: string;
	resultCount?: number;
	pageIds: readonly string[];
	errorCode?: string;
} {
	const details = asRecord(asRecord(result)?.details);
	return {
		collection: typeof details?.collection === "string" ? details.collection : undefined,
		resultCount: typeof details?.resultCount === "number" ? details.resultCount : undefined,
		pageIds: Array.isArray(details?.pageIds)
			? details.pageIds.filter((pageId): pageId is string => typeof pageId === "string")
			: [],
		errorCode: typeof details?.errorCode === "string" ? details.errorCode : undefined,
	};
}

export function createCoachSessionEventHandler(runState: CoachRunState): (event: CoachSessionEvent) => void {
	return (event) => {
		if (!runState.ctx || !runState.logCtx || !runState.queue) return;

		const { ctx, logCtx, queue, pendingTools } = runState;

		if (event.type === "tool_execution_start") {
			pendingTools.set(event.toolCallId, {
				toolName: event.toolName,
				startTime: Date.now(),
			});
			const skillFile = event.toolName === "read" ? safeSkillFile(event.args) : undefined;
			if (skillFile) runState.skillFilesRead.add(skillFile);
			log.logToolStart(logCtx, event.toolName, event.toolName, {});
			queue.enqueue(() => ctx.respond(`_→ ${event.toolName}_`, false), "tool status");
			return;
		}

		if (event.type === "tool_execution_end") {
			const pending = pendingTools.get(event.toolCallId);
			pendingTools.delete(event.toolCallId);
			const durationMs = pending ? Date.now() - pending.startTime : 0;
			const details = safeToolDetails(event.result);
			const isDegraded = details.errorCode === "render_unavailable";
			const isError = event.isError || (details.errorCode !== undefined && !isDegraded);
			runState.toolTraces.push({
				toolName: event.toolName,
				status: isError ? "error" : "success",
				durationMs,
				collection: details.collection,
				resultCount: details.resultCount,
				pageIds: details.pageIds,
				errorCode: details.errorCode,
			});
			if (details.errorCode && !isDegraded && !runState.errorCode) runState.errorCode = details.errorCode;

			if (isError) {
				log.logToolError(logCtx, event.toolName, durationMs, details.errorCode ?? "tool_error");
			} else {
				log.logToolSuccess(logCtx, event.toolName, durationMs, "");
			}

			const threadMessage = `*${isError ? "✗" : "✓"} ${event.toolName}* (${(durationMs / 1000).toFixed(1)}s)`;
			queue.enqueueMessage(threadMessage, "thread", "tool result thread", false);

			if (isError) {
				queue.enqueue(() => ctx.respond(`_Error: ${event.toolName} failed_`, false), "tool error");
			}
			return;
		}

		if (event.type === "message_start" && event.message.role === "assistant") {
			log.logResponseStart(logCtx);
			return;
		}

		if (event.type === "message_end" && event.message.role === "assistant") {
			const assistantMessage = event.message;
			runState.stopReason = assistantMessage.stopReason;
			runState.errorMessage = assistantMessage.errorMessage;
			runState.totalUsage.input += assistantMessage.usage.input;
			runState.totalUsage.output += assistantMessage.usage.output;
			runState.totalUsage.cacheRead += assistantMessage.usage.cacheRead;
			runState.totalUsage.cacheWrite += assistantMessage.usage.cacheWrite;
			runState.totalUsage.cost.input += assistantMessage.usage.cost.input;
			runState.totalUsage.cost.output += assistantMessage.usage.cost.output;
			runState.totalUsage.cost.cacheRead += assistantMessage.usage.cost.cacheRead;
			runState.totalUsage.cost.cacheWrite += assistantMessage.usage.cost.cacheWrite;
			runState.totalUsage.cost.total += assistantMessage.usage.cost.total;

			const textParts: string[] = [];
			for (const part of assistantMessage.content) {
				if (part.type === "thinking") {
					log.logThinking(logCtx, part.thinking);
					queue.enqueueMessage(`_${part.thinking}_`, "thread", "thinking thread", false);
				} else if (part.type === "text") {
					textParts.push(part.text);
				}
			}

			const text = textParts.join("\n");
			if (text.trim()) {
				log.logResponse(logCtx, text);
				queue.enqueueMessage(text, "main", "response main");
				queue.enqueueMessage(text, "thread", "response thread", false);
			}
			return;
		}

		if (event.type === "compaction_start") {
			log.logInfo(`Compaction started (reason: ${event.reason})`);
			queue.enqueue(() => ctx.respond("_Compacting context..._", false), "compaction start");
			return;
		}

		if (event.type === "compaction_end") {
			if (event.result) {
				log.logInfo(`Compaction complete: ${event.result.tokensBefore} tokens compacted`);
			} else if (event.aborted) {
				log.logInfo("Compaction aborted");
			}
			return;
		}

		if (event.type === "auto_retry_start") {
			log.logWarning(`Retrying (${event.attempt}/${event.maxAttempts})`, event.errorMessage);
			queue.enqueue(() => ctx.respond(`_Retrying (${event.attempt}/${event.maxAttempts})..._`, false), "retry");
		}
	};
}
