import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SkillDataDeclaration } from "../src/core/skills.js";
import { FileSportDataStore } from "../src/core/tools/fitness/sport-data-store.js";
import { createSkillDataReadTool, createSkillDataWriteTool } from "../src/core/tools/skill-data-tools.js";

function parseTextResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
	const text = result.content.find((part) => part.type === "text")?.text;
	if (!text) {
		throw new Error("Expected text result");
	}
	return JSON.parse(text) as Record<string, unknown>;
}

describe("skill data tools", () => {
	let tempDir: string;
	let store: FileSportDataStore;
	let dataNamespaces: Map<string, SkillDataDeclaration>;

	beforeEach(() => {
		tempDir = join(tmpdir(), `fitclaw-skill-data-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		store = new FileSportDataStore(tempDir);
		dataNamespaces = new Map<string, SkillDataDeclaration>([
			["user_profile", { type: "object" }],
			["training_log", { type: "array" }],
		]);
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects reads for undeclared namespaces", async () => {
		const tool = createSkillDataReadTool(store, "bodybuilding", dataNamespaces);

		const result = await tool.execute("call-1", { namespace: "private_notes" });

		expect(parseTextResult(result)).toMatchObject({
			error: expect.stringContaining('namespace "private_notes" not declared'),
		});
	});

	it("rejects path-like namespaces before reading", async () => {
		const tool = createSkillDataReadTool(store, "bodybuilding", dataNamespaces);

		const result = await tool.execute("call-1", { namespace: "../training_log" });

		expect(parseTextResult(result)).toMatchObject({
			error: expect.stringContaining("invalid namespace"),
		});
	});

	it("appends without mutating the cached array instance", async () => {
		const writeTool = createSkillDataWriteTool(store, "bodybuilding", dataNamespaces);
		await store.save("bodybuilding/training_log", [{ id: "existing" }]);
		const before = await store.load<Array<{ id: string }>>("bodybuilding/training_log");

		const result = await writeTool.execute("call-1", {
			namespace: "training_log",
			data: { id: "next" },
			mode: "append",
		});

		expect(parseTextResult(result)).toMatchObject({
			success: true,
			newLength: 2,
		});
		expect(before).toEqual([{ id: "existing" }]);
		expect(await store.load("bodybuilding/training_log")).toEqual([{ id: "existing" }, { id: "next" }]);
	});
});
