import { readFileSync } from "node:fs";
import type { Agent, AgentEvent, AgentMessage } from "@fitclaw/agent-core";
import type { AssistantMessage, ImageContent, TextContent } from "@fitclaw/ai";
import type { AgentRetryController } from "@fitclaw/runtime";
import { stripFrontmatter } from "@fitclaw/runtime";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.js";
import type { ExtensionRunner, InputSource } from "./extensions/index.js";
import type { CustomMessage } from "./messages.js";
import type { ModelRegistry } from "./model-registry.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import type { ResourceLoader } from "./resource-loader.js";
import type { SessionBashController } from "./session-bash-controller.js";
import type { SessionManager } from "./session-manager.js";
import type { SessionMessageQueueController } from "./session-message-queue-controller.js";
import type { BuildSystemPromptOptions } from "./system-prompt.js";

export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true). */
	expandPromptTemplates?: boolean;
	/** Image attachments. */
	images?: ImageContent[];
	/** Queue mode required when the agent is already streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Source of input for extension input handlers. Defaults to interactive. */
	source?: InputSource;
	/** Internal hook used by RPC mode to observe prompt preflight acceptance or rejection. */
	preflightResult?: (success: boolean) => void;
}

interface SessionPromptControllerOptions {
	agent: Agent;
	sessionManager: SessionManager;
	modelRegistry: ModelRegistry;
	bashController: SessionBashController;
	messageQueueController: SessionMessageQueueController;
	retryController: AgentRetryController;
	getExtensionRunner: () => ExtensionRunner;
	getResourceLoader: () => ResourceLoader;
	getBaseSystemPrompt: () => { prompt: string; options: BuildSystemPromptOptions };
	checkCompaction: (message: AssistantMessage, skipAbortedCheck: boolean) => Promise<boolean>;
	waitForPendingEvents: () => Promise<void>;
	emit: (event: AgentEvent) => void;
}

export class SessionPromptController {
	private readonly agent: Agent;
	private readonly sessionManager: SessionManager;
	private readonly modelRegistry: ModelRegistry;
	private readonly bashController: SessionBashController;
	private readonly messageQueueController: SessionMessageQueueController;
	private readonly retryController: AgentRetryController;
	private readonly getExtensionRunner: SessionPromptControllerOptions["getExtensionRunner"];
	private readonly getResourceLoader: SessionPromptControllerOptions["getResourceLoader"];
	private readonly getBaseSystemPrompt: SessionPromptControllerOptions["getBaseSystemPrompt"];
	private readonly checkCompaction: SessionPromptControllerOptions["checkCompaction"];
	private readonly waitForPendingEvents: SessionPromptControllerOptions["waitForPendingEvents"];
	private readonly emit: SessionPromptControllerOptions["emit"];

	constructor(options: SessionPromptControllerOptions) {
		this.agent = options.agent;
		this.sessionManager = options.sessionManager;
		this.modelRegistry = options.modelRegistry;
		this.bashController = options.bashController;
		this.messageQueueController = options.messageQueueController;
		this.retryController = options.retryController;
		this.getExtensionRunner = options.getExtensionRunner;
		this.getResourceLoader = options.getResourceLoader;
		this.getBaseSystemPrompt = options.getBaseSystemPrompt;
		this.checkCompaction = options.checkCompaction;
		this.waitForPendingEvents = options.waitForPendingEvents;
		this.emit = options.emit;
	}

	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const shouldExpandPrompts = options?.expandPromptTemplates ?? true;
		const preflightResult = options?.preflightResult;
		let messages: AgentMessage[] | undefined;

		try {
			if (shouldExpandPrompts && text.startsWith("/") && (await this.tryExecuteExtensionCommand(text))) {
				preflightResult?.(true);
				return;
			}

			let currentText = text;
			let currentImages = options?.images;
			const inputRunner = this.getExtensionRunner();
			if (inputRunner.hasHandlers("input")) {
				const inputResult = await inputRunner.emitInput(
					currentText,
					currentImages,
					options?.source ?? "interactive",
				);
				if (inputResult.action === "handled") {
					preflightResult?.(true);
					return;
				}
				if (inputResult.action === "transform") {
					currentText = inputResult.text;
					currentImages = inputResult.images ?? currentImages;
				}
			}

			const expandedText = shouldExpandPrompts ? this.expandPromptText(currentText) : currentText;
			if (this.agent.state.isStreaming) {
				if (!options?.streamingBehavior) {
					throw new Error(
						"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
					);
				}
				if (options.streamingBehavior === "followUp") {
					this.messageQueueController.queueFollowUp(expandedText, currentImages);
				} else {
					this.messageQueueController.queueSteer(expandedText, currentImages);
				}
				preflightResult?.(true);
				return;
			}

			this.bashController.flushPendingMessages();
			const model = this.agent.state.model;
			if (!model) throw new Error(formatNoModelSelectedMessage());
			if (!this.modelRegistry.hasConfiguredAuth(model)) {
				if (this.modelRegistry.isUsingOAuth(model)) {
					throw new Error(
						`Authentication failed for "${model.provider}". ` +
							`Credentials may have expired or network is unavailable. ` +
							`Run '/login ${model.provider}' to re-authenticate.`,
					);
				}
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}

			const lastAssistant = this.findLastAssistantMessage();
			if (lastAssistant) await this.checkCompaction(lastAssistant, false);

			const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
			if (currentImages) userContent.push(...currentImages);
			messages = [
				{ role: "user", content: userContent, timestamp: Date.now() },
				...this.messageQueueController.consumeNextTurnMessages(),
			];

			const baseSystemPrompt = this.getBaseSystemPrompt();
			const result = await this.getExtensionRunner().emitBeforeAgentStart(
				expandedText,
				currentImages,
				baseSystemPrompt.prompt,
				baseSystemPrompt.options,
			);
			if (result?.messages) {
				messages.push(
					...result.messages.map((message) => ({
						role: "custom" as const,
						customType: message.customType,
						content: message.content,
						display: message.display,
						details: message.details,
						timestamp: Date.now(),
					})),
				);
			}
			this.agent.state.systemPrompt = result?.systemPrompt ? result.systemPrompt : baseSystemPrompt.prompt;
		} catch (error) {
			preflightResult?.(false);
			throw error;
		}

		if (!messages) return;
		preflightResult?.(true);
		await this.agent.prompt(messages);
		await this.retryController.waitForRetry();
		await this.waitForPendingEvents();
	}

	async steer(text: string, images?: ImageContent[]): Promise<void> {
		this.throwIfExtensionCommand(text);
		this.messageQueueController.queueSteer(this.expandPromptText(text), images);
	}

	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		this.throwIfExtensionCommand(text);
		this.messageQueueController.queueFollowUp(this.expandPromptText(text), images);
	}

	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		const appMessage = {
			role: "custom" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies CustomMessage<T>;

		if (options?.deliverAs === "nextTurn") {
			this.messageQueueController.queueNextTurn(appMessage);
		} else if (this.agent.state.isStreaming) {
			if (options?.deliverAs === "followUp") this.agent.followUp(appMessage);
			else this.agent.steer(appMessage);
		} else if (options?.triggerTurn) {
			await this.agent.prompt(appMessage);
		} else {
			this.agent.state.messages = [...this.agent.state.messages, appMessage];
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
			this.emit({ type: "message_start", message: appMessage });
			this.emit({ type: "message_end", message: appMessage });
		}
	}

	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		let text: string;
		let images: ImageContent[] | undefined;
		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") textParts.push(part.text);
				else images.push(part);
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
			source: "extension",
		});
	}

	private async tryExecuteExtensionCommand(text: string): Promise<boolean> {
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
		const runner = this.getExtensionRunner();
		const command = runner.getCommand(commandName);
		if (!command) return false;

		try {
			await command.handler(args, runner.createCommandContext());
		} catch (error) {
			this.getExtensionRunner().emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return true;
	}

	private expandPromptText(text: string): string {
		const expandedSkill = this.expandSkillCommand(text);
		return expandPromptTemplate(expandedSkill, [...this.getResourceLoader().getPrompts().prompts]);
	}

	private expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;
		const spaceIndex = text.indexOf(" ");
		const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
		const skill = this.getResourceLoader()
			.getSkills()
			.skills.find((entry) => entry.name === skillName);
		if (!skill) return text;

		try {
			const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
			const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			return args ? `${skillBlock}\n\n${args}` : skillBlock;
		} catch (error) {
			this.getExtensionRunner().emitError({
				extensionPath: skill.filePath,
				event: "skill_expansion",
				error: error instanceof Error ? error.message : String(error),
			});
			return text;
		}
	}

	private throwIfExtensionCommand(text: string): void {
		if (!text.startsWith("/")) return;
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		if (this.getExtensionRunner().getCommand(commandName)) {
			throw new Error(
				`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
			);
		}
	}

	private findLastAssistantMessage(): AssistantMessage | undefined {
		for (let index = this.agent.state.messages.length - 1; index >= 0; index--) {
			const message = this.agent.state.messages[index];
			if (message.role === "assistant") return message;
		}
		return undefined;
	}
}
