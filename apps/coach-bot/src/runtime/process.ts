import { spawn } from "node:child_process";

export const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_PROCESS_ERROR_BYTES = 1024 * 1024;

export interface ProcessOptions {
	timeout?: number;
	signal?: AbortSignal;
}

export interface BufferedProcessResult {
	stdout: Buffer;
	stderr: Buffer;
	code: number;
}

export function runProcess(
	executable: string,
	args: readonly string[],
	options: ProcessOptions | undefined,
	maxStdoutBytes: number,
): Promise<BufferedProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let hasExceededOutput = false;
		let isTimedOut = false;
		let isSettled = false;

		const timeoutHandle =
			options?.timeout && options.timeout > 0
				? setTimeout(() => {
						isTimedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, options.timeout * 1000)
				: undefined;
		const onAbort = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		const cleanup = () => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (options?.signal) options.signal.removeEventListener("abort", onAbort);
		};
		const fail = (error: Error) => {
			if (isSettled) return;
			isSettled = true;
			cleanup();
			reject(error);
		};

		if (options?.signal) {
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}

		child.stdout?.on("data", (data: Buffer) => {
			if (hasExceededOutput) return;
			const remainingBytes = maxStdoutBytes - stdoutBytes;
			if (data.length > remainingBytes) {
				if (remainingBytes > 0) stdoutChunks.push(data.subarray(0, remainingBytes));
				stdoutBytes = maxStdoutBytes;
				hasExceededOutput = true;
				if (child.pid) killProcessTree(child.pid);
				return;
			}
			stdoutChunks.push(data);
			stdoutBytes += data.length;
		});

		child.stderr?.on("data", (data: Buffer) => {
			const remainingBytes = MAX_PROCESS_ERROR_BYTES - stderrBytes;
			if (remainingBytes <= 0) return;
			const chunk = data.length > remainingBytes ? data.subarray(0, remainingBytes) : data;
			stderrChunks.push(chunk);
			stderrBytes += chunk.length;
		});

		child.on("error", (error) => fail(new Error(`Failed to start ${executable}: ${error.message}`)));
		child.on("close", (code) => {
			if (isSettled) return;
			const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
			const stderr = Buffer.concat(stderrChunks, stderrBytes);
			if (options?.signal?.aborted) {
				fail(new Error(`${stdout.toString("utf-8")}\n${stderr.toString("utf-8")}\nCommand aborted`.trim()));
				return;
			}
			if (isTimedOut) {
				fail(
					new Error(
						`${stdout.toString("utf-8")}\n${stderr.toString("utf-8")}\nCommand timed out after ${options?.timeout} seconds`.trim(),
					),
				);
				return;
			}
			if (hasExceededOutput) {
				fail(new Error(`Process output exceeded ${maxStdoutBytes} byte limit: ${executable}`));
				return;
			}
			isSettled = true;
			cleanup();
			resolve({ stdout, stderr, code: code ?? 0 });
		});
	});
}

function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch {}
		return;
	}

	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}
