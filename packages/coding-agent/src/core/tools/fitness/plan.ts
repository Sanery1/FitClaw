import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { PlanExercise, TrainingPlan } from "../../fitness/schemas.js";
import { getPlan, loadFitnessData, persist, setPlan } from "./store.js";

const DEFAULT = "";

export function getCurrentPlanState(dataDir: string = DEFAULT): TrainingPlan | null {
	return getPlan(dataDir);
}

const planExerciseSchema = Type.Object({
	exerciseId: Type.String(),
	exerciseName: Type.String(),
	sets: Type.Number(),
	repsRange: Type.String({ description: "e.g. '8-12', '5-8', '12-15'" }),
	restSeconds: Type.Number({ description: "Rest between sets in seconds" }),
	notes: Type.Optional(Type.String()),
	progressionType: Type.Optional(Type.String({ description: "'double_progression', 'linear', or 'wave'" })),
});

const createTrainingPlanSchema = Type.Object({
	goal: Type.String({
		description: "Training goal: 'muscle_gain', 'fat_loss', 'strength', 'endurance', 'general_fitness'",
	}),
	experienceLevel: Type.String({ description: "'beginner', 'intermediate', or 'advanced'" }),
	splitType: Type.String({ description: "'ppl', 'full_body', 'upper_lower', 'bro_split', or 'custom'" }),
	daysPerWeek: Type.Number({ description: "Training days per week (1-7)" }),
	availableEquipment: Type.Array(Type.String(), {
		description: "Available equipment: e.g. ['dumbbell', 'barbell', 'bench', 'cable', 'pull_up_bar']",
	}),
	injuriesOrLimitations: Type.Optional(
		Type.String({ description: "Any injuries or physical limitations to work around" }),
	),
	weeks: Type.Array(
		Type.Object({
			weekNumber: Type.Number(),
			days: Type.Array(
				Type.Object({
					dayOfWeek: Type.Number({ description: "1=Mon, 7=Sun" }),
					focus: Type.String({ description: "Focus of the day, e.g. 'Push (Chest/Shoulders/Triceps)'" }),
					exercises: Type.Array(planExerciseSchema),
					notes: Type.Optional(Type.String()),
				}),
			),
		}),
	),
});

const getCurrentPlanSchema = Type.Object({});

const getTodayWorkoutSchema = Type.Object({
	dayOfWeek: Type.Optional(Type.Number({ description: "Day of week (1=Mon, 7=Sun). Default: today's day" })),
});

async function ensureLoaded(dataDir: string): Promise<void> {
	if (dataDir) await loadFitnessData(dataDir);
}

async function maybeSave(dataDir: string): Promise<void> {
	if (dataDir) await persist(dataDir);
}

export function createTrainingPlanTool(dataDir: string = DEFAULT): AgentTool<typeof createTrainingPlanSchema> {
	return {
		name: "create_training_plan",
		label: "Create Training Plan",
		description:
			"Create or overwrite the user's training plan. The plan defines weekly schedule, exercises, sets/reps, and progression strategy. Use after collecting user preferences and consulting the exercise database.",
		parameters: createTrainingPlanSchema,
		async execute(_toolCallId, params) {
			await ensureLoaded(dataDir);
			const existing = getPlan(dataDir);
			const now = new Date().toISOString();

			const plan: TrainingPlan = {
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				goal: params.goal,
				experienceLevel: params.experienceLevel as "beginner" | "intermediate" | "advanced",
				splitType: params.splitType as "ppl" | "full_body" | "upper_lower" | "bro_split" | "custom",
				daysPerWeek: params.daysPerWeek,
				availableEquipment: params.availableEquipment,
				injuriesOrLimitations: params.injuriesOrLimitations,
				weeks: params.weeks.map((w) => ({
					weekNumber: w.weekNumber,
					days: w.days.map((d) => ({
						dayOfWeek: d.dayOfWeek,
						focus: d.focus,
						exercises: d.exercises.map((e) => ({
							exerciseId: e.exerciseId,
							exerciseName: e.exerciseName,
							sets: e.sets,
							repsRange: e.repsRange,
							restSeconds: e.restSeconds,
							notes: e.notes,
							progressionType: e.progressionType as PlanExercise["progressionType"],
						})),
						notes: d.notes,
					})),
				})),
			};

			setPlan(dataDir, plan);
			await maybeSave(dataDir);

			const totalExercises = params.weeks.reduce(
				(sum, w) => sum + w.days.reduce((dSum, d) => dSum + d.exercises.length, 0),
				0,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							status: "created",
							splitType: params.splitType,
							daysPerWeek: params.daysPerWeek,
							weekCount: params.weeks.length,
							totalExercises,
						}),
					},
				],
				details: plan,
			};
		},
	};
}

export function createGetCurrentPlanTool(dataDir: string = DEFAULT): AgentTool<typeof getCurrentPlanSchema> {
	return {
		name: "get_current_plan",
		label: "Get Current Plan",
		description:
			"Get the active training plan. Use when the user asks about their current plan or before making adjustments.",
		parameters: getCurrentPlanSchema,
		async execute() {
			await ensureLoaded(dataDir);
			const plan = getPlan(dataDir);

			if (!plan) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ status: "no_plan", message: "No active training plan" }),
						},
					],
					details: null,
				};
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
				details: { planExists: true },
			};
		},
	};
}

export function createGetTodayWorkoutTool(dataDir: string = DEFAULT): AgentTool<typeof getTodayWorkoutSchema> {
	return {
		name: "get_today_workout",
		label: "Get Today's Workout",
		description:
			"Get the planned workout for today (or specified day). Returns exercises, sets, reps, and notes for that day.",
		parameters: getTodayWorkoutSchema,
		async execute(_toolCallId, params) {
			await ensureLoaded(dataDir);
			const plan = getPlan(dataDir);
			const day = (params.dayOfWeek ?? new Date().getDay()) || 7;

			if (!plan) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								status: "no_plan",
								message: "No active training plan. Use create_training_plan first.",
							}),
						},
					],
					details: null,
				};
			}

			const allDays = plan.weeks.flatMap((w) => w.days);
			const todayExercise = allDays.find((d) => d.dayOfWeek === day);

			if (!todayExercise) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								status: "rest_day",
								dayOfWeek: day,
								message: "No workout scheduled for this day",
							}),
						},
					],
					details: null,
				};
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(todayExercise, null, 2) }],
				details: { dayOfWeek: day, focus: todayExercise.focus },
			};
		},
	};
}
