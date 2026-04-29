export { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
export { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
export { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
export { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
export { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

import type { AgentTool } from "@fitclaw/agent-core";
import { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
import { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
import { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
import { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
import { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

export function createAllFitnessTools(): AgentTool<any>[] {
	return [
		createQueryExercisesTool(),
		createGetExerciseDetailTool(),
		createLogWorkoutTool(),
		createGetWorkoutHistoryTool(),
		createLogBodyMetricsTool(),
		createGetBodyMetricsHistoryTool(),
		createTrainingPlanTool(),
		createGetCurrentPlanTool(),
		createGetTodayWorkoutTool(),
		createGetProgressSummaryTool(),
		createLogProgressiveOverloadTool(),
	];
}
