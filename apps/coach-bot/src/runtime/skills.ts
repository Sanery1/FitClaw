import type { AgentTool } from "@fitclaw/agent-core";
import {
	createSkillDataReadTool,
	createSkillDataWriteTool,
	FileSkillDataStore,
	loadSkillsFromDir,
	type Skill,
} from "@fitclaw/runtime";
import { dirname, join, posix, resolve, win32 } from "path";
import type { Executor } from "../sandbox.js";
import type { AllowedCommand } from "../tools/bash.js";
import { createCoachTools } from "../tools/index.js";

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
		...createCoachTools(executor, createCoachAllowedCommands(skills)),
		...createCoachSkillDataTools(channelDir, skills),
	];
}

export function createCoachAllowedCommands(skills: readonly Skill[]): AllowedCommand[] {
	const commands = new Map<string, AllowedCommand>();

	for (const skill of skills) {
		for (const permission of skill.permissions?.commands?.allow ?? []) {
			const argumentPrefix = permission.args.map((argument, index) => {
				if (index !== 0) return argument;
				if (skill.baseDir.startsWith("/")) return posix.resolve(skill.baseDir, argument.replace(/\\/g, "/"));
				if (win32.isAbsolute(skill.baseDir)) return win32.resolve(skill.baseDir, argument);
				return resolve(skill.baseDir, argument);
			});
			const command = { executable: permission.executable, argumentPrefix };
			commands.set(JSON.stringify(command), command);
		}
	}

	return Array.from(commands.values());
}

export function configureCoachSkillDataRoot(channelDir: string): void {
	process.env.FITCLAW_DATA_DIR = channelDir;
}
