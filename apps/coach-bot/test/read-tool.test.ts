import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExecutor, type ExecOptions, type ExecResult, type Executor } from "../src/sandbox.js";
import { createReadTool } from "../src/tools/read.js";

class MemoryExecutor implements Executor {
	readonly readPaths: string[] = [];
	readonly aliases = new Map<string, string>();
	readonly files = new Map<string, Buffer>();

	async exec(_command: string, _options?: ExecOptions): Promise<ExecResult> {
		throw new Error("shell execution is not expected");
	}

	async execFile(_executable: string, _args: readonly string[], _options?: ExecOptions): Promise<ExecResult> {
		throw new Error("process execution is not expected");
	}

	async resolvePath(path: string): Promise<string> {
		return this.aliases.get(path) ?? path;
	}

	async readFile(path: string): Promise<Buffer> {
		this.readPaths.push(path);
		const content = this.files.get(path);
		if (!content) throw new Error(`Missing test file: ${path}`);
		return content;
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

describe("coach bot read tool", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories) {
			rmSync(directory, { recursive: true, force: true });
		}
		temporaryDirectories.length = 0;
	});

	it("reads text inside a Skill root without shell execution", async () => {
		const executor = new MemoryExecutor();
		const filePath = "/workspace/skills/bodybuilding/references/guide.md";
		executor.files.set(filePath, Buffer.from("alpha\nbeta\ngamma", "utf-8"));
		const tool = createReadTool(executor, ["/workspace/skills/bodybuilding"]);

		const result = await tool.execute("call-1", {
			label: "read guide",
			path: filePath,
			offset: 2,
			limit: 1,
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: "beta\n\n[1 more lines in file. Use offset=3 to continue]",
		});
		expect(executor.readPaths).toEqual([filePath]);
	});

	it("rejects relative, outside, and symlink-escaped paths before reading", async () => {
		const executor = new MemoryExecutor();
		const skillRoot = "/workspace/skills/bodybuilding";
		const outsidePath = "/workspace/private.env";
		const escapedPath = `${skillRoot}/../private.env`;
		const linkedPath = `${skillRoot}/references/private.env`;
		executor.aliases.set(linkedPath, outsidePath);
		const tool = createReadTool(executor, [skillRoot]);

		await expect(tool.execute("relative", { label: "relative", path: "references/guide.md" })).rejects.toThrow(
			/SECURITY_BLOCKED/,
		);
		await expect(tool.execute("outside", { label: "outside", path: outsidePath })).rejects.toThrow(
			/SECURITY_BLOCKED/,
		);
		await expect(tool.execute("escaped", { label: "escaped", path: escapedPath })).rejects.toThrow(
			/SECURITY_BLOCKED/,
		);
		await expect(tool.execute("symlink", { label: "symlink", path: linkedPath })).rejects.toThrow(/SECURITY_BLOCKED/);
		expect(executor.readPaths).toEqual([]);
	});

	it("returns image bytes from the executor", async () => {
		const executor = new MemoryExecutor();
		const imagePath = "/workspace/skills/bodybuilding/assets/example.png";
		const imageBytes = Buffer.from([0, 1, 2, 3, 255]);
		executor.files.set(imagePath, imageBytes);
		const tool = createReadTool(executor, ["/workspace/skills/bodybuilding"]);

		const result = await tool.execute("image", { label: "read image", path: imagePath });

		expect(result.content).toEqual([
			{ type: "text", text: "Read image file [image/png]" },
			{ type: "image", data: imageBytes.toString("base64"), mimeType: "image/png" },
		]);
	});

	it("reads host files through the native executor", async () => {
		const skillRoot = join(tmpdir(), `fitclaw-read-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		temporaryDirectories.push(skillRoot);
		mkdirSync(skillRoot, { recursive: true });
		const filePath = join(skillRoot, "SKILL.md");
		writeFileSync(filePath, "native host read\n", "utf-8");
		const tool = createReadTool(createExecutor({ type: "host" }), [skillRoot]);

		const result = await tool.execute("host", { label: "read skill", path: filePath });

		expect(result.content[0]).toEqual({ type: "text", text: "native host read\n" });
	});
});
