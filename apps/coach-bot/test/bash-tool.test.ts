import { describe, expect, it } from "vitest";
import type { ExecOptions, ExecResult, Executor } from "../src/sandbox.js";
import { createBashTool } from "../src/tools/bash.js";

class RecordingExecutor implements Executor {
	commands: string[] = [];
	fileCommands: Array<{ executable: string; args: readonly string[]; options?: ExecOptions }> = [];

	async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
		this.commands.push(command);
		return { stdout: "ok", stderr: "", code: 0 };
	}

	async execFile(executable: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> {
		this.fileCommands.push({ executable, args, options });
		return { stdout: "ok", stderr: "", code: 0 };
	}

	async resolvePath(path: string): Promise<string> {
		return path;
	}

	async readFile(_path: string): Promise<Buffer> {
		throw new Error("file reads are not expected");
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

describe("coach bot bash tool", () => {
	const allowedCommands = [
		{ executable: "python", argumentPrefix: ["/workspace/scripts/query.py"], network: "deny" as const },
	];

	it("executes an allowlisted command as a single process", async () => {
		const executor = new RecordingExecutor();
		const tool = createBashTool(executor, allowedCommands);

		await tool.execute("call-1", {
			label: "query exercises",
			command: "python",
			args: ["/workspace/scripts/query.py", "--muscle", "chest; rm -rf /"],
		});

		expect(executor.fileCommands).toEqual([
			{
				executable: "python",
				args: ["/workspace/scripts/query.py", "--muscle", "chest; rm -rf /"],
				options: { network: "deny", signal: undefined, timeout: undefined },
			},
		]);
		expect(executor.commands).toEqual([]);
	});

	it("blocks commands outside the allowlist before execution", async () => {
		const executor = new RecordingExecutor();
		const tool = createBashTool(executor, allowedCommands);

		await expect(
			tool.execute("call-1", {
				label: "run arbitrary code",
				command: "python",
				args: ["-c", "print('unsafe')"],
			}),
		).rejects.toThrow(/SECURITY_BLOCKED/);

		expect(executor.commands).toEqual([]);
		expect(executor.fileCommands).toEqual([]);
	});
});
