import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { Executor } from "../sandbox.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `mom-bash-${id}.log`);
}

const bashSchema = Type.Object({
	label: Type.String({ description: "Brief description of what this command does (shown to user)" }),
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\brm\s+-rf\s+\/(\s|$|;|&)/i, reason: "rm -rf / destroys the filesystem" },
	{ pattern: /\brm\s+-rf\s+\/\*/i, reason: "rm -rf /* destroys the filesystem" },
	{ pattern: /\bdd\s+.*of=\/dev\/(sda|sdb|nvme|hd|xvd|vd)/i, reason: "dd to block devices overwrites disk" },
	{ pattern: /\bmkfs\./i, reason: "mkfs formats filesystems destructively" },
	{ pattern: /\bchmod\s+-R\s+777\s+\/(\s|$|;|&)/i, reason: "chmod 777 / breaks system permissions" },
	{ pattern: /\bchmod\s+-R\s+000\s+\/(\s|$|;|&)/i, reason: "chmod 000 / locks out the system" },
	{ pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i, reason: "fork bomb crashes the system" },
	{ pattern: /\bmv\s+.*\/\s+\/dev\/null/i, reason: "moving root to /dev/null destroys data" },
	{ pattern: />\s*\/dev\/sda/i, reason: "redirecting to block device destroys disk" },
	{
		pattern: />\s*\/dev\/null.*\b(\/etc|\/usr|\/var|\/home|\/bin|\/sbin|\/lib)/i,
		reason: "redirecting system paths to null destroys data",
	},
	{ pattern: /\bwget\b.*\|\s*\bsh\b/i, reason: "piping curl/wget output to shell executes arbitrary remote code" },
	{ pattern: /\bcurl\b.*\|\s*\bsh\b/i, reason: "piping curl/wget output to shell executes arbitrary remote code" },
];

function validateCommand(command: string): void {
	const normalized = command.replace(/\\\n/g, " ");
	for (const { pattern, reason } of DANGEROUS_PATTERNS) {
		if (pattern.test(normalized)) {
			throw new Error(
				`SECURITY_BLOCKED: This command was blocked because it matches a dangerous pattern (${reason}). If you believe this is a false positive, restructure the command to avoid the pattern.`,
			);
		}
	}
}

export function createBashTool(executor: Executor): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout }: { label: string; command: string; timeout?: number },
			signal?: AbortSignal,
		) => {
			// Track output for potential temp file writing
			let tempFilePath: string | undefined;
			let tempFileStream: ReturnType<typeof createWriteStream> | undefined;

			validateCommand(command);
			const result = await executor.exec(command, { timeout, signal });
			let output = "";
			if (result.stdout) output += result.stdout;
			if (result.stderr) {
				if (output) output += "\n";
				output += result.stderr;
			}

			const totalBytes = Buffer.byteLength(output, "utf-8");

			// Write to temp file if output exceeds limit
			if (totalBytes > DEFAULT_MAX_BYTES) {
				tempFilePath = getTempFilePath();
				tempFileStream = createWriteStream(tempFilePath);
				tempFileStream.write(output);
				tempFileStream.end();
			}

			// Apply tail truncation
			const truncation = truncateTail(output);
			let outputText = truncation.content || "(no output)";

			// Build details with truncation info
			let details: BashToolDetails | undefined;

			if (truncation.truncated) {
				details = {
					truncation,
					fullOutputPath: tempFilePath,
				};

				// Build actionable notice
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				const endLine = truncation.totalLines;

				if (truncation.lastLinePartial) {
					// Edge case: last line alone > 50KB
					const lastLineSize = formatSize(Buffer.byteLength(output.split("\n").pop() || "", "utf-8"));
					outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
				} else if (truncation.truncatedBy === "lines") {
					outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
				} else {
					outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
				}
			}

			if (result.code !== 0) {
				throw new Error(`${outputText}\n\nCommand exited with code ${result.code}`.trim());
			}

			return { content: [{ type: "text", text: outputText }], details };
		},
	};
}
