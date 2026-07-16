import { type ChildProcess, type ChildProcessByStdio, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import { isStdoutTakenOver } from "./output-guard.js";

interface RunCommandOptions {
	cwd?: string;
}

interface CaptureCommandOptions extends RunCommandOptions {
	timeoutMs?: number;
	env?: Record<string, string>;
}

function getProcessEnv(): NodeJS.ProcessEnv {
	if (process.platform !== "linux" || Object.keys(process.env).length > 0) {
		return process.env;
	}
	try {
		const data = readFileSync("/proc/self/environ", "utf-8");
		const env: NodeJS.ProcessEnv = {};
		for (const entry of data.split("\0")) {
			const index = entry.indexOf("=");
			if (index > 0) {
				env[entry.slice(0, index)] = entry.slice(index + 1);
			}
		}
		return env;
	} catch {
		return process.env;
	}
}

export class PackageCommandRunner {
	shouldUseWindowsShell(command: string): boolean {
		if (process.platform !== "win32") {
			return false;
		}
		const commandName = basename(command).toLowerCase();
		return (
			commandName === "npm" ||
			commandName === "npx" ||
			commandName === "pnpm" ||
			commandName === "yarn" ||
			commandName === "yarnpkg" ||
			commandName === "corepack" ||
			commandName.endsWith(".cmd") ||
			commandName.endsWith(".bat")
		);
	}

	run(command: string, args: string[], options?: RunCommandOptions): Promise<void> {
		return new Promise((resolvePromise, reject) => {
			const child = this.spawnCommand(command, args, options);
			child.on("error", reject);
			child.on("exit", (code) => {
				if (code === 0) {
					resolvePromise();
				} else {
					reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
				}
			});
		});
	}

	capture(command: string, args: string[], options?: CaptureCommandOptions): Promise<string> {
		return new Promise((resolvePromise, reject) => {
			const child = this.spawnCaptureCommand(command, args, options);
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timeout =
				typeof options?.timeoutMs === "number"
					? setTimeout(() => {
							timedOut = true;
							child.kill();
						}, options.timeoutMs)
					: undefined;

			child.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			child.stderr?.on("data", (data) => {
				stderr += data.toString();
			});
			child.once("error", (error) => {
				if (timeout) clearTimeout(timeout);
				reject(error);
			});
			child.once("close", (code, signal) => {
				if (timeout) clearTimeout(timeout);
				if (timedOut) {
					reject(new Error(`${command} ${args.join(" ")} timed out after ${options?.timeoutMs}ms`));
					return;
				}
				if (code === 0) {
					resolvePromise(stdout.trim());
					return;
				}
				const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
				reject(new Error(`${command} ${args.join(" ")} failed with ${exitStatus}: ${stderr || stdout}`));
			});
		});
	}

	runSync(command: string, args: string[]): string {
		const result = spawnSync(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf-8",
			shell: this.shouldUseWindowsShell(command),
			env: getProcessEnv(),
		});
		if (result.error || result.status !== 0) {
			throw new Error(
				`Failed to run ${command} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`,
			);
		}
		return (result.stdout || result.stderr || "").trim();
	}

	private spawnCommand(command: string, args: string[], options?: RunCommandOptions): ChildProcess {
		return spawn(command, args, {
			cwd: options?.cwd,
			stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit",
			shell: this.shouldUseWindowsShell(command),
			env: getProcessEnv(),
		});
	}

	private spawnCaptureCommand(
		command: string,
		args: string[],
		options?: CaptureCommandOptions,
	): ChildProcessByStdio<null, Readable, Readable> {
		const baseEnv = getProcessEnv();
		return spawn(command, args, {
			cwd: options?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: this.shouldUseWindowsShell(command),
			env: options?.env ? { ...baseEnv, ...options.env } : baseEnv,
		});
	}
}
