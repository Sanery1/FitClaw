import { existsSync } from "node:fs";
import type { AgentTool } from "@fitclaw/agent-core";
import {
	createKnowledgeReadTool,
	createKnowledgeSearchTool,
	createSkillDataReadTool,
	createSkillDataWriteTool,
	FileSkillDataStore,
	type KnowledgeStore,
	loadSkillsFromDir,
	type Skill,
} from "@fitclaw/runtime";
import { dirname, join } from "path";
import type { Executor } from "../sandbox.js";
import { createExerciseSearchTool } from "../tools/exercise-search.js";
import { createCoachTools } from "../tools/index.js";
import type { BotContext } from "../types.js";
import { createAllowedCommands } from "./permissions.js";

export interface CoachSkill extends Skill {
	hasExerciseDatabase: boolean;
}

export function resolveCoachHostWorkspacePath(channelDir: string, channelId: string): string {
	const channelParts = channelId.split(/[\\/]+/).filter(Boolean);
	let workspacePath = channelDir;
	for (let i = 0; i < channelParts.length; i++) {
		workspacePath = dirname(workspacePath);
	}
	return workspacePath;
}

export function loadCoachSkills(channelDir: string, workspacePath: string, hostWorkspacePath: string): CoachSkill[] {
	const skillMap = new Map<string, CoachSkill>();

	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(hostWorkspacePath)) {
			return workspacePath + hostPath.slice(hostWorkspacePath.length);
		}
		return hostPath;
	};

	const addSkills = (dir: string, source: string): void => {
		for (const skill of loadSkillsFromDir({ dir, source }).skills) {
			const hasExerciseDatabase =
				skill.name === "bodybuilding" &&
				existsSync(join(skill.baseDir, "free-exercise-db", "dist", "exercises.json"));
			skillMap.set(skill.name, {
				...skill,
				filePath: translatePath(skill.filePath),
				baseDir: translatePath(skill.baseDir),
				hasExerciseDatabase,
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

export function createCoachActiveTools(
	executor: Executor,
	channelDir: string,
	skills: CoachSkill[],
	uploadFile?: BotContext["uploadFile"],
	knowledgeStore?: KnowledgeStore,
): AgentTool[] {
	const allowedCollections = Array.from(new Set(skills.flatMap((skill) => skill.knowledgeCollections ?? [])));
	const bodybuildingSkill = skills.find((skill) => skill.name === "bodybuilding" && skill.hasExerciseDatabase);
	return [
		...createCoachTools(executor, createCoachReadRoots(skills), createAllowedCommands(skills), uploadFile),
		...createCoachSkillDataTools(channelDir, skills),
		...(bodybuildingSkill ? [createExerciseSearchTool(executor, bodybuildingSkill)] : []),
		...(knowledgeStore && allowedCollections.length > 0
			? [
					createKnowledgeSearchTool(knowledgeStore, allowedCollections),
					createKnowledgeReadTool(knowledgeStore, allowedCollections),
				]
			: []),
	];
}

export function createCoachReadRoots(skills: readonly Skill[]): string[] {
	return Array.from(new Set(skills.map((skill) => skill.baseDir)));
}

export function configureCoachSkillDataRoot(channelDir: string): void {
	process.env.FITCLAW_DATA_DIR = channelDir;
}
