import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageInstallLayout } from "../src/core/package-install-layout.js";
import { PackageSourceResolver } from "../src/core/package-source-resolver.js";
import { PackageUpdateChecker, runWithConcurrency } from "../src/core/package-update-checker.js";

describe("PackageUpdateChecker", () => {
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "fitclaw-update-checker-"));
		agentDir = join(cwd, "agent");
		mkdirSync(agentDir);
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	function createChecker(isOfflineModeEnabled = false) {
		const getNpmCommand = () => ({ command: "npm", args: [] });
		const runCommandCapture = vi.fn(async () => '"1.2.3"');
		const installLayout = new PackageInstallLayout({
			cwd,
			agentDir,
			getNpmCommand,
			runCommandSync: () => join(agentDir, "node_modules"),
		});
		const sourceResolver = new PackageSourceResolver({ cwd, agentDir });
		const updateChecker = new PackageUpdateChecker({
			cwd,
			networkTimeoutMs: 10_000,
			updateCheckConcurrency: 2,
			installLayout,
			sourceResolver,
			getNpmCommand,
			isOfflineModeEnabled: () => isOfflineModeEnabled,
			runCommand: async () => {},
			runCommandCapture,
		});
		return { installLayout, runCommandCapture, updateChecker };
	}

	it("reports updates for installed project npm packages", async () => {
		const { installLayout, runCommandCapture, updateChecker } = createChecker();
		const source = { type: "npm", spec: "example", name: "example", pinned: false } as const;
		const installedPath = installLayout.getNpmInstallPath(source, "project");
		mkdirSync(installedPath, { recursive: true });
		writeFileSync(join(installedPath, "package.json"), JSON.stringify({ name: "example", version: "1.0.0" }));

		await expect(updateChecker.checkForAvailableUpdates([], ["npm:example"])).resolves.toEqual([
			{
				source: "npm:example",
				displayName: "example",
				type: "npm",
				scope: "project",
			},
		]);
		expect(runCommandCapture).toHaveBeenCalledWith(
			"npm",
			["view", "example", "version", "--json"],
			expect.objectContaining({ cwd, timeoutMs: 10_000 }),
		);
	});

	it("does not inspect packages in offline mode", async () => {
		const { runCommandCapture, updateChecker } = createChecker(true);

		await expect(updateChecker.checkForAvailableUpdates([], ["npm:example"])).resolves.toEqual([]);
		expect(runCommandCapture).not.toHaveBeenCalled();
	});

	it("matches installed versions for pinned npm sources", async () => {
		const { updateChecker } = createChecker();
		const installedPath = join(cwd, "installed-package");
		mkdirSync(installedPath);
		writeFileSync(join(installedPath, "package.json"), JSON.stringify({ name: "example", version: "1.2.3" }));

		await expect(
			updateChecker.installedNpmMatchesPinnedVersion(
				{ type: "npm", spec: "example@1.2.3", name: "example", pinned: true },
				installedPath,
			),
		).resolves.toBe(true);
		await expect(
			updateChecker.installedNpmMatchesPinnedVersion(
				{ type: "npm", spec: "example@2.0.0", name: "example", pinned: true },
				installedPath,
			),
		).resolves.toBe(false);
	});

	it("limits concurrent checks while preserving result order", async () => {
		let activeTasks = 0;
		let maxActiveTasks = 0;
		const tasks = [0, 1, 2, 3].map((index) => async () => {
			activeTasks += 1;
			maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeTasks -= 1;
			return index;
		});

		await expect(runWithConcurrency(tasks, 2)).resolves.toEqual([0, 1, 2, 3]);
		expect(maxActiveTasks).toBe(2);
	});
});
