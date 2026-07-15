import { readFile as readHostFile, realpath, stat } from "node:fs/promises";
import { spawn } from "child_process";
import { DEFAULT_MAX_PROCESS_OUTPUT_BYTES, runProcess } from "./runtime/process.js";
import { executeSkillRunnerCommand } from "./runtime/skill-runner-client.js";

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type SandboxConfig = { type: "host" } | { type: "docker"; container: string };

export interface ExecutorOptions {
	skillRunnerSocketPath?: string | null;
}

export function parseSandboxArg(value: string): SandboxConfig {
	if (value === "host") {
		return { type: "host" };
	}
	if (value.startsWith("docker:")) {
		const container = value.slice("docker:".length);
		if (!container) {
			console.error("Error: docker sandbox requires container name (e.g., docker:fitclaw-coach-sandbox)");
			process.exit(1);
		}
		return { type: "docker", container };
	}
	console.error(`Error: Invalid sandbox type '${value}'. Use 'host' or 'docker:<container-name>'`);
	process.exit(1);
}

export async function validateSandbox(config: SandboxConfig): Promise<void> {
	if (config.type === "host") {
		return;
	}

	// Check if Docker is available
	try {
		await execSimple("docker", ["--version"]);
	} catch {
		console.error("Error: Docker is not installed or not in PATH");
		process.exit(1);
	}

	// Check if container exists and is running
	try {
		const result = await execSimple("docker", ["inspect", "-f", "{{.State.Running}}", config.container]);
		if (result.trim() !== "true") {
			console.error(`Error: Container '${config.container}' is not running.`);
			console.error(`Start it with: docker start ${config.container}`);
			process.exit(1);
		}
	} catch {
		console.error(`Error: Container '${config.container}' does not exist.`);
		console.error("Create it with: ./docker.sh create <data-dir>");
		process.exit(1);
	}

	console.log(`  Docker container '${config.container}' is running.`);
}

function execSimple(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d) => {
			stdout += d;
		});
		child.stderr?.on("data", (d) => {
			stderr += d;
		});
		child.on("error", (error) => reject(new Error(`Failed to start ${cmd}: ${error.message}`)));
		child.on("close", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(stderr || `Exit code ${code}`));
		});
	});
}

/**
 * Create an executor that runs commands either on host or in Docker container
 */
export function createExecutor(config: SandboxConfig, options: ExecutorOptions = {}): Executor {
	const skillRunnerSocketPath =
		options.skillRunnerSocketPath === undefined
			? process.env.FITCLAW_SKILL_RUNNER_SOCKET
			: (options.skillRunnerSocketPath ?? undefined);
	if (config.type === "host") {
		return new HostExecutor(skillRunnerSocketPath);
	}
	return new DockerExecutor(config.container, skillRunnerSocketPath);
}

export interface Executor {
	/**
	 * Execute a bash command
	 */
	exec(command: string, options?: ExecOptions): Promise<ExecResult>;

	/** Execute one process directly without shell interpretation. */
	execFile(executable: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>;

	/** Resolve a path in the executor's filesystem, following symlinks. */
	resolvePath(path: string, options?: ExecOptions): Promise<string>;

	/** Read one regular file as raw bytes. */
	readFile(path: string, options?: ReadFileOptions): Promise<Buffer>;

	/**
	 * Get the workspace path prefix for this executor
	 * Host: returns the actual path
	 * Docker: returns /workspace
	 */
	getWorkspacePath(hostPath: string): string;
}

export interface ExecOptions {
	timeout?: number;
	signal?: AbortSignal;
	network?: "inherit" | "deny";
}

export interface ReadFileOptions extends ExecOptions {
	maxBytes?: number;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

class HostExecutor implements Executor {
	constructor(private readonly skillRunnerSocketPath?: string) {}

	async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
		if (options?.network === "deny") {
			throw new Error("NETWORK_ISOLATION_UNAVAILABLE: shell commands cannot use the Skill Runner");
		}
		const shell = process.platform === "win32" ? "cmd" : "sh";
		const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
		return this.spawnProcess(shell, shellArgs, options);
	}

	async execFile(executable: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> {
		if (options?.network === "deny") {
			if (!this.skillRunnerSocketPath) {
				throw new Error("NETWORK_ISOLATION_UNAVAILABLE: FITCLAW_SKILL_RUNNER_SOCKET is not configured");
			}
			return executeSkillRunnerCommand(
				this.skillRunnerSocketPath,
				{ executable, args: [...args], timeout: options.timeout },
				{ signal: options.signal },
			);
		}
		return this.spawnProcess(executable, args, options);
	}

	async resolvePath(path: string, _options?: ExecOptions): Promise<string> {
		return realpath(path);
	}

	async readFile(path: string, options?: ReadFileOptions): Promise<Buffer> {
		const fileStats = await stat(path);
		if (!fileStats.isFile()) {
			throw new Error(`Path is not a regular file: ${path}`);
		}
		const maxBytes = getMaxFileBytes(options);
		if (fileStats.size > maxBytes) {
			throw new Error(`File exceeds ${maxBytes} byte read limit: ${path}`);
		}
		return readHostFile(path, { signal: options?.signal });
	}

	private async spawnProcess(executable: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> {
		const result = await runProcess(executable, args, options, DEFAULT_MAX_PROCESS_OUTPUT_BYTES);
		return {
			stdout: result.stdout.toString("utf-8"),
			stderr: result.stderr.toString("utf-8"),
			code: result.code,
		};
	}

	getWorkspacePath(hostPath: string): string {
		return hostPath;
	}
}

class DockerExecutor implements Executor {
	constructor(
		private readonly container: string,
		private readonly skillRunnerSocketPath?: string,
	) {}

	async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
		if (options?.network === "deny") {
			throw new Error("NETWORK_ISOLATION_UNAVAILABLE: shell commands cannot use the Skill Runner");
		}
		const hostExecutor = new HostExecutor(this.skillRunnerSocketPath);
		return hostExecutor.execFile("docker", ["exec", this.container, "sh", "-c", command], options);
	}

	async execFile(executable: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> {
		const hostExecutor = new HostExecutor(this.skillRunnerSocketPath);
		if (options?.network === "deny") {
			return hostExecutor.execFile(executable, args, options);
		}
		return hostExecutor.execFile("docker", ["exec", this.container, executable, ...args], options);
	}

	async resolvePath(path: string, options?: ExecOptions): Promise<string> {
		const result = await this.execFile("readlink", ["-f", path], options);
		if (result.code !== 0 || !result.stdout.trim()) {
			throw new Error(result.stderr || `Failed to resolve path: ${path}`);
		}
		return result.stdout.trimEnd();
	}

	async readFile(path: string, options?: ReadFileOptions): Promise<Buffer> {
		const fileCheck = await this.execFile("test", ["-f", path], options);
		if (fileCheck.code !== 0) {
			throw new Error(fileCheck.stderr || `Path is not a regular file: ${path}`);
		}
		return readProcessOutput("docker", ["exec", this.container, "cat", path], options);
	}

	getWorkspacePath(_hostPath: string): string {
		// Docker container sees /workspace
		return "/workspace";
	}
}

function getMaxFileBytes(options?: ReadFileOptions): number {
	const maxBytes = options?.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error("maxBytes must be a positive safe integer");
	}
	return maxBytes;
}

async function readProcessOutput(
	executable: string,
	args: readonly string[],
	options?: ReadFileOptions,
): Promise<Buffer> {
	const result = await runProcess(executable, args, options, getMaxFileBytes(options));
	if (result.code !== 0) {
		throw new Error(result.stderr.toString("utf-8") || `${executable} exited with code ${result.code}`);
	}
	return result.stdout;
}
