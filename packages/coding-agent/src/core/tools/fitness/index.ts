export { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
export { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
export { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
export { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
export type { FitnessData } from "./store.js";
export { loadFitnessData, persist } from "./store.js";
export { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

import type { AgentTool } from "@fitclaw/agent-core";
import { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
import { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
import { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
import { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
import { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

export function createAllFitnessTools(dataDir?: string): AgentTool<any>[] {
	const dir = dataDir ?? "";

	return [
		createQueryExercisesTool(),
		createGetExerciseDetailTool(),
		createLogWorkoutTool(dir),
		createGetWorkoutHistoryTool(dir),
		createLogBodyMetricsTool(dir),
		createGetBodyMetricsHistoryTool(dir),
		createTrainingPlanTool(dir),
		createGetCurrentPlanTool(dir),
		createGetTodayWorkoutTool(dir),
		createGetProgressSummaryTool(dir),
		createLogProgressiveOverloadTool(dir),
	];
}
