export { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
export { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
export { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
export { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
export type { SportDataStore } from "./sport-data-store.js";
export { FileSportDataStore } from "./sport-data-store.js";
export type { FitnessData } from "./store.js";
export { createFitnessStore, emptyFitnessData, loadFitnessData, persist } from "./store.js";
export { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

import type { AgentTool } from "@fitclaw/agent-core";
import { createGetBodyMetricsHistoryTool, createLogBodyMetricsTool } from "./body.js";
import { createGetExerciseDetailTool, createQueryExercisesTool } from "./exercises.js";
import { createGetCurrentPlanTool, createGetTodayWorkoutTool, createTrainingPlanTool } from "./plan.js";
import { createGetProgressSummaryTool, createLogProgressiveOverloadTool } from "./progress.js";
import type { SportDataStore } from "./sport-data-store.js";
import { createFitnessStore } from "./store.js";
import { createGetWorkoutHistoryTool, createLogWorkoutTool } from "./workout.js";

/** Create all fitness tools with a SportDataStore. */
export function createFitnessTools(store?: SportDataStore): AgentTool<any>[] {
	return [
		createQueryExercisesTool(),
		createGetExerciseDetailTool(),
		createLogWorkoutTool(store),
		createGetWorkoutHistoryTool(store),
		createLogBodyMetricsTool(store),
		createGetBodyMetricsHistoryTool(store),
		createTrainingPlanTool(store),
		createGetCurrentPlanTool(store),
		createGetTodayWorkoutTool(store),
		createGetProgressSummaryTool(store),
		createLogProgressiveOverloadTool(store),
	];
}

/**
 * Backward-compatible factory.
 * When dataDir is provided, fitness data is persisted to {dataDir}/sport-data/fitness.json.
 * When empty/omitted, tools operate in-memory only.
 */
export function createAllFitnessTools(dataDir?: string): AgentTool<any>[] {
	const store = dataDir ? createFitnessStore(dataDir) : undefined;
	return createFitnessTools(store);
}
