import { type Component, Container, type EditorComponent, Spacer, Text, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { ExtensionRunner } from "../../core/extensions/index.js";
import type { FooterDataProvider } from "../../core/footer-data-provider.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import type { CustomEditor } from "./components/custom-editor.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import type { FooterComponent } from "./components/footer.js";
import { setRegisteredThemes, setTheme, theme } from "./theme/theme.js";

export interface InteractiveReloadControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	editorContainer: Container;
	defaultEditor: CustomEditor;
	getEditor: () => EditorComponent;
	keybindings: KeybindingsManager;
	footer: FooterComponent;
	footerDataProvider: FooterDataProvider;
	getToolOutputExpanded: () => boolean;
	setHeaderExpanded: (expanded: boolean) => void;
	refreshSettings: () => void;
	setupAutocomplete: () => void;
	setupExtensionShortcuts: (runner: ExtensionRunner) => void;
	resetExtensionUI: () => void;
	rebuildChatFromMessages: () => void;
	showLoadedResources: () => void;
	showWarning: (message: string) => void;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
}

export class InteractiveReloadController {
	constructor(private readonly options: InteractiveReloadControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	applyRuntimeSettings(): void {
		this.options.footer.setSession(this.session);
		this.options.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.options.footerDataProvider.setCwd(this.session.sessionManager.getCwd());
		this.options.refreshSettings();
		this.applyUiSettings();
		this.applyEditorSettings();
	}

	async reload(): Promise<void> {
		if (this.session.isStreaming) {
			this.options.showWarning("Wait for the current response to finish before reloading.");
			return;
		}
		if (this.session.isCompacting) {
			this.options.showWarning("Wait for compaction to finish before reloading.");
			return;
		}

		this.options.resetExtensionUI();
		const previousEditor = this.options.getEditor();
		this.showReloadBox();
		await new Promise((resolve) => process.nextTick(resolve));

		try {
			await this.session.reload();
			this.options.keybindings.reload();
			this.options.setHeaderExpanded(this.options.getToolOutputExpanded());
			setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
			this.options.refreshSettings();
			this.applyConfiguredTheme();
			this.applyEditorSettings();
			this.applyUiSettings();
			this.options.setupAutocomplete();
			this.options.setupExtensionShortcuts(this.session.extensionRunner);
			this.options.rebuildChatFromMessages();
			this.restoreEditor(this.options.getEditor());
			this.options.showLoadedResources();

			const modelsJsonError = this.session.modelRegistry.getError();
			if (modelsJsonError) {
				this.options.showError(`models.json error: ${modelsJsonError}`);
			}
			this.options.showStatus("Reloaded keybindings, extensions, skills, prompts, themes");
		} catch (error: unknown) {
			this.restoreEditor(previousEditor);
			this.options.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private applyConfiguredTheme(): void {
		const themeName = this.session.settingsManager.getTheme();
		const result = themeName ? setTheme(themeName, true) : { success: true };
		if (!result.success) {
			this.options.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
		}
	}

	private applyUiSettings(): void {
		const settings = this.session.settingsManager;
		this.options.ui.setShowHardwareCursor(settings.getShowHardwareCursor());
		this.options.ui.setClearOnShrink(settings.getClearOnShrink());
	}

	private applyEditorSettings(): void {
		const settings = this.session.settingsManager;
		const padding = settings.getEditorPaddingX();
		const autocompleteMaxVisible = settings.getAutocompleteMaxVisible();
		this.options.defaultEditor.setPaddingX(padding);
		this.options.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		const editor = this.options.getEditor();
		if (editor !== this.options.defaultEditor) {
			editor.setPaddingX?.(padding);
			editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
		}
	}

	private showReloadBox(): void {
		const reloadBox = new Container();
		const borderColor = (text: string) => theme.fg("border", text);
		reloadBox.addChild(new DynamicBorder(borderColor));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(
			new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0),
		);
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new DynamicBorder(borderColor));

		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(reloadBox);
		this.options.ui.setFocus(reloadBox);
		this.options.ui.requestRender(true);
	}

	private restoreEditor(editor: EditorComponent): void {
		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(editor as Component);
		this.options.ui.setFocus(editor);
		this.options.ui.requestRender();
	}
}
