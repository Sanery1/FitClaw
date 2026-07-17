import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createSkillDataReadTool,
	createSkillDataWriteTool,
	FileSkillDataStore,
	type SkillDataDeclaration,
} from "../src/index.js";

function parseTextResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
	const text = result.content.find((part) => part.type === "text")?.text;
	if (!text) {
		throw new Error("Expected text result");
	}
	return JSON.parse(text) as Record<string, unknown>;
}

describe("skill data tools", () => {
	let tempDir: string;
	let store: FileSkillDataStore;
	let dataNamespaces: Map<string, SkillDataDeclaration>;

	beforeEach(() => {
		tempDir = join(tmpdir(), `fitclaw-skill-data-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		store = new FileSkillDataStore(tempDir);
		dataNamespaces = new Map<string, SkillDataDeclaration>([
			[
				"user_profile",
				{
					type: "object",
					schema: {
						type: "object",
						required: ["goal", "experience_level"],
						properties: {
							goal: { type: "string" },
							experience_level: { type: "string" },
						},
					},
				},
			],
			[
				"training_log",
				{
					type: "array",
					schema: {
						type: "array",
						items: {
							type: "object",
							required: ["id"],
							properties: { id: { type: "string" } },
						},
					},
				},
			],
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

	it("rejects schema-invalid replacements without changing persisted data", async () => {
		const writeTool = createSkillDataWriteTool(store, "bodybuilding", dataNamespaces);
		const existing = { goal: "strength", experience_level: "intermediate" };
		await store.save("bodybuilding/user_profile", existing);

		const result = await writeTool.execute("call-1", {
			namespace: "user_profile",
			data: { goal: "hypertrophy" },
			mode: "replace",
		});

		expect(parseTextResult(result)).toMatchObject({
			error: expect.stringContaining('data for "user_profile" does not match its declared schema'),
			issues: [
				expect.objectContaining({
					instance_path: "",
					keyword: "required",
				}),
			],
		});
		expect(await store.load("bodybuilding/user_profile")).toEqual(existing);
	});

	it("persists schema-valid replacements", async () => {
		const writeTool = createSkillDataWriteTool(store, "bodybuilding", dataNamespaces);
		const profile = { goal: "hypertrophy", experience_level: "beginner" };

		const result = await writeTool.execute("call-1", {
			namespace: "user_profile",
			data: profile,
			mode: "replace",
		});

		expect(parseTextResult(result)).toMatchObject({ success: true, mode: "replace" });
		expect(await store.load("bodybuilding/user_profile")).toEqual(profile);
	});

	it("rejects appends when the resulting array violates its schema", async () => {
		const writeTool = createSkillDataWriteTool(store, "bodybuilding", dataNamespaces);
		const existing = [{ id: "existing" }];
		await store.save("bodybuilding/training_log", existing);

		const result = await writeTool.execute("call-1", {
			namespace: "training_log",
			data: { note: "missing id" },
			mode: "append",
		});

		expect(parseTextResult(result)).toMatchObject({
			error: expect.stringContaining('data for "training_log" does not match its declared schema'),
			issues: [expect.objectContaining({ keyword: "required" })],
		});
		expect(await store.load("bodybuilding/training_log")).toEqual(existing);
	});
});
