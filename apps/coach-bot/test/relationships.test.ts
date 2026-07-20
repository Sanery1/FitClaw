import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelationship, FileCoachRelationshipStore } from "../src/relationships.js";
import { resolveCoachUserScope } from "../src/runtime/coach-scope.js";

describe("FileCoachRelationshipStore personalities", () => {
	let workspaceDir: string;
	const event = { tenantKey: "tenant_a", openId: "ou_user_a" };

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-relationships-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	});

	afterEach(async () => rm(workspaceDir, { recursive: true, force: true }));

	it("persists a selected personality and selection state", async () => {
		const scope = resolveCoachUserScope(workspaceDir, event);
		const store = new FileCoachRelationshipStore();
		const relationship = createRelationship(scope, "active", "2026-07-20T00:00:00.000Z", {
			personalityId: "strict",
			personalitySelectionPending: false,
		});

		await store.save(scope, relationship);

		expect(await store.load(scope)).toMatchObject({
			personalityId: "strict",
			personalitySelectionPending: false,
		});
	});

	it("loads legacy relationships without assigning a default personality", async () => {
		const scope = resolveCoachUserScope(workspaceDir, event);
		const store = new FileCoachRelationshipStore();
		await store.save(scope, createRelationship(scope, "active", "2026-07-20T00:00:00.000Z"));

		const loaded = await store.load(scope);

		expect(loaded?.personalityId).toBeUndefined();
		expect(loaded?.personalitySelectionPending).toBeUndefined();
	});

	it("rejects an unknown personality ID from persisted input", async () => {
		const scope = resolveCoachUserScope(workspaceDir, event);
		await mkdir(scope.userDir, { recursive: true });
		await writeFile(
			join(scope.userDir, "relationship.json"),
			JSON.stringify({
				version: 1,
				tenantKey: scope.tenantKey,
				openId: scope.openId,
				status: "active",
				personalityId: "cheerful",
				trainingRemindersEnabled: false,
				updatedAt: "2026-07-20T00:00:00.000Z",
			}),
			"utf-8",
		);

		await expect(new FileCoachRelationshipStore().load(scope)).rejects.toThrow("Invalid relationship personality");
	});
});
