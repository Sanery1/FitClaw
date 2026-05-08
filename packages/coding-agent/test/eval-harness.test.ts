import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEvalTask } from "../src/evals/task-schema.js";
import { runEvalTask } from "../src/evals/trial-runner.js";

describe("eval harness", () => {
	let tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	function createTempDir(): string {
		const dir = join(tmpdir(), `fitclaw-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		tempDirs = [...tempDirs, dir];
		return dir;
	}

	it("loads a task, runs a faux transcript, and grades deterministic checks", async () => {
		const dir = createTempDir();
		const taskPath = join(dir, "task.yaml");
		writeFileSync(
			taskPath,
			[
				"id: sample-task",
				"suite: smoke",
				"prompt: Record a bench press workout.",
				"fauxResponses:",
				"  - toolCalls:",
				"      - name: data_bodybuilding_write",
				"        args:",
				"          namespace: training_log",
				"          data:",
				"            exercise: bench press",
				"            weightKg: 60",
				"          mode: append",
				"  - text: Logged bench press.",
				"graders:",
				"  - type: final_contains",
				"    text: bench press",
				"  - type: tool_called",
				"    tool: data_bodybuilding_write",
				"  - type: json_path_equals",
				"    file: sport-data/bodybuilding/training_log.json",
				"    path: $[0].weightKg",
				"    equals: 60",
			].join("\n"),
			"utf-8",
		);

		const task = loadEvalTask(taskPath);
		const result = await runEvalTask(task, { outputDir: join(dir, "out") });

		expect(result.taskId).toBe("sample-task");
		expect(result.passed).toBe(true);
		expect(result.finalAnswer).toBe("Logged bench press.");
		expect(result.toolCalls.map((call) => call.name)).toEqual(["data_bodybuilding_write"]);
		expect(result.graderResults.map((grader) => grader.passed)).toEqual([true, true, true]);
		expect(result.transcriptPath.endsWith("sample-task.jsonl")).toBe(true);
	});

	it("seeds initial data and enforces metric graders", async () => {
		const dir = createTempDir();
		const taskPath = join(dir, "task.yaml");
		writeFileSync(
			taskPath,
			[
				"id: profile-task",
				"suite: smoke",
				"prompt: Update the training profile.",
				"initialData:",
				"  sport-data/bodybuilding/user_profile.json:",
				"    goal: hypertrophy",
				"fauxResponses:",
				"  - text: Profile already says hypertrophy.",
				"graders:",
				"  - type: json_path_equals",
				"    file: sport-data/bodybuilding/user_profile.json",
				"    path: $.goal",
				"    equals: hypertrophy",
				"  - type: max_tool_calls",
				"    max: 0",
				"  - type: max_turns",
				"    max: 1",
			].join("\n"),
			"utf-8",
		);

		const task = loadEvalTask(taskPath);
		const result = await runEvalTask(task, { outputDir: join(dir, "out") });

		expect(result.passed).toBe(true);
		expect(result.metrics.toolCallCount).toBe(0);
		expect(result.metrics.turnCount).toBe(1);
		expect(result.graderResults.map((grader) => grader.passed)).toEqual([true, true, true]);
	});

	it("rejects unsupported bodybuilding namespaces and can grade missing files", async () => {
		const dir = createTempDir();
		const taskPath = join(dir, "task.yaml");
		writeFileSync(
			taskPath,
			[
				"id: invalid-namespace-task",
				"suite: smoke",
				"prompt: Save unsupported data.",
				"fauxResponses:",
				"  - toolCalls:",
				"      - name: data_bodybuilding_write",
				"        args:",
				"          namespace: random_notes",
				"          data:",
				"            note: unsupported",
				"  - text: random_notes was rejected.",
				"graders:",
				"  - type: final_contains",
				"    text: rejected",
				"  - type: file_not_exists",
				"    file: sport-data/bodybuilding/random_notes.json",
			].join("\n"),
			"utf-8",
		);

		const task = loadEvalTask(taskPath);
		const result = await runEvalTask(task, { outputDir: join(dir, "out") });

		expect(result.passed).toBe(true);
		expect(result.graderResults.map((grader) => grader.passed)).toEqual([true, true]);
	});
});
