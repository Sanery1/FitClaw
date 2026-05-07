import { describe, expect, it } from "vitest";
import type { ExecOptions, ExecResult, Executor } from "../src/sandbox.js";
import { createBashTool } from "../src/tools/bash.js";

class RecordingExecutor implements Executor {
	commands: string[] = [];

	async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
		this.commands.push(command);
		return { stdout: "ok", stderr: "", code: 0 };
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

describe("mom bash tool", () => {
	it("blocks dangerous commands before execution", async () => {
		const executor = new RecordingExecutor();
		const tool = createBashTool(executor);

		await expect(
			tool.execute("call-1", {
				label: "delete filesystem",
				command: "rm -rf /",
			}),
		).rejects.toThrow(/SECURITY_BLOCKED/);

		expect(executor.commands).toEqual([]);
	});
});
