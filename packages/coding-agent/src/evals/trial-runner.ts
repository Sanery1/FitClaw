import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { Agent, type AgentEvent } from "@fitclaw/agent-core";
import type { Message, TextContent } from "@fitclaw/ai";
import { createEvalTools } from "./eval-tools.js";
import { createEvalFauxStream, evalFauxModel } from "./faux-stream.js";
import { gradeEvalTask } from "./graders.js";
import { writeTranscript } from "./reporter.js";
import type { EvalTask, EvalToolCallRecord, EvalTrialResult } from "./types.js";

export type RunEvalTaskOptions = {
	outputDir: string;
	trialIndex?: number;
	totalTrials?: number;
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

function extractToolCalls(events: AgentEvent[]): EvalToolCallRecord[] {
	return events
		.filter((event) => event.type === "tool_execution_start")
		.map((event) => ({
			name: event.toolName,
			args: event.args as Record<string, unknown>,
		}));
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

	let events: AgentEvent[] = [];
	const agent = new Agent({
		initialState: {
			systemPrompt: "You are running inside the FitClaw eval harness.",
			model: evalFauxModel,
			thinkingLevel: "off",
			tools: createEvalTools(workspaceDir),
		},
		convertToLlm: convertAgentMessages,
		streamFn: createEvalFauxStream(task.fauxResponses),
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
	const toolCalls = extractToolCalls(events);
	const turnCount = events.filter((event) => event.type === "turn_end").length;
	const graderResults = gradeEvalTask(task.graders, { workspaceDir, finalAnswer, toolCalls, turnCount });
	writeTranscript(transcriptPath, events);

	return {
		taskId: task.id,
		suite: task.suite,
		trialIndex,
		passed: graderResults.every((result) => result.passed),
		finalAnswer,
		toolCalls,
		graderResults,
		transcriptPath,
		metrics: {
			turnCount,
			toolCallCount: toolCalls.length,
			durationMs: Date.now() - startedAt,
		},
	};
}
