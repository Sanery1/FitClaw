#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSummary } from "./reporter.js";
import { createSessionEvalTaskDraft } from "./session-import.js";
import { loadEvalTask } from "./task-schema.js";
import { runEvalTask } from "./trial-runner.js";
import type { EvalTrialResult } from "./types.js";

type EvalCliOptions = {
	tasksDir: string;
	outputDir: string;
	suite?: string;
	taskId?: string;
	runs: number;
	fromSession?: string;
	writeTask?: string;
	draftTaskId?: string;
};

function requireFlagValue(args: string[], index: number): string {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		throw new Error(`Missing value for ${args[index]}`);
	}
	return value;
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer.`);
	}
	return parsed;
}

function parseArgs(args: string[]): EvalCliOptions {
	let tasksDir = "evals/tasks";
	let outputDir = "eval-results";
	let suite: string | undefined;
	let taskId: string | undefined;
	let runs = 1;
	let fromSession: string | undefined;
	let writeTask: string | undefined;
	let draftTaskId: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--tasks") {
			tasksDir = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--out") {
			outputDir = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--suite") {
			suite = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--task") {
			taskId = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--runs") {
			runs = parsePositiveInteger(requireFlagValue(args, index), "--runs");
			index += 1;
		} else if (arg === "--from-session") {
			fromSession = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--write-task") {
			writeTask = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--task-id") {
			draftTaskId = requireFlagValue(args, index);
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: npm run eval -- --tasks evals/tasks --out eval-results [--suite skills] [--task task-id] [--runs 3]\n" +
					"       npm run eval -- --from-session session.jsonl --write-task evals/tasks/session/case.yaml --task-id case-id",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown eval argument: ${arg}`);
		}
	}
	return {
		tasksDir: resolve(tasksDir),
		outputDir: resolve(outputDir),
		suite,
		taskId,
		runs,
		fromSession: fromSession ? resolve(fromSession) : undefined,
		writeTask: writeTask ? resolve(writeTask) : undefined,
		draftTaskId,
	};
}

function collectTaskFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return collectTaskFiles(path);
		}
		return entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) ? [path] : [];
	});
}

export async function runEvalCli(args: string[]): Promise<number> {
	const options = parseArgs(args);
	if (options.fromSession || options.writeTask) {
		if (!options.fromSession || !options.writeTask) {
			throw new Error("--from-session and --write-task must be provided together.");
		}
		const taskId = options.draftTaskId ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
		const draft = createSessionEvalTaskDraft(options.fromSession, { id: taskId, suite: "session" });
		mkdirSync(dirname(options.writeTask), { recursive: true });
		writeFileSync(options.writeTask, draft, "utf-8");
		console.log(`Wrote human-review eval task draft: ${options.writeTask}`);
		return 0;
	}
	if (!existsSync(options.tasksDir)) {
		throw new Error(`Eval tasks directory does not exist: ${options.tasksDir}`);
	}
	mkdirSync(options.outputDir, { recursive: true });
	const tasks = collectTaskFiles(options.tasksDir)
		.map((path) => loadEvalTask(path))
		.filter((task) => options.suite === undefined || task.suite === options.suite)
		.filter((task) => options.taskId === undefined || task.id === options.taskId);
	if (tasks.length === 0) {
		throw new Error("No eval tasks matched the requested filters.");
	}
	let results: EvalTrialResult[] = [];
	for (const task of tasks) {
		for (let trialIndex = 1; trialIndex <= options.runs; trialIndex += 1) {
			const result = await runEvalTask(task, {
				outputDir: options.outputDir,
				trialIndex,
				totalTrials: options.runs,
			});
			results = [...results, result];
			const status = result.passed ? "PASS" : "FAIL";
			const trialSuffix = options.runs > 1 ? `#${trialIndex}` : "";
			console.log(`${status} ${result.taskId}${trialSuffix}`);
		}
	}
	writeSummary(join(options.outputDir, "summary.md"), results);
	const failed = results.filter((result) => !result.passed).length;
	console.log(`Eval summary: ${results.length - failed}/${results.length} passed`);
	return failed === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runEvalCli(process.argv.slice(2))
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(message);
			process.exitCode = 1;
		});
}
