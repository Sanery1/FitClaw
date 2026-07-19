export const MAX_SKILL_RUNNER_REQUEST_BYTES = 64 * 1024;
export const MAX_SKILL_RUNNER_RESPONSE_BYTES = 24 * 1024 * 1024;
export const DEFAULT_SKILL_COMMAND_TIMEOUT_SECONDS = 30;
export const MAX_SKILL_COMMAND_TIMEOUT_SECONDS = 120;

export interface SkillRunnerCommand {
	executable: string;
	args: string[];
	timeout?: number;
	dataDir?: string;
}

export type SkillRunnerRequest = { type: "ping" } | ({ type: "execute" } & SkillRunnerCommand);

export type SkillRunnerResponse =
	| { ok: true; type: "pong" }
	| { ok: true; type: "result"; result: { stdoutBase64: string; stderrBase64: string; code: number } }
	| { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line) as unknown;
	} catch {
		throw new Error("Invalid Skill Runner JSON message");
	}
}

function isValidTimeout(value: unknown): value is number | undefined {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SKILL_COMMAND_TIMEOUT_SECONDS)
	);
}

function isValidBase64(value: unknown): value is string {
	return typeof value === "string" && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function parseSkillRunnerRequest(line: string): SkillRunnerRequest {
	const value = parseJson(line);
	if (!isRecord(value)) throw new Error("Skill Runner request must be an object");
	if (value.type === "ping") return { type: "ping" };
	if (value.type !== "execute") throw new Error("Unknown Skill Runner request type");
	if (typeof value.executable !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value.executable)) {
		throw new Error("Skill Runner executable must be a command name without a path");
	}
	if (
		!Array.isArray(value.args) ||
		value.args.length === 0 ||
		!value.args.every((argument) => typeof argument === "string" && !argument.includes("\0"))
	) {
		throw new Error("Skill Runner args must be a non-empty string array");
	}
	if (!isValidTimeout(value.timeout)) {
		throw new Error(`Skill Runner timeout must be between 1 and ${MAX_SKILL_COMMAND_TIMEOUT_SECONDS} seconds`);
	}
	if (value.dataDir !== undefined && (typeof value.dataDir !== "string" || !isAbsolute(value.dataDir))) {
		throw new Error("Skill Runner dataDir must be an absolute path");
	}
	return {
		type: "execute",
		executable: value.executable,
		args: [...value.args],
		timeout: value.timeout,
		dataDir: value.dataDir,
	};
}

export function parseSkillRunnerResponse(line: string): SkillRunnerResponse {
	const value = parseJson(line);
	if (!isRecord(value) || typeof value.ok !== "boolean") {
		throw new Error("Invalid Skill Runner response");
	}
	if (!value.ok) {
		if (typeof value.error !== "string") throw new Error("Invalid Skill Runner error response");
		return { ok: false, error: value.error };
	}
	if (value.type === "pong") return { ok: true, type: "pong" };
	if (value.type !== "result" || !isRecord(value.result)) {
		throw new Error("Invalid Skill Runner success response");
	}
	if (
		!isValidBase64(value.result.stdoutBase64) ||
		!isValidBase64(value.result.stderrBase64) ||
		typeof value.result.code !== "number" ||
		!Number.isInteger(value.result.code)
	) {
		throw new Error("Invalid Skill Runner process result");
	}
	return {
		ok: true,
		type: "result",
		result: {
			stdoutBase64: value.result.stdoutBase64,
			stderrBase64: value.result.stderrBase64,
			code: value.result.code,
		},
	};
}

export function encodeSkillRunnerMessage(message: SkillRunnerRequest | SkillRunnerResponse): string {
	return `${JSON.stringify(message)}\n`;
}

import { isAbsolute } from "node:path";
