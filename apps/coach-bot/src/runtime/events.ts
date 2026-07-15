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
	pendingTools: Map<string, { toolName: string; args: unknown; startTime: number }>;
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
		totalUsage: createEmptyUsageTotals(),
		stopReason: "stop",
		errorMessage: undefined,
	};
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.substring(0, maxLen - 3)}...`;
}

function extractToolResultText(result: unknown): string {
	if (typeof result === "string") return result;

	if (
		result &&
		typeof result === "object" &&
		"content" in result &&
		Array.isArray((result as { content: unknown }).content)
	) {
		const content = (result as { content: Array<{ type: string; text?: string }> }).content;
		const textParts = content.filter((part) => part.type === "text" && part.text).map((part) => part.text as string);
		if (textParts.length > 0) return textParts.join("\n");
	}

	return JSON.stringify(result);
}

function formatToolArgs(args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			lines.push(offset !== undefined && limit !== undefined ? `${value}:${offset}-${offset + limit}` : value);
			continue;
		}

		if (key === "offset" || key === "limit") continue;
		lines.push(typeof value === "string" ? value : JSON.stringify(value));
	}

	return lines.join("\n");
}

export function createCoachSessionEventHandler(runState: CoachRunState): (event: CoachSessionEvent) => void {
	return (event) => {
		if (!runState.ctx || !runState.logCtx || !runState.queue) return;

		const { ctx, logCtx, queue, pendingTools } = runState;

		if (event.type === "tool_execution_start") {
			const args = event.args as { label?: string };
			const label = args.label || event.toolName;
			pendingTools.set(event.toolCallId, {
				toolName: event.toolName,
				args: event.args,
				startTime: Date.now(),
			});
			log.logToolStart(logCtx, event.toolName, label, event.args as Record<string, unknown>);
			queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
			return;
		}

		if (event.type === "tool_execution_end") {
			const resultText = extractToolResultText(event.result);
			const pending = pendingTools.get(event.toolCallId);
			pendingTools.delete(event.toolCallId);
			const durationMs = pending ? Date.now() - pending.startTime : 0;

			if (event.isError) {
				log.logToolError(logCtx, event.toolName, durationMs, resultText);
			} else {
				log.logToolSuccess(logCtx, event.toolName, durationMs, resultText);
			}

			const pendingArgs = pending?.args as Record<string, unknown> | undefined;
			const label = pendingArgs && typeof pendingArgs.label === "string" ? pendingArgs.label : undefined;
			const argsFormatted = pendingArgs ? formatToolArgs(pendingArgs) : "(args not found)";
			let threadMessage = `*${event.isError ? "✗" : "✓"} ${event.toolName}*`;
			if (label) threadMessage += `: ${label}`;
			threadMessage += ` (${(durationMs / 1000).toFixed(1)}s)\n`;
			if (argsFormatted) threadMessage += `\`\`\`\n${argsFormatted}\n\`\`\`\n`;
			threadMessage += `*Result:*\n\`\`\`\n${resultText}\n\`\`\``;
			queue.enqueueMessage(threadMessage, "thread", "tool result thread", false);

			if (event.isError) {
				queue.enqueue(() => ctx.respond(`_Error: ${truncate(resultText, 200)}_`, false), "tool error");
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
