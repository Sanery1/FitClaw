import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentEvent } from "@fitclaw/agent-core";
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
	const passed = results.filter((result) => result.passed).length;
	const lines = [
		"# FitClaw Eval Summary",
		"",
		`Passed: ${passed}/${results.length}`,
		"",
		"| Task | Suite | Passed | Tool Calls | Transcript |",
		"| --- | --- | --- | ---: | --- |",
		...results.map((result) =>
			[
				`| ${result.taskId}`,
				result.suite,
				result.passed ? "yes" : "no",
				String(result.metrics.toolCallCount),
				`${result.transcriptPath} |`,
			].join(" | "),
		),
		"",
	];
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}
