import { Agent, type AgentEvent } from "@fitclaw/agent-core";
import type { ImageContent } from "@fitclaw/ai";
import {
	AgentSession,
	AuthStorage,
	convertToLlm,
	createExtensionRuntime,
	createSkillDataReadTool,
	createSkillDataWriteTool,
	FileSportDataStore,
	formatSkillsForPrompt,
	loadSkillsFromDir,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	type Skill,
} from "@fitclaw/claw";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createMomSettingsManager, syncLogToSessionManager } from "./context.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";
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

function getImageMimeType(filename: string): string | undefined {
	return IMAGE_MIME_TYPES[filename.toLowerCase().split(".").pop() || ""];
}

function getMemory(channelDir: string): string {
	const parts: string[] = [];

	// Read workspace-level memory (shared across all channels)
	const workspaceMemoryPath = join(channelDir, "..", "MEMORY.md");
	if (existsSync(workspaceMemoryPath)) {
		try {
			const content = readFileSync(workspaceMemoryPath, "utf-8").trim();
			if (content) {
				parts.push(`### Global Workspace Memory\n${content}`);
			}
		} catch (error) {
			log.logWarning("Failed to read workspace memory", `${workspaceMemoryPath}: ${error}`);
		}
	}

	// Read channel-specific memory
	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) {
				parts.push(`### Channel-Specific Memory\n${content}`);
			}
		} catch (error) {
			log.logWarning("Failed to read channel memory", `${channelMemoryPath}: ${error}`);
		}
	}

	if (parts.length === 0) {
		return "(no working memory yet)";
	}

	return parts.join("\n\n");
}

function loadMomSkills(channelDir: string, workspacePath: string): Skill[] {
	const skillMap = new Map<string, Skill>();

	// channelDir is the host path (e.g., /Users/.../data/C0A34FL8PMH)
	// hostWorkspacePath is the parent directory on host
	// workspacePath is the container path (e.g., /workspace)
	const hostWorkspacePath = join(channelDir, "..");

	// Helper to translate host paths to container paths
	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(hostWorkspacePath)) {
			return workspacePath + hostPath.slice(hostWorkspacePath.length);
		}
		return hostPath;
	};

	// Load workspace-level skills (global)
	const workspaceSkillsDir = join(hostWorkspacePath, "skills");
	for (const skill of loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" }).skills) {
		// Translate paths to container paths for system prompt
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	// Load channel-specific skills (override workspace skills on collision)
	const channelSkillsDir = join(channelDir, "skills");
	for (const skill of loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" }).skills) {
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}

function buildSystemPrompt(workspacePath: string, channelId: string, memory: string, skills: Skill[]): string {
	const channelPath = `${workspacePath}/${channelId}`;
	const skillsSection = formatSkillsForPrompt(skills);
	return `You are FitCoach, an AI fitness personal trainer powered by FitClaw. Be concise, professional, and encouraging. No emojis.

## Your Role
You are FitCoach (FitClaw AI), a fitness personal trainer. Keep responses SHORT — 1-3 sentences for simple questions. Do NOT list your capabilities unless specifically asked. For "who are you" / "你是谁", just say: "我是 FitCoach，AI 健身私教。有什么可以帮你的？"

Maintain a fitness-coach tone: motivating, knowledgeable, and supportive.

## Context
- Current date: use the \`date\` bash command if needed.
- You have access to previous conversation context including tool results from prior turns.

## Formatting
Use plain text with clear structure and line breaks. Avoid complex formatting.
${skillsSection}

## Memory
Write to MEMORY.md to remember user preferences, injuries, and goals across conversations.
- Global: ${workspacePath}/MEMORY.md
- Channel: ${channelPath}/MEMORY.md

### Current Memory
${memory}

## Skills
${skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)"}

## Tools
### General Tools
- bash: Run shell commands (primary tool). Install packages as needed.
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits
- attach: Share files to chat

### Fitness Tools
Use the available fitness tools to query exercises, log workouts, track body metrics,
manage training plans, and record progress. Each tool requires a "label" parameter.
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.substring(0, maxLen - 3)}...`;
}

function extractToolResultText(result: unknown): string {
	if (typeof result === "string") {
		return result;
	}

	if (
		result &&
		typeof result === "object" &&
		"content" in result &&
		Array.isArray((result as { content: unknown }).content)
	) {
		const content = (result as { content: Array<{ type: string; text?: string }> }).content;
		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	return JSON.stringify(result);
}

function formatToolArgs(_toolName: string, args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined && limit !== undefined) {
				lines.push(`${value}:${offset}-${offset + limit}`);
			} else {
				lines.push(value);
			}
			continue;
		}

		if (key === "offset" || key === "limit") continue;

		if (typeof value === "string") {
			lines.push(value);
		} else {
			lines.push(JSON.stringify(value));
		}
	}

	return lines.join("\n");
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
	const workspacePath = executor.getWorkspacePath(join(channelDir, ".."));

	// Create tools
	const tools = createMomTools(executor);

	// Initial system prompt (will be updated each run with fresh memory/channels/users/skills)
	const memory = getMemory(channelDir);
	const skills = loadMomSkills(channelDir, workspacePath);
	const systemPrompt = buildSystemPrompt(workspacePath, channelId, memory, skills);

	// Model B: auto-register data persistence tools for skills with data: declarations
	const sportDataDir = join(channelDir, "sport-data");
	process.env.FITCLAW_DATA_DIR = sportDataDir;
	for (const skill of skills) {
		if (skill.dataNamespaces && skill.dataNamespaces.size > 0) {
			const skillStore = new FileSportDataStore(channelDir);
			tools.push(
				createSkillDataReadTool(skillStore, skill.name, skill.dataNamespaces),
				createSkillDataWriteTool(skillStore, skill.name, skill.dataNamespaces),
			);
		}
	}

	// Create session manager and settings manager
	// Use a fixed context.jsonl file per channel (not timestamped like coding-agent)
	const contextFile = join(channelDir, "context.jsonl");
	const sessionManager = SessionManager.open(contextFile, channelDir);
	const settingsManager = createMomSettingsManager(join(channelDir, ".."));

	// Create AuthStorage and ModelRegistry
	// Auth stored outside workspace so agent can't access it
	const authStorage = AuthStorage.create(join(homedir(), ".fitclaw", "agent", "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage);

	// Resolve model from env vars, with fallback
	const llmProvider = process.env.MOM_LLM_PROVIDER || "MiniMax";
	const llmModelId = process.env.MOM_LLM_MODEL || "MiniMax-M2.7-highspeed";
	const resolvedModel = modelRegistry.find(llmProvider, llmModelId);
	if (!resolvedModel) {
		throw new Error(
			`Model not found: "${llmProvider}/${llmModelId}".\n` +
				"Configure models.json or set MOM_LLM_PROVIDER / MOM_LLM_MODEL env vars.",
		);
	}
	log.logInfo(`[${channelId}] Using model: ${llmProvider}/${llmModelId}`);

	// Create agent
	const agent = new Agent({
		initialState: {
			systemPrompt,
			model: resolvedModel,
			thinkingLevel: "off",
			tools,
		},
		convertToLlm,
		getApiKey: async () => {
			const auth = await modelRegistry.getApiKeyAndHeaders(resolvedModel);
			if (!auth.ok || !auth.apiKey) {
				throw new Error(
					`No API key found for "${resolvedModel.provider}".\n\n` +
						"Set API key via auth.json or environment variable (e.g., MINIMAX_API_KEY).",
				);
			}
			return auth.apiKey;
		},
	});

	// Load existing messages
	const loadedSession = sessionManager.buildSessionContext();
	if (loadedSession.messages.length > 0) {
		agent.state.messages = loadedSession.messages;
		log.logInfo(`[${channelId}] Loaded ${loadedSession.messages.length} messages from context.jsonl`);
	}

	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills, diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};

	const baseToolsOverride = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

	// Create AgentSession wrapper
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRegistry,
		resourceLoader,
		baseToolsOverride,
	});

	// Mutable per-run state - event handler references this
	const runState = {
		ctx: null as BotContext | null,
		logCtx: null as { channelId: string; userName?: string } | null,
		queue: null as {
			enqueue(fn: () => Promise<void>, errorContext: string): void;
			enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog?: boolean): void;
		} | null,
		pendingTools: new Map<string, { toolName: string; args: unknown; startTime: number }>(),
		totalUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		errorMessage: undefined as string | undefined,
	};

	// Subscribe to events ONCE
	session.subscribe(async (event) => {
		// Skip if no active run
		if (!runState.ctx || !runState.logCtx || !runState.queue) return;

		const { ctx, logCtx, queue, pendingTools } = runState;

		if (event.type === "tool_execution_start") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
			const args = agentEvent.args as { label?: string };
			const label = args.label || agentEvent.toolName;

			pendingTools.set(agentEvent.toolCallId, {
				toolName: agentEvent.toolName,
				args: agentEvent.args,
				startTime: Date.now(),
			});

			log.logToolStart(logCtx, agentEvent.toolName, label, agentEvent.args as Record<string, unknown>);
			queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
		} else if (event.type === "tool_execution_end") {
			const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
			const resultStr = extractToolResultText(agentEvent.result);
			const pending = pendingTools.get(agentEvent.toolCallId);
			pendingTools.delete(agentEvent.toolCallId);

			const durationMs = pending ? Date.now() - pending.startTime : 0;

			if (agentEvent.isError) {
				log.logToolError(logCtx, agentEvent.toolName, durationMs, resultStr);
			} else {
				log.logToolSuccess(logCtx, agentEvent.toolName, durationMs, resultStr);
			}

			// Post args + result to thread
			const label = pending?.args ? (pending.args as { label?: string }).label : undefined;
			const argsFormatted = pending
				? formatToolArgs(agentEvent.toolName, pending.args as Record<string, unknown>)
				: "(args not found)";
			const duration = (durationMs / 1000).toFixed(1);
			let threadMessage = `*${agentEvent.isError ? "✗" : "✓"} ${agentEvent.toolName}*`;
			if (label) threadMessage += `: ${label}`;
			threadMessage += ` (${duration}s)\n`;
			if (argsFormatted) threadMessage += `\`\`\`\n${argsFormatted}\n\`\`\`\n`;
			threadMessage += `*Result:*\n\`\`\`\n${resultStr}\n\`\`\``;

			queue.enqueueMessage(threadMessage, "thread", "tool result thread", false);

			if (agentEvent.isError) {
				queue.enqueue(() => ctx.respond(`_Error: ${truncate(resultStr, 200)}_`, false), "tool error");
			}
		} else if (event.type === "message_start") {
			const agentEvent = event as AgentEvent & { type: "message_start" };
			if (agentEvent.message.role === "assistant") {
				log.logResponseStart(logCtx);
			}
		} else if (event.type === "message_end") {
			const agentEvent = event as AgentEvent & { type: "message_end" };
			if (agentEvent.message.role === "assistant") {
				const assistantMsg = agentEvent.message as any;

				if (assistantMsg.stopReason) {
					runState.stopReason = assistantMsg.stopReason;
				}
				if (assistantMsg.errorMessage) {
					runState.errorMessage = assistantMsg.errorMessage;
				}

				if (assistantMsg.usage) {
					runState.totalUsage.input += assistantMsg.usage.input;
					runState.totalUsage.output += assistantMsg.usage.output;
					runState.totalUsage.cacheRead += assistantMsg.usage.cacheRead;
					runState.totalUsage.cacheWrite += assistantMsg.usage.cacheWrite;
					runState.totalUsage.cost.input += assistantMsg.usage.cost.input;
					runState.totalUsage.cost.output += assistantMsg.usage.cost.output;
					runState.totalUsage.cost.cacheRead += assistantMsg.usage.cost.cacheRead;
					runState.totalUsage.cost.cacheWrite += assistantMsg.usage.cost.cacheWrite;
					runState.totalUsage.cost.total += assistantMsg.usage.cost.total;
				}

				const content = agentEvent.message.content;
				const thinkingParts: string[] = [];
				const textParts: string[] = [];
				for (const part of content) {
					if (part.type === "thinking") {
						thinkingParts.push((part as any).thinking);
					} else if (part.type === "text") {
						textParts.push((part as any).text);
					}
				}

				const text = textParts.join("\n");

				for (const thinking of thinkingParts) {
					log.logThinking(logCtx, thinking);
					queue.enqueueMessage(`_${thinking}_`, "thread", "thinking thread", false);
				}

				if (text.trim()) {
					log.logResponse(logCtx, text);
					queue.enqueueMessage(text, "main", "response main");
					queue.enqueueMessage(text, "thread", "response thread", false);
				}
			}
		} else if (event.type === "compaction_start") {
			log.logInfo(`Compaction started (reason: ${event.reason})`);
			queue.enqueue(() => ctx.respond("_Compacting context..._", false), "compaction start");
		} else if (event.type === "compaction_end") {
			if (event.result) {
				log.logInfo(`Compaction complete: ${event.result.tokensBefore} tokens compacted`);
			} else if (event.aborted) {
				log.logInfo("Compaction aborted");
			}
		} else if (event.type === "auto_retry_start") {
			const retryEvent = event as any;
			log.logWarning(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})`, retryEvent.errorMessage);
			queue.enqueue(
				() => ctx.respond(`_Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})..._`, false),
				"retry",
			);
		}
	});

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
				agent.state.messages = reloadedSession.messages;
				log.logInfo(`[${channelId}] Reloaded ${reloadedSession.messages.length} messages from context`);
			}

			// Update system prompt with fresh memory, channel/user info, and skills
			const memory = getMemory(channelDir);
			const skills = loadMomSkills(channelDir, workspacePath);
			const systemPrompt = buildSystemPrompt(workspacePath, channelId, memory, skills);
			session.agent.state.systemPrompt = systemPrompt;

			// Set up file upload function
			setUploadFunction(async (filePath: string, title?: string) => {
				const hostPath = translateToHostPath(filePath, channelDir, workspacePath, channelId);
				await ctx.uploadFile(hostPath, title);
			});

			// Reset per-run state
			runState.ctx = ctx;
			runState.logCtx = {
				channelId: ctx.message.channel,
				userName: ctx.message.userName,
			};
			runState.pendingTools.clear();
			runState.totalUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
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
			log.logInfo(`Context sizes - system: ${systemPrompt.length} chars, memory: ${memory.length} chars`);
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
				const fullPath = `${workspacePath}/${a.local}`;
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

			await session.prompt(userMessage, imageAttachments.length > 0 ? { images: imageAttachments } : undefined);

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
					.find((m) => m.role === "assistant" && (m as any).stopReason !== "aborted") as any;

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
function translateToHostPath(
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
