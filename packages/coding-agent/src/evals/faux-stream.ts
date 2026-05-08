import type { StreamFn } from "@fitclaw/agent-core";
import type { AssistantMessage, AssistantMessageEventStream, Model, TextContent, ToolCall } from "@fitclaw/ai";
import { createAssistantMessageEventStream } from "@fitclaw/ai";
import type { EvalFauxResponse } from "./types.js";

const FAUX_API = "anthropic-messages" as const;

export const evalFauxModel: Model<typeof FAUX_API> = {
	id: "fitclaw-eval-faux",
	name: "FitClaw Eval Faux",
	api: FAUX_API,
	provider: "fitclaw-eval",
	baseUrl: "http://localhost:0",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

type FauxStreamState = {
	callCount: number;
};

function buildAssistantMessage(response: EvalFauxResponse, callCount: number): AssistantMessage {
	const textBlocks: TextContent[] = response.text === undefined ? [] : [{ type: "text", text: response.text }];
	const toolBlocks: ToolCall[] = (response.toolCalls ?? []).map((toolCall, index) => ({
		type: "toolCall",
		id: `eval_tool_${callCount}_${index + 1}`,
		name: toolCall.name,
		arguments: toolCall.args,
	}));
	const content = [...toolBlocks, ...textBlocks];
	return {
		role: "assistant",
		content: content.length > 0 ? content : [{ type: "text", text: "" }],
		api: FAUX_API,
		provider: evalFauxModel.provider,
		model: evalFauxModel.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: toolBlocks.length > 0 ? "toolUse" : "stop",
		timestamp: Date.now(),
	};
}

function emitMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
	stream.push({ type: "start", partial: { ...message, content: [] } });
	let partialContent: AssistantMessage["content"] = [];
	for (const [contentIndex, block] of message.content.entries()) {
		if (block.type === "toolCall") {
			const partial = { ...message, content: [...partialContent, { ...block, arguments: {} }] };
			stream.push({ type: "toolcall_start", contentIndex, partial });
			stream.push({
				type: "toolcall_delta",
				contentIndex,
				delta: JSON.stringify(block.arguments),
				partial,
			});
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
			partialContent = [...partialContent, block];
		}
		if (block.type === "text") {
			const partial = { ...message, content: [...partialContent, { type: "text" as const, text: "" }] };
			stream.push({ type: "text_start", contentIndex, partial });
			stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: message });
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: message });
			partialContent = [...partialContent, block];
		}
	}
	stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
}

export function createEvalFauxStream(responses: EvalFauxResponse[]): StreamFn {
	const state: FauxStreamState = { callCount: 0 };
	return () => {
		const response = responses[state.callCount];
		state.callCount += 1;
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			if (!response) {
				emitMessage(
					stream,
					buildAssistantMessage({ text: "No more eval faux responses queued." }, state.callCount),
				);
				return;
			}
			emitMessage(stream, buildAssistantMessage(response, state.callCount));
		});
		return stream;
	};
}
