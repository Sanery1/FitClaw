import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { Agent, type AgentEvent, type StreamFn } from "@fitclaw/agent-core";
import { type Api, type AssistantMessage, type Message, type Model, streamSimple, type TextContent } from "@fitclaw/ai";
import type { ModelRegistry } from "../core/model-registry.js";
import { createEvalTools } from "./eval-tools.js";
import { createEvalFauxStream, evalFauxModel } from "./faux-stream.js";
import { gradeEvalTask } from "./graders.js";
import { writeTranscript } from "./reporter.js";
import type { EvalTask, EvalToolCallRecord, EvalTrialResult } from "./types.js";

export type RunEvalTaskOptions = {
	outputDir: string;
	trialIndex?: number;
	totalTrials?: number;
	execution?: { mode: "faux" } | { mode: "real"; model: Model<Api>; modelRegistry: ModelRegistry };
};

function resolveInside(root: string, relativePath: string): string {
	const resolved = normalize(join(root, relativePath));
	const normalizedRoot = normalize(root);
	if (
		resolved !== normalizedRoot &&
		!resolved.startsWith(`${normalizedRoot}\\`) &&
		!resolved.startsWith(`${normalizedRoot}/`)
	) {
		throw new Error(`Path escapes eval workspace: ${relativePath}`);
	}
	return resolved;
}

function convertAgentMessages(messages: unknown[]): Message[] {
	return messages.filter((message): message is Message => {
		if (typeof message !== "object" || message === null) {
			return false;
		}
		const role = (message as { role?: unknown }).role;
		return role === "user" || role === "assistant" || role === "toolResult";
	});
}

function extractFinalAnswer(events: AgentEvent[]): string {
	const assistantMessages = events
		.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		)
		.map((event) => event.message);
	const lastAssistant = assistantMessages[assistantMessages.length - 1];
	if (!lastAssistant || lastAssistant.role !== "assistant") {
		return "";
	}
	return lastAssistant.content
		.filter((content): content is TextContent => content.type === "text")
		.map((content) => content.text)
		.join("")
		.trim();
}

export function extractEvalModelError(events: AgentEvent[]): string | undefined {
	const assistantMessages = events
		.filter((event): event is Extract<AgentEvent, { type: "message_end" }> => event.type === "message_end")
		.map((event) => event.message)
		.filter((message): message is AssistantMessage => message.role === "assistant");
	const lastAssistant = assistantMessages[assistantMessages.length - 1];
	if (!lastAssistant || lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted") {
		return lastAssistant?.errorMessage ?? "Model did not produce a completed assistant response.";
	}
	return undefined;
}

function extractToolCalls(events: AgentEvent[]): EvalToolCallRecord[] {
	const completions = new Map(
		events.filter((event) => event.type === "tool_execution_end").map((event) => [event.toolCallId, event] as const),
	);
	return events
		.filter((event) => event.type === "tool_execution_start")
		.map((event) => {
			const completion = completions.get(event.toolCallId);
			const result: unknown = completion?.result;
			const details = isRecord(result) && isRecord(result.details) ? result.details : undefined;
			const pageIds = Array.isArray(details?.pageIds)
				? details.pageIds.filter((pageId): pageId is string => typeof pageId === "string")
				: [];
			return {
				name: event.toolName,
				args: event.args as Record<string, unknown>,
				pageIds,
				isError: completion?.isError ?? true,
			};
		});
}

function extractUsage(events: AgentEvent[]): { inputTokens: number; outputTokens: number; cost: number } {
	return events
		.filter((event): event is Extract<AgentEvent, { type: "message_end" }> => event.type === "message_end")
		.map((event) => event.message)
		.filter((message): message is AssistantMessage => message.role === "assistant")
		.reduce(
			(totals, message) => ({
				inputTokens: totals.inputTokens + message.usage.input,
				outputTokens: totals.outputTokens + message.usage.output,
				cost: totals.cost + message.usage.cost.total,
			}),
			{ inputTokens: 0, outputTokens: 0, cost: 0 },
		);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seedInitialData(workspaceDir: string, initialData: Record<string, unknown>): void {
	for (const [relativePath, value] of Object.entries(initialData)) {
		const filePath = resolveInside(workspaceDir, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	}
}

export async function runEvalTask(task: EvalTask, options: RunEvalTaskOptions): Promise<EvalTrialResult> {
	const startedAt = Date.now();
	const trialIndex = options.trialIndex ?? 1;
	const isRepeated = (options.totalTrials ?? 1) > 1;
	const workspaceDir = isRepeated
		? join(options.outputDir, "workspaces", task.id, `trial-${trialIndex}`)
		: join(options.outputDir, "workspaces", task.id);
	const transcriptPath = isRepeated
		? join(options.outputDir, "transcripts", task.id, `trial-${trialIndex}.jsonl`)
		: join(options.outputDir, "transcripts", `${task.id}.jsonl`);
	mkdirSync(workspaceDir, { recursive: true });
	seedInitialData(workspaceDir, task.initialData);

	const execution = options.execution ?? { mode: "faux" as const };
	if (execution.mode === "faux" && !task.fauxResponses?.length) {
		throw new Error(`Eval task "${task.id}" requires fauxResponses in faux mode.`);
	}
	const model = execution.mode === "faux" ? evalFauxModel : execution.model;
	const streamFn: StreamFn =
		execution.mode === "faux"
			? createEvalFauxStream(task.fauxResponses ?? [])
			: async (requestedModel, context, streamOptions) => {
					const auth = await execution.modelRegistry.getApiKeyAndHeaders(requestedModel);
					if (!auth.ok) throw new Error(auth.error);
					return streamSimple(requestedModel, context, {
						...streamOptions,
						apiKey: auth.apiKey,
						headers:
							auth.headers || streamOptions?.headers
								? { ...auth.headers, ...streamOptions?.headers }
								: undefined,
					});
				};

	let events: AgentEvent[] = [];
	const agent = new Agent({
		initialState: {
			systemPrompt: task.systemPrompt ?? "You are running inside the FitClaw eval harness.",
			model,
			thinkingLevel: "off",
			tools: createEvalTools(workspaceDir, task.knowledge),
		},
		convertToLlm: convertAgentMessages,
		streamFn,
	});
	const unsubscribe = agent.subscribe((event) => {
		events = [...events, event];
	});

	try {
		await agent.prompt(task.prompt);
	} finally {
		unsubscribe();
	}

	const finalAnswer = extractFinalAnswer(events);
	const errorMessage = extractEvalModelError(events);
	const toolCalls = extractToolCalls(events);
	const usage = extractUsage(events);
	const turnCount = events.filter((event) => event.type === "turn_end").length;
	const graderResults = gradeEvalTask(task.graders, { workspaceDir, finalAnswer, toolCalls, turnCount });
	writeTranscript(transcriptPath, events);

	return {
		taskId: task.id,
		suite: task.suite,
		trialIndex,
		modelId: `${model.provider}/${model.id}`,
		passed: errorMessage === undefined && graderResults.every((result) => result.passed),
		errorMessage,
		finalAnswer,
		toolCalls,
		graderResults,
		transcriptPath,
		metrics: {
			turnCount,
			toolCallCount: toolCalls.length,
			durationMs: Date.now() - startedAt,
			...usage,
		},
	};
}
