import { createSyntheticSourceInfo, type Skill } from "@fitclaw/runtime";
import { describe, expect, it } from "vitest";
import {
	buildCoachSystemPrompt,
	COACH_PERSONALITIES,
	COACH_PERSONALITY_IDS,
	COACH_PERSONALITY_POLICY_VERSION,
} from "../src/index.js";

function createSkill(): Skill {
	return {
		name: "bodybuilding",
		description: "Bodybuilding coaching workflows.",
		filePath: "/workspace/skills/bodybuilding/SKILL.md",
		baseDir: "/workspace/skills/bodybuilding",
		sourceInfo: createSyntheticSourceInfo("/workspace/skills/bodybuilding/SKILL.md", {
			source: "workspace",
		}),
		disableModelInvocation: false,
		hasTools: false,
		dataNamespaces: new Map([
			["user_profile", { type: "object" }],
			["training_log", { type: "array" }],
		]),
	};
}

describe("buildCoachSystemPrompt", () => {
	it("uses Skill data as the only durable fitness memory", () => {
		const prompt = buildCoachSystemPrompt([createSkill()], "balanced");

		expect(prompt).toContain("Skill-declared data namespaces are the only source of durable fitness facts");
		expect(prompt).toContain("Do not store fitness facts in MEMORY.md");
		expect(prompt).toContain("data_bodybuilding_read");
		expect(prompt).toContain("data_bodybuilding_write");
	});

	it("keeps the response policy optimized for the Feishu coach experience", () => {
		const prompt = buildCoachSystemPrompt([], "balanced");

		expect(prompt).toContain("You are FitCoach");
		expect(prompt).toContain("Feishu card on mobile");
		expect(prompt).toContain("(no skills installed yet)");
	});

	it("applies injury, durable-data, and attachment boundaries globally", () => {
		const prompt = buildCoachSystemPrompt([createSkill()], "balanced");

		expect(prompt).toContain("the response MUST include all three");
		expect(prompt).toContain("Do not provide a loaded replacement workout");
		expect(prompt).toContain("read the relevant namespace in the current turn");
		expect(prompt).toContain("Do not guess flags");
		expect(prompt).toContain("attach the verified Skill file");
		expect(prompt).not.toContain("Do not use attach");
	});

	it.each(COACH_PERSONALITY_IDS)("injects only the selected %s personality", (personalityId) => {
		const prompt = buildCoachSystemPrompt([], personalityId);

		expect(prompt).toContain(`Policy version: ${COACH_PERSONALITY_POLICY_VERSION}`);
		expect(prompt).toContain(`Personality ID: ${personalityId}`);
		expect(prompt).toContain(COACH_PERSONALITIES[personalityId].prompt);
		expect(prompt).toContain("only a newly injected selected personality can replace it");
		expect(prompt).toContain("safety and privacy; factual accuracy; the user's training goal");
		for (const otherId of COACH_PERSONALITY_IDS) {
			if (otherId !== personalityId) expect(prompt).not.toContain(COACH_PERSONALITIES[otherId].prompt);
		}
	});

	it("does not force every personality into a generic encouraging style", () => {
		const prompt = buildCoachSystemPrompt([], "strict");

		expect(prompt).not.toContain("professional, and encouraging");
		expect(prompt).not.toContain("motivating, knowledgeable, and supportive");
	});
});
