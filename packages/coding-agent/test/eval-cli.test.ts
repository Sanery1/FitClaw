import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvalCli } from "../src/evals/run-evals.js";

describe("eval cli", () => {
	let tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	function createTempDir(): string {
		const dir = join(tmpdir(), `fitclaw-eval-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		tempDirs = [...tempDirs, dir];
		return dir;
	}

	function writeTask(tasksDir: string, id: string, suite: string): void {
		writeFileSync(
			join(tasksDir, `${id}.yaml`),
			[
				`id: ${id}`,
				`suite: ${suite}`,
				"prompt: Say done.",
				"fauxResponses:",
				"  - text: done",
				"graders:",
				"  - type: final_contains",
				"    text: done",
			].join("\n"),
			"utf-8",
		);
	}

	it("runs only tasks matching suite and task filters", async () => {
		const dir = createTempDir();
		const tasksDir = join(dir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeTask(tasksDir, "skill-task", "skills");
		writeTask(tasksDir, "tool-task", "tools");

		const outputDir = join(dir, "out");
		const exitCode = await runEvalCli([
			"--tasks",
			tasksDir,
			"--out",
			outputDir,
			"--suite",
			"skills",
			"--task",
			"skill-task",
		]);

		expect(exitCode).toBe(0);
		expect(() => rmSync(join(outputDir, "workspaces", "skill-task"), { recursive: true })).not.toThrow();
		expect(() => rmSync(join(outputDir, "workspaces", "tool-task"), { recursive: true })).toThrow();
	});
});
