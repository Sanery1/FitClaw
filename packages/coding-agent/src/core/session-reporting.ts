import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentMessage, AgentState } from "@fitclaw/agent-core";
import type { AssistantMessage } from "@fitclaw/ai";
import { theme } from "../modes/interactive/theme/theme.js";
import { calculateContextTokens, estimateContextTokens } from "./compaction/index.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.js";
import type { ContextUsage, ToolDefinition } from "./extensions/index.js";
import {
	CURRENT_SESSION_VERSION,
	getLatestCompactionEntry,
	type SessionHeader,
	type SessionManager,
} from "./session-manager.js";

export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: ContextUsage;
}

interface SessionHtmlExportOptions {
	sessionManager: SessionManager;
	state: AgentState;
	themeName?: string;
	getToolDefinition: (name: string) => ToolDefinition | undefined;
	outputPath?: string;
}

export function getSessionStats(state: AgentState, sessionManager: SessionManager): SessionStats {
	const userMessages = state.messages.filter((message) => message.role === "user").length;
	const assistantMessages = state.messages.filter((message) => message.role === "assistant").length;
	const toolResults = state.messages.filter((message) => message.role === "toolResult").length;

	let toolCalls = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

	for (const message of state.messages) {
		if (message.role === "assistant") {
			const assistant = message as AssistantMessage;
			toolCalls += assistant.content.filter((content) => content.type === "toolCall").length;
			totalInput += assistant.usage.input;
			totalOutput += assistant.usage.output;
			totalCacheRead += assistant.usage.cacheRead;
			totalCacheWrite += assistant.usage.cacheWrite;
			totalCost += assistant.usage.cost.total;
		}
	}

	return {
		sessionFile: sessionManager.getSessionFile(),
		sessionId: sessionManager.getSessionId(),
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages: state.messages.length,
		tokens: {
			input: totalInput,
			output: totalOutput,
			cacheRead: totalCacheRead,
			cacheWrite: totalCacheWrite,
			total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
		},
		cost: totalCost,
		contextUsage: getSessionContextUsage(state, sessionManager),
	};
}

export function getSessionContextUsage(state: AgentState, sessionManager: SessionManager): ContextUsage | undefined {
	const model = state.model;
	if (!model) return undefined;

	const contextWindow = model.contextWindow ?? 0;
	if (contextWindow <= 0) return undefined;

	const branchEntries = sessionManager.getBranch();
	const latestCompaction = getLatestCompactionEntry(branchEntries);

	if (latestCompaction) {
		const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
		let hasPostCompactionUsage = false;
		for (let index = branchEntries.length - 1; index > compactionIndex; index--) {
			const entry = branchEntries[index];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const assistant = entry.message;
				if (assistant.stopReason === "aborted" || assistant.stopReason === "error") continue;
				hasPostCompactionUsage = calculateContextTokens(assistant.usage) > 0;
				break;
			}
		}

		if (!hasPostCompactionUsage) {
			return { tokens: null, contextWindow, percent: null };
		}
	}

	const estimate = estimateContextTokens(state.messages);
	return {
		tokens: estimate.tokens,
		contextWindow,
		percent: (estimate.tokens / contextWindow) * 100,
	};
}

export async function exportSessionHtml(options: SessionHtmlExportOptions): Promise<string> {
	const toolRenderer = createToolHtmlRenderer({
		getToolDefinition: options.getToolDefinition,
		theme,
		cwd: options.sessionManager.getCwd(),
	});

	return exportSessionToHtml(options.sessionManager, options.state, {
		outputPath: options.outputPath,
		themeName: options.themeName,
		toolRenderer,
	});
}

export function exportSessionJsonl(sessionManager: SessionManager, outputPath?: string): string {
	const filePath = resolve(outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
	const directory = dirname(filePath);
	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}

	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: sessionManager.getSessionId(),
		timestamp: new Date().toISOString(),
		cwd: sessionManager.getCwd(),
	};

	const lines = [JSON.stringify(header)];
	let previousId: string | null = null;
	for (const entry of sessionManager.getBranch()) {
		lines.push(JSON.stringify({ ...entry, parentId: previousId }));
		previousId = entry.id;
	}

	writeFileSync(filePath, `${lines.join("\n")}\n`);
	return filePath;
}

export function getLastAssistantText(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;

		const assistant = message as AssistantMessage;
		if (assistant.stopReason === "aborted" && assistant.content.length === 0) continue;

		const text = assistant.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("")
			.trim();
		return text || undefined;
	}

	return undefined;
}
