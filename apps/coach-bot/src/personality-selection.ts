import { COACH_PERSONALITIES, type CoachPersonalityId } from "@fitclaw/coach-core";

const PERSONALITY_SELECTIONS: Readonly<Record<string, CoachPersonalityId>> = {
	"1": "supportive",
	"2": "balanced",
	"3": "strict",
};

const SWITCH_PERSONALITY_COMMANDS = new Set(["切换人格", "更换人格"]);

export interface PersonalitySelectionPromptOptions {
	canCancel: boolean;
	shouldResendMessage?: boolean;
}

export function buildPersonalitySelectionPrompt(options: PersonalitySelectionPromptOptions): string {
	const lines = [
		"# 选择你的教练风格",
		"",
		`**1. ${COACH_PERSONALITIES.supportive.displayName}**`,
		COACH_PERSONALITIES.supportive.description,
		"",
		`**2. ${COACH_PERSONALITIES.balanced.displayName}**`,
		COACH_PERSONALITIES.balanced.description,
		"",
		`**3. ${COACH_PERSONALITIES.strict.displayName}**`,
		COACH_PERSONALITIES.strict.description,
		"",
		"回复 **1 / 2 / 3** 选择。之后发送“切换人格”可以更换。",
	];
	if (options.canCancel) lines.push("回复“取消”可以保留当前人格。");
	if (options.shouldResendMessage) lines.push("选好后，请重新发送你刚才的问题。");
	return lines.join("\n");
}

export function resolvePersonalitySelection(command: string): CoachPersonalityId | undefined {
	return PERSONALITY_SELECTIONS[command];
}

export function isSwitchPersonalityCommand(command: string): boolean {
	return SWITCH_PERSONALITY_COMMANDS.has(command);
}
