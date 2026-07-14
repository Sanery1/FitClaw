import { createSyntheticSourceInfo, type Skill } from "@fitclaw/runtime";
import { describe, expect, it } from "vitest";
import { buildCoachSystemPrompt } from "../src/index.js";

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
		const prompt = buildCoachSystemPrompt([createSkill()]);

		expect(prompt).toContain("Skill-declared data namespaces are the only source of durable fitness facts");
		expect(prompt).toContain("Do not store fitness facts in MEMORY.md");
		expect(prompt).toContain("data_bodybuilding_read");
		expect(prompt).toContain("data_bodybuilding_write");
	});

	it("keeps the response policy optimized for the Feishu coach experience", () => {
		const prompt = buildCoachSystemPrompt([]);

		expect(prompt).toContain("You are FitCoach");
		expect(prompt).toContain("Feishu card on mobile");
		expect(prompt).toContain("(no skills installed yet)");
	});
});
