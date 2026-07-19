import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MemoryMigrationManifest, migrateCoachMemory } from "../src/memory-migration.js";

const canCreateDirectoryLinks = detectDirectoryLinkSupport();

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

	it("preflights every source before writing any destination", async () => {
		writeFileSync(
			join(workspaceDir, "oc_private_a", "sport-data", "bodybuilding", "z-invalid.json"),
			"not json",
			"utf-8",
		);

		await expect(migrateCoachMemory({ workspaceDir, manifest, apply: true })).rejects.toThrow(/Invalid JSON/);

		expect(existsSync(join(workspaceDir, "tenants"))).toBe(false);
	});

	it("accumulates repeated destinations in dry-run exactly as apply does", async () => {
		const secondSourceDir = join(workspaceDir, "oc_private_b");
		mkdirSync(join(secondSourceDir, "sport-data", "bodybuilding"), { recursive: true });
		writeFileSync(
			join(secondSourceDir, "context.jsonl"),
			`${JSON.stringify({ type: "message", id: "first" })}\n${JSON.stringify({ type: "message", id: "third" })}\n`,
			"utf-8",
		);
		writeFileSync(
			join(secondSourceDir, "sport-data", "bodybuilding", "training_log.json"),
			JSON.stringify([{ exercise: "deadlift", sets: 3, reps: 3 }]),
			"utf-8",
		);
		const repeatedDestinationManifest: MemoryMigrationManifest = {
			version: 1,
			sessions: [
				...manifest.sessions,
				{
					chatId: "oc_private_a",
					tenantKey: "tenant_a",
					openId: "ou_user_a",
					kind: "dm",
					legacyPath: "oc_private_b",
				},
			],
		};

		const dryRun = await migrateCoachMemory({ workspaceDir, manifest: repeatedDestinationManifest });
		const apply = await migrateCoachMemory({ workspaceDir, manifest: repeatedDestinationManifest, apply: true });

		expect(dryRun.operations).toEqual(apply.operations);
		expect(dryRun.operations.filter((operation) => operation.type === "session")[1]).toMatchObject({
			action: "merge",
			itemCount: 3,
		});
		expect(dryRun.operations.filter((operation) => operation.type === "sport_data")[1]).toMatchObject({
			action: "merge",
			itemCount: 2,
		});
		const userDir = join(workspaceDir, "tenants", "tenant_a", "users", "ou_user_a");
		expect(
			readFileSync(join(userDir, "sessions", "oc_private_a", "context.jsonl"), "utf-8")
				.trim()
				.split("\n"),
		).toHaveLength(3);
		expect(
			JSON.parse(readFileSync(join(userDir, "sport-data", "bodybuilding", "training_log.json"), "utf-8")),
		).toHaveLength(2);
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
		expect(
			existsSync(
				join(
					workspaceDir,
					"tenants",
					"tenant_a",
					"users",
					"ou_user_a",
					"sessions",
					"oc_private_a",
					"context.jsonl",
				),
			),
		).toBe(false);
		const report = await migrateCoachMemory({ workspaceDir, manifest, apply: true, conflictStrategy: "legacy" });
		expect(JSON.parse(readFileSync(destinationProfile, "utf-8"))).toEqual({ goal: "strength" });
		expect(report.operations.find((operation) => operation.source === sourceProfile)?.action).toBe("replace");
	});

	it("detects conflicts between sources sharing a virtual destination", async () => {
		writeFileSync(
			join(workspaceDir, "oc_private_a", "sport-data", "bodybuilding", "user_profile.json"),
			'{"goal":"strength"}',
		);
		const secondSourceDir = join(workspaceDir, "oc_private_b", "sport-data", "bodybuilding");
		mkdirSync(secondSourceDir, { recursive: true });
		writeFileSync(join(secondSourceDir, "user_profile.json"), '{"goal":"hypertrophy"}');
		const conflictingManifest: MemoryMigrationManifest = {
			version: 1,
			sessions: [
				...manifest.sessions,
				{
					chatId: "oc_private_b",
					tenantKey: "tenant_a",
					openId: "ou_user_a",
					kind: "dm",
				},
			],
		};

		await expect(migrateCoachMemory({ workspaceDir, manifest: conflictingManifest })).rejects.toThrow(/--conflict/);
		await expect(migrateCoachMemory({ workspaceDir, manifest: conflictingManifest, apply: true })).rejects.toThrow(
			/--conflict/,
		);
		expect(existsSync(join(workspaceDir, "tenants"))).toBe(false);
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

	it.skipIf(!canCreateDirectoryLinks)("rejects a legacy source symlink that escapes the workspace", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "fitclaw-migration-outside-"));
		try {
			writeFileSync(join(outsideDir, "context.jsonl"), `${JSON.stringify({ type: "message", id: "outside" })}\n`);
			const linkedSource = join(workspaceDir, "oc_external_alias");
			createDirectoryLink(outsideDir, linkedSource);
			const unsafeManifest: MemoryMigrationManifest = {
				version: 1,
				sessions: [
					{
						chatId: "oc_external_alias",
						tenantKey: "tenant_a",
						openId: "ou_user_a",
						kind: "dm",
					},
				],
			};

			await expect(migrateCoachMemory({ workspaceDir, manifest: unsafeManifest })).rejects.toThrow(/symbolic link/);
		} finally {
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it.skipIf(!canCreateDirectoryLinks)("detects aliases of one real source mapped to multiple users", async () => {
		createDirectoryLink(join(workspaceDir, "oc_private_a"), join(workspaceDir, "oc_private_alias"));
		const unsafeManifest: MemoryMigrationManifest = {
			version: 1,
			sessions: [
				...manifest.sessions,
				{
					chatId: "oc_private_alias",
					tenantKey: "tenant_a",
					openId: "ou_user_b",
					kind: "dm",
				},
			],
		};

		await expect(migrateCoachMemory({ workspaceDir, manifest: unsafeManifest })).rejects.toThrow(/multiple users/);
	});

	it.skipIf(!canCreateDirectoryLinks)(
		"rejects internal source symlinks instead of silently omitting data",
		async () => {
			const linkedDataDir = join(workspaceDir, "oc_private_a", "linked-sport-data");
			mkdirSync(linkedDataDir);
			writeFileSync(join(linkedDataDir, "linked.json"), '[{"exercise":"row"}]');
			createDirectoryLink(linkedDataDir, join(workspaceDir, "oc_private_a", "sport-data", "bodybuilding", "linked"));

			await expect(migrateCoachMemory({ workspaceDir, manifest, apply: true })).rejects.toThrow(
				/source symbolic links are not supported/,
			);
			expect(existsSync(join(workspaceDir, "tenants"))).toBe(false);
		},
	);

	it.skipIf(!canCreateDirectoryLinks)(
		"rejects an escaping destination parent symlink before applying earlier operations",
		async () => {
			const outsideDir = mkdtempSync(join(tmpdir(), "fitclaw-migration-destination-outside-"));
			const groupDir = join(workspaceDir, "oc_group_destination");
			mkdirSync(join(groupDir, "sport-data", "bodybuilding"), { recursive: true });
			writeFileSync(join(groupDir, "context.jsonl"), `${JSON.stringify({ type: "message", id: "group" })}\n`);
			writeFileSync(join(groupDir, "sport-data", "bodybuilding", "user_profile.json"), '{"goal":"strength"}');
			createDirectoryLink(outsideDir, join(workspaceDir, "tenants"));
			const groupManifest: MemoryMigrationManifest = {
				version: 1,
				sessions: [
					{
						chatId: "oc_group_destination",
						tenantKey: "tenant_a",
						openId: "ou_user_a",
						kind: "group",
						confirmedPersonalData: true,
					},
				],
			};

			try {
				await expect(migrateCoachMemory({ workspaceDir, manifest: groupManifest, apply: true })).rejects.toThrow(
					/destination symbolic links are not supported/,
				);
				expect(existsSync(join(workspaceDir, "migration-archive"))).toBe(false);
				expect(existsSync(join(outsideDir, "tenant_a"))).toBe(false);
			} finally {
				rmSync(join(workspaceDir, "tenants"), { recursive: true, force: true });
				rmSync(outsideDir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!canCreateDirectoryLinks)("rejects a destination link into another user's directory", async () => {
		const usersDir = join(workspaceDir, "tenants", "tenant_a", "users");
		const otherUserDir = join(usersDir, "ou_user_b");
		mkdirSync(otherUserDir, { recursive: true });
		createDirectoryLink(otherUserDir, join(usersDir, "ou_user_a"));

		await expect(migrateCoachMemory({ workspaceDir, manifest, apply: true })).rejects.toThrow(
			/destination symbolic links are not supported/,
		);
		expect(existsSync(join(otherUserDir, "sessions"))).toBe(false);
		expect(existsSync(join(otherUserDir, "sport-data"))).toBe(false);
	});
});

function detectDirectoryLinkSupport(): boolean {
	const probeDir = mkdtempSync(join(tmpdir(), "fitclaw-link-probe-"));
	try {
		const targetDir = join(probeDir, "target");
		mkdirSync(targetDir);
		createDirectoryLink(targetDir, join(probeDir, "link"));
		return true;
	} catch (error) {
		if (isNodeError(error) && ["EACCES", "EPERM", "ENOTSUP"].includes(error.code ?? "")) return false;
		throw error;
	} finally {
		rmSync(probeDir, { recursive: true, force: true });
	}
}

function createDirectoryLink(target: string, path: string): void {
	symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
