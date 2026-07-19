import { describe, expect, it, vi } from "vitest";
import type { ExecOptions, ExecResult, Executor, ReadFileOptions } from "../src/sandbox.js";
import { createAttachTool } from "../src/tools/attach.js";
import type { BotUpload } from "../src/types.js";

class RecordingExecutor implements Executor {
	readonly resolvedPaths = new Map<string, string>();
	readonly readPaths: string[] = [];

	async exec(_command: string, _options?: ExecOptions): Promise<ExecResult> {
		return { stdout: "", stderr: "", code: 0 };
	}

	async execFile(_executable: string, _args: readonly string[], _options?: ExecOptions): Promise<ExecResult> {
		return { stdout: "", stderr: "", code: 0 };
	}

	async resolvePath(path: string, _options?: ExecOptions): Promise<string> {
		return this.resolvedPaths.get(path) ?? path;
	}

	async readFile(path: string, _options?: ReadFileOptions): Promise<Buffer> {
		this.readPaths.push(path);
		return Buffer.from("image-data");
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

describe("coach bot attach tool", () => {
	const skillRoot = "/workspace/skills/bodybuilding";

	it("uploads a file read through the Skill boundary", async () => {
		const executor = new RecordingExecutor();
		const uploadFile = vi.fn(async (_upload: BotUpload) => {});
		const tool = createAttachTool(executor, [skillRoot], uploadFile);
		const filePath = `${skillRoot}/assets/press.jpg`;

		const result = await tool.execute("attach", {
			label: "Share exercise image",
			path: filePath,
			title: "Incline press",
		});

		expect(executor.readPaths).toEqual([filePath]);
		expect(uploadFile).toHaveBeenCalledWith({
			data: Buffer.from("image-data"),
			fileName: "press.jpg",
			title: "Incline press",
		});
		expect(result.content[0]).toEqual({ type: "text", text: "Attached file: Incline press" });
	});

	it("rejects a Skill path whose realpath escapes the allowed root", async () => {
		const executor = new RecordingExecutor();
		const uploadFile = vi.fn(async (_upload: BotUpload) => {});
		const tool = createAttachTool(executor, [skillRoot], uploadFile);
		const filePath = `${skillRoot}/assets/escape.jpg`;
		executor.resolvedPaths.set(filePath, "/workspace/private.jpg");

		await expect(tool.execute("attach", { label: "Share exercise image", path: filePath })).rejects.toThrow(
			/SECURITY_BLOCKED/,
		);
		expect(executor.readPaths).toEqual([]);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it("does not upload when the run is aborted after reading the file", async () => {
		const controller = new AbortController();
		class AbortingExecutor extends RecordingExecutor {
			override async readFile(path: string, options?: ReadFileOptions): Promise<Buffer> {
				const data = await super.readFile(path, options);
				controller.abort();
				return data;
			}
		}
		const executor = new AbortingExecutor();
		const uploadFile = vi.fn(async (_upload: BotUpload) => {});
		const tool = createAttachTool(executor, [skillRoot], uploadFile);

		await expect(
			tool.execute(
				"attach",
				{ label: "Share exercise image", path: `${skillRoot}/assets/press.jpg` },
				controller.signal,
			),
		).rejects.toThrow();
		expect(uploadFile).not.toHaveBeenCalled();
	});
});
