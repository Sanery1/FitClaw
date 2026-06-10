import type { EvalRateMetric, EvalSummaryMetrics, EvalTrialResult } from "./types.js";

function divide(passed: number, total: number): EvalRateMetric {
	return {
		passed,
		total,
		rate: total === 0 ? 0 : passed / total,
	};
}

function uniqueTaskIds(results: EvalTrialResult[]): string[] {
	return Array.from(new Set(results.map((result) => result.taskId)));
}

function resultsForTask(results: EvalTrialResult[], taskId: string): EvalTrialResult[] {
	return results
		.filter((result) => result.taskId === taskId)
		.sort((left, right) => left.trialIndex - right.trialIndex);
}

function average(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((total, value) => total + value, 0) / values.length;
}

export function summarizeEvalResults(results: EvalTrialResult[]): EvalSummaryMetrics {
	const taskIds = uniqueTaskIds(results);
	const grouped = taskIds.map((taskId) => resultsForTask(results, taskId));
	const firstTrialPasses = grouped.filter((taskResults) => taskResults[0]?.passed === true).length;
	const anyTrialPasses = grouped.filter((taskResults) => taskResults.some((result) => result.passed)).length;
	const allTrialPasses = grouped.filter(
		(taskResults) => taskResults.length > 0 && taskResults.every((result) => result.passed),
	).length;
	const passedTrials = results.filter((result) => result.passed).length;
	const graderResults = results.flatMap((result) => result.graderResults);
	const passedGraders = graderResults.filter((result) => result.passed).length;

	return {
		totalTasks: taskIds.length,
		totalTrials: results.length,
		runsPerTask: Math.max(0, ...grouped.map((taskResults) => taskResults.length)),
		passAt1: divide(firstTrialPasses, taskIds.length),
		passAtK: divide(anyTrialPasses, taskIds.length),
		passAllK: divide(allTrialPasses, taskIds.length),
		trialPassRate: divide(passedTrials, results.length),
		graderPassRate: divide(passedGraders, graderResults.length),
		averageToolCalls: average(results.map((result) => result.metrics.toolCallCount)),
		averageTurns: average(results.map((result) => result.metrics.turnCount)),
		averageDurationMs: average(results.map((result) => result.metrics.durationMs)),
	};
}

export function formatRate(metric: EvalRateMetric): string {
	return `${(metric.rate * 100).toFixed(1)}% (${metric.passed}/${metric.total})`;
}
