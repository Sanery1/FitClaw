import { describe, expect, it } from "vitest";
import { parseSkillBlock } from "../src/core/skill-block.js";

describe("skill block parser", () => {
	it("parses skill metadata, content, and optional user message", () => {
		const parsed = parseSkillBlock(
			[
				'<skill name="bodybuilding" location=".fitclaw/skills/bodybuilding">',
				"# Bodybuilding",
				"",
				"Use for training tasks.",
				"</skill>",
				"",
				"Create a bench plan.",
			].join("\n"),
		);

		expect(parsed).toEqual({
			name: "bodybuilding",
			location: ".fitclaw/skills/bodybuilding",
			content: "# Bodybuilding\n\nUse for training tasks.",
			userMessage: "Create a bench plan.",
		});
	});

	it("returns null for normal messages", () => {
		expect(parseSkillBlock("hello")).toBeNull();
	});
});
