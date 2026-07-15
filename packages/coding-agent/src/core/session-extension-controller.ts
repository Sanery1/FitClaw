import { basename, dirname } from "node:path";
import type { Agent } from "@fitclaw/agent-core";
import { resetApiProviders } from "@fitclaw/ai";
import type { CompactionResult } from "./compaction/index.js";
import type {
	ContextUsage,
	ExtensionCommandContextActions,
	ExtensionErrorListener,
	ExtensionUIContext,
	ReplacedSessionContext,
	SessionStartEvent,
	ShutdownHandler,
} from "./extensions/index.js";
import { ExtensionRunner } from "./extensions/index.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import type { ModelRegistry } from "./model-registry.js";
import type { ResourceExtensionPaths, ResourceLoader } from "./resource-loader.js";
import { SessionExtensionEventBridge } from "./session-extension-event-bridge.js";
import type { SessionManager } from "./session-manager.js";
import type { SessionModelController } from "./session-model-controller.js";
import type { SessionPromptController } from "./session-prompt-controller.js";
import type { SessionToolController } from "./session-tool-controller.js";
import type { SettingsManager } from "./settings-manager.js";
import type { SlashCommandInfo } from "./slash-commands.js";

const STALE_CONTEXT_MESSAGE =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	commandContextActions?: ExtensionCommandContextActions;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
}

interface SessionExtensionControllerOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	modelController: SessionModelController;
	promptController: SessionPromptController;
	toolController: SessionToolController;
	resourceLoader: ResourceLoader;
	cwd: string;
	extensionRunnerRef?: { current?: ExtensionRunner };
	sessionStartEvent?: SessionStartEvent;
	waitForPendingEvents: () => Promise<void>;
	abort: () => Promise<void>;
	getPendingMessageCount: () => number;
	setSessionName: (name: string) => void;
	getContextUsage: () => ContextUsage | undefined;
	compact: (customInstructions?: string) => Promise<CompactionResult>;
}

export class SessionExtensionController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly settingsManager: SettingsManager;
	private readonly modelRegistry: ModelRegistry;
	private readonly modelController: SessionModelController;
	private readonly promptController: SessionPromptController;
	private readonly toolController: SessionToolController;
	private readonly cwd: string;
	private readonly extensionRunnerRef: { current?: ExtensionRunner } | undefined;
	private readonly sessionStartEvent: SessionStartEvent;
	private readonly waitForPendingEvents: SessionExtensionControllerOptions["waitForPendingEvents"];
	private readonly abort: SessionExtensionControllerOptions["abort"];
	private readonly getPendingMessageCount: SessionExtensionControllerOptions["getPendingMessageCount"];
	private readonly setSessionName: SessionExtensionControllerOptions["setSessionName"];
	private readonly getContextUsage: SessionExtensionControllerOptions["getContextUsage"];
	private readonly compact: SessionExtensionControllerOptions["compact"];
	private readonly eventBridge: SessionExtensionEventBridge;
	private extensionRunner!: ExtensionRunner;
	private resourceLoaderValue: ResourceLoader;
	private uiContext: ExtensionUIContext | undefined;
	private commandContextActions: ExtensionCommandContextActions | undefined;
	private shutdownHandler: ShutdownHandler | undefined;
	private errorListener: ExtensionErrorListener | undefined;
	private errorUnsubscriber: (() => void) | undefined;

	constructor(options: SessionExtensionControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.settingsManager = options.settingsManager;
		this.modelRegistry = options.modelRegistry;
		this.modelController = options.modelController;
		this.promptController = options.promptController;
		this.toolController = options.toolController;
		this.resourceLoaderValue = options.resourceLoader;
		this.cwd = options.cwd;
		this.extensionRunnerRef = options.extensionRunnerRef;
		this.sessionStartEvent = options.sessionStartEvent ?? { type: "session_start", reason: "startup" };
		this.waitForPendingEvents = options.waitForPendingEvents;
		this.abort = options.abort;
		this.getPendingMessageCount = options.getPendingMessageCount;
		this.setSessionName = options.setSessionName;
		this.getContextUsage = options.getContextUsage;
		this.compact = options.compact;
		this.eventBridge = new SessionExtensionEventBridge(() => this.runner);
	}

	get runner(): ExtensionRunner {
		return this.extensionRunner;
	}

	get resourceLoader(): ResourceLoader {
		return this.resourceLoaderValue;
	}

	initialize(activeToolNames?: string[]): void {
		this.buildRuntime({ activeToolNames, includeAllExtensionTools: true });
		this.installAgentToolHooks();
	}

	async emitAgentEvent(event: Parameters<SessionExtensionEventBridge["emitAgentEvent"]>[0]): Promise<void> {
		await this.eventBridge.emitAgentEvent(event);
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		if (bindings.uiContext !== undefined) this.uiContext = bindings.uiContext;
		if (bindings.commandContextActions !== undefined) this.commandContextActions = bindings.commandContextActions;
		if (bindings.shutdownHandler !== undefined) this.shutdownHandler = bindings.shutdownHandler;
		if (bindings.onError !== undefined) this.errorListener = bindings.onError;

		this.applyBindings(this.runner);
		await this.runner.emit(this.sessionStartEvent);
		await this.extendResources(this.sessionStartEvent.reason === "reload" ? "reload" : "startup");
	}

	async reload(): Promise<void> {
		const previousFlagValues = this.runner.getFlagValues();
		await emitSessionShutdownEvent(this.runner, { type: "session_shutdown", reason: "reload" });
		await this.settingsManager.reload();
		resetApiProviders();
		await this.resourceLoaderValue.reload();
		this.buildRuntime({
			activeToolNames: this.toolController.getActiveToolNames(),
			flagValues: previousFlagValues,
			includeAllExtensionTools: true,
		});

		if (this.uiContext || this.commandContextActions || this.shutdownHandler || this.errorListener) {
			await this.runner.emit({ type: "session_start", reason: "reload" });
			await this.extendResources("reload");
		}
	}

	createReplacedSessionContext(): ReplacedSessionContext {
		const context = Object.defineProperties(
			{},
			Object.getOwnPropertyDescriptors(this.runner.createCommandContext()),
		) as ReplacedSessionContext;
		context.sendMessage = (message, options) => this.promptController.sendCustomMessage(message, options);
		context.sendUserMessage = (content, options) => this.promptController.sendUserMessage(content, options);
		return context;
	}

	hasHandlers(eventType: string): boolean {
		return this.runner.hasHandlers(eventType);
	}

	dispose(): void {
		this.errorUnsubscriber?.();
		this.errorUnsubscriber = undefined;
		this.runner.invalidate(STALE_CONTEXT_MESSAGE);
	}

	private installAgentToolHooks(): void {
		this.agent.beforeToolCall = async ({ toolCall, args }) => {
			const runner = this.runner;
			if (!runner.hasHandlers("tool_call")) return undefined;
			await this.waitForPendingEvents();
			try {
				return await runner.emitToolCall({
					type: "tool_call",
					toolName: toolCall.name,
					toolCallId: toolCall.id,
					input: args as Record<string, unknown>,
				});
			} catch (error) {
				if (error instanceof Error) throw error;
				throw new Error(`Extension failed, blocking execution: ${String(error)}`);
			}
		};

		this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
			const runner = this.runner;
			if (!runner.hasHandlers("tool_result")) return undefined;
			const hookResult = await runner.emitToolResult({
				type: "tool_result",
				toolName: toolCall.name,
				toolCallId: toolCall.id,
				input: args as Record<string, unknown>,
				content: result.content,
				details: result.details,
				isError,
			});
			return hookResult
				? {
						content: hookResult.content,
						details: hookResult.details,
						isError: hookResult.isError ?? isError,
					}
				: undefined;
		};
	}

	private async extendResources(reason: "startup" | "reload"): Promise<void> {
		if (!this.runner.hasHandlers("resources_discover")) return;
		const { skillPaths, promptPaths, themePaths } = await this.runner.emitResourcesDiscover(this.cwd, reason);
		if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) return;

		const extensionPaths: ResourceExtensionPaths = {
			skillPaths: this.buildExtensionResourcePaths(skillPaths),
			promptPaths: this.buildExtensionResourcePaths(promptPaths),
			themePaths: this.buildExtensionResourcePaths(themePaths),
		};
		this.resourceLoaderValue.extendResources(extensionPaths);
		this.toolController.rebuildSystemPrompt(this.toolController.getActiveToolNames());
	}

	private buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
		path: string;
		metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
	}> {
		return entries.map((entry) => ({
			path: entry.path,
			metadata: {
				source: this.getExtensionSourceLabel(entry.extensionPath),
				scope: "temporary",
				origin: "top-level",
				baseDir: entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath),
			},
		}));
	}

	private getExtensionSourceLabel(extensionPath: string): string {
		if (extensionPath.startsWith("<")) return `extension:${extensionPath.replace(/[<>]/g, "")}`;
		return `extension:${basename(extensionPath).replace(/\.(ts|js)$/, "")}`;
	}

	private applyBindings(runner: ExtensionRunner): void {
		runner.setUIContext(this.uiContext);
		runner.bindCommandContext(this.commandContextActions);
		this.errorUnsubscriber?.();
		this.errorUnsubscriber = this.errorListener ? runner.onError(this.errorListener) : undefined;
	}

	private bindCore(runner: ExtensionRunner): void {
		const getCommands = (): SlashCommandInfo[] => {
			const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			}));
			const templates: SlashCommandInfo[] = this.resourceLoaderValue.getPrompts().prompts.map((template) => ({
				name: template.name,
				description: template.description,
				source: "prompt",
				sourceInfo: template.sourceInfo,
			}));
			const skills: SlashCommandInfo[] = this.resourceLoaderValue.getSkills().skills.map((skill) => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourceInfo: skill.sourceInfo,
			}));
			return [...extensionCommands, ...templates, ...skills];
		};

		runner.bindCore(
			{
				sendMessage: (message, options) => {
					this.promptController.sendCustomMessage(message, options).catch((error) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_message",
							error: error instanceof Error ? error.message : String(error),
						});
					});
				},
				sendUserMessage: (content, options) => {
					this.promptController.sendUserMessage(content, options).catch((error) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_user_message",
							error: error instanceof Error ? error.message : String(error),
						});
					});
				},
				appendEntry: (customType, data) => this.sessionManager.appendCustomEntry(customType, data),
				setSessionName: (name) => this.setSessionName(name),
				getSessionName: () => this.sessionManager.getSessionName(),
				setLabel: (entryId, label) => this.sessionManager.appendLabelChange(entryId, label),
				getActiveTools: () => this.toolController.getActiveToolNames(),
				getAllTools: () => this.toolController.getAllTools(),
				setActiveTools: (toolNames) => this.toolController.setActiveToolsByName(toolNames),
				refreshTools: () => this.toolController.refresh(),
				getCommands,
				setModel: async (model) => {
					if (!this.modelRegistry.hasConfiguredAuth(model)) return false;
					await this.modelController.setModel(model);
					return true;
				},
				getThinkingLevel: () => this.modelController.thinkingLevel,
				setThinkingLevel: (level) => this.modelController.setThinkingLevel(level),
			},
			{
				getModel: () => this.modelController.model,
				isIdle: () => !this.agent.state.isStreaming,
				getSignal: () => this.agent.signal,
				abort: () => void this.abort(),
				hasPendingMessages: () => this.getPendingMessageCount() > 0,
				shutdown: () => this.shutdownHandler?.(),
				getContextUsage: () => this.getContextUsage(),
				compact: (options) => {
					void this.compact(options?.customInstructions)
						.then(options?.onComplete)
						.catch((error: unknown) => {
							options?.onError?.(error instanceof Error ? error : new Error(String(error)));
						});
				},
				getSystemPrompt: () => this.agent.state.systemPrompt,
			},
			{
				registerProvider: (name, config) => {
					this.modelRegistry.registerProvider(name, config);
					this.modelController.refreshCurrentModelFromRegistry();
				},
				unregisterProvider: (name) => {
					this.modelRegistry.unregisterProvider(name);
					this.modelController.refreshCurrentModelFromRegistry();
				},
			},
		);
	}

	private buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void {
		this.toolController.buildBaseToolDefinitions();
		const extensionsResult = this.resourceLoaderValue.getExtensions();
		if (options.flagValues) {
			for (const [name, value] of options.flagValues) extensionsResult.runtime.flagValues.set(name, value);
		}

		this.extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			this.cwd,
			this.sessionManager,
			this.modelRegistry,
		);
		if (this.extensionRunnerRef) this.extensionRunnerRef.current = this.extensionRunner;
		this.bindCore(this.extensionRunner);
		this.applyBindings(this.extensionRunner);

		const activeToolNames = options.activeToolNames ?? this.toolController.getDefaultActiveToolNames();
		this.toolController.refresh({
			activeToolNames,
			includeAllExtensionTools: options.includeAllExtensionTools,
		});
	}
}
