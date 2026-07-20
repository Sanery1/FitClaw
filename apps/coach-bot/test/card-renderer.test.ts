import { describe, expect, it } from "vitest";
import { renderFeishuCard } from "../src/adapters/feishu/card-renderer.js";
import { buildPersonalitySelectionPrompt } from "../src/personality-selection.js";

describe("renderFeishuCard", () => {
	it("renders plain text into a card with default element", () => {
		const result = renderFeishuCard("Hello");
		expect(result.config?.wide_screen_mode).toBe(true);
		expect(result.elements).toHaveLength(1);
		expect(result.elements![0].text?.content).toBe("Hello");
	});

	it("uses first non-bullet line as header", () => {
		const result = renderFeishuCard("Workout Summary\n- Exercise A\n- Exercise B");
		expect(result.header?.title?.content).toBe("Workout Summary");
		expect(result.elements).toHaveLength(2);
	});

	it("skips empty lines and inserts separators", () => {
		const result = renderFeishuCard("Header\n\nBody");
		expect(result.header?.title?.content).toBe("Header");
		const hrElements = result.elements?.filter((e) => e.tag === "hr");
		expect(hrElements).toHaveLength(1);
	});

	it("truncates header to 64 characters", () => {
		const longHeader = "A".repeat(100);
		const result = renderFeishuCard(`${longHeader}\nBody`);
		expect(result.header?.title?.content.length).toBe(64);
	});

	it("truncates body content to 2000 characters", () => {
		const longBody = "B".repeat(3000);
		const result = renderFeishuCard(`Header\n${longBody}`);
		expect(result.elements![0].text?.content.length).toBe(2000);
	});

	it("renders code block content as lark_md, stripping box art", () => {
		const result = renderFeishuCard("```typescript\nconst x = 1;\n```");
		expect(result.header?.title?.content).toBeUndefined();
		expect(result.elements).toHaveLength(1);
		expect(result.elements![0].text?.content).toBe("const x = 1;");
	});

	it("strips ASCII box-art lines from code blocks", () => {
		const input = "```\n╔══════════╗\n║  Header  ║\n╚══════════╝\n实际内容\n```";
		const result = renderFeishuCard(input);
		expect(result.elements).toHaveLength(1);
		expect(result.elements![0].text?.content).toBe("实际内容");
	});

	it("converts --- and *** to horizontal rules", () => {
		const result = renderFeishuCard("Header\n---\nBody");
		expect(result.header?.title?.content).toBe("Header");
		const hrElements = result.elements?.filter((e) => e.tag === "hr");
		expect(hrElements).toHaveLength(1);
		expect(result.elements!.some((e) => e.text?.content === "Body")).toBe(true);
	});

	it("strips markdown heading markers from body text", () => {
		const result = renderFeishuCard("Header\n## Section Title\nBody");
		expect(result.elements![0].text?.content).toBe("Section Title");
	});

	it("produces fallback element for empty input", () => {
		const result = renderFeishuCard("");
		expect(result.elements?.[0].text?.content).toBe("");
	});

	it("renders all personality options without interactive controls", () => {
		const result = renderFeishuCard(buildPersonalitySelectionPrompt({ canCancel: true }));
		const serialized = JSON.stringify(result);

		expect(result.header?.title?.content).toBe("选择你的教练风格");
		expect(serialized).toContain("暖心鼓励");
		expect(serialized).toContain("温和理性");
		expect(serialized).toContain("严格督导");
		expect(serialized).toContain("取消");
		expect(serialized).not.toContain('"tag":"button"');
		expect(serialized).not.toContain('"actions"');
	});
});
