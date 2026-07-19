import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSkillDataStore } from "../src/index.js";

describe("FileSkillDataStore", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `fitclaw-sport-data-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects namespaces that escape sport-data", async () => {
		const store = new FileSkillDataStore(tempDir);

		await expect(store.save("../escape", { secret: true })).rejects.toThrow(/invalid namespace/i);

		await expect(readFile(join(tempDir, "escape.json"), "utf-8")).rejects.toThrow();
	});

	it("throws when existing JSON is corrupt", async () => {
		const dataDir = join(tempDir, "sport-data", "bodybuilding");
		await mkdir(dataDir, { recursive: true });
		await writeFile(join(dataDir, "training_log.json"), "{not json", "utf-8");

		const store = new FileSkillDataStore(tempDir);

		await expect(store.load("bodybuilding/training_log")).rejects.toThrow(/invalid JSON/i);
	});

	it("uses atomic replacement and leaves no temporary or lock files", async () => {
		const store = new FileSkillDataStore(tempDir);
		await store.save("bodybuilding/training_log", [{ id: "first" }]);
		await store.save("bodybuilding/training_log", [{ id: "first" }, { id: "second" }]);

		const dataDir = join(tempDir, "sport-data", "bodybuilding");
		expect(JSON.parse(await readFile(join(dataDir, "training_log.json"), "utf-8"))).toEqual([
			{ id: "first" },
			{ id: "second" },
		]);
		expect(readdirSync(dataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		expect(existsSync(join(dataDir, "training_log.json.lock"))).toBe(false);
	});

	it("uses independent locks for different namespaces", async () => {
		const store = new FileSkillDataStore(tempDir);
		const trainingLogPath = join(tempDir, "sport-data", "bodybuilding", "training_log.json");
		await store.save("bodybuilding/training_log", []);
		const release = await lockfile.lock(trainingLogPath, { realpath: false });
		try {
			await expect(store.save("bodybuilding/user_profile", { goal: "strength" })).resolves.toBeUndefined();
		} finally {
			await release();
		}
	});

	it("serializes read-modify-write updates across store instances", async () => {
		const namespace = "bodybuilding/training_log";
		const seedStore = new FileSkillDataStore(tempDir);
		await seedStore.save(namespace, []);

		const firstStore = new FileSkillDataStore(tempDir);
		const secondStore = new FileSkillDataStore(tempDir);
		await Promise.all([firstStore.load(namespace), secondStore.load(namespace)]);

		await Promise.all([
			firstStore.update<Array<{ id: string }>>(namespace, (current) => [...(current ?? []), { id: "first" }]),
			secondStore.update<Array<{ id: string }>>(namespace, (current) => [...(current ?? []), { id: "second" }]),
		]);

		const persisted = await new FileSkillDataStore(tempDir).load<Array<{ id: string }>>(namespace);
		expect(persisted).toHaveLength(2);
		expect(persisted).toEqual(expect.arrayContaining([{ id: "first" }, { id: "second" }]));
	});

	it("reloads disk changes while read keeps the last snapshot", async () => {
		const namespace = "bodybuilding/training_log";
		const reader = new FileSkillDataStore(tempDir);
		const writer = new FileSkillDataStore(tempDir);
		const initial = [{ id: "initial" }];
		const updated = [...initial, { id: "updated" }];

		await writer.save(namespace, initial);
		expect(await reader.load(namespace)).toEqual(initial);

		await writer.save(namespace, updated);
		expect(reader.read(namespace)).toEqual(initial);
		expect(await reader.load(namespace)).toEqual(updated);
		expect(reader.read(namespace)).toEqual(updated);
	});

	it("rejects asynchronous updaters without changing persisted data", async () => {
		const namespace = "bodybuilding/training_log";
		const store = new FileSkillDataStore(tempDir);
		const initial = [{ id: "initial" }];
		await store.save(namespace, initial);

		const asyncUpdater = async (current: Array<{ id: string }> | null) => [...(current ?? []), { id: "invalid" }];
		await expect(
			// @ts-expect-error Skill data updaters must return synchronously.
			store.update<Array<{ id: string }>>(namespace, asyncUpdater),
		).rejects.toThrow(/synchronously/i);

		const freshStore = new FileSkillDataStore(tempDir);
		expect(await freshStore.load(namespace)).toEqual(initial);
	});
});
