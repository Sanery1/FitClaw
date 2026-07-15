import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Component, Container, EditorComponent, TUI } from "@fitclaw/tui";
import { spawn, spawnSync } from "child_process";
import { getShareViewerUrl } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { type AgentSessionRuntime, SessionImportFileNotFoundError } from "../../core/agent-session-runtime.js";
import { MissingSessionCwdError } from "../../core/session-cwd.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { BorderedLoader } from "./components/bordered-loader.js";
import { theme } from "./theme/theme.js";

type PathCommand = "/export" | "/import";

export function getPathCommandArgument(text: string, command: PathCommand): string | undefined {
	if (text === command || !text.startsWith(`${command} `)) {
		return undefined;
	}

	const argsString = text.slice(command.length + 1).trimStart();
	if (!argsString) {
		return undefined;
	}

	const firstChar = argsString[0];
	if (firstChar === '"' || firstChar === "'") {
		const closingQuoteIndex = argsString.indexOf(firstChar, 1);
		if (closingQuoteIndex < 0) {
			return undefined;
		}
		return argsString.slice(1, closingQuoteIndex);
	}

	const firstWhitespaceIndex = argsString.search(/\s/);
	return firstWhitespaceIndex < 0 ? argsString : argsString.slice(0, firstWhitespaceIndex);
}

export interface InteractiveSessionTransferControllerOptions {
	getSession: () => AgentSession;
	runtimeHost: Pick<AgentSessionRuntime, "importFromJsonl">;
	ui: TUI;
	editorContainer: Container;
	getEditor: () => EditorComponent;
	showConfirm: (title: string, message: string) => Promise<boolean>;
	promptForMissingSessionCwd: (error: MissingSessionCwdError) => Promise<string | undefined>;
	stopWorkingLoader: () => void;
	renderCurrentSessionState: () => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<never>;
}

export class InteractiveSessionTransferController {
	constructor(private readonly options: InteractiveSessionTransferControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	private get editor(): EditorComponent {
		return this.options.getEditor();
	}

	async handleExportCommand(text: string): Promise<void> {
		const outputPath = getPathCommandArgument(text, "/export");

		try {
			const filePath = outputPath?.endsWith(".jsonl")
				? this.session.exportToJsonl(outputPath)
				: await this.session.exportToHtml(outputPath);
			this.options.showStatus(`Session exported to: ${filePath}`);
		} catch (error: unknown) {
			this.options.showError(
				`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	async handleImportCommand(text: string): Promise<void> {
		const inputPath = getPathCommandArgument(text, "/import");
		if (!inputPath) {
			this.options.showError("Usage: /import <path.jsonl>");
			return;
		}

		const confirmed = await this.options.showConfirm("Import session", `Replace current session with ${inputPath}?`);
		if (!confirmed) {
			this.options.showStatus("Import cancelled");
			return;
		}

		try {
			this.options.stopWorkingLoader();
			const result = await this.options.runtimeHost.importFromJsonl(inputPath);
			if (result.cancelled) {
				this.options.showStatus("Import cancelled");
				return;
			}
			this.options.renderCurrentSessionState();
			this.options.showStatus(`Session imported from: ${inputPath}`);
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.options.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.options.showStatus("Import cancelled");
					return;
				}
				const result = await this.options.runtimeHost.importFromJsonl(inputPath, selectedCwd);
				if (result.cancelled) {
					this.options.showStatus("Import cancelled");
					return;
				}
				this.options.renderCurrentSessionState();
				this.options.showStatus(`Session imported from: ${inputPath}`);
				return;
			}
			if (error instanceof SessionImportFileNotFoundError) {
				this.options.showError(`Failed to import session: ${error.message}`);
				return;
			}
			await this.options.handleFatalRuntimeError("Failed to import session", error);
		}
	}

	async handleShareCommand(): Promise<void> {
		try {
			const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
			if (authResult.status !== 0) {
				this.options.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			this.options.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
			return;
		}

		const tmpFile = path.join(os.tmpdir(), "session.html");
		try {
			await this.session.exportToHtml(tmpFile);
		} catch (error: unknown) {
			this.options.showError(
				`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
			return;
		}

		const loader = new BorderedLoader(this.options.ui, theme, "Creating gist...");
		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(loader);
		this.options.ui.setFocus(loader);
		this.options.ui.requestRender();

		const restoreEditor = () => {
			loader.dispose();
			this.options.editorContainer.clear();
			this.options.editorContainer.addChild(this.editor as Component);
			this.options.ui.setFocus(this.editor);
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors.
			}
		};

		let proc: ReturnType<typeof spawn> | undefined;
		loader.onAbort = () => {
			proc?.kill();
			restoreEditor();
			this.options.showStatus("Share cancelled");
		};

		try {
			const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
				proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
				let stdout = "";
				let stderr = "";
				proc.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				proc.stderr?.on("data", (data) => {
					stderr += data.toString();
				});
				proc.on("close", (code) => resolve({ stdout, stderr, code }));
			});

			if (loader.signal.aborted) return;
			restoreEditor();

			if (result.code !== 0) {
				const errorMessage = result.stderr.trim() || "Unknown error";
				this.options.showError(`Failed to create gist: ${errorMessage}`);
				return;
			}

			const gistUrl = result.stdout.trim();
			const gistId = gistUrl.split("/").pop();
			if (!gistId) {
				this.options.showError("Failed to parse gist ID from gh output");
				return;
			}

			const previewUrl = getShareViewerUrl(gistId);
			const viewerLine = previewUrl ? `\nPreview: ${previewUrl}` : "";
			this.options.showStatus(`Share URL: ${gistUrl}${viewerLine}`);
		} catch (error: unknown) {
			if (!loader.signal.aborted) {
				restoreEditor();
				this.options.showError(
					`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	}

	async handleCopyCommand(): Promise<void> {
		const text = this.session.getLastAssistantText();
		if (!text) {
			this.options.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			this.options.showStatus("Copied last agent message to clipboard");
		} catch (error: unknown) {
			this.options.showError(error instanceof Error ? error.message : String(error));
		}
	}
}
