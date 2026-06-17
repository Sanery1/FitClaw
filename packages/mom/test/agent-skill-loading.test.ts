import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMomSkillDataTools,
	getOrCreateRunner,
	loadMomSkills,
	resolveMomHostWorkspacePath,
} from "../src/agent.js";

function toPosixPath(path: string): string {
	return path.replace(/\\/g, "/");
}

describe("mom skill loading", () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-mom-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

		const hostWorkspacePath = resolveMomHostWorkspacePath(channelDir, "chat-1/user-1");
		const skills = loadMomSkills(channelDir, "/workspace", hostWorkspacePath);

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

		const hostWorkspacePath = resolveMomHostWorkspacePath(channelDir, "chat-1/user-1");
		const skills = loadMomSkills(channelDir, "/workspace", hostWorkspacePath);

		const bodybuilding = skills.find((skill) => skill.name === "bodybuilding");
		expect(bodybuilding?.description).toBe("Channel-specific bodybuilding skill.");
		expect(toPosixPath(bodybuilding?.filePath ?? "")).toBe("/workspace/chat-1/user-1/skills/bodybuilding/SKILL.md");
	});

	it("builds data tools from currently loaded skill declarations", () => {
		const channelDir = join(workspaceDir, "chat-1");
		mkdirSync(channelDir, { recursive: true });

		const initialSkills = loadMomSkills(channelDir, "/workspace", workspaceDir);
		expect(createMomSkillDataTools(channelDir, initialSkills).map((tool) => tool.name)).toEqual([]);

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

		const refreshedSkills = loadMomSkills(channelDir, "/workspace", workspaceDir);
		const toolNames = createMomSkillDataTools(channelDir, refreshedSkills).map((tool) => tool.name);

		expect(toolNames).toEqual(["data_bodybuilding_read", "data_bodybuilding_write"]);
	});

	it("sets FITCLAW_DATA_DIR to the channel data root used by FileSportDataStore", () => {
		const previousDataDir = process.env.FITCLAW_DATA_DIR;
		const previousProvider = process.env.MOM_LLM_PROVIDER;
		const previousModel = process.env.MOM_LLM_MODEL;
		const channelId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const channelDir = join(workspaceDir, channelId);
		mkdirSync(channelDir, { recursive: true });

		process.env.MOM_LLM_PROVIDER = "anthropic";
		process.env.MOM_LLM_MODEL = "claude-sonnet-4-5";

		const runner = getOrCreateRunner({ type: "host" }, channelId, channelDir);
		try {
			expect(process.env.FITCLAW_DATA_DIR).toBe(channelDir);
		} finally {
			runner.abort();
			if (previousDataDir === undefined) {
				delete process.env.FITCLAW_DATA_DIR;
			} else {
				process.env.FITCLAW_DATA_DIR = previousDataDir;
			}
			if (previousProvider === undefined) {
				delete process.env.MOM_LLM_PROVIDER;
			} else {
				process.env.MOM_LLM_PROVIDER = previousProvider;
			}
			if (previousModel === undefined) {
				delete process.env.MOM_LLM_MODEL;
			} else {
				process.env.MOM_LLM_MODEL = previousModel;
			}
		}
	});
});
