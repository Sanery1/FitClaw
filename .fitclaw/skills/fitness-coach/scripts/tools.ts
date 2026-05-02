/**
 * Fitness Coach Skill — Tool Definitions
 *
 * This file is loaded at runtime (via jiti) when the fitness-coach skill is activated.
 * It exports a createTools function that the framework calls with a SportDataStore.
 *
 * Tool names use the "fitness:" prefix to prevent collisions with other sport skills.
 */
import { type AgentTool } from "@fitclaw/agent-core";
import { createFitnessTools, type SportDataStore } from "@fitclaw/claw";

export function createTools(store: SportDataStore): AgentTool<any>[] {
	const tools = createFitnessTools(store);
	// Prefix all tool names with the skill name for namespace isolation
	return tools.map((t) => ({ ...t, name: `fitness:${t.name}` }));
}
