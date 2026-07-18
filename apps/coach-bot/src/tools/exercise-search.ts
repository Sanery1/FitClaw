import { posix, relative, resolve, win32 } from "node:path";
import type { AgentTool } from "@fitclaw/agent-core";
import type { Skill } from "@fitclaw/runtime";
import { Type } from "typebox";
import type { Executor } from "../sandbox.js";

const MAX_DATABASE_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const exerciseSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: "Exercise name or ID text" })),
	id: Type.Optional(Type.String({ minLength: 1, maxLength: 150, description: "Exact exercise ID" })),
	muscle: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
	equipment: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
	level: Type.Optional(Type.Union([Type.Literal("beginner"), Type.Literal("intermediate"), Type.Literal("expert")])),
	force: Type.Optional(Type.Union([Type.Literal("push"), Type.Literal("pull"), Type.Literal("static")])),
	mechanic: Type.Optional(Type.Union([Type.Literal("compound"), Type.Literal("isolation")])),
	category: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
	include_instructions: Type.Optional(Type.Boolean({ default: false })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })),
});

interface ExerciseRecord {
	id: string;
	name: string;
	force: string | null;
	level: string | null;
	mechanic: string | null;
	equipment: string | null;
	primaryMuscles: readonly string[];
	secondaryMuscles: readonly string[];
	instructions: readonly string[];
	category: string | null;
	images: readonly string[];
}

interface ExerciseSearchDetails {
	resultCount: number;
	exerciseIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.trim() === "") throw new Error("expected a non-empty string or null");
	return value;
}

function stringArray(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new Error("expected an array of strings");
	}
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function parseExercise(value: unknown, index: number): ExerciseRecord {
	try {
		if (!isRecord(value)) throw new Error("expected an object");
		if (typeof value.id !== "string" || value.id.trim() === "") throw new Error("id must be a non-empty string");
		if (typeof value.name !== "string" || value.name.trim() === "") {
			throw new Error("name must be a non-empty string");
		}
		return {
			id: value.id,
			name: value.name,
			force: stringOrNull(value.force),
			level: stringOrNull(value.level),
			mechanic: stringOrNull(value.mechanic),
			equipment: stringOrNull(value.equipment),
			primaryMuscles: stringArray(value.primaryMuscles),
			secondaryMuscles: stringArray(value.secondaryMuscles),
			instructions: stringArray(value.instructions),
			category: stringOrNull(value.category),
			images: stringArray(value.images),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Exercise database record ${index} is invalid: ${message}`);
	}
}

function resolveSkillPath(baseDir: string, ...parts: string[]): string {
	if (baseDir.startsWith("/")) return posix.resolve(baseDir, ...parts.map((part) => part.replace(/\\/g, "/")));
	if (win32.isAbsolute(baseDir)) return win32.resolve(baseDir, ...parts);
	return resolve(baseDir, ...parts);
}

function safeImagePaths(baseDir: string, images: readonly string[]): readonly string[] {
	const imagesRoot = resolveSkillPath(baseDir, "free-exercise-db", "exercises");
	return images.flatMap((image) => {
		const path = resolveSkillPath(imagesRoot, image);
		const relativePath = baseDir.startsWith("/") ? posix.relative(imagesRoot, path) : relative(imagesRoot, path);
		return relativePath.startsWith("..") || relativePath === "" ? [] : [path];
	});
}

function includesIgnoreCase(value: string | null, expected: string | undefined): boolean {
	return expected === undefined || value?.toLowerCase() === expected.trim().toLowerCase();
}

function muscleMatches(exercise: ExerciseRecord, muscle: string | undefined): boolean {
	if (muscle === undefined) return true;
	const expected = muscle.trim().toLowerCase();
	return [...exercise.primaryMuscles, ...exercise.secondaryMuscles].some((entry) => entry.toLowerCase() === expected);
}

export function createExerciseSearchTool(
	executor: Executor,
	skill: Skill,
): AgentTool<typeof exerciseSearchSchema, ExerciseSearchDetails> {
	const databasePath = resolveSkillPath(skill.baseDir, "free-exercise-db", "dist", "exercises.json");
	let exercisesPromise: Promise<readonly ExerciseRecord[]> | undefined;

	const loadExercises = async (): Promise<readonly ExerciseRecord[]> => {
		const content = await executor.readFile(databasePath, { maxBytes: MAX_DATABASE_BYTES });
		let parsed: unknown;
		try {
			parsed = JSON.parse(content.toString("utf-8"));
		} catch {
			throw new Error("Exercise database contains invalid JSON");
		}
		if (!Array.isArray(parsed)) throw new Error("Exercise database must contain an array");
		return parsed.map(parseExercise);
	};

	return {
		name: "exercise_search",
		label: "Search Exercises",
		description:
			"Search the existing bodybuilding exercise catalog by ID, name, muscle, equipment, level, force, mechanic, or category. Returns verified image paths and optionally instructions.",
		parameters: exerciseSearchSchema,
		async execute(_toolCallId, params) {
			const textFilters = [params.query, params.id, params.muscle, params.equipment, params.category];
			if (textFilters.some((value) => value !== undefined && value.trim() === "")) {
				throw new Error("Exercise search filters cannot contain only whitespace");
			}
			const hasFilter = [
				params.query,
				params.id,
				params.muscle,
				params.equipment,
				params.level,
				params.force,
				params.mechanic,
				params.category,
			].some((value) => value !== undefined);
			if (!hasFilter) throw new Error("At least one exercise search filter is required");
			const limit = params.limit ?? DEFAULT_LIMIT;
			if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
				throw new Error(`limit must be between 1 and ${MAX_LIMIT}`);
			}

			exercisesPromise ??= loadExercises();
			const exercises = await exercisesPromise;
			const query = params.query?.trim().toLowerCase();
			const id = params.id?.trim().toLowerCase();
			const results = exercises
				.filter((exercise) => id === undefined || exercise.id.toLowerCase() === id)
				.filter(
					(exercise) =>
						query === undefined ||
						exercise.id.toLowerCase().includes(query) ||
						exercise.name.toLowerCase().includes(query),
				)
				.filter((exercise) => muscleMatches(exercise, params.muscle))
				.filter((exercise) => includesIgnoreCase(exercise.equipment, params.equipment))
				.filter((exercise) => includesIgnoreCase(exercise.level, params.level))
				.filter((exercise) => includesIgnoreCase(exercise.force, params.force))
				.filter((exercise) => includesIgnoreCase(exercise.mechanic, params.mechanic))
				.filter((exercise) => includesIgnoreCase(exercise.category, params.category))
				.slice(0, limit);
			const serialized = results.map((exercise) => ({
				id: exercise.id,
				name: exercise.name,
				force: exercise.force,
				level: exercise.level,
				mechanic: exercise.mechanic,
				equipment: exercise.equipment,
				primary_muscles: exercise.primaryMuscles,
				secondary_muscles: exercise.secondaryMuscles,
				category: exercise.category,
				image_paths: safeImagePaths(skill.baseDir, exercise.images),
				...(params.include_instructions ? { instructions: exercise.instructions } : {}),
			}));
			return {
				content: [{ type: "text" as const, text: JSON.stringify({ results: serialized }) }],
				details: { resultCount: results.length, exerciseIds: results.map((exercise) => exercise.id) },
			};
		},
	};
}
