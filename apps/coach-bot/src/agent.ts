import type { AssistantMessage, ImageContent } from "@fitclaw/ai";
import { buildCoachSystemPrompt } from "@fitclaw/coach-core";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { isAbsolute, join } from "path";
import { syncLogToSessionManager } from "./context.js";
import { type CoachContextWindowResult, getCoachContextWindowOptions, windowCoachContext } from "./context-window.js";
import * as log from "./log.js";
import { createCoachRunState, createCoachSessionEventHandler, createEmptyUsageTotals } from "./runtime/events.js";
import { createCoachSession } from "./runtime/session.js";
import {
	configureCoachSkillDataRoot,
	createCoachActiveTools,
	loadCoachSkills,
	resolveCoachHostWorkspacePath,
} from "./runtime/skills.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelStore } from "./store.js";
import type { BotContext } from "./types.js";

export interface PendingMessage {
	userName: string;
	text: string;
	attachments: { local: string }[];
	timestamp: number;
}

export interface AgentRunner {
	run(
		ctx: BotContext,
		store: ChannelStore,
		pendingMessages?: PendingMessage[],
	): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
};

function formatContextWindowStats(result: CoachContextWindowResult): string {
	if (!result.wasTrimmed) {
		return `${result.originalCount} messages`;
	}
	return `${result.originalCount} messages (${result.retainedCount} retained for prompt)`;
}

function getImageMimeType(filename: string): string | undefined {
	return IMAGE_MIME_TYPES[filename.toLowerCase().split(".").pop() || ""];
}

// Cache runners per channel
const channelRunners = new Map<string, AgentRunner>();

/**
 * Get or create an AgentRunner for a channel.
 * Runners are cached - one per channel, persistent across messages.
 */
export function getOrCreateRunner(sandboxConfig: SandboxConfig, channelId: string, channelDir: string): AgentRunner {
	const existing = channelRunners.get(channelId);
	if (existing) return existing;

	const runner = createRunner(sandboxConfig, channelId, channelDir);
	channelRunners.set(channelId, runner);
	return runner;
}

/**
 * Create a new AgentRunner for a channel.
 * Sets up the session and subscribes to events once.
 */
function createRunner(sandboxConfig: SandboxConfig, channelId: string, channelDir: string): AgentRunner {
	const executor = createExecutor(sandboxConfig);
	const hostWorkspacePath = resolveCoachHostWorkspacePath(channelDir, channelId);
	const workspacePath = executor.getWorkspacePath(hostWorkspacePath);

	// Initial system prompt (updated each run with freshly loaded skills)
	const skills = loadCoachSkills(channelDir, workspacePath, hostWorkspacePath);
	const systemPrompt = buildCoachSystemPrompt(skills);

	// Model B: auto-register data persistence tools for skills with data: declarations
	configureCoachSkillDataRoot(channelDir);
	const tools = createCoachActiveTools(executor, channelDir, skills);

	const contextWindowOptions = getCoachContextWindowOptions();
	const session = createCoachSession({
		channelDir,
		systemPrompt,
		tools,
	});
	const { model: resolvedModel, sessionManager } = session;
	log.logInfo(`[${channelId}] Using model: ${resolvedModel.provider}/${resolvedModel.id}`);

	// Load existing messages
	const loadedSession = sessionManager.buildSessionContext();
	if (loadedSession.messages.length > 0) {
		const windowedContext = windowCoachContext(loadedSession.messages, contextWindowOptions);
		session.agent.state.messages = windowedContext.messages;
		log.logInfo(`[${channelId}] Loaded ${formatContextWindowStats(windowedContext)} from context.jsonl`);
	}

	const runState = createCoachRunState();
	session.subscribe(createCoachSessionEventHandler(runState));

	const MAX_MESSAGE_LENGTH = 30000;
	const splitMessage = (text: string): string[] => {
		if (text.length <= MAX_MESSAGE_LENGTH) return [text];
		const parts: string[] = [];
		let remaining = text;
		let partNum = 1;
		while (remaining.length > 0) {
			const chunk = remaining.substring(0, MAX_MESSAGE_LENGTH - 50);
			remaining = remaining.substring(MAX_MESSAGE_LENGTH - 50);
			const suffix = remaining.length > 0 ? `\n_(continued ${partNum}...)_` : "";
			parts.push(chunk + suffix);
			partNum++;
		}
		return parts;
	};

	return {
		async run(
			ctx: BotContext,
			_store: ChannelStore,
			_pendingMessages?: PendingMessage[],
		): Promise<{ stopReason: string; errorMessage?: string }> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			// Sync messages from log.jsonl that arrived while we were offline or busy
			// Exclude the current message (it will be added via prompt())
			const syncedCount = syncLogToSessionManager(sessionManager, channelDir, ctx.message.ts);
			if (syncedCount > 0) {
				log.logInfo(`[${channelId}] Synced ${syncedCount} messages from log.jsonl`);
			}

			// Reload messages from context.jsonl
			// This picks up any messages synced above
			const reloadedSession = sessionManager.buildSessionContext();
			if (reloadedSession.messages.length > 0) {
				const windowedContext = windowCoachContext(reloadedSession.messages, contextWindowOptions);
				session.agent.state.messages = windowedContext.messages;
				log.logInfo(`[${channelId}] Reloaded ${formatContextWindowStats(windowedContext)} from context`);
			}

			// Update the system prompt and tools with freshly loaded skills
			const skills = loadCoachSkills(channelDir, workspacePath, hostWorkspacePath);
			const systemPrompt = buildCoachSystemPrompt(skills);
			const activeTools = createCoachActiveTools(executor, channelDir, skills);
			session.updateRuntime(systemPrompt, activeTools);

			// Reset per-run state
			runState.ctx = ctx;
			runState.logCtx = {
				channelId: ctx.message.channel,
				userName: ctx.message.userName,
			};
			runState.pendingTools.clear();
			runState.totalUsage = createEmptyUsageTotals();
			runState.stopReason = "stop";
			runState.errorMessage = undefined;

			// Create queue for this run
			let queueChain = Promise.resolve();
			runState.queue = {
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					queueChain = queueChain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning(`Bot API error (${errorContext})`, errMsg);
							try {
								await ctx.respondInThread(`_Error: ${errMsg}_`);
							} catch {
								// Ignore
							}
						}
					});
				},
				enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog = true): void {
					const parts = splitMessage(text);
					for (const part of parts) {
						this.enqueue(
							() => (target === "main" ? ctx.respond(part, doLog) : ctx.respondInThread(part)),
							errorContext,
						);
					}
				},
			};

			// Log context info
			log.logInfo(`Context size - system: ${systemPrompt.length} chars`);
			log.logInfo(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);

			// Build user message with timestamp and username prefix
			// Format: "[YYYY-MM-DD HH:MM:SS+HH:MM] [username]: message" so LLM knows when and who
			const now = new Date();
			const pad = (n: number) => n.toString().padStart(2, "0");
			const offset = -now.getTimezoneOffset();
			const offsetSign = offset >= 0 ? "+" : "-";
			const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
			const offsetMins = pad(Math.abs(offset) % 60);
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
			let userMessage = `[${timestamp}] [${ctx.message.userName || "unknown"}]: ${ctx.message.text}`;

			const imageAttachments: ImageContent[] = [];
			const nonImagePaths: string[] = [];

			for (const a of ctx.message.attachments || []) {
				if (!a.local) continue;
				const fullPath = isAbsolute(a.local) ? a.local : `${workspacePath}/${a.local}`;
				const mimeType = getImageMimeType(a.local);

				if (mimeType && existsSync(fullPath)) {
					try {
						imageAttachments.push({
							type: "image",
							mimeType,
							data: readFileSync(fullPath).toString("base64"),
						});
					} catch {
						nonImagePaths.push(fullPath);
					}
				} else {
					nonImagePaths.push(fullPath);
				}
			}

			if (nonImagePaths.length > 0) {
				userMessage += `\n\n<attachments>\n${nonImagePaths.join("\n")}\n</attachments>`;
			}

			// Debug: write context to last_prompt.jsonl
			const debugContext = {
				systemPrompt,
				messages: session.messages,
				newUserMessage: userMessage,
				imageAttachmentCount: imageAttachments.length,
			};
			await writeFile(join(channelDir, "last_prompt.jsonl"), JSON.stringify(debugContext, null, 2));

			await session.prompt(userMessage, imageAttachments);

			// Wait for queued messages
			await queueChain;

			// Handle error case - update main message and post error to thread
			if (runState.stopReason === "error" && runState.errorMessage) {
				try {
					await ctx.replaceMessage("_Sorry, something went wrong_");
					await ctx.respondInThread(`_Error: ${runState.errorMessage}_`);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					log.logWarning("Failed to post error message", errMsg);
				}
			} else {
				// Final message update
				const messages = session.messages;
				const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
				const finalText =
					lastAssistant?.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n") || "";

				// Check for [SILENT] marker - delete message and thread instead of posting
				if (finalText.trim() === "[SILENT]" || finalText.trim().startsWith("[SILENT]")) {
					try {
						await ctx.deleteMessage();
						log.logInfo("Silent response - deleted message and thread");
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						log.logWarning("Failed to delete message for silent response", errMsg);
					}
				} else if (finalText.trim()) {
					try {
						const mainText =
							finalText.length > MAX_MESSAGE_LENGTH
								? `${finalText.substring(0, MAX_MESSAGE_LENGTH - 50)}\n\n_(see thread for full response)_`
								: finalText;
						await ctx.replaceMessage(mainText);
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						log.logWarning("Failed to replace message with final text", errMsg);
					}
				}
			}

			// Log usage summary with context info
			if (runState.totalUsage.cost.total > 0) {
				// Get last non-aborted assistant message for context calculation
				const messages = session.messages;
				const lastAssistantMessage = messages
					.slice()
					.reverse()
					.find(
						(message): message is AssistantMessage =>
							message.role === "assistant" && message.stopReason !== "aborted",
					);

				const contextTokens = lastAssistantMessage
					? lastAssistantMessage.usage.input +
						lastAssistantMessage.usage.output +
						lastAssistantMessage.usage.cacheRead +
						lastAssistantMessage.usage.cacheWrite
					: 0;
				const contextWindow = resolvedModel.contextWindow || 200000;

				const summary = log.logUsageSummary(runState.logCtx!, runState.totalUsage, contextTokens, contextWindow);
				runState.queue.enqueue(() => ctx.respondInThread(summary), "usage summary");
				await queueChain;
			}

			// Clear run state
			runState.ctx = null;
			runState.logCtx = null;
			runState.queue = null;

			return { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
		},

		abort(): void {
			session.abort();
		},
	};
}

/**
 * Translate container path back to host path for file operations
 */
function _translateToHostPath(
	containerPath: string,
	channelDir: string,
	workspacePath: string,
	channelId: string,
): string {
	if (workspacePath === "/workspace") {
		const prefix = `/workspace/${channelId}/`;
		if (containerPath.startsWith(prefix)) {
			return join(channelDir, containerPath.slice(prefix.length));
		}
		if (containerPath.startsWith("/workspace/")) {
			return join(channelDir, "..", containerPath.slice("/workspace/".length));
		}
	}
	return containerPath;
}
