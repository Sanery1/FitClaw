import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSkillRunnerCommand, pingSkillRunner } from "../src/runtime/skill-runner-client.js";
import { createExecutor } from "../src/sandbox.js";
import { type SkillRunnerServer, startSkillRunnerServer } from "../src/skill-runner.js";

function createSocketPath(id: string, workspacePath: string): string {
	return process.platform === "win32" ? `\\\\.\\pipe\\fitclaw-skill-runner-${id}` : join(workspacePath, "runner.sock");
}

describe("skill runner", () => {
	let workspacePath: string;
	let socketPath: string;
	let server: SkillRunnerServer | undefined;

	beforeEach(async () => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		workspacePath = join(tmpdir(), `fitclaw-skill-runner-${id}`);
		socketPath = createSocketPath(id, workspacePath);
		mkdirSync(join(workspacePath, "skills", "test-skill", "scripts"), { recursive: true });
		server = await startSkillRunnerServer({ socketPath, workspacePath, verifyNetworkIsolation: false });
	});

	afterEach(async () => {
		await server?.close();
		rmSync(workspacePath, { recursive: true, force: true });
	});

	function writeSkill(
		scriptName: string,
		skillPath = join(workspacePath, "skills", "test-skill"),
		skillName = "test-skill",
		script = "process.stdout.write(process.argv.slice(2).join('|'));\n",
	): string {
		mkdirSync(join(skillPath, "scripts"), { recursive: true });
		const scriptPath = join(skillPath, "scripts", scriptName);
		writeFileSync(scriptPath, script, "utf-8");
		writeFileSync(
			join(skillPath, "SKILL.md"),
			["---", `name: ${skillName}`, "description: Test runner skill.", "---", "# Test Skill"].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(skillPath, "fitclaw.yaml"),
			[
				"version: 1",
				"permissions:",
				"  network: false",
				"  commands:",
				"    allow:",
				"      - executable: node",
				`        args: [scripts/${scriptName}]`,
			].join("\n"),
			"utf-8",
		);
		return scriptPath;
	}

	it("executes allowlisted argv and responds to health checks", async () => {
		const scriptPath = writeSkill("query.mjs");

		expect(await pingSkillRunner(socketPath)).toBe(true);
		const result = await executeSkillRunnerCommand(socketPath, {
			executable: "node",
			args: [scriptPath, "value && echo unsafe", "second"],
		});

		expect(result).toEqual({ stdout: "value && echo unsafe|second", stderr: "", code: 0 });
	});

	it("loads channel-specific Skill permissions from the command path", async () => {
		const skillPath = join(workspacePath, "chat-1", "user-1", "skills", "channel-skill");
		const scriptPath = writeSkill("channel.mjs", skillPath, "channel-skill");

		const result = await executeSkillRunnerCommand(socketPath, {
			executable: "node",
			args: [scriptPath, "channel"],
		});

		expect(result.stdout).toBe("channel");
	});

	it("reloads permissions and rejects stale or arbitrary commands", async () => {
		const firstScript = writeSkill("first.mjs");
		await expect(
			executeSkillRunnerCommand(socketPath, { executable: "node", args: ["-e", "process.exit(0)"] }),
		).rejects.toThrow(/SECURITY_BLOCKED/);

		const secondScript = writeSkill("second.mjs");
		await expect(executeSkillRunnerCommand(socketPath, { executable: "node", args: [firstScript] })).rejects.toThrow(
			/SECURITY_BLOCKED/,
		);
		const result = await executeSkillRunnerCommand(socketPath, {
			executable: "node",
			args: [secondScript, "fresh"],
		});
		expect(result.stdout).toBe("fresh");
	});

	it("fails closed when no isolated runner is configured", async () => {
		const executor = createExecutor({ type: "host" }, { skillRunnerSocketPath: null });

		await expect(executor.execFile("node", ["script.mjs"], { network: "deny" })).rejects.toThrow(
			/NETWORK_ISOLATION_UNAVAILABLE/,
		);
	});

	it("scopes FITCLAW_DATA_DIR to one isolated command", async () => {
		const scriptPath = writeSkill(
			"data-dir.mjs",
			undefined,
			undefined,
			"process.stdout.write(process.env.FITCLAW_DATA_DIR || 'missing');\n",
		);
		const dataDir = join(workspacePath, "tenants", "tenant-a", "users", "user-a");
		const result = await executeSkillRunnerCommand(socketPath, {
			executable: "node",
			args: [scriptPath],
			dataDir,
		});

		expect(result.stdout).toBe(dataDir);
		expect(process.env.FITCLAW_DATA_DIR).toBeUndefined();
	});

	it("rejects an isolated data directory outside the runner workspace", async () => {
		const scriptPath = writeSkill("outside-data.mjs");
		await expect(
			executeSkillRunnerCommand(socketPath, {
				executable: "node",
				args: [scriptPath],
				dataDir: join(workspacePath, "..", "outside"),
			}),
		).rejects.toThrow(/SECURITY_BLOCKED/);
	});

	it("does not mutate the host process environment between user executors", async () => {
		const firstDataDir = join(workspacePath, "tenants", "tenant-a", "users", "user-a");
		const secondDataDir = join(workspacePath, "tenants", "tenant-a", "users", "user-b");
		const firstExecutor = createExecutor(
			{ type: "host" },
			{ skillRunnerSocketPath: null, workspaceRoot: workspacePath, dataDir: firstDataDir },
		);
		const secondExecutor = createExecutor(
			{ type: "host" },
			{ skillRunnerSocketPath: null, workspaceRoot: workspacePath, dataDir: secondDataDir },
		);

		const [first, second] = await Promise.all([
			firstExecutor.execFile("node", ["-e", "process.stdout.write(process.env.FITCLAW_DATA_DIR || '')"]),
			secondExecutor.execFile("node", ["-e", "process.stdout.write(process.env.FITCLAW_DATA_DIR || '')"]),
		]);
		expect(first.stdout).toBe(firstDataDir);
		expect(second.stdout).toBe(secondDataDir);
		expect(process.env.FITCLAW_DATA_DIR).toBeUndefined();
	});
});
