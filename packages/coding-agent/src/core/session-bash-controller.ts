import type { Agent } from "@fitclaw/agent-core";
import { type BashResult, executeBashWithOperations } from "./bash-executor.js";
import type { BashExecutionMessage } from "./messages.js";
import type { SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";
import { type BashOperations, createLocalBashOperations } from "./tools/bash.js";

export interface SessionBashExecutionOptions {
	excludeFromContext?: boolean;
	operations?: BashOperations;
}

export class SessionBashController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly settingsManager: Pick<SettingsManager, "getShellCommandPrefix" | "getShellPath">;
	private bashAbortController: AbortController | undefined;
	private pendingMessages: BashExecutionMessage[] = [];

	constructor(options: { agent: Agent; sessionManager: SessionManager; settingsManager: SettingsManager }) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
	}

	get isRunning(): boolean {
		return this.bashAbortController !== undefined;
	}

	get hasPendingMessages(): boolean {
		return this.pendingMessages.length > 0;
	}

	abort(): void {
		this.bashAbortController?.abort();
	}

	async execute(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: SessionBashExecutionOptions,
	): Promise<BashResult> {
		const abortController = new AbortController();
		this.bashAbortController = abortController;
		const prefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

		try {
			const result = await executeBashWithOperations(
				resolvedCommand,
				this.sessionManager.getCwd(),
				options?.operations ?? createLocalBashOperations({ shellPath }),
				{ onChunk, signal: abortController.signal },
			);
			this.record(command, result, options);
			return result;
		} finally {
			if (this.bashAbortController === abortController) this.bashAbortController = undefined;
		}
	}

	record(
		command: string,
		result: BashResult,
		options?: Pick<SessionBashExecutionOptions, "excludeFromContext">,
	): void {
		const message: BashExecutionMessage = {
			role: "bashExecution",
			command,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			fullOutputPath: result.fullOutputPath,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		if (this.agent.state.isStreaming) {
			this.pendingMessages = [...this.pendingMessages, message];
			return;
		}

		this.agent.state.messages = [...this.agent.state.messages, message];
		this.sessionManager.appendMessage(message);
	}

	flushPendingMessages(): void {
		if (this.pendingMessages.length === 0) return;
		const pendingMessages = this.pendingMessages;
		this.pendingMessages = [];
		this.agent.state.messages = [...this.agent.state.messages, ...pendingMessages];
		for (const message of pendingMessages) this.sessionManager.appendMessage(message);
	}
}
