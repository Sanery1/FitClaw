/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import type { Agent, AgentEvent, AgentMessage, AgentState, AgentTool, ThinkingLevel } from "@fitclaw/agent-core";
import type { AssistantMessage, ImageContent, Model, TextContent } from "@fitclaw/ai";
import {
	AgentCompactionController,
	type AgentCompactionEvent,
	AgentRetryController,
	type AgentRetryEvent,
} from "@fitclaw/runtime";
import { formatNoApiKeyFoundMessage } from "./auth-guidance.js";
import type { BashResult } from "./bash-executor.js";
import { type CompactionResult, compact, prepareCompaction } from "./compaction/index.js";
import type {
	ContextUsage,
	ExtensionRunner,
	ReplacedSessionContext,
	SessionBeforeCompactResult,
	SessionStartEvent,
	ToolDefinition,
	ToolInfo,
} from "./extensions/index.js";
import { ManualCompactionController, type ManualCompactionEvent } from "./manual-compaction-controller.js";
import type { CustomMessage } from "./messages.js";
import type { ModelRegistry } from "./model-registry.js";
import type { PromptTemplate } from "./prompt-templates.js";
import type { ResourceLoader } from "./resource-loader.js";
import { SessionBashController, type SessionBashExecutionOptions } from "./session-bash-controller.js";
import { SessionEventController } from "./session-event-controller.js";
import { type ExtensionBindings, SessionExtensionController } from "./session-extension-controller.js";
import type { SessionManager } from "./session-manager.js";
import { SessionMessageQueueController } from "./session-message-queue-controller.js";
import { type ModelCycleResult, SessionModelController, type SessionScopedModel } from "./session-model-controller.js";
import { type PromptOptions, SessionPromptController } from "./session-prompt-controller.js";
import {
	exportSessionHtml,
	exportSessionJsonl,
	getLastAssistantText,
	getSessionContextUsage,
	getSessionStats,
	type SessionStats,
} from "./session-reporting.js";
import { SessionToolController } from "./session-tool-controller.js";
import {
	type ForkableUserMessage,
	SessionTreeController,
	type SessionTreeNavigationOptions,
	type SessionTreeNavigationResult,
} from "./session-tree-controller.js";
import type { SettingsManager } from "./settings-manager.js";

export type { ExtensionBindings } from "./session-extension-controller.js";
export type { ModelCycleResult } from "./session-model-controller.js";
export type { PromptOptions } from "./session-prompt-controller.js";
export type { SessionStats } from "./session-reporting.js";
export { type ParsedSkillBlock, parseSkillBlock } from "./skill-block.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| { type: "session_info_changed"; name: string | undefined }
	| ManualCompactionEvent
	| AgentCompactionEvent
	| AgentRetryEvent;

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: SessionScopedModel[];
	/** Resource loader for skills, prompts, themes, context files, system prompt */
	resourceLoader: ResourceLoader;
	/** SDK custom tools registered outside extensions */
	customTools?: ToolDefinition[];
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Initial active built-in tool names. Default: [read, bash, edit, write] */
	initialActiveToolNames?: string[];
	/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
	allowedToolNames?: string[];
	/**
	 * Override base tools (useful for custom runtimes).
	 *
	 * These are synthesized into minimal ToolDefinitions internally so AgentSession can keep
	 * a definition-first registry even when callers provide plain AgentTool instances.
	 */
	baseToolsOverride?: Record<string, AgentTool>;
	/** Mutable ref used by Agent to access the current ExtensionRunner */
	extensionRunnerRef?: { current?: ExtensionRunner };
	/** Session start event metadata emitted when extensions bind to this runtime. */
	sessionStartEvent?: SessionStartEvent;
}

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private readonly _modelController: SessionModelController;

	private _eventListeners: AgentSessionEventListener[] = [];
	private readonly _eventController: SessionEventController;

	private readonly _messageQueueController: SessionMessageQueueController;
	private readonly _promptController: SessionPromptController;
	private readonly _toolController: SessionToolController;
	private readonly _extensionController: SessionExtensionController;

	// Compaction state
	private readonly _compactionController: AgentCompactionController;
	private readonly _manualCompactionController: ManualCompactionController;

	private readonly _treeController: SessionTreeController;

	private readonly _retryController: AgentRetryController;

	private readonly _bashController: SessionBashController;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._modelRegistry = config.modelRegistry;
		this._toolController = new SessionToolController({
			agent: this.agent,
			settingsManager: this.settingsManager,
			cwd: config.cwd,
			customTools: config.customTools,
			allowedToolNames: config.allowedToolNames,
			baseToolsOverride: config.baseToolsOverride,
			getExtensionRunner: () => this._extensionController.runner,
			getResourceLoader: () => this._extensionController.resourceLoader,
		});
		this._retryController = new AgentRetryController({
			agent: this.agent,
			getSettings: () => this.settingsManager.getRetrySettings(),
			emit: (event) => this._emit(event),
		});
		this._compactionController = new AgentCompactionController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			modelRegistry: this._modelRegistry,
			getSettings: () => this.settingsManager.getCompactionSettings(),
			emit: (event) => this._emit(event),
			compact,
			prepareCompaction,
			requestCompaction: (reason, willRetry) => this._runAutoCompaction(reason, willRetry),
			beforeCompact: async ({ preparation, branchEntries, signal }) => {
				if (!this._extensionController.runner.hasHandlers("session_before_compact")) return undefined;
				const extensionResult = (await this._extensionController.runner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries,
					customInstructions: undefined,
					signal,
				})) as SessionBeforeCompactResult | undefined;
				return {
					cancel: extensionResult?.cancel,
					compaction: extensionResult?.compaction,
					fromHook: extensionResult?.compaction !== undefined,
				};
			},
			afterCompact: async ({ compactionEntry, fromHook }) => {
				await this._extensionController.runner.emit({
					type: "session_compact",
					compactionEntry,
					fromExtension: fromHook,
				});
			},
		});
		this._manualCompactionController = new ManualCompactionController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			settingsManager: this.settingsManager,
			getModel: () => this.model,
			getRequiredRequestAuth: (model) => this._getRequiredRequestAuth(model),
			getExtensionRunner: () => this._extensionController.runner,
			emit: (event) => this._emit(event),
		});
		this._treeController = new SessionTreeController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			settingsManager: this.settingsManager,
			getModel: () => this.model,
			getRequiredRequestAuth: (model) => this._getRequiredRequestAuth(model),
			getExtensionRunner: () => this._extensionController.runner,
		});
		this._bashController = new SessionBashController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			settingsManager: this.settingsManager,
		});
		this._modelController = new SessionModelController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			settingsManager: this.settingsManager,
			modelRegistry: this._modelRegistry,
			getExtensionRunner: () => this._extensionController.runner,
			scopedModels: config.scopedModels,
		});
		this._messageQueueController = new SessionMessageQueueController({
			agent: this.agent,
			onUpdate: ({ steering, followUp }) => {
				this._emit({ type: "queue_update", steering, followUp });
			},
		});
		this._eventController = new SessionEventController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			retryController: this._retryController,
			compactionController: this._compactionController,
			messageQueueController: this._messageQueueController,
			emitExtensionEvent: (event) => this._extensionController.emitAgentEvent(event),
			emit: (event) => this._emit(event),
			checkCompaction: (message) => this._checkCompaction(message),
		});
		this._promptController = new SessionPromptController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			modelRegistry: this._modelRegistry,
			bashController: this._bashController,
			messageQueueController: this._messageQueueController,
			retryController: this._retryController,
			getExtensionRunner: () => this._extensionController.runner,
			getResourceLoader: () => this._extensionController.resourceLoader,
			getBaseSystemPrompt: () => this._toolController.getBaseSystemPrompt(),
			checkCompaction: (message, skipAbortedCheck) => this._checkCompaction(message, skipAbortedCheck),
			waitForPendingEvents: () => this._eventController.waitForPendingEvents(),
			emit: (event) => this._emit(event),
		});
		this._extensionController = new SessionExtensionController({
			agent: this.agent,
			sessionManager: this.sessionManager,
			settingsManager: this.settingsManager,
			modelRegistry: this._modelRegistry,
			modelController: this._modelController,
			promptController: this._promptController,
			toolController: this._toolController,
			resourceLoader: config.resourceLoader,
			cwd: config.cwd,
			extensionRunnerRef: config.extensionRunnerRef,
			sessionStartEvent: config.sessionStartEvent,
			waitForPendingEvents: () => this._eventController.waitForPendingEvents(),
			abort: () => this.abort(),
			getPendingMessageCount: () => this.pendingMessageCount,
			setSessionName: (name) => this.setSessionName(name),
			getContextUsage: () => this.getContextUsage(),
			compact: (customInstructions) => this.compact(customInstructions),
		});
		this._extensionController.initialize(config.initialActiveToolNames);

		// Always subscribe to agent events for internal handling
		// (session persistence, extensions, auto-compaction, retry logic)
		this._eventController.connect();
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	private async _getRequiredRequestAuth(model: Model<any>): Promise<{
		apiKey: string;
		headers?: Record<string, string>;
	}> {
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		if (!result.ok) {
			if (result.error.startsWith("No API key found")) {
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}
			throw new Error(result.error);
		}
		if (result.apiKey) {
			return { apiKey: result.apiKey, headers: result.headers };
		}

		const isOAuth = this._modelRegistry.isUsingOAuth(model);
		if (isOAuth) {
			throw new Error(
				`Authentication failed for "${model.provider}". ` +
					`Credentials may have expired or network is unavailable. ` +
					`Run '/login ${model.provider}' to re-authenticate.`,
			);
		}
		throw new Error(formatNoApiKeyFoundMessage(model.provider));
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		this._retryController.abort();
		this._compactionController.abort();
		this._manualCompactionController.abort();
		this._treeController.abort();
		this._bashController.abort();
		this._extensionController.dispose();
		this._eventController.disconnect();
		this._eventListeners = [];
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this._modelController.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this._modelController.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryController.attempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this._toolController.getActiveToolNames();
	}

	/**
	 * Get all configured tools with name, description, parameter schema, and source metadata.
	 */
	getAllTools(): ToolInfo[] {
		return this._toolController.getAllTools();
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this._toolController.getToolDefinition(name);
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	setActiveToolsByName(toolNames: string[]): void {
		this._toolController.setActiveToolsByName(toolNames);
	}

	/** Whether compaction or branch summarization is currently running */
	get isCompacting(): boolean {
		return (
			this._compactionController.isCompacting ||
			this._manualCompactionController.isCompacting ||
			this._treeController.isSummarizing
		);
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.steeringMode;
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.followUpMode;
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this._modelController.scopedModels;
	}

	/** Update scoped models for cycling */
	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._modelController.setScopedModels(scopedModels);
	}

	/** File-based prompt templates */
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this._extensionController.resourceLoader.getPrompts().prompts;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		await this._promptController.prompt(text, options);
	}

	/**
	 * Queue a steering message while the agent is running.
	 * Delivered after the current assistant turn finishes executing its tool calls,
	 * before the next LLM call.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		await this._promptController.steer(text, images);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		await this._promptController.followUp(text, images);
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Custom message with customType, content, display, details
	 * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
	 * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		await this._promptController.sendCustomMessage(message, options);
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		await this._promptController.sendUserMessage(content, options);
	}

	/**
	 * Clear all queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 * @returns Object with steering and followUp arrays
	 */
	clearQueue(): { steering: string[]; followUp: string[] } {
		return this._messageQueueController.clear();
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get pendingMessageCount(): number {
		return this._messageQueueController.pendingCount;
	}

	/** Get pending steering messages (read-only) */
	getSteeringMessages(): readonly string[] {
		return this._messageQueueController.getSteeringMessages();
	}

	/** Get pending follow-up messages (read-only) */
	getFollowUpMessages(): readonly string[] {
		return this._messageQueueController.getFollowUpMessages();
	}

	get resourceLoader(): ResourceLoader {
		return this._extensionController.resourceLoader;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Set model directly.
	 * Validates that auth is configured, saves to session and settings.
	 * @throws Error if no auth is configured for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		await this._modelController.setModel(model);
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		return this._modelController.cycleModel(direction);
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		this._modelController.setThinkingLevel(level);
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		return this._modelController.cycleThinkingLevel();
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		return this._modelController.getAvailableThinkingLevels();
	}

	/**
	 * Check if current model supports xhigh thinking level.
	 */
	supportsXhighThinking(): boolean {
		return this._modelController.supportsXhighThinking();
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return this._modelController.supportsThinking();
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	/**
	 * Set steering message mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.steeringMode = mode;
		this.settingsManager.setSteeringMode(mode);
	}

	/**
	 * Set follow-up message mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.followUpMode = mode;
		this.settingsManager.setFollowUpMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		this._eventController.disconnect();
		try {
			await this.abort();
			return await this._manualCompactionController.compact(customInstructions);
		} finally {
			this._eventController.connect();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._manualCompactionController.abort();
		this._compactionController.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._treeController.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		return this._compactionController.check(assistantMessage, skipAbortedCheck);
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
		return this._compactionController.run(reason, willRetry);
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		await this._extensionController.bindExtensions(bindings);
	}

	async reload(): Promise<void> {
		await this._extensionController.reload();
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryController.abort();
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryController.isRetrying;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 * @param options.operations Custom BashOperations for remote execution
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: SessionBashExecutionOptions,
	): Promise<BashResult> {
		return this._bashController.execute(command, onChunk, options);
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		this._bashController.record(command, result, options);
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashController.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashController.isRunning;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._bashController.hasPendingMessages;
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.appendSessionInfo(name);
		this._emit({ type: "session_info_changed", name: this.sessionManager.getSessionName() });
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike fork() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @param options.replaceInstructions If true, customInstructions replaces the default prompt
	 * @param options.label Label to attach to the branch summary entry
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: SessionTreeNavigationOptions = {},
	): Promise<SessionTreeNavigationResult> {
		return this._treeController.navigate(targetId, options);
	}

	/**
	 * Get all user messages from session for fork selector.
	 */
	getUserMessagesForForking(): ForkableUserMessage[] {
		return this._treeController.getUserMessagesForForking();
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		return getSessionStats(this.state, this.sessionManager);
	}

	getContextUsage(): ContextUsage | undefined {
		return getSessionContextUsage(this.state, this.sessionManager);
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		return exportSessionHtml({
			outputPath,
			sessionManager: this.sessionManager,
			state: this.state,
			themeName: this.settingsManager.getTheme(),
			getToolDefinition: (name) => this.getToolDefinition(name),
		});
	}

	/**
	 * Export the current session branch to a JSONL file.
	 * Writes the session header followed by all entries on the current branch path.
	 * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
	 * @returns The resolved output file path.
	 */
	exportToJsonl(outputPath?: string): string {
		return exportSessionJsonl(this.sessionManager, outputPath);
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		return getLastAssistantText(this.messages);
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	createReplacedSessionContext(): ReplacedSessionContext {
		return this._extensionController.createReplacedSessionContext();
	}

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this._extensionController.hasHandlers(eventType);
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner {
		return this._extensionController.runner;
	}
}
