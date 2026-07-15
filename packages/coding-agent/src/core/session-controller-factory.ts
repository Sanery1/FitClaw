import type { Agent, AgentEvent, AgentTool } from "@fitclaw/agent-core";
import type { Api, Model } from "@fitclaw/ai";
import {
	AgentCompactionController,
	type AgentCompactionEvent,
	AgentRetryController,
	type AgentRetryEvent,
} from "@fitclaw/runtime";
import type { CompactionResult } from "./compaction/index.js";
import { compact, prepareCompaction } from "./compaction/index.js";
import type {
	ContextUsage,
	ExtensionRunner,
	SessionBeforeCompactResult,
	SessionStartEvent,
	ToolDefinition,
} from "./extensions/index.js";
import { ManualCompactionController, type ManualCompactionEvent } from "./manual-compaction-controller.js";
import type { ModelRegistry } from "./model-registry.js";
import type { ResourceLoader } from "./resource-loader.js";
import { SessionBashController } from "./session-bash-controller.js";
import { SessionEventController } from "./session-event-controller.js";
import { SessionExtensionController } from "./session-extension-controller.js";
import type { SessionManager } from "./session-manager.js";
import { SessionMessageQueueController } from "./session-message-queue-controller.js";
import { SessionModelController, type SessionScopedModel } from "./session-model-controller.js";
import { SessionPromptController } from "./session-prompt-controller.js";
import { SessionToolController } from "./session-tool-controller.js";
import { SessionTreeController } from "./session-tree-controller.js";
import type { SettingsManager } from "./settings-manager.js";

export type SessionControllerEvent =
	| AgentEvent
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| ManualCompactionEvent
	| AgentCompactionEvent
	| AgentRetryEvent;

interface CreateSessionControllersOptions {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	resourceLoader: ResourceLoader;
	cwd: string;
	scopedModels?: SessionScopedModel[];
	customTools?: ToolDefinition[];
	initialActiveToolNames?: string[];
	allowedToolNames?: string[];
	baseToolsOverride?: Record<string, AgentTool>;
	extensionRunnerRef?: { current?: ExtensionRunner };
	sessionStartEvent?: SessionStartEvent;
	emit: (event: SessionControllerEvent) => void;
	getRequiredRequestAuth: (model: Model<Api>) => Promise<{ apiKey: string; headers?: Record<string, string> }>;
	abort: () => Promise<void>;
	getPendingMessageCount: () => number;
	setSessionName: (name: string) => void;
	getContextUsage: () => ContextUsage | undefined;
	compact: (customInstructions?: string) => Promise<CompactionResult>;
}

export interface SessionControllers {
	model: SessionModelController;
	event: SessionEventController;
	messageQueue: SessionMessageQueueController;
	prompt: SessionPromptController;
	tool: SessionToolController;
	extension: SessionExtensionController;
	compaction: AgentCompactionController;
	manualCompaction: ManualCompactionController;
	tree: SessionTreeController;
	retry: AgentRetryController;
	bash: SessionBashController;
}

export function createSessionControllers(options: CreateSessionControllersOptions): SessionControllers {
	let extension!: SessionExtensionController;
	let compaction!: AgentCompactionController;

	const tool = new SessionToolController({
		agent: options.agent,
		settingsManager: options.settingsManager,
		cwd: options.cwd,
		customTools: options.customTools,
		allowedToolNames: options.allowedToolNames,
		baseToolsOverride: options.baseToolsOverride,
		getExtensionRunner: () => extension.runner,
		getResourceLoader: () => extension.resourceLoader,
	});
	const retry = new AgentRetryController({
		agent: options.agent,
		getSettings: () => options.settingsManager.getRetrySettings(),
		emit: options.emit,
	});
	compaction = new AgentCompactionController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		modelRegistry: options.modelRegistry,
		getSettings: () => options.settingsManager.getCompactionSettings(),
		emit: options.emit,
		compact,
		prepareCompaction,
		requestCompaction: (reason, willRetry) => compaction.run(reason, willRetry),
		beforeCompact: async ({ preparation, branchEntries, signal }) => {
			if (!extension.runner.hasHandlers("session_before_compact")) return undefined;
			const result = (await extension.runner.emit({
				type: "session_before_compact",
				preparation,
				branchEntries,
				customInstructions: undefined,
				signal,
			})) as SessionBeforeCompactResult | undefined;
			return {
				cancel: result?.cancel,
				compaction: result?.compaction,
				fromHook: result?.compaction !== undefined,
			};
		},
		afterCompact: async ({ compactionEntry, fromHook }) => {
			await extension.runner.emit({ type: "session_compact", compactionEntry, fromExtension: fromHook });
		},
	});
	const bash = new SessionBashController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
	});
	const model = new SessionModelController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
		modelRegistry: options.modelRegistry,
		getExtensionRunner: () => extension.runner,
		scopedModels: options.scopedModels,
	});
	const manualCompaction = new ManualCompactionController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
		getModel: () => model.model,
		getRequiredRequestAuth: options.getRequiredRequestAuth,
		getExtensionRunner: () => extension.runner,
		emit: options.emit,
	});
	const tree = new SessionTreeController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
		getModel: () => model.model,
		getRequiredRequestAuth: options.getRequiredRequestAuth,
		getExtensionRunner: () => extension.runner,
	});
	const messageQueue = new SessionMessageQueueController({
		agent: options.agent,
		onUpdate: ({ steering, followUp }) => options.emit({ type: "queue_update", steering, followUp }),
	});
	const event = new SessionEventController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		retryController: retry,
		compactionController: compaction,
		messageQueueController: messageQueue,
		emitExtensionEvent: (agentEvent) => extension.emitAgentEvent(agentEvent),
		emit: options.emit,
		checkCompaction: (message) => compaction.check(message),
	});
	const prompt = new SessionPromptController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		modelRegistry: options.modelRegistry,
		bashController: bash,
		messageQueueController: messageQueue,
		retryController: retry,
		getExtensionRunner: () => extension.runner,
		getResourceLoader: () => extension.resourceLoader,
		getBaseSystemPrompt: () => tool.getBaseSystemPrompt(),
		checkCompaction: (message, skipAbortedCheck) => compaction.check(message, skipAbortedCheck),
		waitForPendingEvents: () => event.waitForPendingEvents(),
		emit: options.emit,
	});
	extension = new SessionExtensionController({
		agent: options.agent,
		sessionManager: options.sessionManager,
		settingsManager: options.settingsManager,
		modelRegistry: options.modelRegistry,
		modelController: model,
		promptController: prompt,
		toolController: tool,
		resourceLoader: options.resourceLoader,
		cwd: options.cwd,
		extensionRunnerRef: options.extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
		waitForPendingEvents: () => event.waitForPendingEvents(),
		abort: options.abort,
		getPendingMessageCount: options.getPendingMessageCount,
		setSessionName: options.setSessionName,
		getContextUsage: options.getContextUsage,
		compact: options.compact,
	});
	extension.initialize(options.initialActiveToolNames);
	event.connect();

	return { model, event, messageQueue, prompt, tool, extension, compaction, manualCompaction, tree, retry, bash };
}
