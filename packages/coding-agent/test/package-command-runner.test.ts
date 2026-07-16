import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackageCommandRunner } from "../src/core/package-command-runner.js";

class MockSpawnedProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();

	kill(): boolean {
		this.emit("close", null, "SIGTERM");
		return true;
	}
}

describe("PackageCommandRunner", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("avoids the shell for git so Windows paths with spaces stay single arguments", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const commandRunner = new PackageCommandRunner();

		expect(commandRunner.shouldUseWindowsShell("git")).toBe(false);
		expect(commandRunner.shouldUseWindowsShell("npm")).toBe(true);
		expect(commandRunner.shouldUseWindowsShell("pnpm")).toBe(true);
		expect(commandRunner.shouldUseWindowsShell("C:/Program Files/nodejs/npm.cmd")).toBe(true);
	});

	it("waits for close before resolving captured stdout", async () => {
		const commandRunner = new PackageCommandRunner() as unknown as {
			spawnCaptureCommand(
				command: string,
				args: string[],
				options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
			): MockSpawnedProcess;
			capture(
				command: string,
				args: string[],
				options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
			): Promise<string>;
		};
		const child = new MockSpawnedProcess();
		vi.spyOn(commandRunner, "spawnCaptureCommand").mockReturnValue(child);

		let isSettled = false;
		const capturePromise = commandRunner.capture("git", ["rev-parse", "HEAD"]).then((value) => {
			isSettled = true;
			return value;
		});

		child.emit("exit", 0, null);
		await Promise.resolve();
		expect(isSettled).toBe(false);

		child.stdout.write("abc123\n");
		child.stdout.end();
		child.emit("close", 0, null);

		await expect(capturePromise).resolves.toBe("abc123");
	});
});
