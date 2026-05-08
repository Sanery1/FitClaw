#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSummary } from "./reporter.js";
import { loadEvalTask } from "./task-schema.js";
import { runEvalTask } from "./trial-runner.js";
import type { EvalTrialResult } from "./types.js";

type EvalCliOptions = {
	tasksDir: string;
	outputDir: string;
};

function parseArgs(args: string[]): EvalCliOptions {
	let tasksDir = "evals/tasks";
	let outputDir = "eval-results";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--tasks") {
			tasksDir = args[index + 1] ?? tasksDir;
			index += 1;
		} else if (arg === "--out") {
			outputDir = args[index + 1] ?? outputDir;
			index += 1;
		} else if (arg === "--help" || arg === "-h") {
			console.log("Usage: npm run eval -- --tasks evals/tasks --out eval-results");
			process.exit(0);
		} else {
			throw new Error(`Unknown eval argument: ${arg}`);
		}
	}
	return { tasksDir: resolve(tasksDir), outputDir: resolve(outputDir) };
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
	if (!existsSync(options.tasksDir)) {
		throw new Error(`Eval tasks directory does not exist: ${options.tasksDir}`);
	}
	mkdirSync(options.outputDir, { recursive: true });
	const tasks = collectTaskFiles(options.tasksDir).map((path) => loadEvalTask(path));
	let results: EvalTrialResult[] = [];
	for (const task of tasks) {
		const result = await runEvalTask(task, { outputDir: options.outputDir });
		results = [...results, result];
		const status = result.passed ? "PASS" : "FAIL";
		console.log(`${status} ${result.taskId}`);
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
