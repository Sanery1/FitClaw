import type { AgentEvent } from "@fitclaw/agent-core";
import type {
	ExtensionRunner,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "./extensions/index.js";

export class SessionExtensionEventBridge {
	private readonly getExtensionRunner: () => ExtensionRunner;
	private turnIndex = 0;

	constructor(getExtensionRunner: () => ExtensionRunner) {
		this.getExtensionRunner = getExtensionRunner;
	}

	async emitAgentEvent(event: AgentEvent): Promise<void> {
		const runner = this.getExtensionRunner();
		if (event.type === "agent_start") {
			this.turnIndex = 0;
			await runner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await runner.emit({ type: "agent_end", messages: event.messages });
		} else if (event.type === "turn_start") {
			const extensionEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this.turnIndex,
				timestamp: Date.now(),
			};
			await runner.emit(extensionEvent);
		} else if (event.type === "turn_end") {
			const extensionEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this.turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await runner.emit(extensionEvent);
			this.turnIndex++;
		} else if (event.type === "message_start") {
			const extensionEvent: MessageStartEvent = { type: "message_start", message: event.message };
			await runner.emit(extensionEvent);
		} else if (event.type === "message_update") {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await runner.emit(extensionEvent);
		} else if (event.type === "message_end") {
			const extensionEvent: MessageEndEvent = { type: "message_end", message: event.message };
			await runner.emit(extensionEvent);
		} else if (event.type === "tool_execution_start") {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
			await runner.emit(extensionEvent);
		} else if (event.type === "tool_execution_update") {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await runner.emit(extensionEvent);
		} else if (event.type === "tool_execution_end") {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
			};
			await runner.emit(extensionEvent);
		}
	}
}
