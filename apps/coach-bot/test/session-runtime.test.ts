import { createSyntheticSourceInfo, type Skill } from "@fitclaw/runtime";
import { describe, expect, it } from "vitest";
import { createCoachResourceState } from "../src/runtime/session.js";

function createSkill(name: string): Skill {
	const filePath = `/workspace/skills/${name}/SKILL.md`;
	return {
		name,
		description: `${name} skill`,
		filePath,
		baseDir: `/workspace/skills/${name}`,
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "workspace" }),
		disableModelInvocation: false,
		hasTools: false,
	};
}

describe("coach session resources", () => {
	it("updates the prompt and skills without retaining caller-owned arrays", () => {
		const initialSkills = [createSkill("bodybuilding")];
		const resources = createCoachResourceState("initial prompt", initialSkills);
		initialSkills.length = 0;

		expect(resources.resourceLoader.getSystemPrompt()).toBe("initial prompt");
		expect(resources.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["bodybuilding"]);

		const returnedSkills = resources.resourceLoader.getSkills().skills;
		returnedSkills.length = 0;
		expect(resources.resourceLoader.getSkills().skills).toHaveLength(1);

		const nextSkills = [createSkill("swimming-coach")];
		resources.update("updated prompt", nextSkills);
		nextSkills.length = 0;

		expect(resources.resourceLoader.getSystemPrompt()).toBe("updated prompt");
		expect(resources.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual(["swimming-coach"]);
	});
});
