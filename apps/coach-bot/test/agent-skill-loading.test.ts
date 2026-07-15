import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	configureCoachSkillDataRoot,
	createCoachActiveTools,
	createCoachSkillDataTools,
	loadCoachSkills,
	resolveCoachHostWorkspacePath,
} from "../src/runtime/skills.js";
import type { ExecOptions, ExecResult, Executor } from "../src/sandbox.js";

class RecordingExecutor implements Executor {
	async exec(_command: string, _options?: ExecOptions): Promise<ExecResult> {
		return { stdout: "", stderr: "", code: 0 };
	}

	async execFile(_executable: string, _args: readonly string[], _options?: ExecOptions): Promise<ExecResult> {
		return { stdout: "", stderr: "", code: 0 };
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

function toPosixPath(path: string): string {
	return path.replace(/\\/g, "/");
}

describe("coach bot skill loading", () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-coach-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(workspaceDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
	});

	it("loads workspace-level skills for group user channel directories", () => {
		const skillDir = join(workspaceDir, "skills", "bodybuilding");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			[
				"---",
				"name: bodybuilding",
				"description: Bodybuilding coaching skill.",
				"data:",
				"  training_log:",
				"    type: array",
				"---",
				"# Bodybuilding",
			].join("\n"),
			"utf-8",
		);

		const channelDir = join(workspaceDir, "chat-1", "user-1");
		mkdirSync(channelDir, { recursive: true });

		const hostWorkspacePath = resolveCoachHostWorkspacePath(channelDir, "chat-1/user-1");
		const skills = loadCoachSkills(channelDir, "/workspace", hostWorkspacePath);

		const bodybuilding = skills.find((skill) => skill.name === "bodybuilding");
		expect(toPosixPath(hostWorkspacePath)).toBe(toPosixPath(workspaceDir));
		expect(toPosixPath(bodybuilding?.filePath ?? "")).toBe("/workspace/skills/bodybuilding/SKILL.md");
		expect(bodybuilding?.dataNamespaces?.get("training_log")).toEqual({ type: "array" });
	});

	it("keeps channel-specific skills overriding workspace-level skills", () => {
		const workspaceSkillDir = join(workspaceDir, "skills", "bodybuilding");
		mkdirSync(workspaceSkillDir, { recursive: true });
		writeFileSync(
			join(workspaceSkillDir, "SKILL.md"),
			[
				"---",
				"name: bodybuilding",
				"description: Workspace bodybuilding skill.",
				"---",
				"# Workspace Bodybuilding",
			].join("\n"),
			"utf-8",
		);

		const channelDir = join(workspaceDir, "chat-1", "user-1");
		const channelSkillDir = join(channelDir, "skills", "bodybuilding");
		mkdirSync(channelSkillDir, { recursive: true });
		writeFileSync(
			join(channelSkillDir, "SKILL.md"),
			[
				"---",
				"name: bodybuilding",
				"description: Channel-specific bodybuilding skill.",
				"---",
				"# Channel Bodybuilding",
			].join("\n"),
			"utf-8",
		);

		const hostWorkspacePath = resolveCoachHostWorkspacePath(channelDir, "chat-1/user-1");
		const skills = loadCoachSkills(channelDir, "/workspace", hostWorkspacePath);

		const bodybuilding = skills.find((skill) => skill.name === "bodybuilding");
		expect(bodybuilding?.description).toBe("Channel-specific bodybuilding skill.");
		expect(toPosixPath(bodybuilding?.filePath ?? "")).toBe("/workspace/chat-1/user-1/skills/bodybuilding/SKILL.md");
	});

	it("builds data tools from currently loaded skill declarations", () => {
		const channelDir = join(workspaceDir, "chat-1");
		mkdirSync(channelDir, { recursive: true });

		const initialSkills = loadCoachSkills(channelDir, "/workspace", workspaceDir);
		expect(createCoachSkillDataTools(channelDir, initialSkills).map((tool) => tool.name)).toEqual([]);

		const skillDir = join(workspaceDir, "skills", "bodybuilding");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			[
				"---",
				"name: bodybuilding",
				"description: Bodybuilding coaching skill.",
				"data:",
				"  training_log:",
				"    type: array",
				"---",
				"# Bodybuilding",
			].join("\n"),
			"utf-8",
		);

		const refreshedSkills = loadCoachSkills(channelDir, "/workspace", workspaceDir);
		const toolNames = createCoachSkillDataTools(channelDir, refreshedSkills).map((tool) => tool.name);

		expect(toolNames).toEqual(["data_bodybuilding_read", "data_bodybuilding_write"]);
	});

	it("only exposes command execution when a skill declares an allowlist", () => {
		const channelDir = join(workspaceDir, "chat-1");
		mkdirSync(channelDir, { recursive: true });
		const executor = new RecordingExecutor();

		const initialSkills = loadCoachSkills(channelDir, workspaceDir, workspaceDir);
		expect(createCoachActiveTools(executor, channelDir, initialSkills).map((tool) => tool.name)).toEqual(["read"]);

		const skillDir = join(workspaceDir, "skills", "bodybuilding");
		const scriptsDir = join(skillDir, "scripts");
		mkdirSync(scriptsDir, { recursive: true });
		writeFileSync(join(scriptsDir, "query.py"), "print('ok')\n", "utf-8");
		writeFileSync(
			join(skillDir, "SKILL.md"),
			[
				"---",
				"name: bodybuilding",
				"description: Bodybuilding coaching skill.",
				"permissions:",
				"  commands:",
				"    allow:",
				"      - executable: python",
				"        args: [scripts/query.py]",
				"data:",
				"  training_log:",
				"    type: array",
				"---",
				"# Bodybuilding",
			].join("\n"),
			"utf-8",
		);

		const refreshedSkills = loadCoachSkills(channelDir, workspaceDir, workspaceDir);
		const toolNames = createCoachActiveTools(executor, channelDir, refreshedSkills).map((tool) => tool.name);

		expect(toolNames).toEqual(["read", "bash", "data_bodybuilding_read", "data_bodybuilding_write"]);
	});

	it("sets FITCLAW_DATA_DIR to the channel data root used by FileSkillDataStore", () => {
		const previousDataDir = process.env.FITCLAW_DATA_DIR;
		const channelId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const channelDir = join(workspaceDir, channelId);
		mkdirSync(channelDir, { recursive: true });

		configureCoachSkillDataRoot(channelDir);
		try {
			expect(process.env.FITCLAW_DATA_DIR).toBe(channelDir);
		} finally {
			if (previousDataDir === undefined) {
				delete process.env.FITCLAW_DATA_DIR;
			} else {
				process.env.FITCLAW_DATA_DIR = previousDataDir;
			}
		}
	});
});
