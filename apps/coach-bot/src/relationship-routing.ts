import type { CoachRelationshipStatus } from "./relationships.js";

export type CoachRouteAction = "group_redirect" | "activation_prompt" | "activate" | "decline" | "coach" | "blocked";

const ACTIVATION_COMMANDS = new Set(["开始", "开始使用", "同意启用"]);
const DECLINE_COMMANDS = new Set(["暂不", "不使用", "不同意"]);

export function decideCoachRoute(
	chatType: "p2p" | "group",
	text: string,
	status?: CoachRelationshipStatus,
): CoachRouteAction {
	if (chatType === "group") return "group_redirect";
	if (status === "active") return "coach";
	if (status === "declined" || status === "revoked") return "blocked";

	const command = text.trim().replace(/[。.!！?？]+$/u, "");
	if (ACTIVATION_COMMANDS.has(command)) return "activate";
	if (DECLINE_COMMANDS.has(command)) return "decline";
	return "activation_prompt";
}
