import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";

export interface SkillSyncOptions {
	cwd: string;
	from?: string;
	to?: string;
	dryRun?: boolean;
	prune?: boolean;
}

export interface SkillSyncResult {
	sourceDir: string;
	targetDir: string;
	copied: string[];
	pruned: string[];
	skipped: string[];
}

function resolvePath(cwd: string, value: string): string {
	return resolve(cwd, value);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function listSkillNames(dir: string): Promise<string[]> {
	if (!(await pathExists(dir))) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
	const checks = await Promise.all(
		candidates.map(async (entry) => ({
			name: entry.name,
			hasSkillFile: await pathExists(join(dir, entry.name, "SKILL.md")),
		})),
	);
	return checks
		.filter((entry) => entry.hasSkillFile)
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

export async function syncSkills(options: SkillSyncOptions): Promise<SkillSyncResult> {
	const sourceDir = resolvePath(options.cwd, options.from ?? ".fitclaw/skills");
	const targetDir = resolvePath(options.cwd, options.to ?? "feishu-workspace/skills");
	const skillNames = await listSkillNames(sourceDir);
	const targetSkillNames = await listSkillNames(targetDir);
	const targetOnlySkillNames = targetSkillNames.filter((name) => !skillNames.includes(name));

	if (!options.dryRun) {
		await mkdir(targetDir, { recursive: true });
	}

	for (const skillName of skillNames) {
		const sourceSkillDir = join(sourceDir, skillName);
		const targetSkillDir = join(targetDir, skillName);
		if (!options.dryRun) {
			await rm(targetSkillDir, { recursive: true, force: true });
			await cp(sourceSkillDir, targetSkillDir, { recursive: true });
		}
	}

	const pruned = options.prune ? targetOnlySkillNames : [];
	for (const skillName of pruned) {
		if (!options.dryRun) {
			await rm(join(targetDir, skillName), { recursive: true, force: true });
		}
	}

	return {
		sourceDir,
		targetDir,
		copied: skillNames,
		pruned,
		skipped: options.prune ? [] : targetOnlySkillNames,
	};
}

function printSkillHelp(): void {
	console.log(`Usage:
  fitclaw skill sync [--from <dir>] [--to <dir>] [--dry-run] [--prune]

Defaults:
  --from .fitclaw/skills
  --to   feishu-workspace/skills
`);
}

function requireFlagValue(args: string[], index: number): string {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		throw new Error(`Missing value for ${args[index]}`);
	}
	return value;
}

function parseSkillSyncArgs(args: string[]): Omit<SkillSyncOptions, "cwd"> | undefined {
	if (args[0] !== "sync") {
		return undefined;
	}

	let options: Omit<SkillSyncOptions, "cwd"> = {};
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--from") {
			options = { ...options, from: requireFlagValue(args, index) };
			index += 1;
		} else if (arg === "--to") {
			options = { ...options, to: requireFlagValue(args, index) };
			index += 1;
		} else if (arg === "--dry-run") {
			options = { ...options, dryRun: true };
		} else if (arg === "--prune") {
			options = { ...options, prune: true };
		} else if (arg === "--help" || arg === "-h") {
			printSkillHelp();
			return undefined;
		} else {
			throw new Error(`Unknown skill sync argument: ${arg}`);
		}
	}
	return options;
}

export async function handleSkillCommand(args: string[], cwd = process.cwd()): Promise<boolean> {
	if (args[0] !== "skill") {
		return false;
	}

	if (args[1] === "--help" || args[1] === "-h" || !args[1]) {
		printSkillHelp();
		return true;
	}

	if (args[1] === "sync" && (args.includes("--help") || args.includes("-h"))) {
		printSkillHelp();
		return true;
	}

	const parsed = parseSkillSyncArgs(args.slice(1));
	if (!parsed) {
		throw new Error(`Unknown skill command: ${args[1]}`);
	}

	const result = await syncSkills({ cwd, ...parsed });
	const mode = parsed.dryRun ? "Would sync" : "Synced";
	console.log(chalk.green(`${mode} ${result.copied.length} skill(s)`));
	for (const name of result.copied) {
		console.log(`  ${name}`);
	}
	if (result.skipped.length > 0) {
		console.log(chalk.yellow(`Skipped ${result.skipped.length} target-only skill(s); pass --prune to remove them.`));
		for (const name of result.skipped) {
			console.log(`  ${name}`);
		}
	}
	if (result.pruned.length > 0) {
		console.log(chalk.yellow(`${parsed.dryRun ? "Would prune" : "Pruned"} ${result.pruned.length} skill(s)`));
		for (const name of result.pruned) {
			console.log(`  ${name}`);
		}
	}
	console.log(chalk.dim(`From: ${result.sourceDir}`));
	console.log(chalk.dim(`To:   ${result.targetDir}`));
	return true;
}
