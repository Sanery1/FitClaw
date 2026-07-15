import type { AutocompleteItem, AutocompleteProvider, EditorComponent, SlashCommand } from "@fitclaw/tui";
import { CombinedAutocompleteProvider, fuzzyFilter } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { AutocompleteProviderFactory, ExtensionRunner } from "../../core/extensions/index.js";
import type { ResourceDiagnostic } from "../../core/resource-loader.js";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.js";
import type { SourceInfo } from "../../core/source-info.js";
import { parseGitUrl } from "../../utils/git.js";

export interface InteractiveAutocompleteControllerOptions {
	getSession: () => AgentSession;
	getEditor: () => EditorComponent;
	defaultEditor: EditorComponent;
	getFdPath: () => string | undefined;
}

export class InteractiveAutocompleteController {
	private provider: AutocompleteProvider | undefined;
	private providerWrappers: AutocompleteProviderFactory[] = [];
	private readonly skillCommands = new Map<string, string>();

	constructor(private readonly options: InteractiveAutocompleteControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	setup(): void {
		let provider = this.createBaseProvider();
		for (const wrapProvider of this.providerWrappers) {
			provider = wrapProvider(provider);
		}

		this.provider = provider;
		this.options.defaultEditor.setAutocompleteProvider?.(provider);
		const editor = this.options.getEditor();
		if (editor !== this.options.defaultEditor) {
			editor.setAutocompleteProvider?.(provider);
		}
	}

	addProvider(factory: AutocompleteProviderFactory): void {
		this.providerWrappers.push(factory);
		this.setup();
	}

	clearProviders(): void {
		this.providerWrappers = [];
	}

	applyToEditor(editor: EditorComponent): void {
		if (this.provider) {
			editor.setAutocompleteProvider?.(this.provider);
		}
	}

	getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		return extensionRunner
			.getRegisteredCommands()
			.filter((command) => builtinNames.has(command.name))
			.map((command) => ({
				type: "warning" as const,
				message:
					command.invocationName === command.name
						? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
						: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
				path: command.sourceInfo.path,
			}));
	}

	private createBaseProvider(): AutocompleteProvider {
		const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
			name: command.name,
			description: command.description,
		}));

		const modelCommand = slashCommands.find((command) => command.name === "model");
		if (modelCommand) {
			modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
				const models =
					this.session.scopedModels.length > 0
						? this.session.scopedModels.map((scopedModel) => scopedModel.model)
						: this.session.modelRegistry.getAvailable();
				if (models.length === 0) return null;

				const items = models.map((model) => ({
					id: model.id,
					provider: model.provider,
					label: `${model.provider}/${model.id}`,
				}));
				const filtered = fuzzyFilter(items, prefix, (item) => `${item.id} ${item.provider}`);
				if (filtered.length === 0) return null;

				return filtered.map((item) => ({
					value: item.label,
					label: item.id,
					description: item.provider,
				}));
			};
		}

		const templateCommands: SlashCommand[] = this.session.promptTemplates.map((command) => ({
			name: command.name,
			description: this.prefixDescription(command.description, command.sourceInfo),
			...(command.argumentHint && { argumentHint: command.argumentHint }),
		}));

		const builtinCommandNames = new Set(slashCommands.map((command) => command.name));
		const extensionCommands: SlashCommand[] = this.session.extensionRunner
			.getRegisteredCommands()
			.filter((command) => !builtinCommandNames.has(command.name))
			.map((command) => ({
				name: command.invocationName,
				description: this.prefixDescription(command.description, command.sourceInfo),
				getArgumentCompletions: command.getArgumentCompletions,
			}));

		this.skillCommands.clear();
		const skillCommandList: SlashCommand[] = [];
		if (this.session.settingsManager.getEnableSkillCommands()) {
			for (const skill of this.session.resourceLoader.getSkills().skills) {
				const commandName = `skill:${skill.name}`;
				this.skillCommands.set(commandName, skill.filePath);
				skillCommandList.push({
					name: commandName,
					description: this.prefixDescription(skill.description, skill.sourceInfo),
				});
			}
		}

		return new CombinedAutocompleteProvider(
			[...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
			this.session.sessionManager.getCwd(),
			this.options.getFdPath(),
		);
	}

	private prefixDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
		const sourceTag = this.getSourceTag(sourceInfo);
		if (!sourceTag) return description;
		return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
	}

	private getSourceTag(sourceInfo?: SourceInfo): string | undefined {
		if (!sourceInfo) return undefined;

		const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
		const source = sourceInfo.source.trim();
		if (source === "auto" || source === "local" || source === "cli") {
			return scopePrefix;
		}
		if (source.startsWith("npm:")) {
			return `${scopePrefix}:${source}`;
		}

		const gitSource = parseGitUrl(source);
		if (gitSource) {
			const ref = gitSource.ref ? `@${gitSource.ref}` : "";
			return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
		}
		return scopePrefix;
	}
}
