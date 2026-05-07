import { mkdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSportDataStore } from "../src/core/tools/fitness/sport-data-store.js";

describe("FileSportDataStore", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `fitclaw-sport-data-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects namespaces that escape sport-data", async () => {
		const store = new FileSportDataStore(tempDir);

		await expect(store.save("../escape", { secret: true })).rejects.toThrow(/invalid namespace/i);

		await expect(readFile(join(tempDir, "escape.json"), "utf-8")).rejects.toThrow();
	});

	it("throws when existing JSON is corrupt", async () => {
		const dataDir = join(tempDir, "sport-data", "bodybuilding");
		await mkdir(dataDir, { recursive: true });
		await writeFile(join(dataDir, "training_log.json"), "{not json", "utf-8");

		const store = new FileSportDataStore(tempDir);

		await expect(store.load("bodybuilding/training_log")).rejects.toThrow(/invalid JSON/i);
	});
});
