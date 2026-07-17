import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSettingsStorage } from "../src/settings/settings-storage.js";

const lockHooks = vi.hoisted((): { beforeLock?: (path: string) => void } => ({}));

vi.mock("proper-lockfile", () => ({
	default: {
		lockSync(path: string) {
			lockHooks.beforeLock?.(path);
			return (): void => {};
		},
	},
}));

describe("FileSettingsStorage", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "fitclaw-settings-storage-"));
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		lockHooks.beforeLock = undefined;
	});

	afterEach(() => {
		lockHooks.beforeLock = undefined;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reads the latest contents after locking a file that did not exist", () => {
		const settingsPath = join(agentDir, "settings.json");
		const storage = new FileSettingsStorage(projectDir, agentDir);
		lockHooks.beforeLock = (path) => {
			expect(path).toBe(settingsPath);
			writeFileSync(path, JSON.stringify({ external: true }), "utf-8");
		};

		storage.update("global", (current) => {
			const settings = current ? (JSON.parse(current) as Record<string, unknown>) : {};
			return JSON.stringify({ ...settings, local: true });
		});

		expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({ external: true, local: true });
	});

	it("does not create the project settings directory while reading", () => {
		const storage = new FileSettingsStorage(projectDir, agentDir);

		expect(storage.read("project")).toBeUndefined();
		expect(existsSync(join(projectDir, ".fitclaw"))).toBe(false);
	});
});
