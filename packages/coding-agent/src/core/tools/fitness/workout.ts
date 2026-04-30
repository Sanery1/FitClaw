import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { WorkoutRecord } from "../../fitness/schemas.js";
import { getWorkouts, loadFitnessData, persist } from "./store.js";

const DEFAULT = "";

const logWorkoutSchema = Type.Object({
	date: Type.Optional(Type.String({ description: "Workout date in YYYY-MM-DD format (default: today)" })),
	exercises: Type.Array(
		Type.Object({
			exerciseId: Type.String({ description: "Exercise ID from exercise database" }),
			exerciseName: Type.String({ description: "Exercise name for display" }),
			sets: Type.Array(
				Type.Object({
					reps: Type.Number({ description: "Reps performed" }),
					weight: Type.Number({ description: "Weight in kg" }),
					rpe: Type.Optional(Type.Number({ description: "Rate of Perceived Exertion (1-10)" })),
				}),
			),
		}),
	),
	duration: Type.Optional(Type.Number({ description: "Total workout duration in minutes" })),
	notes: Type.Optional(Type.String({ description: "Additional notes about the workout" })),
});

const getWorkoutHistorySchema = Type.Object({
	limit: Type.Optional(Type.Number({ description: "Max entries to return (default 20)" })),
	fromDate: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
	toDate: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
});

async function ensureLoaded(dataDir: string): Promise<void> {
	if (dataDir) await loadFitnessData(dataDir);
}
async function maybeSave(dataDir: string): Promise<void> {
	if (dataDir) await persist(dataDir);
}

export function createLogWorkoutTool(dataDir: string = DEFAULT): AgentTool<typeof logWorkoutSchema> {
	return {
		name: "log_workout",
		label: "Log Workout",
		description:
			"Record a completed workout session. Stores exercises performed, sets, reps, weights, duration, and notes. Call after user confirms a workout is complete.",
		parameters: logWorkoutSchema,
		async execute(_toolCallId, params) {
			await ensureLoaded(dataDir);
			const workouts = getWorkouts(dataDir);

			const record: WorkoutRecord = {
				date: params.date ?? new Date().toISOString().slice(0, 10),
				exercises: params.exercises.map((ex) => ({
					exerciseId: ex.exerciseId,
					exerciseName: ex.exerciseName,
					sets: ex.sets.map((s) => ({ reps: s.reps, weight: s.weight, rpe: s.rpe })),
				})),
				duration: params.duration,
				notes: params.notes,
			};

			workouts.push(record);
			await maybeSave(dataDir);

			const totalSets = record.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							status: "logged",
							date: record.date,
							exerciseCount: record.exercises.length,
							totalSets,
							duration: record.duration,
						}),
					},
				],
				details: record,
			};
		},
	};
}

export function createGetWorkoutHistoryTool(dataDir: string = DEFAULT): AgentTool<typeof getWorkoutHistorySchema> {
	return {
		name: "get_workout_history",
		label: "Get Workout History",
		description:
			"Retrieve past workout records. Use to review training consistency, track progress, or inform training plan adjustments.",
		parameters: getWorkoutHistorySchema,
		async execute(_toolCallId, params) {
			await ensureLoaded(dataDir);
			let results = [...getWorkouts(dataDir)];

			if (params.fromDate) {
				results = results.filter((w) => w.date >= params.fromDate!);
			}
			if (params.toDate) {
				results = results.filter((w) => w.date <= params.toDate!);
			}

			results.sort((a, b) => b.date.localeCompare(a.date));
			const limit = params.limit ?? 20;
			const sliced = results.slice(0, limit);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ count: sliced.length, workouts: sliced }, null, 2),
					},
				],
				details: { count: sliced.length },
			};
		},
	};
}
