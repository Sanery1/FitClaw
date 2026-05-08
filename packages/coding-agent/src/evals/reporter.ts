import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentEvent } from "@fitclaw/agent-core";
import { formatRate, summarizeEvalResults } from "./metrics.js";
import type { EvalTrialResult } from "./types.js";

export function writeTranscript(path: string, events: AgentEvent[]): void {
	mkdirSync(dirname(path), { recursive: true });
	const lines = events.map((event) =>
		JSON.stringify({
			timestamp: new Date().toISOString(),
			event,
		}),
	);
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}

export function writeSummary(path: string, results: EvalTrialResult[]): void {
	mkdirSync(dirname(path), { recursive: true });
	const metrics = summarizeEvalResults(results);
	const lines = [
		"# FitClaw Eval Summary",
		"",
		"## Metrics",
		"",
		`- pass@1: ${formatRate(metrics.passAt1)}`,
		`- pass@${metrics.runsPerTask}: ${formatRate(metrics.passAtK)}`,
		`- pass^${metrics.runsPerTask}: ${formatRate(metrics.passAllK)}`,
		`- trial pass rate: ${formatRate(metrics.trialPassRate)}`,
		`- grader pass rate: ${formatRate(metrics.graderPassRate)}`,
		`- average tool calls: ${metrics.averageToolCalls.toFixed(2)}`,
		`- average turns: ${metrics.averageTurns.toFixed(2)}`,
		`- average duration: ${metrics.averageDurationMs.toFixed(1)}ms`,
		"",
		"## Trials",
		"",
		"| Task | Suite | Trial | Passed | Tool Calls | Turns | Transcript |",
		"| --- | --- | ---: | --- | ---: | ---: | --- |",
		...results.map((result) =>
			[
				`| ${result.taskId}`,
				result.suite,
				String(result.trialIndex),
				result.passed ? "yes" : "no",
				String(result.metrics.toolCallCount),
				String(result.metrics.turnCount),
				`${result.transcriptPath} |`,
			].join(" | "),
		),
		"",
	];
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}
