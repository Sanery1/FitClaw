import type { Container, TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import { BashExecutionComponent } from "./components/bash-execution.js";

export interface InteractiveBashControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	chatContainer: Container;
	pendingMessagesContainer: Container;
	addPendingBashComponent: (component: BashExecutionComponent) => void;
	showError: (message: string) => void;
}

export class InteractiveBashController {
	private activeComponent: BashExecutionComponent | undefined;

	constructor(private readonly options: InteractiveBashControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	async handle(command: string, excludeFromContext = false): Promise<void> {
		const eventResult = await this.session.extensionRunner.emitUserBash({
			type: "user_bash",
			command,
			excludeFromContext,
			cwd: this.session.sessionManager.getCwd(),
		});

		if (eventResult?.result) {
			const result = eventResult.result;
			const component = this.createComponent(command, excludeFromContext, this.session.isStreaming);
			if (result.output) {
				component.appendOutput(result.output);
			}
			component.setComplete(
				result.exitCode,
				result.cancelled,
				result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
				result.fullOutputPath,
			);
			this.session.recordBashResult(command, result, { excludeFromContext });
			this.activeComponent = undefined;
			this.options.ui.requestRender();
			return;
		}

		const component = this.createComponent(command, excludeFromContext, this.session.isStreaming);
		this.options.ui.requestRender();

		try {
			const result = await this.session.executeBash(
				command,
				(chunk) => {
					if (this.activeComponent) {
						this.activeComponent.appendOutput(chunk);
						this.options.ui.requestRender();
					}
				},
				{ excludeFromContext, operations: eventResult?.operations },
			);

			component.setComplete(
				result.exitCode,
				result.cancelled,
				result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
				result.fullOutputPath,
			);
		} catch (error: unknown) {
			component.setComplete(undefined, false);
			this.options.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.activeComponent = undefined;
		this.options.ui.requestRender();
	}

	private createComponent(command: string, excludeFromContext: boolean, isDeferred: boolean): BashExecutionComponent {
		const component = new BashExecutionComponent(command, this.options.ui, excludeFromContext);
		this.activeComponent = component;
		if (isDeferred) {
			this.options.pendingMessagesContainer.addChild(component);
			this.options.addPendingBashComponent(component);
		} else {
			this.options.chatContainer.addChild(component);
		}
		return component;
	}
}
