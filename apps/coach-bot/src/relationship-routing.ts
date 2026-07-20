import type { CoachRelationshipStatus } from "./relationships.js";

export type CoachRouteAction =
	| "group_redirect"
	| "activation_prompt"
	| "activate"
	| "decline"
	| "deactivate"
	| "coach"
	| "blocked";

const ACTIVATION_COMMANDS = new Set(["开始", "开始使用", "同意启用"]);
const DECLINE_COMMANDS = new Set(["暂不", "不使用", "不同意"]);
const DEACTIVATION_COMMANDS = new Set(["停用", "停止使用", "不同意", "撤回同意", "关闭私人教练"]);

export function decideCoachRoute(
	chatType: "p2p" | "group",
	text: string,
	status?: CoachRelationshipStatus,
): CoachRouteAction {
	if (chatType === "group") return "group_redirect";
	const command = normalizeCoachCommand(text);
	if (status === "active") return DEACTIVATION_COMMANDS.has(command) ? "deactivate" : "coach";
	if (status === "revoked") return "blocked";
	if (status === "declined") return ACTIVATION_COMMANDS.has(command) ? "activate" : "blocked";
	if (status !== "invited") return "activation_prompt";
	if (ACTIVATION_COMMANDS.has(command)) return "activate";
	if (DECLINE_COMMANDS.has(command)) return "decline";
	return "activation_prompt";
}

export function normalizeCoachCommand(text: string): string {
	return text.trim().replace(/[。.!！?？]+$/u, "");
}
