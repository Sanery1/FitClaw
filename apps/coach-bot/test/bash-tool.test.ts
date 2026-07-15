import { describe, expect, it } from "vitest";
import { createExecutor, type ExecOptions, type ExecResult, type Executor } from "../src/sandbox.js";
import { createBashTool } from "../src/tools/bash.js";

class RecordingExecutor implements Executor {
	commands: string[] = [];
	fileCommands: Array<{ executable: string; args: readonly string[] }> = [];

	async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
		this.commands.push(command);
		return { stdout: "ok", stderr: "", code: 0 };
	}

	async execFile(executable: string, args: readonly string[], _options?: ExecOptions): Promise<ExecResult> {
		this.fileCommands.push({ executable, args });
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
	const allowedCommands = [{ executable: "python", argumentPrefix: ["/workspace/scripts/query.py"] }];

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

	it("passes metacharacters literally through the host executor", async () => {
		const argumentPrefix = ["-e", "process.stdout.write(process.argv[1])"];
		const tool = createBashTool(createExecutor({ type: "host" }), [{ executable: process.execPath, argumentPrefix }]);

		const result = await tool.execute("host", {
			label: "literal argument",
			command: process.execPath,
			args: [...argumentPrefix, "value && echo unsafe"],
		});

		expect(result.content[0]).toEqual({ type: "text", text: "value && echo unsafe" });
	});
});
