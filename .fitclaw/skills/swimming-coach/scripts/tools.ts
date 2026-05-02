/**
 * Swimming Coach Skill — Tool Definitions
 *
 * This file is loaded at runtime (via jiti) when the swimming-coach skill is activated.
 * Tool names use the "swimming:" prefix to prevent collisions with other sport skills.
 */
import { type AgentTool } from "@fitclaw/agent-core";
import { type SportDataStore } from "@fitclaw/claw";

export function createTools(store: SportDataStore): AgentTool<any>[] {
	// Placeholder: swimming-specific tools (lap tracking, stroke analysis, pace logging)
	// would be defined here. For now, this demonstrates the extensibility pattern.
	return [];
}
