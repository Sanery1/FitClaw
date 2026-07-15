import type { AgentTool } from "@fitclaw/agent-core";
import {
	createSkillDataReadTool,
	createSkillDataWriteTool,
	FileSkillDataStore,
	loadSkillsFromDir,
	type Skill,
} from "@fitclaw/runtime";
import { dirname, join } from "path";
import type { Executor } from "../sandbox.js";
import { createCoachTools } from "../tools/index.js";
import { createAllowedCommands } from "./permissions.js";

export function resolveCoachHostWorkspacePath(channelDir: string, channelId: string): string {
	const channelParts = channelId.split(/[\\/]+/).filter(Boolean);
	let workspacePath = channelDir;
	for (let i = 0; i < channelParts.length; i++) {
		workspacePath = dirname(workspacePath);
	}
	return workspacePath;
}

export function loadCoachSkills(channelDir: string, workspacePath: string, hostWorkspacePath: string): Skill[] {
	const skillMap = new Map<string, Skill>();

	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(hostWorkspacePath)) {
			return workspacePath + hostPath.slice(hostWorkspacePath.length);
		}
		return hostPath;
	};

	const addSkills = (dir: string, source: string): void => {
		for (const skill of loadSkillsFromDir({ dir, source }).skills) {
			skillMap.set(skill.name, {
				...skill,
				filePath: translatePath(skill.filePath),
				baseDir: translatePath(skill.baseDir),
			});
		}
	};

	addSkills(join(hostWorkspacePath, "skills"), "workspace");
	addSkills(join(channelDir, "skills"), "channel");

	return Array.from(skillMap.values());
}

export function createCoachSkillDataTools(channelDir: string, skills: Skill[]): AgentTool[] {
	const tools: AgentTool[] = [];

	for (const skill of skills) {
		if (skill.dataNamespaces && skill.dataNamespaces.size > 0) {
			const skillStore = new FileSkillDataStore(channelDir);
			tools.push(
				createSkillDataReadTool(skillStore, skill.name, skill.dataNamespaces),
				createSkillDataWriteTool(skillStore, skill.name, skill.dataNamespaces),
			);
		}
	}

	return tools;
}

export function createCoachActiveTools(executor: Executor, channelDir: string, skills: Skill[]): AgentTool[] {
	return [
		...createCoachTools(executor, createCoachReadRoots(skills), createAllowedCommands(skills)),
		...createCoachSkillDataTools(channelDir, skills),
	];
}

export function createCoachReadRoots(skills: readonly Skill[]): string[] {
	return Array.from(new Set(skills.map((skill) => skill.baseDir)));
}

export function configureCoachSkillDataRoot(channelDir: string): void {
	process.env.FITCLAW_DATA_DIR = channelDir;
}
