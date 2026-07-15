import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EditorComponent, TUI } from "@fitclaw/tui";
import { spawnSync } from "child_process";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import { killTrackedDetachedChildren } from "../../utils/shell.js";

export interface InteractiveTerminalControllerOptions {
	runtimeHost: Pick<AgentSessionRuntime, "dispose">;
	ui: TUI;
	getEditor: () => EditorComponent;
	isStreaming: () => boolean;
	clearEditor: () => void;
	stopInteractiveMode: () => void;
	showStatus: (message: string) => void;
	showWarning: (message: string) => void;
	exitProcess: (code: number) => void;
}

export class InteractiveTerminalController {
	private isShuttingDown = false;
	private isShutdownRequested = false;
	private lastInterruptTime = 0;
	private signalCleanupHandlers: Array<() => void> = [];

	constructor(private readonly options: InteractiveTerminalControllerOptions) {}

	handleInterruptKey(): void {
		const now = Date.now();
		if (now - this.lastInterruptTime < 500) {
			void this.shutdown();
		} else {
			this.options.clearEditor();
			this.lastInterruptTime = now;
		}
	}

	handleExitKey(): void {
		void this.shutdown();
	}

	requestShutdown(): void {
		this.isShutdownRequested = true;
		if (!this.options.isStreaming()) {
			void this.shutdown();
		}
	}

	deferShutdown(): void {
		this.isShutdownRequested = true;
	}

	async checkShutdownRequested(): Promise<void> {
		if (!this.isShutdownRequested) return;
		await this.shutdown();
	}

	async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		this.unregisterSignalHandlers();

		await this.options.ui.terminal.drainInput(1000);
		this.options.stopInteractiveMode();
		await this.options.runtimeHost.dispose();
		this.options.exitProcess(0);
	}

	registerSignalHandlers(): void {
		this.unregisterSignalHandlers();

		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void this.shutdown();
			};
			process.on(signal, handler);
			this.signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	}

	dispose(): void {
		this.unregisterSignalHandlers();
	}

	suspend(): void {
		if (process.platform === "win32") {
			this.options.showStatus("Suspend to background is not supported on Windows");
			return;
		}

		const suspendKeepAlive = setInterval(() => {}, 2 ** 30);
		const ignoreSigint = () => {};
		process.on("SIGINT", ignoreSigint);
		process.once("SIGCONT", () => {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			this.options.ui.start();
			this.options.ui.requestRender(true);
		});

		try {
			this.options.ui.stop();
			process.kill(0, "SIGTSTP");
		} catch (error: unknown) {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			throw error;
		}
	}

	openExternalEditor(): void {
		const editorCommand = process.env.VISUAL || process.env.EDITOR;
		if (!editorCommand) {
			this.options.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
			return;
		}

		const editor = this.options.getEditor();
		const currentText = editor.getExpandedText?.() ?? editor.getText();
		const temporaryFile = path.join(os.tmpdir(), `fitclaw-editor-${Date.now()}.md`);

		try {
			fs.writeFileSync(temporaryFile, currentText, "utf-8");
			this.options.ui.stop();

			const [command, ...args] = editorCommand.split(" ");
			const result = spawnSync(command, [...args, temporaryFile], {
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			if (result.status === 0) {
				const newContent = fs.readFileSync(temporaryFile, "utf-8").replace(/\n$/, "");
				this.options.getEditor().setText(newContent);
			}
		} finally {
			try {
				fs.unlinkSync(temporaryFile);
			} catch {
				// Preserve the edited content even if temporary-file cleanup fails.
			}

			this.options.ui.start();
			this.options.ui.requestRender(true);
		}
	}

	private unregisterSignalHandlers(): void {
		for (const cleanup of this.signalCleanupHandlers) {
			cleanup();
		}
		this.signalCleanupHandlers = [];
	}
}
