import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeEvalResults } from "../src/evals/metrics.js";
import { writeSummary } from "../src/evals/reporter.js";
import { runEvalCli } from "../src/evals/run-evals.js";
import { createSessionEvalTaskDraft } from "../src/evals/session-import.js";
import { loadEvalTask } from "../src/evals/task-schema.js";
import { runEvalTask } from "../src/evals/trial-runner.js";
import type { EvalTrialResult } from "../src/evals/types.js";

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

	it("grades forbidden tools and required tool order", async () => {
		const dir = createTempDir();
		const taskPath = join(dir, "task.yaml");
		writeFileSync(
			taskPath,
			[
				"id: tool-policy-task",
				"suite: smoke",
				"prompt: Record a simple workout.",
				"fauxResponses:",
				"  - toolCalls:",
				"      - name: data_bodybuilding_write",
				"        args:",
				"          namespace: training_log",
				"          data:",
				"            exercise: squat",
				"  - text: Logged squat.",
				"graders:",
				"  - type: tool_not_called",
				"    tool: bash",
				"  - type: tool_sequence",
				"    tools:",
				"      - data_bodybuilding_write",
			].join("\n"),
			"utf-8",
		);

		const task = loadEvalTask(taskPath);
		const result = await runEvalTask(task, { outputDir: join(dir, "out") });

		expect(result.passed).toBe(true);
		expect(result.graderResults.map((grader) => grader.passed)).toEqual([true, true]);
	});

	it("summarizes pass@1, pass@k, pass^k, and selected efficiency metrics", () => {
		const baseResult = {
			suite: "smoke",
			finalAnswer: "",
			toolCalls: [],
			transcriptPath: "transcript.jsonl",
		};
		const results: EvalTrialResult[] = [
			{
				...baseResult,
				taskId: "flaky",
				trialIndex: 1,
				passed: false,
				graderResults: [{ name: "first", passed: false, message: "failed" }],
				metrics: { turnCount: 2, toolCallCount: 1, durationMs: 10 },
			},
			{
				...baseResult,
				taskId: "flaky",
				trialIndex: 2,
				passed: true,
				graderResults: [{ name: "second", passed: true, message: "passed" }],
				metrics: { turnCount: 1, toolCallCount: 0, durationMs: 20 },
			},
			{
				...baseResult,
				taskId: "stable",
				trialIndex: 1,
				passed: true,
				graderResults: [{ name: "first", passed: true, message: "passed" }],
				metrics: { turnCount: 1, toolCallCount: 2, durationMs: 30 },
			},
			{
				...baseResult,
				taskId: "stable",
				trialIndex: 2,
				passed: true,
				graderResults: [{ name: "second", passed: true, message: "passed" }],
				metrics: { turnCount: 2, toolCallCount: 1, durationMs: 40 },
			},
		];

		const summary = summarizeEvalResults(results);

		expect(summary.passAt1.rate).toBe(0.5);
		expect(summary.passAtK.rate).toBe(1);
		expect(summary.passAllK.rate).toBe(0.5);
		expect(summary.trialPassRate.rate).toBe(0.75);
		expect(summary.graderPassRate.rate).toBe(0.75);
		expect(summary.averageToolCalls).toBe(1);
		expect(summary.averageTurns).toBe(1.5);
	});

	it("writes pass metrics as the only top-level metrics and moves supporting data to diagnostics", () => {
		const dir = createTempDir();
		const summaryPath = join(dir, "summary.md");
		const result: EvalTrialResult = {
			taskId: "stable",
			suite: "smoke",
			trialIndex: 1,
			passed: true,
			finalAnswer: "",
			toolCalls: [],
			graderResults: [{ name: "answer", passed: true, message: "passed" }],
			transcriptPath: "stable.jsonl",
			metrics: { turnCount: 1, toolCallCount: 0, durationMs: 10 },
		};

		writeSummary(summaryPath, [result]);
		const summary = readFileSync(summaryPath, "utf-8");
		const metricsSection = summary.split("## Diagnostics")[0] ?? "";

		expect(metricsSection).toContain("pass@1");
		expect(metricsSection).toContain("pass^1");
		expect(metricsSection).not.toContain("trial pass rate");
		expect(metricsSection).not.toContain("average tool calls");
		expect(summary).toContain("## Diagnostics");
		expect(summary).toContain("Tool Calls");
	});

	it("creates a human-review eval task draft from a real session jsonl", () => {
		const dir = createTempDir();
		const sessionPath = join(dir, "session.jsonl");
		writeFileSync(
			sessionPath,
			[
				JSON.stringify({ type: "session", version: 1 }),
				JSON.stringify({
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "记录今天卧推 60kg 5x5，RPE 8" }],
					},
				}),
				JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "已记录卧推训练。" }],
					},
				}),
			].join("\n"),
			"utf-8",
		);

		const draft = createSessionEvalTaskDraft(sessionPath, {
			id: "real-session-001",
			suite: "session",
		});

		expect(draft).toContain("id: real-session-001");
		expect(draft).toContain("suite: session");
		expect(draft).toContain("记录今天卧推");
		expect(draft).toContain("已记录卧推训练");
		expect(draft).toContain("HUMAN_REVIEW_REQUIRED");
	});

	it("writes a human-review task draft from session through the eval CLI", async () => {
		const dir = createTempDir();
		const sessionPath = join(dir, "session.jsonl");
		const taskPath = join(dir, "real-session.yaml");
		writeFileSync(
			sessionPath,
			[
				JSON.stringify({
					type: "message",
					message: { role: "user", content: "Summarize the project status." },
				}),
				JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "The project has an eval harness." }],
					},
				}),
			].join("\n"),
			"utf-8",
		);

		const exitCode = await runEvalCli([
			"--from-session",
			sessionPath,
			"--write-task",
			taskPath,
			"--task-id",
			"real-project-status",
		]);

		const taskDraft = readFileSync(taskPath, "utf-8");
		expect(exitCode).toBe(0);
		expect(taskDraft).toContain("id: real-project-status");
		expect(taskDraft).toContain("Summarize the project status.");
		expect(taskDraft).toContain("HUMAN_REVIEW_REQUIRED");
	});
});
