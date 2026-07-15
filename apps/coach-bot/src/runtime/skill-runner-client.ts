import { createConnection } from "node:net";
import type { ExecResult } from "../sandbox.js";
import {
	DEFAULT_SKILL_COMMAND_TIMEOUT_SECONDS,
	encodeSkillRunnerMessage,
	MAX_SKILL_RUNNER_RESPONSE_BYTES,
	parseSkillRunnerResponse,
	type SkillRunnerCommand,
	type SkillRunnerRequest,
	type SkillRunnerResponse,
} from "./skill-runner-protocol.js";

interface SkillRunnerClientOptions {
	signal?: AbortSignal;
}

function requestSkillRunner(
	socketPath: string,
	request: SkillRunnerRequest,
	options?: SkillRunnerClientOptions,
): Promise<SkillRunnerResponse> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		let isSettled = false;
		const timeoutSeconds =
			request.type === "execute" ? (request.timeout ?? DEFAULT_SKILL_COMMAND_TIMEOUT_SECONDS) : 5;

		const cleanup = () => {
			if (options?.signal) options.signal.removeEventListener("abort", onAbort);
			socket.removeAllListeners();
			socket.destroy();
		};
		const fail = (error: Error) => {
			if (isSettled) return;
			isSettled = true;
			cleanup();
			reject(error);
		};
		const finish = (response: SkillRunnerResponse) => {
			if (isSettled) return;
			isSettled = true;
			cleanup();
			resolve(response);
		};
		const onAbort = () => fail(new Error("Skill Runner request aborted"));

		if (options?.signal?.aborted) {
			onAbort();
			return;
		}
		options?.signal?.addEventListener("abort", onAbort, { once: true });
		socket.setTimeout((timeoutSeconds + 5) * 1000);
		socket.once("connect", () => socket.write(encodeSkillRunnerMessage(request)));
		socket.once("timeout", () => fail(new Error("Skill Runner request timed out")));
		socket.once("error", (error) => fail(new Error(`SKILL_RUNNER_UNAVAILABLE: ${error.message}`)));
		socket.once("close", () => {
			if (!isSettled) fail(new Error("SKILL_RUNNER_UNAVAILABLE: connection closed before a response"));
		});
		socket.on("data", (chunk: Buffer) => {
			totalBytes += chunk.length;
			if (totalBytes > MAX_SKILL_RUNNER_RESPONSE_BYTES) {
				fail(new Error("Skill Runner response exceeded the size limit"));
				return;
			}
			chunks.push(chunk);
		});
		socket.once("end", () => {
			const responseText = Buffer.concat(chunks, totalBytes).toString("utf-8");
			const newlineIndex = responseText.indexOf("\n");
			if (newlineIndex === -1) {
				fail(new Error("Skill Runner response was not terminated"));
				return;
			}
			try {
				finish(parseSkillRunnerResponse(responseText.slice(0, newlineIndex)));
			} catch (error) {
				fail(error instanceof Error ? error : new Error("Invalid Skill Runner response"));
			}
		});
	});
}

export async function executeSkillRunnerCommand(
	socketPath: string,
	command: SkillRunnerCommand,
	options?: SkillRunnerClientOptions,
): Promise<ExecResult> {
	const response = await requestSkillRunner(socketPath, { type: "execute", ...command }, options);
	if (!response.ok) throw new Error(response.error);
	if (response.type !== "result") throw new Error("Skill Runner returned an unexpected response");
	return {
		stdout: Buffer.from(response.result.stdoutBase64, "base64").toString("utf-8"),
		stderr: Buffer.from(response.result.stderrBase64, "base64").toString("utf-8"),
		code: response.result.code,
	};
}

export async function pingSkillRunner(socketPath: string): Promise<boolean> {
	try {
		const response = await requestSkillRunner(socketPath, { type: "ping" });
		return response.ok && response.type === "pong";
	} catch {
		return false;
	}
}
