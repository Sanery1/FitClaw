import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoachPersonalityId } from "@fitclaw/coach-core";
import type { CoachRunState } from "./events.js";

export interface RunTraceV1 {
	trace_id: string;
	started_at: string;
	duration_ms: number;
	status: "success" | "error" | "aborted";
	model_id: string;
	personality_id: CoachPersonalityId | "unknown";
	personality_policy_version: string;
	skill_files_read: readonly string[];
	tools: readonly {
		tool_name: string;
		tool_status: "success" | "error";
		tool_duration_ms: number;
		collection?: string;
		result_count?: number;
		page_ids?: readonly string[];
		error_code?: string;
	}[];
	token_usage: {
		input: number;
		output: number;
		cache_read: number;
		cache_write: number;
	};
	cost: number;
	error_code?: string;
}

function traceStatus(runState: CoachRunState): RunTraceV1["status"] {
	if (runState.stopReason === "aborted") return "aborted";
	if (runState.stopReason === "error" || runState.errorCode) return "error";
	return "success";
}

export function buildRunTrace(runState: CoachRunState, completedAt = Date.now()): RunTraceV1 {
	return {
		trace_id: runState.traceId,
		started_at: new Date(runState.startedAtMs).toISOString(),
		duration_ms: Math.max(0, completedAt - runState.startedAtMs),
		status: traceStatus(runState),
		model_id: runState.modelId,
		personality_id: runState.personalityId,
		personality_policy_version: runState.personalityPolicyVersion,
		skill_files_read: Array.from(runState.skillFilesRead).sort(),
		tools: runState.toolTraces.map((tool) => ({
			tool_name: tool.toolName,
			tool_status: tool.status,
			tool_duration_ms: tool.durationMs,
			...(tool.collection ? { collection: tool.collection } : {}),
			...(tool.resultCount !== undefined ? { result_count: tool.resultCount } : {}),
			...(tool.pageIds.length > 0 ? { page_ids: [...tool.pageIds] } : {}),
			...(tool.errorCode ? { error_code: tool.errorCode } : {}),
		})),
		token_usage: {
			input: runState.totalUsage.input,
			output: runState.totalUsage.output,
			cache_read: runState.totalUsage.cacheRead,
			cache_write: runState.totalUsage.cacheWrite,
		},
		cost: runState.totalUsage.cost.total,
		...(runState.errorCode ? { error_code: runState.errorCode } : {}),
	};
}

export async function appendRunTrace(workspacePath: string, runState: CoachRunState): Promise<void> {
	const trace = buildRunTrace(runState);
	const tracesDir = join(workspacePath, "traces");
	await mkdir(tracesDir, { recursive: true });
	const date = trace.started_at.slice(0, 10);
	await appendFile(join(tracesDir, `${date}.jsonl`), `${JSON.stringify(trace)}\n`, { encoding: "utf-8", mode: 0o600 });
}
