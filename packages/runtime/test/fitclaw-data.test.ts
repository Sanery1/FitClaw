import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, it } from "vitest";

const cliPath = resolve(__dirname, "../src/cli/fitclaw-data.ts");
const tsxPath = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");
const namespace = "bodybuilding/training_log";
const tempDirs: string[] = [];
const activeChildren = new Set<ChildProcessWithoutNullStreams>();

interface CliProcess {
	child: ChildProcessWithoutNullStreams;
	spawned: Promise<void>;
	result: Promise<{ stdout: string; stderr: string; code: number | null }>;
}

afterEach(async () => {
	const children = [...activeChildren];
	const exits = children.map((child) => once(child, "close"));
	for (const child of children) child.kill();
	await Promise.all(exits);
	activeChildren.clear();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createDataDir(): Promise<string> {
	const dataDir = await mkdtemp(join(tmpdir(), "fitclaw-data-cli-"));
	tempDirs.push(dataDir);
	return dataDir;
}

function startAppend(dataDir: string): CliProcess {
	const child = spawn(
		process.execPath,
		[tsxPath, cliPath, "write", "--namespace", namespace, "--data-dir", dataDir, "--mode", "append"],
		{
			env: {
				...process.env,
				TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	activeChildren.add(child);
	const spawned = new Promise<void>((resolvePromise, reject) => {
		child.once("spawn", resolvePromise);
		child.once("error", reject);
	});

	const result = new Promise<{ stdout: string; stderr: string; code: number | null }>((resolvePromise, reject) => {
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("fitclaw-data child process timed out"));
		}, 15_000);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			activeChildren.delete(child);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			activeChildren.delete(child);
			resolvePromise({ stdout, stderr, code });
		});
	});

	return { child, spawned, result };
}

describe("fitclaw-data append", () => {
	it("preserves concurrent appends from independent CLI processes", async () => {
		const dataDir = await createDataDir();
		const namespaceDir = join(dataDir, "sport-data", "bodybuilding");
		const dataPath = join(namespaceDir, "training_log.json");
		const seed = Array.from({ length: 100_000 }, (_, index) => index);
		await mkdir(namespaceDir, { recursive: true });
		await writeFile(dataPath, JSON.stringify(seed), "utf-8");

		const releaseLegacyLock = await lockfile.lock(join(dataDir, "sport-data"), { realpath: false });
		const releaseNamespaceLock = await lockfile.lock(dataPath, { realpath: false });
		const commands = ["first", "second", "third", "fourth"].map((id) => ({ id, command: startAppend(dataDir) }));
		try {
			await Promise.all(commands.map(({ command }) => command.spawned));
			for (const { id, command } of commands) command.child.stdin.end(JSON.stringify({ id }));
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
		} finally {
			await Promise.all([releaseLegacyLock(), releaseNamespaceLock()]);
		}

		const results = await Promise.all(commands.map(({ command }) => command.result));
		for (const result of results) {
			expect(result).toMatchObject({ code: 0, stderr: "" });
			expect(JSON.parse(result.stdout)).toMatchObject({ success: true, namespace, mode: "append" });
		}

		const persisted = JSON.parse(await readFile(dataPath, "utf-8")) as unknown[];
		expect(persisted).toHaveLength(seed.length + commands.length);
		expect(persisted.slice(-commands.length)).toEqual(expect.arrayContaining(commands.map(({ id }) => ({ id }))));
	}, 20_000);

	it("rejects append when existing data is not an array", async () => {
		const dataDir = await createDataDir();
		const namespaceDir = join(dataDir, "sport-data", "bodybuilding");
		const dataPath = join(namespaceDir, "training_log.json");
		const existing = { exercise: "squat" };
		await mkdir(namespaceDir, { recursive: true });
		await writeFile(dataPath, JSON.stringify(existing), "utf-8");

		const command = startAppend(dataDir);
		command.child.stdin.end(JSON.stringify({ exercise: "deadlift" }));
		const result = await command.result;

		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(`Error: cannot append to "${namespace}": existing data is not an array`);
		expect(JSON.parse(await readFile(dataPath, "utf-8"))).toEqual(existing);
	});
});
