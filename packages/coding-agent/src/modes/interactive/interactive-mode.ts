/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ImageContent } from "@fitclaw/ai";
import type { EditorComponent, MarkdownTheme } from "@fitclaw/tui";
import { Container, ProcessTerminal, Spacer, setKeybindings, Text, TUI } from "@fitclaw/tui";
import { APP_NAME, APP_TITLE, VERSION } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import { FooterDataProvider } from "../../core/footer-data-provider.js";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.js";
import { extensionForImageMimeType, readClipboardImage } from "../../utils/clipboard-image.js";
import { ensureTool } from "../../utils/tools-manager.js";
import { CustomEditor } from "./components/custom-editor.js";
import { ExpandableText, isExpandable } from "./components/expandable-text.js";
import { FooterComponent } from "./components/footer.js";
import { keyDisplay, keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";
import { InteractiveAuthController } from "./interactive-auth-controller.js";
import { InteractiveAutocompleteController } from "./interactive-autocomplete-controller.js";
import { InteractiveBashController } from "./interactive-bash-controller.js";
import { InteractiveExtensionChromeController } from "./interactive-extension-chrome-controller.js";
import { InteractiveExtensionDialogController } from "./interactive-extension-dialog-controller.js";
import { InteractiveExtensionRuntimeController } from "./interactive-extension-runtime-controller.js";
import { InteractiveExtensionSurfaceController } from "./interactive-extension-surface-controller.js";
import { InteractiveFeedbackController } from "./interactive-feedback-controller.js";
import { InteractiveInfoController } from "./interactive-info-controller.js";
import { InteractiveMessageQueueController } from "./interactive-message-queue-controller.js";
import { InteractiveModelController } from "./interactive-model-controller.js";
import { InteractiveReloadController } from "./interactive-reload-controller.js";
import { InteractiveSessionNavigationController } from "./interactive-session-navigation-controller.js";
import { InteractiveSessionTransferController } from "./interactive-session-transfer-controller.js";
import { InteractiveSessionViewController } from "./interactive-session-view-controller.js";
import { InteractiveSettingsController } from "./interactive-settings-controller.js";
import { InteractiveStartupController } from "./interactive-startup-controller.js";
import { InteractiveTerminalController } from "./interactive-terminal-controller.js";
import { InteractiveWorkingController } from "./interactive-working-controller.js";
import {
	getEditorTheme,
	getMarkdownTheme,
	initTheme,
	onThemeChange,
	setRegisteredThemes,
	stopThemeWatcher,
	theme,
} from "./theme/theme.js";

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json (shows warning) */
	migratedProviders?: string[];
	/** Warning message if session model couldn't be restored */
	modelFallbackMessage?: string;
	/** Initial message to send on startup (can include @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Additional messages to send after the initial message */
	initialMessages?: string[];
	/** Force verbose startup (overrides quietStartup setting) */
	verbose?: boolean;
}

export class InteractiveMode {
	private runtimeHost: AgentSessionRuntime;
	private ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: CustomEditor;
	private fdPath: string | undefined;
	private footer: FooterComponent;
	private footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	private keybindings: KeybindingsManager;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;

	private lastEscapeTime = 0;
	private readonly autocompleteController: InteractiveAutocompleteController;
	private readonly authController: InteractiveAuthController;
	private readonly bashController: InteractiveBashController;
	private readonly extensionChromeController: InteractiveExtensionChromeController;
	private readonly extensionDialogController: InteractiveExtensionDialogController;
	private readonly extensionRuntimeController: InteractiveExtensionRuntimeController;
	private readonly extensionSurfaceController: InteractiveExtensionSurfaceController;
	private readonly feedbackController: InteractiveFeedbackController;
	private readonly infoController: InteractiveInfoController;
	private readonly messageQueueController: InteractiveMessageQueueController;
	private readonly modelController: InteractiveModelController;
	private readonly reloadController: InteractiveReloadController;
	private readonly sessionNavigationController: InteractiveSessionNavigationController;
	private readonly settingsController: InteractiveSettingsController;
	private readonly sessionTransferController: InteractiveSessionTransferController;
	private readonly sessionViewController: InteractiveSessionViewController;
	private readonly startupController: InteractiveStartupController;
	private readonly terminalController: InteractiveTerminalController;
	private readonly workingController: InteractiveWorkingController;

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;
	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Convenience accessors
	private get editor(): EditorComponent {
		return this.extensionSurfaceController.editor;
	}
	private get editorContainer(): Container {
		return this.extensionSurfaceController.editorContainer;
	}
	private get session(): AgentSession {
		return this.runtimeHost.session;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(
		runtimeHost: AgentSessionRuntime,
		private options: InteractiveModeOptions = {},
	) {
		this.runtimeHost = runtimeHost;
		this.runtimeHost.setBeforeSessionInvalidate(() => {
			this.extensionRuntimeController.reset();
		});
		this.runtimeHost.setRebindSession(async () => {
			await this.rebindCurrentSession();
		});
		this.version = VERSION;
		this.ui = new TUI(new ProcessTerminal(), this.settingsManager.getShowHardwareCursor());
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.feedbackController = new InteractiveFeedbackController({
			getSession: () => this.session,
			ui: this.ui,
			chatContainer: this.chatContainer,
		});
		this.keybindings = KeybindingsManager.create();
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
			paddingX: editorPaddingX,
			autocompleteMaxVisible,
		});
		this.extensionSurfaceController = new InteractiveExtensionSurfaceController({
			ui: this.ui,
			defaultEditor: this.defaultEditor,
			keybindings: this.keybindings,
			applyAutocompleteToEditor: (editor) => this.autocompleteController.applyToEditor(editor),
		});
		this.autocompleteController = new InteractiveAutocompleteController({
			getSession: () => this.session,
			getEditor: () => this.editor,
			defaultEditor: this.defaultEditor,
			getFdPath: () => this.fdPath,
		});
		this.extensionDialogController = new InteractiveExtensionDialogController({
			ui: this.ui,
			editorContainer: this.editorContainer,
			getEditor: () => this.editor,
			keybindings: this.keybindings,
		});
		this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
		this.footer = new FooterComponent(this.session, this.footerDataProvider);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.extensionChromeController = new InteractiveExtensionChromeController({
			ui: this.ui,
			footer: this.footer,
			footerDataProvider: this.footerDataProvider,
			getToolOutputExpanded: () => this.toolOutputExpanded,
		});
		this.workingController = new InteractiveWorkingController({
			ui: this.ui,
			statusContainer: this.statusContainer,
			isStreaming: () => this.session.isStreaming,
		});
		this.extensionRuntimeController = new InteractiveExtensionRuntimeController({
			getSession: () => this.session,
			ui: this.ui,
			chatContainer: this.chatContainer,
			defaultEditor: this.defaultEditor,
			keybindings: this.keybindings,
			autocompleteController: this.autocompleteController,
			chromeController: this.extensionChromeController,
			dialogController: this.extensionDialogController,
			surfaceController: this.extensionSurfaceController,
			workingController: this.workingController,
			isVerbose: () => this.options.verbose === true,
			getToolOutputExpanded: () => this.toolOutputExpanded,
			setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
			deferShutdown: () => this.terminalController.deferShutdown(),
			updateTerminalTitle: () => this.updateTerminalTitle(),
			updateHiddenThinkingLabel: (label) => this.sessionViewController.updateHiddenThinkingLabel(label),
			showNotification: (message, type) => this.feedbackController.showExtensionNotification(message, type),
			showError: (message) => this.showError(message),
		});
		this.startupController = new InteractiveStartupController({
			getSession: () => this.session,
			chatContainer: this.chatContainer,
			version: this.version,
			getMarkdownTheme: () => this.getMarkdownThemeWithSettings(),
		});
		this.settingsController = new InteractiveSettingsController({
			getSession: () => this.session,
			getEditor: () => this.editor,
			ui: this.ui,
			chatContainer: this.chatContainer,
			defaultEditor: this.defaultEditor,
			footer: this.footer,
			showSelector: (create) => this.extensionSurfaceController.showSelector(create),
			setupAutocomplete: () => this.autocompleteController.setup(),
			rebuildThinkingVisibility: (hidden, showStatus) =>
				this.sessionViewController.rebuildForThinkingVisibility(hidden, showStatus),
			updateEditorBorderColor: () => this.updateEditorBorderColor(),
			showError: (message) => this.showError(message),
			showStatus: (message) => this.showStatus(message),
		});

		// Register themes from resource loader and initialize
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		initTheme(this.settingsManager.getTheme(), true);
		this.authController = new InteractiveAuthController({
			getSession: () => this.session,
			ui: this.ui,
			editorContainer: this.editorContainer,
			getEditor: () => this.editor,
			showSelector: (create) => this.extensionSurfaceController.showSelector(create),
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
			showWarning: (message) => this.showWarning(message),
			updateAvailableProviderCount: () => this.modelController.updateAvailableProviderCount(),
			invalidateFooter: () => this.footer.invalidate(),
			updateEditorBorderColor: () => this.updateEditorBorderColor(),
			checkModelEasterEgg: (model) => this.feedbackController.checkModelEasterEgg(model),
		});
		this.modelController = new InteractiveModelController({
			getSession: () => this.session,
			ui: this.ui,
			showSelector: (create) => this.extensionSurfaceController.showSelector(create),
			invalidateFooter: () => this.footer.invalidate(),
			setAvailableProviderCount: (count) => this.footerDataProvider.setAvailableProviderCount(count),
			updateEditorBorderColor: () => this.updateEditorBorderColor(),
			warnAboutAnthropicSubscriptionAuth: (model) =>
				this.authController.maybeWarnAboutAnthropicSubscriptionAuth(model),
			checkModelEasterEgg: (model) => this.feedbackController.checkModelEasterEgg(model),
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
		});
		this.infoController = new InteractiveInfoController({
			getSession: () => this.session,
			ui: this.ui,
			chatContainer: this.chatContainer,
			keybindings: this.keybindings,
			getMarkdownTheme: () => this.getMarkdownThemeWithSettings(),
			showWarning: (message) => this.showWarning(message),
		});
		this.reloadController = new InteractiveReloadController({
			getSession: () => this.session,
			ui: this.ui,
			editorContainer: this.editorContainer,
			defaultEditor: this.defaultEditor,
			getEditor: () => this.editor,
			keybindings: this.keybindings,
			footer: this.footer,
			footerDataProvider: this.footerDataProvider,
			getToolOutputExpanded: () => this.toolOutputExpanded,
			setHeaderExpanded: (expanded) => this.extensionChromeController.setHeaderExpanded(expanded),
			refreshSettings: () => this.settingsController.refresh(),
			setupAutocomplete: () => this.autocompleteController.setup(),
			setupExtensionShortcuts: (runner) => this.extensionRuntimeController.setupShortcuts(runner),
			resetExtensionUI: () => this.extensionRuntimeController.reset(),
			rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
			showLoadedResources: () =>
				this.extensionRuntimeController.showLoadedResources({
					force: false,
					showDiagnosticsWhenQuiet: true,
				}),
			showWarning: (message) => this.showWarning(message),
			showError: (message) => this.showError(message),
			showStatus: (message) => this.showStatus(message),
		});
		this.terminalController = new InteractiveTerminalController({
			runtimeHost: this.runtimeHost,
			ui: this.ui,
			getEditor: () => this.editor,
			isStreaming: () => this.session.isStreaming,
			clearEditor: () => this.clearEditor(),
			stopInteractiveMode: () => this.stop(),
			showStatus: (message) => this.showStatus(message),
			showWarning: (message) => this.showWarning(message),
			exitProcess: (code) => process.exit(code),
		});
		this.messageQueueController = new InteractiveMessageQueueController({
			getSession: () => this.session,
			getEditor: () => this.editor,
			ui: this.ui,
			chatContainer: this.chatContainer,
			pendingMessagesContainer: this.pendingMessagesContainer,
			getDequeueKeyDisplay: () => keyDisplay("app.message.dequeue"),
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
		});
		this.bashController = new InteractiveBashController({
			getSession: () => this.session,
			ui: this.ui,
			chatContainer: this.chatContainer,
			pendingMessagesContainer: this.pendingMessagesContainer,
			addPendingBashComponent: (component) => this.messageQueueController.addPendingBashComponent(component),
			showError: (message) => this.showError(message),
		});
		this.sessionTransferController = new InteractiveSessionTransferController({
			getSession: () => this.session,
			runtimeHost: this.runtimeHost,
			ui: this.ui,
			editorContainer: this.editorContainer,
			getEditor: () => this.editor,
			showConfirm: (title, message) => this.extensionDialogController.confirm(title, message),
			promptForMissingSessionCwd: (error) => this.extensionDialogController.promptForMissingSessionCwd(error),
			stopWorkingLoader: () => this.workingController.stop(),
			renderCurrentSessionState: () => this.renderCurrentSessionState(),
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
			handleFatalRuntimeError: (prefix, error) => this.handleFatalRuntimeError(prefix, error),
		});
		this.sessionNavigationController = new InteractiveSessionNavigationController({
			getSession: () => this.session,
			runtimeHost: this.runtimeHost,
			ui: this.ui,
			chatContainer: this.chatContainer,
			statusContainer: this.statusContainer,
			defaultEditor: this.defaultEditor,
			getEditor: () => this.editor,
			keybindings: this.keybindings,
			showSelector: (create) => this.extensionSurfaceController.showSelector(create),
			showExtensionSelector: (title, options) => this.extensionDialogController.select(title, options),
			showExtensionEditor: (title) => this.extensionDialogController.editor(title),
			promptForMissingSessionCwd: (error) => this.extensionDialogController.promptForMissingSessionCwd(error),
			stopWorkingLoader: () => this.workingController.stop(),
			renderCurrentSessionState: () => this.renderCurrentSessionState(),
			renderInitialMessages: () => this.renderInitialMessages(),
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
			handleFatalRuntimeError: (prefix, error) => this.handleFatalRuntimeError(prefix, error),
			flushCompactionQueue: (options) => this.messageQueueController.flushCompactionQueue(options),
			shutdown: () => this.terminalController.shutdown(),
		});
		this.sessionViewController = new InteractiveSessionViewController({
			getSession: () => this.session,
			ui: this.ui,
			chatContainer: this.chatContainer,
			statusContainer: this.statusContainer,
			defaultEditor: this.defaultEditor,
			getEditor: () => this.editor,
			isInitialized: () => this.isInitialized,
			initialize: () => this.init(),
			invalidateFooter: () => this.footer.invalidate(),
			updateEditorBorderColor: () => this.updateEditorBorderColor(),
			startAgentActivity: () => this.workingController.startAgentActivity(),
			stopAgentActivity: () => this.workingController.stopAgentActivity(),
			updatePendingMessagesDisplay: () => this.messageQueueController.updatePendingMessagesDisplay(),
			updateTerminalTitle: () => this.updateTerminalTitle(),
			checkShutdownRequested: () => this.terminalController.checkShutdownRequested(),
			showError: (message) => this.showError(message),
			showStatus: (message) => this.showStatus(message),
			flushCompactionQueue: (options) => this.messageQueueController.flushCompactionQueue(options),
			getHideThinkingBlock: () => this.settingsController.hideThinkingBlock,
			getHiddenThinkingLabel: () => this.extensionRuntimeController.hiddenThinkingLabel,
			getToolOutputExpanded: () => this.toolOutputExpanded,
			getMarkdownTheme: () => this.getMarkdownThemeWithSettings(),
		});
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.terminalController.registerSignalHandlers();

		// Load changelog (only show new entries, skip for resumed sessions)
		this.startupController.prepareChangelog();

		// Ensure fd and rg are available (downloads if missing, adds to PATH via getBinDir)
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands
		const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
		this.fdPath = fdPath;

		// Add header container as first child
		this.ui.addChild(this.extensionChromeController.headerContainer);

		// Add header with keybindings from config (unless silenced)
		if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
			const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${this.version}`);

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

			const expandedInstructions = [
				hint("app.interrupt", "to interrupt"),
				hint("app.clear", "to clear"),
				rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
				hint("app.exit", "to exit (empty)"),
				hint("app.suspend", "to suspend"),
				keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
				hint("app.thinking.cycle", "to cycle thinking level"),
				rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
				hint("app.model.select", "to select model"),
				hint("app.tools.expand", "to expand tools"),
				hint("app.thinking.toggle", "to expand thinking"),
				hint("app.editor.external", "for external editor"),
				rawKeyHint("/", "for commands"),
				rawKeyHint("!", "to run bash"),
				rawKeyHint("!!", "to run bash (no context)"),
				hint("app.message.followUp", "to queue follow-up"),
				hint("app.message.dequeue", "to edit all queued messages"),
				hint("app.clipboard.pasteImage", "to paste image"),
				rawKeyHint("drop files", "to attach"),
			].join("\n");
			const compactInstructions = [
				hint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
				hint("app.tools.expand", "more"),
			].join(theme.fg("muted", " · "));
			const compactOnboarding = theme.fg(
				"dim",
				`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
			);
			const onboarding = theme.fg(
				"dim",
				`Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.`,
			);
			const builtInHeader = new ExpandableText(
				() => `${logo}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
				() => `${logo}\n${expandedInstructions}\n\n${onboarding}`,
				this.getStartupExpansionState(),
				1,
				0,
			);
			this.extensionChromeController.setBuiltInHeader(builtInHeader);

			// Setup UI layout
			this.extensionChromeController.headerContainer.addChild(new Spacer(1));
			this.extensionChromeController.headerContainer.addChild(builtInHeader);
			this.extensionChromeController.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			const builtInHeader = new Text("", 0, 0);
			this.extensionChromeController.setBuiltInHeader(builtInHeader);
			this.extensionChromeController.headerContainer.addChild(builtInHeader);
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.extensionChromeController.renderWidgets(); // Initialize with default spacer
		this.ui.addChild(this.extensionChromeController.widgetContainerAbove);
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.extensionChromeController.widgetContainerBelow);
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();

		// Render initial messages AFTER showing loaded resources
		this.renderInitialMessages();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher (uses provider instead of footer)
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});

		// Initialize available provider count for footer display
		await this.modelController.updateAvailableProviderCount();
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	private updateTerminalTitle(): void {
		const cwdBasename = path.basename(this.sessionManager.getCwd());
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName) {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
		} else {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
		}
	}

	/**
	 * Run the interactive mode. This is the main entry point.
	 * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
	 */
	async run(): Promise<void> {
		await this.init();

		this.startupController.startBackgroundChecks({
			showNewVersion: (version) => this.showNewVersionNotification(version),
			showPackageUpdates: (packages) => this.showPackageUpdateNotification(packages),
			showWarning: (warning) => this.showWarning(warning),
		});

		// Show startup warnings
		const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = this.options;

		if (migratedProviders && migratedProviders.length > 0) {
			this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
		}

		const modelsJsonError = this.session.modelRegistry.getError();
		if (modelsJsonError) {
			this.showError(`models.json error: ${modelsJsonError}`);
		}

		if (modelFallbackMessage) {
			this.showWarning(modelFallbackMessage);
		}

		void this.authController.maybeWarnAboutAnthropicSubscriptionAuth();

		// Process initial messages
		if (initialMessage) {
			try {
				await this.session.prompt(initialMessage, { images: initialImages });
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}

		if (initialMessages) {
			for (const message of initialMessages) {
				try {
					await this.session.prompt(message);
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
					this.showError(errorMessage);
				}
			}
		}

		// Main interactive loop
		while (true) {
			const userInput = await this.getUserInput();
			try {
				await this.session.prompt(userInput);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	private getStartupExpansionState(): boolean {
		return this.options.verbose || this.toolOutputExpanded;
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 */
	private async bindCurrentSessionExtensions(): Promise<void> {
		const uiContext = this.extensionRuntimeController.createUIContext();
		await this.session.bindExtensions({
			uiContext,
			commandContextActions: {
				waitForIdle: () => this.session.agent.waitForIdle(),
				newSession: async (options) => {
					this.workingController.stop();
					try {
						const result = await this.runtimeHost.newSession(options);
						if (!result.cancelled) {
							this.renderCurrentSessionState();
							this.ui.requestRender();
						}
						return result;
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to create session", error);
					}
				},
				fork: async (entryId, options) => {
					try {
						const result = await this.runtimeHost.fork(entryId, options);
						if (!result.cancelled) {
							this.renderCurrentSessionState();
							this.editor.setText(result.selectedText ?? "");
							this.showStatus("Forked to new session");
						}
						return { cancelled: result.cancelled };
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to fork session", error);
					}
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					if (result.cancelled) {
						return { cancelled: true };
					}

					this.chatContainer.clear();
					this.renderInitialMessages();
					if (result.editorText && !this.editor.getText().trim()) {
						this.editor.setText(result.editorText);
					}
					this.showStatus("Navigated to selected point");
					void this.messageQueueController.flushCompactionQueue({ willRetry: false });
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					return this.sessionNavigationController.handleResumeSession(sessionPath, options);
				},
				reload: async () => {
					await this.reloadController.reload();
				},
			},
			shutdownHandler: () => {
				this.terminalController.requestShutdown();
			},
			onError: (error) => {
				this.feedbackController.showExtensionError(error.extensionPath, error.error, error.stack);
			},
		});

		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		this.autocompleteController.setup();

		const extensionRunner = this.session.extensionRunner;
		this.extensionRuntimeController.setupShortcuts(extensionRunner);
		this.extensionRuntimeController.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		this.startupController.showNotices();
	}

	private async rebindCurrentSession(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.reloadController.applyRuntimeSettings();
		await this.bindCurrentSessionExtensions();
		this.subscribeToAgent();
		await this.modelController.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
	}

	private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error);
		this.showError(`${prefix}: ${message}`);
		stopThemeWatcher();
		this.stop();
		process.exit(1);
	}

	private renderCurrentSessionState(): void {
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.messageQueueController.clearCompactionQueue();
		this.sessionViewController.resetSessionState();
		this.renderInitialMessages();
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	private setupKeyHandlers(): void {
		// Set up handlers on defaultEditor - they use this.editor for text access
		// so they work correctly regardless of which editor is active
		this.defaultEditor.onEscape = () => {
			if (this.session.isStreaming) {
				this.messageQueueController.restoreQueuedMessagesToEditor({ abort: true });
			} else if (this.session.isBashRunning) {
				this.session.abortBash();
			} else if (this.isBashMode) {
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			} else if (!this.editor.getText().trim()) {
				// Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
				const action = this.settingsManager.getDoubleEscapeAction();
				if (action !== "none") {
					const now = Date.now();
					if (now - this.lastEscapeTime < 500) {
						if (action === "tree") {
							this.sessionNavigationController.showTreeSelector();
						} else {
							this.sessionNavigationController.showUserMessageSelector();
						}
						this.lastEscapeTime = 0;
					} else {
						this.lastEscapeTime = now;
					}
				}
			}
		};

		// Register app action handlers
		this.defaultEditor.onAction("app.clear", () => this.terminalController.handleInterruptKey());
		this.defaultEditor.onCtrlD = () => this.terminalController.handleExitKey();
		this.defaultEditor.onAction("app.suspend", () => this.terminalController.suspend());
		this.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
		this.defaultEditor.onAction("app.model.cycleForward", () => this.modelController.cycle("forward"));
		this.defaultEditor.onAction("app.model.cycleBackward", () => this.modelController.cycle("backward"));

		// Global debug handler on TUI (works regardless of focus)
		this.ui.onDebug = () => this.feedbackController.writeDebugLog();
		this.defaultEditor.onAction("app.model.select", () => this.modelController.showModelSelector());
		this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
		this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
		this.defaultEditor.onAction("app.editor.external", () => this.terminalController.openExternalEditor());
		this.defaultEditor.onAction("app.message.followUp", () => this.messageQueueController.handleFollowUp());
		this.defaultEditor.onAction("app.message.dequeue", () => this.messageQueueController.handleDequeue());
		this.defaultEditor.onAction("app.session.new", () => this.handleClearCommand());
		this.defaultEditor.onAction("app.session.tree", () => this.sessionNavigationController.showTreeSelector());
		this.defaultEditor.onAction("app.session.fork", () => this.sessionNavigationController.showUserMessageSelector());
		this.defaultEditor.onAction("app.session.resume", () => this.sessionNavigationController.showSessionSelector());

		this.defaultEditor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};

		// Handle clipboard image paste (triggered on Ctrl+V)
		this.defaultEditor.onPasteImage = () => {
			this.handleClipboardImagePaste();
		};
	}

	private async handleClipboardImagePaste(): Promise<void> {
		try {
			const image = await readClipboardImage();
			if (!image) {
				return;
			}

			// Write to temp file
			const tmpDir = os.tmpdir();
			const ext = extensionForImageMimeType(image.mimeType) ?? "png";
			const fileName = `pi-clipboard-${crypto.randomUUID()}.${ext}`;
			const filePath = path.join(tmpDir, fileName);
			fs.writeFileSync(filePath, Buffer.from(image.bytes));

			// Insert file path directly
			this.editor.insertTextAtCursor?.(filePath);
			this.ui.requestRender();
		} catch {
			// Silently ignore clipboard errors (may not have permission, etc.)
		}
	}

	private setupEditorSubmitHandler(): void {
		this.defaultEditor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// Handle commands
			if (text === "/settings") {
				this.settingsController.show();
				this.editor.setText("");
				return;
			}
			if (text === "/scoped-models") {
				this.editor.setText("");
				await this.modelController.showScopedModelsSelector();
				return;
			}
			if (text === "/model" || text.startsWith("/model ")) {
				const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.modelController.handleCommand(searchTerm);
				return;
			}
			if (text === "/export" || text.startsWith("/export ")) {
				await this.sessionTransferController.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/import" || text.startsWith("/import ")) {
				await this.sessionTransferController.handleImportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/share") {
				await this.sessionTransferController.handleShareCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/copy") {
				await this.sessionTransferController.handleCopyCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/name" || text.startsWith("/name ")) {
				this.infoController.handleNameCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.infoController.showSessionInfo();
				this.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				this.infoController.showChangelog();
				this.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.infoController.showHotkeys();
				this.editor.setText("");
				return;
			}
			if (text === "/fork") {
				this.sessionNavigationController.showUserMessageSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clone") {
				this.editor.setText("");
				await this.sessionNavigationController.handleCloneCommand();
				return;
			}
			if (text === "/tree") {
				this.sessionNavigationController.showTreeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/login") {
				this.authController.show("login");
				this.editor.setText("");
				return;
			}
			if (text === "/logout") {
				this.authController.show("logout");
				this.editor.setText("");
				return;
			}
			if (text === "/new") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.editor.setText("");
				await this.handleCompactCommand(customInstructions);
				return;
			}
			if (text === "/reload") {
				this.editor.setText("");
				await this.reloadController.reload();
				return;
			}
			if (text === "/debug") {
				this.feedbackController.writeDebugLog();
				this.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.feedbackController.showArmin();
				this.editor.setText("");
				return;
			}
			if (text === "/dementedelves") {
				this.feedbackController.showDementedDelves();
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.sessionNavigationController.showSessionSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/quit") {
				this.editor.setText("");
				await this.terminalController.shutdown();
				return;
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (command) {
					if (this.session.isBashRunning) {
						this.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory?.(text);
					await this.bashController.handle(command, isExcluded);
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Queue input during compaction (extension commands execute immediately)
			if (this.session.isCompacting) {
				if (this.messageQueueController.isExtensionCommand(text)) {
					this.editor.addToHistory?.(text);
					this.editor.setText("");
					await this.session.prompt(text);
				} else {
					this.messageQueueController.queueCompactionMessage(text, "steer");
				}
				return;
			}

			// If streaming, use prompt() with steer behavior
			// This handles extension commands (execute immediately), prompt template expansion, and queueing
			if (this.session.isStreaming) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.session.prompt(text, { streamingBehavior: "steer" });
				this.messageQueueController.updatePendingMessagesDisplay();
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.messageQueueController.flushPendingBashComponents();

			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
			this.editor.addToHistory?.(text);
		};
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.sessionViewController.handle(event);
		});
	}

	private showStatus(message: string): void {
		this.feedbackController.showStatus(message);
	}

	renderInitialMessages(): void {
		this.sessionViewController.renderInitialMessages();
	}

	async getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		this.sessionViewController.rebuildChatFromMessages();
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(`Thinking level: ${newLevel}`);
		}
	}

	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}

	private setToolsExpanded(expanded: boolean): void {
		this.toolOutputExpanded = expanded;
		this.extensionChromeController.setHeaderExpanded(expanded);
		for (const child of this.chatContainer.children) {
			if (isExpandable(child)) {
				child.setExpanded(expanded);
			}
		}
		this.ui.requestRender();
	}

	private toggleThinkingBlockVisibility(): void {
		this.settingsController.toggleThinkingVisibility();
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.feedbackController.showError(errorMessage);
	}

	showWarning(warningMessage: string): void {
		this.feedbackController.showWarning(warningMessage);
	}

	showNewVersionNotification(newVersion: string): void {
		this.feedbackController.showVersionUpdate(newVersion);
	}

	showPackageUpdateNotification(packages: string[]): void {
		this.feedbackController.showPackageUpdates(packages);
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	private async handleClearCommand(): Promise<void> {
		this.workingController.stop();
		try {
			const result = await this.runtimeHost.newSession();
			if (result.cancelled) {
				return;
			}
			this.renderCurrentSessionState();
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
			this.ui.requestRender();
		} catch (error: unknown) {
			await this.handleFatalRuntimeError("Failed to create session", error);
		}
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		const entries = this.sessionManager.getEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		this.workingController.stop();

		try {
			await this.session.compact(customInstructions);
		} catch {
			// Ignore, will be emitted as an event
		}
	}

	stop(): void {
		this.terminalController.dispose();
		if (this.settingsManager.getShowTerminalProgress()) {
			this.ui.terminal.setProgress(false);
		}
		this.workingController.dispose();
		this.extensionSurfaceController.clearTerminalInputListeners();
		this.footer.dispose();
		this.footerDataProvider.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
