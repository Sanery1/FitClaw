import { type Container, type KeyId, matchesKey, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { ExtensionContext, ExtensionRunner, ExtensionUIContext } from "../../core/extensions/index.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import type { ResourceDiagnostic } from "../../core/resource-loader.js";
import type { SourceInfo } from "../../core/source-info.js";
import type { CustomEditor } from "./components/custom-editor.js";
import type { InteractiveAutocompleteController } from "./interactive-autocomplete-controller.js";
import type { InteractiveExtensionChromeController } from "./interactive-extension-chrome-controller.js";
import type { InteractiveExtensionDialogController } from "./interactive-extension-dialog-controller.js";
import type { InteractiveExtensionSurfaceController } from "./interactive-extension-surface-controller.js";
import type { InteractiveWorkingController } from "./interactive-working-controller.js";
import { type LoadedResourcesDisplayOptions, renderLoadedResources } from "./loaded-resources-view.js";
import {
	getAvailableThemesWithPaths,
	getThemeByName,
	setTheme,
	setThemeInstance,
	Theme,
	theme,
} from "./theme/theme.js";

const DEFAULT_HIDDEN_THINKING_LABEL = "Thinking...";

export interface InteractiveExtensionRuntimeControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	keybindings: KeybindingsManager;
	autocompleteController: InteractiveAutocompleteController;
	chromeController: InteractiveExtensionChromeController;
	dialogController: InteractiveExtensionDialogController;
	surfaceController: InteractiveExtensionSurfaceController;
	workingController: InteractiveWorkingController;
	isVerbose: () => boolean;
	getToolOutputExpanded: () => boolean;
	setToolsExpanded: (expanded: boolean) => void;
	deferShutdown: () => void;
	updateTerminalTitle: () => void;
	updateHiddenThinkingLabel: (label: string) => void;
	showNotification: (message: string, type?: "info" | "warning" | "error") => void;
	showError: (message: string) => void;
}

export class InteractiveExtensionRuntimeController {
	private currentHiddenThinkingLabel = DEFAULT_HIDDEN_THINKING_LABEL;

	constructor(private readonly options: InteractiveExtensionRuntimeControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	get hiddenThinkingLabel(): string {
		return this.currentHiddenThinkingLabel;
	}

	showLoadedResources(
		options?: LoadedResourcesDisplayOptions & {
			extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
		},
	): void {
		const isQuietStartup = this.session.settingsManager.getQuietStartup();
		const shouldShowListing = options?.force === true || this.options.isVerbose() || !isQuietStartup;
		if (!shouldShowListing && options?.showDiagnosticsWhenQuiet !== true) return;

		const skillsResult = this.session.resourceLoader.getSkills();
		const promptsResult = this.session.resourceLoader.getPrompts();
		const themesResult = this.session.resourceLoader.getThemes();
		const extensionsResult = this.session.resourceLoader.getExtensions();
		const extensions =
			options?.extensions ??
			extensionsResult.extensions.map((extension) => ({
				path: extension.path,
				sourceInfo: extension.sourceInfo,
			}));
		const extensionDiagnostics: ResourceDiagnostic[] = extensionsResult.errors.map((error) => ({
			type: "error",
			message: error.error,
			path: error.path,
		}));
		extensionDiagnostics.push(...this.session.extensionRunner.getCommandDiagnostics());
		extensionDiagnostics.push(
			...this.options.autocompleteController.getBuiltInCommandConflictDiagnostics(this.session.extensionRunner),
		);
		extensionDiagnostics.push(...this.session.extensionRunner.getShortcutDiagnostics());

		renderLoadedResources(
			{
				chatContainer: this.options.chatContainer,
				cwd: this.session.sessionManager.getCwd(),
				isVerbose: this.options.isVerbose(),
				isExpanded: this.options.isVerbose() || this.options.getToolOutputExpanded(),
				isQuietStartup,
				resources: {
					contextFiles: this.session.resourceLoader.getAgentsFiles().agentsFiles,
					skills: skillsResult.skills,
					promptTemplates: this.session.promptTemplates,
					extensions,
					themes: themesResult.themes,
					skillDiagnostics: skillsResult.diagnostics,
					promptDiagnostics: promptsResult.diagnostics,
					extensionDiagnostics,
					themeDiagnostics: themesResult.diagnostics,
				},
			},
			options,
		);
	}

	setupShortcuts(extensionRunner: ExtensionRunner): void {
		const shortcuts = extensionRunner.getShortcuts(this.options.keybindings.getEffectiveConfig());
		if (shortcuts.size === 0) return;

		const createContext = (): ExtensionContext => ({
			ui: this.createUIContext(),
			hasUI: true,
			cwd: this.session.sessionManager.getCwd(),
			sessionManager: this.session.sessionManager,
			modelRegistry: this.session.modelRegistry,
			model: this.session.model,
			isIdle: () => !this.session.isStreaming,
			signal: this.session.agent.signal,
			abort: () => this.session.abort(),
			hasPendingMessages: () => this.session.pendingMessageCount > 0,
			shutdown: () => this.options.deferShutdown(),
			getContextUsage: () => this.session.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await this.session.compact(options?.customInstructions);
						options?.onComplete?.(result);
					} catch (error: unknown) {
						const resolvedError = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(resolvedError);
					}
				})();
			},
			getSystemPrompt: () => this.session.systemPrompt,
		});

		this.options.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [shortcutText, shortcut] of shortcuts) {
				if (matchesKey(data, shortcutText as KeyId)) {
					Promise.resolve(shortcut.handler(createContext())).catch((error: unknown) => {
						this.options.showError(
							`Shortcut handler error: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
					return true;
				}
			}
			return false;
		};
	}

	reset(): void {
		this.options.dialogController.reset();
		this.options.surfaceController.hideOverlay();
		this.options.surfaceController.clearTerminalInputListeners();
		this.options.chromeController.reset();
		this.options.autocompleteController.clearProviders();
		this.options.surfaceController.setCustomEditor(undefined);
		this.options.autocompleteController.setup();
		this.options.defaultEditor.onExtensionShortcut = undefined;
		this.options.updateTerminalTitle();
		this.options.workingController.reset();
		this.setHiddenThinkingLabel();
	}

	createUIContext(): ExtensionUIContext {
		return {
			select: (title, options, config) => this.options.dialogController.select(title, options, config),
			confirm: (title, message, config) => this.options.dialogController.confirm(title, message, config),
			input: (title, placeholder, config) => this.options.dialogController.input(title, placeholder, config),
			notify: (message, type) => this.options.showNotification(message, type),
			onTerminalInput: (handler) => this.options.surfaceController.addTerminalInputListener(handler),
			setStatus: (key, text) => this.options.chromeController.setStatus(key, text),
			setWorkingMessage: (message) => this.options.workingController.setMessage(message),
			setWorkingVisible: (visible) => this.options.workingController.setVisible(visible),
			setWorkingIndicator: (config) => this.options.workingController.setIndicator(config),
			setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
			setWidget: (key, content, config) => this.options.chromeController.setWidget(key, content, config),
			setFooter: (factory) => this.options.chromeController.setFooter(factory),
			setHeader: (factory) => this.options.chromeController.setHeader(factory),
			setTitle: (title) => this.options.ui.terminal.setTitle(title),
			custom: (factory, config) => this.options.surfaceController.showCustom(factory, config),
			pasteToEditor: (text) => this.options.surfaceController.pasteToEditor(text),
			setEditorText: (text) => this.options.surfaceController.setEditorText(text),
			getEditorText: () => this.options.surfaceController.getEditorText(),
			editor: (title, prefill) => this.options.dialogController.editor(title, prefill),
			addAutocompleteProvider: (factory) => this.options.autocompleteController.addProvider(factory),
			setEditorComponent: (factory) => this.options.surfaceController.setCustomEditor(factory),
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					setThemeInstance(themeOrName);
					this.options.ui.requestRender();
					return { success: true };
				}
				const result = setTheme(themeOrName, true);
				if (result.success) {
					if (this.session.settingsManager.getTheme() !== themeOrName) {
						this.session.settingsManager.setTheme(themeOrName);
					}
					this.options.ui.requestRender();
				}
				return result;
			},
			getToolsExpanded: () => this.options.getToolOutputExpanded(),
			setToolsExpanded: (expanded) => this.options.setToolsExpanded(expanded),
		};
	}

	private setHiddenThinkingLabel(label?: string): void {
		this.currentHiddenThinkingLabel = label ?? DEFAULT_HIDDEN_THINKING_LABEL;
		this.options.updateHiddenThinkingLabel(this.currentHiddenThinkingLabel);
	}
}
