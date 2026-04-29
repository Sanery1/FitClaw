import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { Exercise } from "../../fitness/schemas.js";

let exerciseCache: Exercise[] | null = null;

async function loadExercises(): Promise<Exercise[]> {
	if (exerciseCache) return exerciseCache;
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const dataPath = path.resolve(__dirname, "../../../../data/exercises.json");
	const raw = await fs.readFile(dataPath, "utf-8");
	exerciseCache = JSON.parse(raw) as Exercise[];
	return exerciseCache;
}

const queryExercisesSchema = Type.Object({
	muscle: Type.Optional(Type.String({ description: "Target muscle group, e.g. 'chest', 'lats', 'quadriceps'" })),
	equipment: Type.Optional(
		Type.String({ description: "Equipment filter, e.g. 'dumbbell', 'barbell', 'bodyweight', 'cable'" }),
	),
	difficulty: Type.Optional(Type.String({ description: "Difficulty: 'beginner', 'intermediate', or 'advanced'" })),
	category: Type.Optional(Type.String({ description: "Movement type: 'compound' or 'isolation'" })),
	search: Type.Optional(Type.String({ description: "Free-text search on exercise name (English or Chinese)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
});

const getExerciseDetailSchema = Type.Object({
	exerciseId: Type.String({ description: "The exercise ID (e.g. 'ex_001')" }),
});

export function createQueryExercisesTool(): AgentTool<typeof queryExercisesSchema> {
	return {
		name: "query_exercises",
		label: "Query Exercises",
		description:
			"Search the exercise database by muscle group, equipment, difficulty, or keyword. Returns matching exercises with basic info (id, name, primary muscle, equipment). Use before creating a training plan.",
		parameters: queryExercisesSchema,
		async execute(_toolCallId, params) {
			const exercises = await loadExercises();
			let results = [...exercises];

			if (params.muscle) {
				const m = params.muscle.toLowerCase();
				results = results.filter(
					(e) =>
						e.primaryMuscle.toLowerCase().includes(m) ||
						e.secondaryMuscles.some((s) => s.toLowerCase().includes(m)),
				);
			}
			if (params.equipment) {
				const eq = params.equipment.toLowerCase();
				results = results.filter((e) => e.equipment.some((item) => item.toLowerCase().includes(eq)));
			}
			if (params.difficulty) {
				results = results.filter((e) => e.difficulty === params.difficulty);
			}
			if (params.category) {
				results = results.filter((e) => e.category === params.category);
			}
			if (params.search) {
				const s = params.search.toLowerCase();
				results = results.filter(
					(e) =>
						e.name.toLowerCase().includes(s) ||
						e.nameZh?.includes(s) ||
						e.primaryMuscle.toLowerCase().includes(s),
				);
			}

			const limit = params.limit ?? 20;
			const sliced = results.slice(0, limit);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								count: sliced.length,
								total: results.length,
								exercises: sliced.map((e) => ({
									id: e.id,
									name: e.name,
									nameZh: e.nameZh,
									primaryMuscle: e.primaryMuscle,
									equipment: e.equipment,
									difficulty: e.difficulty,
									category: e.category,
								})),
							},
							null,
							2,
						),
					},
				],
				details: { count: sliced.length },
			};
		},
	};
}

export function createGetExerciseDetailTool(): AgentTool<typeof getExerciseDetailSchema> {
	return {
		name: "get_exercise_detail",
		label: "Get Exercise Detail",
		description:
			"Get full details for a specific exercise including instructions, tips, cautions, and variations. Use when you need to teach the user proper form.",
		parameters: getExerciseDetailSchema,
		async execute(_toolCallId, params) {
			const exercises = await loadExercises();
			const exercise = exercises.find((e) => e.id === params.exerciseId);

			if (!exercise) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ error: `Exercise '${params.exerciseId}' not found` }),
						},
					],
					details: null,
				};
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(exercise, null, 2) }],
				details: { exerciseId: exercise.id },
			};
		},
	};
}
