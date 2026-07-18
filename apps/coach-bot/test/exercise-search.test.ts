import { posix } from "node:path";
import { createSyntheticSourceInfo, type Skill } from "@fitclaw/runtime";
import { describe, expect, it } from "vitest";
import type { ExecOptions, ExecResult, Executor, ReadFileOptions } from "../src/sandbox.js";
import { createExerciseSearchTool } from "../src/tools/exercise-search.js";

class MemoryExecutor implements Executor {
	readonly files = new Map<string, Buffer>();
	readonly reads: Array<{ path: string; options?: ReadFileOptions }> = [];

	async exec(_command: string, _options?: ExecOptions): Promise<ExecResult> {
		throw new Error("shell execution is not expected");
	}

	async execFile(_executable: string, _args: readonly string[], _options?: ExecOptions): Promise<ExecResult> {
		throw new Error("process execution is not expected");
	}

	async resolvePath(path: string): Promise<string> {
		return path;
	}

	async readFile(path: string, options?: ReadFileOptions): Promise<Buffer> {
		this.reads.push({ path, options });
		const content = this.files.get(path);
		if (!content) throw new Error(`Missing test file: ${path}`);
		return content;
	}

	getWorkspacePath(): string {
		return "/workspace";
	}
}

const SKILL_ROOT = "/workspace/skills/bodybuilding";
const DATABASE_PATH = `${SKILL_ROOT}/free-exercise-db/dist/exercises.json`;

function createSkill(): Skill {
	return {
		name: "bodybuilding",
		description: "Bodybuilding coaching skill.",
		filePath: `${SKILL_ROOT}/SKILL.md`,
		baseDir: SKILL_ROOT,
		sourceInfo: createSyntheticSourceInfo(`${SKILL_ROOT}/SKILL.md`, { source: "test" }),
		disableModelInvocation: false,
		hasTools: false,
	};
}

function exercise(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "Incline_Dumbbell_Press",
		name: "Incline Dumbbell Press",
		force: "push",
		level: "intermediate",
		mechanic: "compound",
		equipment: "dumbbell",
		primaryMuscles: ["chest"],
		secondaryMuscles: ["triceps"],
		instructions: ["", "Press the dumbbells upward."],
		category: "strength",
		images: ["Incline_Dumbbell_Press/0.jpg", "../../private.jpg"],
		...overrides,
	};
}

function seed(executor: MemoryExecutor, records: readonly unknown[]): void {
	executor.files.set(DATABASE_PATH, Buffer.from(JSON.stringify(records), "utf-8"));
}

function textResult(result: Awaited<ReturnType<ReturnType<typeof createExerciseSearchTool>["execute"]>>): unknown {
	const content = result.content[0];
	if (content?.type !== "text") throw new Error("Expected text tool result");
	return JSON.parse(content.text) as unknown;
}

describe("exercise_search", () => {
	it("filters the catalog and only includes instructions when requested", async () => {
		const executor = new MemoryExecutor();
		seed(executor, [
			exercise(),
			exercise({ id: "Bodyweight_Squat", name: "Bodyweight Squat", equipment: "body only" }),
		]);
		const tool = createExerciseSearchTool(executor, createSkill());

		const summary = await tool.execute("summary", { muscle: "chest", equipment: "dumbbell" });
		const detailed = await tool.execute("detailed", {
			id: "incline_dumbbell_press",
			include_instructions: true,
		});

		expect(textResult(summary)).toEqual({
			results: [
				expect.objectContaining({
					id: "Incline_Dumbbell_Press",
					image_paths: [`${SKILL_ROOT}/free-exercise-db/exercises/Incline_Dumbbell_Press/0.jpg`],
				}),
			],
		});
		expect(JSON.stringify(textResult(summary))).not.toContain("instructions");
		expect(textResult(detailed)).toEqual({
			results: [expect.objectContaining({ instructions: ["Press the dumbbells upward."] })],
		});
		expect(executor.reads).toEqual([{ path: DATABASE_PATH, options: { maxBytes: 5 * 1024 * 1024 } }]);
	});

	it("applies the result limit and requires at least one filter", async () => {
		const executor = new MemoryExecutor();
		seed(
			executor,
			Array.from({ length: 3 }, (_, index) => exercise({ id: `press-${index}`, name: `Press ${index}` })),
		);
		const tool = createExerciseSearchTool(executor, createSkill());

		const result = await tool.execute("limited", { query: "press", limit: 2 });

		expect(result.details).toEqual({ resultCount: 2, exerciseIds: ["press-0", "press-1"] });
		await expect(tool.execute("empty", {})).rejects.toThrow("At least one exercise search filter is required");
		await expect(tool.execute("whitespace", { query: "   " })).rejects.toThrow(
			"Exercise search filters cannot contain only whitespace",
		);
	});

	it("fails explicitly for malformed external records and JSON", async () => {
		const malformedRecordExecutor = new MemoryExecutor();
		seed(malformedRecordExecutor, [exercise({ primaryMuscles: "chest" })]);
		const malformedRecordTool = createExerciseSearchTool(malformedRecordExecutor, createSkill());

		await expect(malformedRecordTool.execute("record", { query: "press" })).rejects.toThrow(
			"Exercise database record 0 is invalid",
		);

		const malformedJsonExecutor = new MemoryExecutor();
		malformedJsonExecutor.files.set(DATABASE_PATH, Buffer.from("{broken", "utf-8"));
		const malformedJsonTool = createExerciseSearchTool(malformedJsonExecutor, createSkill());

		await expect(malformedJsonTool.execute("json", { query: "press" })).rejects.toThrow(
			"Exercise database contains invalid JSON",
		);
	});

	it("normalizes POSIX paths without allowing image traversal", async () => {
		const executor = new MemoryExecutor();
		seed(executor, [exercise({ images: ["./Incline_Dumbbell_Press/0.jpg", "/etc/passwd"] })]);
		const tool = createExerciseSearchTool(executor, createSkill());

		const result = await tool.execute("paths", { id: "Incline_Dumbbell_Press" });
		const expectedPath = posix.join(SKILL_ROOT, "free-exercise-db", "exercises", "Incline_Dumbbell_Press", "0.jpg");

		expect(JSON.stringify(textResult(result))).toContain(expectedPath);
		expect(JSON.stringify(textResult(result))).not.toContain("/etc/passwd");
	});
});
