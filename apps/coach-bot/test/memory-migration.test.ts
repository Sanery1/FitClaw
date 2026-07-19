import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MemoryMigrationManifest, migrateCoachMemory } from "../src/memory-migration.js";

describe("coach memory migration", () => {
	let workspaceDir: string;
	const manifest: MemoryMigrationManifest = {
		version: 1,
		sessions: [{ chatId: "oc_private_a", tenantKey: "tenant_a", openId: "ou_user_a", kind: "dm" }],
	};

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const legacyDir = join(workspaceDir, "oc_private_a");
		mkdirSync(join(legacyDir, "sport-data", "bodybuilding"), { recursive: true });
		writeFileSync(
			join(legacyDir, "context.jsonl"),
			`${JSON.stringify({ type: "message", id: "first" })}\n${JSON.stringify({ type: "message", id: "second" })}\n`,
			"utf-8",
		);
		writeFileSync(
			join(legacyDir, "sport-data", "bodybuilding", "training_log.json"),
			JSON.stringify([{ exercise: "squat", sets: 5, reps: 5 }]),
			"utf-8",
		);
	});

	afterEach(() => rmSync(workspaceDir, { recursive: true, force: true }));

	it("is dry-run by default and does not create tenant data", async () => {
		const report = await migrateCoachMemory({ workspaceDir, manifest });

		expect(report.mode).toBe("dry-run");
		expect(report.operations.map((operation) => operation.type)).toEqual(["session", "sport_data"]);
		expect(existsSync(join(workspaceDir, "tenants"))).toBe(false);
	});

	it("copies private history and deduplicates repeated applies", async () => {
		await migrateCoachMemory({ workspaceDir, manifest, apply: true });
		await migrateCoachMemory({ workspaceDir, manifest, apply: true });

		const userDir = join(workspaceDir, "tenants", "tenant_a", "users", "ou_user_a");
		const contextLines = readFileSync(join(userDir, "sessions", "oc_private_a", "context.jsonl"), "utf-8")
			.trim()
			.split("\n");
		const trainingLog = JSON.parse(
			readFileSync(join(userDir, "sport-data", "bodybuilding", "training_log.json"), "utf-8"),
		) as unknown[];
		expect(contextLines).toHaveLength(2);
		expect(trainingLog).toHaveLength(1);
		expect(existsSync(join(workspaceDir, "oc_private_a", "context.jsonl"))).toBe(true);
	});

	it("archives group history and skips unconfirmed personal data", async () => {
		const groupDir = join(workspaceDir, "oc_group_a", "ou_user_a");
		mkdirSync(join(groupDir, "sport-data", "bodybuilding"), { recursive: true });
		writeFileSync(join(groupDir, "context.jsonl"), `${JSON.stringify({ type: "message", id: "group" })}\n`);
		writeFileSync(join(groupDir, "sport-data", "bodybuilding", "user_profile.json"), '{"goal":"strength"}');
		const groupManifest: MemoryMigrationManifest = {
			version: 1,
			sessions: [
				{
					chatId: "oc_group_a",
					tenantKey: "tenant_a",
					openId: "ou_user_a",
					kind: "group",
					legacyPath: "oc_group_a/ou_user_a",
				},
			],
		};

		const report = await migrateCoachMemory({ workspaceDir, manifest: groupManifest, apply: true });

		expect(
			existsSync(join(workspaceDir, "migration-archive", "groups", "oc_group_a", "ou_user_a", "context.jsonl")),
		).toBe(true);
		expect(existsSync(join(workspaceDir, "tenants", "tenant_a", "users", "ou_user_a", "sport-data"))).toBe(false);
		expect(report.warnings[0]).toContain("Skipped unconfirmed group sport data");
	});

	it("stops on conflicting object data unless a source is selected", async () => {
		const sourceProfile = join(workspaceDir, "oc_private_a", "sport-data", "bodybuilding", "user_profile.json");
		writeFileSync(sourceProfile, '{"goal":"strength"}');
		const destinationProfile = join(
			workspaceDir,
			"tenants",
			"tenant_a",
			"users",
			"ou_user_a",
			"sport-data",
			"bodybuilding",
			"user_profile.json",
		);
		mkdirSync(dirname(destinationProfile), { recursive: true });
		writeFileSync(destinationProfile, '{"goal":"hypertrophy"}');

		await expect(migrateCoachMemory({ workspaceDir, manifest, apply: true })).rejects.toThrow(/--conflict/);
		await migrateCoachMemory({ workspaceDir, manifest, apply: true, conflictStrategy: "legacy" });
		expect(JSON.parse(readFileSync(destinationProfile, "utf-8"))).toEqual({ goal: "strength" });
	});

	it("maps legacy fitness-data namespaces and prefers canonical sport-data sources", async () => {
		writeFileSync(
			join(workspaceDir, "oc_private_a", "fitness-data.json"),
			JSON.stringify({
				workouts: [{ exercise: "legacy press" }],
				metrics: [{ date: "2026-07-01", weight: 80 }],
				plan: {
					goal: "muscle_gain",
					experienceLevel: "intermediate",
					availableEquipment: ["dumbbell"],
					daysPerWeek: 3,
				},
			}),
			"utf-8",
		);

		const report = await migrateCoachMemory({ workspaceDir, manifest, apply: true });
		const bodybuildingDir = join(
			workspaceDir,
			"tenants",
			"tenant_a",
			"users",
			"ou_user_a",
			"sport-data",
			"bodybuilding",
		);
		expect(JSON.parse(readFileSync(join(bodybuildingDir, "training_log.json"), "utf-8"))).toEqual([
			{ exercise: "squat", sets: 5, reps: 5 },
		]);
		expect(JSON.parse(readFileSync(join(bodybuildingDir, "body_metrics.json"), "utf-8"))).toEqual([
			{ date: "2026-07-01", weight: 80 },
		]);
		expect(JSON.parse(readFileSync(join(bodybuildingDir, "user_profile.json"), "utf-8"))).toMatchObject({
			goal: "muscle_gain",
			experience: "intermediate",
			training_days_per_week: 3,
		});
		expect(report.warnings.some((warning) => warning.includes("canonical sport-data exists"))).toBe(true);
	});

	it("rejects one legacy source mapped to multiple users", async () => {
		const unsafeManifest: MemoryMigrationManifest = {
			version: 1,
			sessions: [
				...manifest.sessions,
				{ chatId: "oc_private_a", tenantKey: "tenant_a", openId: "ou_user_b", kind: "dm" },
			],
		};

		await expect(migrateCoachMemory({ workspaceDir, manifest: unsafeManifest })).rejects.toThrow(/multiple users/);
	});
});
