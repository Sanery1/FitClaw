import type { AgentTool } from "@fitclaw/agent-core";
import type { Executor } from "../sandbox.js";
import { type AllowedCommand, createBashTool } from "./bash.js";
import { createReadTool } from "./read.js";

export function createCoachTools(executor: Executor, allowedCommands: readonly AllowedCommand[]): AgentTool[] {
	const tools: AgentTool[] = [createReadTool(executor)];
	if (allowedCommands.length > 0) {
		tools.push(createBashTool(executor, allowedCommands));
	}
	return tools;
}
