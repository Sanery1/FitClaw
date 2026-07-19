import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, realpath, rm, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadSkillsFromDir } from "@fitclaw/runtime";
import { createAllowedCommands, findAllowedCommand } from "./runtime/permissions.js";
import { DEFAULT_MAX_PROCESS_OUTPUT_BYTES, runProcess } from "./runtime/process.js";
import {
	DEFAULT_SKILL_COMMAND_TIMEOUT_SECONDS,
	encodeSkillRunnerMessage,
	MAX_SKILL_RUNNER_REQUEST_BYTES,
	parseSkillRunnerRequest,
	type SkillRunnerRequest,
	type SkillRunnerResponse,
} from "./runtime/skill-runner-protocol.js";

const MAX_RUNNER_ERROR_LENGTH = 8192;

export interface StartSkillRunnerOptions {
	socketPath: string;
	workspacePath: string;
	verifyNetworkIsolation?: boolean;
}

export interface SkillRunnerServer {
	close(): Promise<void>;
}

function assertNetworkIsolated(): void {
	for (const addresses of Object.values(networkInterfaces())) {
		if (addresses?.some((address) => !address.internal)) {
			throw new Error("Skill Runner must start without external network interfaces");
		}
	}
}

function isNamedPipe(path: string): boolean {
	return process.platform === "win32" && path.startsWith("\\\\.\\pipe\\");
}

async function removeStaleSocket(socketPath: string): Promise<void> {
	if (!isNamedPipe(socketPath)) await rm(socketPath, { force: true });
}

function createErrorResponse(error: unknown): SkillRunnerResponse {
	const message = error instanceof Error ? error.message : "Skill Runner request failed";
	return { ok: false, error: message.slice(0, MAX_RUNNER_ERROR_LENGTH) };
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
	const relativePath = relative(rootPath, candidatePath);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

async function resolveAllowedCommand(request: Extract<SkillRunnerRequest, { type: "execute" }>, workspacePath: string) {
	let canonicalWorkspace: string;
	let canonicalScript: string;
	try {
		[canonicalWorkspace, canonicalScript] = await Promise.all([realpath(workspacePath), realpath(request.args[0])]);
		if (!(await stat(canonicalScript)).isFile()) throw new Error("not a regular file");
	} catch {
		throw new Error(`SECURITY_BLOCKED: Skill command script is not an accessible file: ${request.args[0]}`);
	}
	if (!isPathInside(canonicalScript, canonicalWorkspace)) {
		throw new Error(`SECURITY_BLOCKED: Skill command script is outside the Runner workspace: ${request.args[0]}`);
	}

	let skillPath = dirname(canonicalScript);
	while (isPathInside(skillPath, canonicalWorkspace)) {
		if (existsSync(join(skillPath, "SKILL.md"))) {
			const skills = loadSkillsFromDir({ dir: skillPath, source: "skill-runner" }).skills;
			const allowedCommands = createAllowedCommands(skills).map((command) => ({
				...command,
				argumentPrefix: [realpathSync(command.argumentPrefix[0]), ...command.argumentPrefix.slice(1)],
			}));
			const normalizedArgs = [canonicalScript, ...request.args.slice(1)];
			return {
				allowedCommand: findAllowedCommand(request.executable, normalizedArgs, allowedCommands),
				normalizedArgs,
			};
		}
		const parentPath = dirname(skillPath);
		if (parentPath === skillPath) break;
		skillPath = parentPath;
	}

	throw new Error(`SECURITY_BLOCKED: No owning SKILL.md found for command script: ${request.args[0]}`);
}

async function executeRequest(
	request: SkillRunnerRequest,
	workspacePath: string,
	signal: AbortSignal,
): Promise<SkillRunnerResponse> {
	if (request.type === "ping") return { ok: true, type: "pong" };

	const { allowedCommand, normalizedArgs } = await resolveAllowedCommand(request, workspacePath);
	if (!allowedCommand || allowedCommand.network !== "deny") {
		throw new Error(
			`SECURITY_BLOCKED: Command does not match a network-disabled Skill allowlist: ${request.executable}`,
		);
	}

	const dataDir = request.dataDir ? await resolveRunnerDataDir(request.dataDir, workspacePath) : undefined;
	const result = await runProcess(
		request.executable,
		normalizedArgs,
		{
			signal,
			timeout: request.timeout ?? DEFAULT_SKILL_COMMAND_TIMEOUT_SECONDS,
			...(dataDir ? { environment: { FITCLAW_DATA_DIR: dataDir } } : {}),
		},
		DEFAULT_MAX_PROCESS_OUTPUT_BYTES,
	);
	return {
		ok: true,
		type: "result",
		result: {
			stdoutBase64: result.stdout.toString("base64"),
			stderrBase64: result.stderr.toString("base64"),
			code: result.code,
		},
	};
}

async function resolveRunnerDataDir(dataDir: string, workspacePath: string): Promise<string> {
	const canonicalWorkspace = await realpath(workspacePath);
	const candidate = resolve(dataDir);
	if (!isPathInside(candidate, canonicalWorkspace)) {
		throw new Error("SECURITY_BLOCKED: Skill dataDir is outside the Runner workspace");
	}
	await mkdir(candidate, { recursive: true });
	const canonicalDataDir = await realpath(candidate);
	if (!isPathInside(canonicalDataDir, canonicalWorkspace)) {
		throw new Error("SECURITY_BLOCKED: Skill dataDir resolves outside the Runner workspace");
	}
	return canonicalDataDir;
}

function handleConnection(socket: Socket, workspacePath: string): void {
	const chunks: Buffer[] = [];
	const abortController = new AbortController();
	let totalBytes = 0;
	let isHandled = false;

	const respond = (response: SkillRunnerResponse) => {
		if (!socket.destroyed) socket.end(encodeSkillRunnerMessage(response));
	};
	socket.once("error", () => abortController.abort());
	socket.once("close", () => abortController.abort());
	socket.on("data", (chunk: Buffer) => {
		if (isHandled) return;
		totalBytes += chunk.length;
		if (totalBytes > MAX_SKILL_RUNNER_REQUEST_BYTES) {
			isHandled = true;
			respond({ ok: false, error: "Skill Runner request exceeded the size limit" });
			return;
		}
		chunks.push(chunk);
		const requestText = Buffer.concat(chunks, totalBytes).toString("utf-8");
		const newlineIndex = requestText.indexOf("\n");
		if (newlineIndex === -1) return;
		isHandled = true;
		try {
			const request = parseSkillRunnerRequest(requestText.slice(0, newlineIndex));
			executeRequest(request, workspacePath, abortController.signal)
				.then(respond)
				.catch((error) => respond(createErrorResponse(error)));
		} catch (error) {
			respond(createErrorResponse(error));
		}
	});
}

async function listen(server: Server, socketPath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
}

export async function startSkillRunnerServer(options: StartSkillRunnerOptions): Promise<SkillRunnerServer> {
	if (!isAbsolute(options.workspacePath)) throw new Error("Skill Runner workspace path must be absolute");
	if (options.verifyNetworkIsolation !== false) assertNetworkIsolated();
	if (!isNamedPipe(options.socketPath)) {
		await mkdir(dirname(options.socketPath), { recursive: true });
		await removeStaleSocket(options.socketPath);
	}

	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		handleConnection(socket, options.workspacePath);
	});
	await listen(server, options.socketPath);
	if (!isNamedPipe(options.socketPath)) await chmod(options.socketPath, 0o600);

	return {
		async close(): Promise<void> {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			await removeStaleSocket(options.socketPath);
		},
	};
}
