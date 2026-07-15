import type { Agent, AgentTool } from "@fitclaw/agent-core";
import { type ExtensionRunner, type ToolDefinition, type ToolInfo, wrapRegisteredTools } from "./extensions/index.js";
import type { ResourceLoader } from "./resource-loader.js";
import type { SettingsManager } from "./settings-manager.js";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.js";
import { type BuildSystemPromptOptions, buildSystemPrompt } from "./system-prompt.js";
import { createAllToolDefinitions } from "./tools/index.js";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.js";

interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

interface SessionToolControllerOptions {
	agent: Agent;
	settingsManager: SettingsManager;
	cwd: string;
	customTools?: readonly ToolDefinition[];
	allowedToolNames?: readonly string[];
	baseToolsOverride?: Readonly<Record<string, AgentTool>>;
	getExtensionRunner: () => ExtensionRunner;
	getResourceLoader: () => ResourceLoader;
}

export class SessionToolController {
	private readonly agent: Agent;
	private readonly settingsManager: SettingsManager;
	private readonly cwd: string;
	private readonly customTools: ToolDefinition[];
	private readonly allowedToolNames: ReadonlySet<string> | undefined;
	private readonly baseToolsOverride: ReadonlyMap<string, AgentTool> | undefined;
	private readonly getExtensionRunner: SessionToolControllerOptions["getExtensionRunner"];
	private readonly getResourceLoader: SessionToolControllerOptions["getResourceLoader"];
	private baseToolDefinitions = new Map<string, ToolDefinition>();
	private toolRegistry = new Map<string, AgentTool>();
	private toolDefinitions = new Map<string, ToolDefinitionEntry>();
	private toolPromptSnippets = new Map<string, string>();
	private toolPromptGuidelines = new Map<string, string[]>();
	private baseSystemPrompt = "";
	private baseSystemPromptOptions: BuildSystemPromptOptions | undefined;

	constructor(options: SessionToolControllerOptions) {
		this.agent = options.agent;
		this.settingsManager = options.settingsManager;
		this.cwd = options.cwd;
		this.customTools = [...(options.customTools ?? [])];
		this.allowedToolNames = options.allowedToolNames ? new Set(options.allowedToolNames) : undefined;
		this.baseToolsOverride = options.baseToolsOverride
			? new Map(Object.entries(options.baseToolsOverride))
			: undefined;
		this.getExtensionRunner = options.getExtensionRunner;
		this.getResourceLoader = options.getResourceLoader;
	}

	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((tool) => tool.name);
	}

	getAllTools(): ToolInfo[] {
		return Array.from(this.toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			sourceInfo,
		}));
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this.toolDefinitions.get(name)?.definition;
	}

	getBaseSystemPrompt(): { prompt: string; options: BuildSystemPromptOptions } {
		if (!this.baseSystemPromptOptions) {
			throw new Error("Session tool controller is not initialized");
		}
		return { prompt: this.baseSystemPrompt, options: this.baseSystemPromptOptions };
	}

	getDefaultActiveToolNames(): string[] {
		return this.baseToolsOverride ? [...this.baseToolsOverride.keys()] : ["read", "bash", "edit", "write"];
	}

	setActiveToolsByName(toolNames: readonly string[]): void {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		for (const name of toolNames) {
			const tool = this.toolRegistry.get(name);
			if (tool) {
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this.agent.state.tools = tools;
		this.rebuildSystemPrompt(validToolNames);
	}

	buildBaseToolDefinitions(): void {
		const autoResizeImages = this.settingsManager.getImageAutoResize();
		const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const definitions = this.baseToolsOverride
			? Object.fromEntries(
					Array.from(this.baseToolsOverride, ([name, tool]) => [name, createToolDefinitionFromAgentTool(tool)]),
				)
			: createAllToolDefinitions(this.cwd, {
					read: { autoResizeImages },
					bash: { commandPrefix: shellCommandPrefix, shellPath },
				});

		this.baseToolDefinitions = new Map(
			Object.entries(definitions).map(([name, definition]) => [name, definition as ToolDefinition]),
		);
	}

	refresh(options?: { activeToolNames?: readonly string[]; includeAllExtensionTools?: boolean }): void {
		const previousRegistryNames = new Set(this.toolRegistry.keys());
		const previousActiveToolNames = this.getActiveToolNames();
		const isAllowedTool = (name: string): boolean => !this.allowedToolNames || this.allowedToolNames.has(name);
		const registeredTools = this.getExtensionRunner().getAllRegisteredTools();
		const customTools = [
			...registeredTools,
			...this.customTools.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
			})),
		].filter((tool) => isAllowedTool(tool.definition.name));

		const definitionRegistry = new Map<string, ToolDefinitionEntry>(
			Array.from(this.baseToolDefinitions.entries())
				.filter(([name]) => isAllowedTool(name))
				.map(([name, definition]) => [
					name,
					{
						definition,
						sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
					},
				]),
		);
		for (const tool of customTools) {
			definitionRegistry.set(tool.definition.name, {
				definition: tool.definition,
				sourceInfo: tool.sourceInfo,
			});
		}
		this.toolDefinitions = definitionRegistry;
		this.toolPromptSnippets = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const snippet = this.normalizePromptSnippet(definition.promptSnippet);
					return snippet ? ([definition.name, snippet] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string] => entry !== undefined),
		);
		this.toolPromptGuidelines = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const guidelines = this.normalizePromptGuidelines(definition.promptGuidelines);
					return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
		);

		const runner = this.getExtensionRunner();
		const wrappedExtensionTools = wrapRegisteredTools(customTools, runner);
		const wrappedBuiltInTools = wrapRegisteredTools(
			Array.from(this.baseToolDefinitions.values())
				.filter((definition) => isAllowedTool(definition.name))
				.map((definition) => ({
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
				})),
			runner,
		);
		const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
		for (const tool of wrappedExtensionTools as AgentTool[]) toolRegistry.set(tool.name, tool);
		this.toolRegistry = toolRegistry;

		const nextActiveToolNames = (
			options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
		).filter(isAllowedTool);
		if (this.allowedToolNames) {
			for (const toolName of this.toolRegistry.keys()) {
				if (this.allowedToolNames.has(toolName)) nextActiveToolNames.push(toolName);
			}
		} else if (options?.includeAllExtensionTools) {
			for (const tool of wrappedExtensionTools) nextActiveToolNames.push(tool.name);
		} else if (!options?.activeToolNames) {
			for (const toolName of this.toolRegistry.keys()) {
				if (!previousRegistryNames.has(toolName)) nextActiveToolNames.push(toolName);
			}
		}

		this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
	}

	rebuildSystemPrompt(toolNames: readonly string[]): void {
		const validToolNames = toolNames.filter((name) => this.toolRegistry.has(name));
		const toolSnippets: Record<string, string> = {};
		const promptGuidelines: string[] = [];
		for (const name of validToolNames) {
			const snippet = this.toolPromptSnippets.get(name);
			if (snippet) toolSnippets[name] = snippet;
			const guidelines = this.toolPromptGuidelines.get(name);
			if (guidelines) promptGuidelines.push(...guidelines);
		}

		const resourceLoader = this.getResourceLoader();
		const appendPrompts = resourceLoader.getAppendSystemPrompt();
		this.baseSystemPromptOptions = {
			cwd: this.cwd,
			skills: resourceLoader.getSkills().skills,
			contextFiles: resourceLoader.getAgentsFiles().agentsFiles,
			customPrompt: resourceLoader.getSystemPrompt(),
			appendSystemPrompt: appendPrompts.length > 0 ? appendPrompts.join("\n\n") : undefined,
			selectedTools: validToolNames,
			toolSnippets,
			promptGuidelines,
		};
		this.baseSystemPrompt = buildSystemPrompt(this.baseSystemPromptOptions);
		this.agent.state.systemPrompt = this.baseSystemPrompt;
	}

	private normalizePromptSnippet(text: string | undefined): string | undefined {
		if (!text) return undefined;
		const oneLine = text
			.replace(/[\r\n]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return oneLine.length > 0 ? oneLine : undefined;
	}

	private normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
		if (!guidelines || guidelines.length === 0) return [];
		return [...new Set(guidelines.map((guideline) => guideline.trim()).filter(Boolean))];
	}
}
