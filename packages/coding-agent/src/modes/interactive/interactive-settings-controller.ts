import type { Component, Container, EditorComponent, TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { CustomEditor } from "./components/custom-editor.js";
import type { FooterComponent } from "./components/footer.js";
import { SettingsSelectorComponent } from "./components/settings-selector.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { getAvailableThemes, setTheme } from "./theme/theme.js";

export interface InteractiveSettingsControllerOptions {
	getSession: () => AgentSession;
	getEditor: () => EditorComponent;
	ui: TUI;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	footer: FooterComponent;
	showSelector: (create: (done: () => void) => { component: Component; focus: Component }) => void;
	setupAutocomplete: () => void;
	rebuildThinkingVisibility: (hidden: boolean, showStatus: boolean) => void;
	updateEditorBorderColor: () => void;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
}

export class InteractiveSettingsController {
	private isThinkingHidden: boolean;

	constructor(private readonly options: InteractiveSettingsControllerOptions) {
		this.isThinkingHidden = this.session.settingsManager.getHideThinkingBlock();
	}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	get hideThinkingBlock(): boolean {
		return this.isThinkingHidden;
	}

	refresh(): void {
		this.isThinkingHidden = this.session.settingsManager.getHideThinkingBlock();
	}

	toggleThinkingVisibility(): void {
		this.setThinkingVisibility(!this.isThinkingHidden, true);
	}

	show(): void {
		const settings = this.session.settingsManager;
		this.options.showSelector((done) => {
			const selector = new SettingsSelectorComponent(
				{
					autoCompact: this.session.autoCompactionEnabled,
					showImages: settings.getShowImages(),
					imageWidthCells: settings.getImageWidthCells(),
					autoResizeImages: settings.getImageAutoResize(),
					blockImages: settings.getBlockImages(),
					enableSkillCommands: settings.getEnableSkillCommands(),
					steeringMode: this.session.steeringMode,
					followUpMode: this.session.followUpMode,
					transport: settings.getTransport(),
					thinkingLevel: this.session.thinkingLevel,
					availableThinkingLevels: this.session.getAvailableThinkingLevels(),
					currentTheme: settings.getTheme() || "dark",
					availableThemes: getAvailableThemes(),
					hideThinkingBlock: this.isThinkingHidden,
					collapseChangelog: settings.getCollapseChangelog(),
					enableInstallTelemetry: settings.getEnableInstallTelemetry(),
					doubleEscapeAction: settings.getDoubleEscapeAction(),
					treeFilterMode: settings.getTreeFilterMode(),
					showHardwareCursor: settings.getShowHardwareCursor(),
					editorPaddingX: settings.getEditorPaddingX(),
					autocompleteMaxVisible: settings.getAutocompleteMaxVisible(),
					quietStartup: settings.getQuietStartup(),
					clearOnShrink: settings.getClearOnShrink(),
					showTerminalProgress: settings.getShowTerminalProgress(),
					warnings: settings.getWarnings(),
				},
				{
					onAutoCompactChange: (enabled) => {
						this.session.setAutoCompactionEnabled(enabled);
						this.options.footer.setAutoCompactEnabled(enabled);
					},
					onShowImagesChange: (enabled) => {
						settings.setShowImages(enabled);
						for (const child of this.options.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) child.setShowImages(enabled);
						}
					},
					onImageWidthCellsChange: (width) => {
						settings.setImageWidthCells(width);
						for (const child of this.options.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) child.setImageWidthCells(width);
						}
					},
					onAutoResizeImagesChange: (enabled) => settings.setImageAutoResize(enabled),
					onBlockImagesChange: (blocked) => settings.setBlockImages(blocked),
					onEnableSkillCommandsChange: (enabled) => {
						settings.setEnableSkillCommands(enabled);
						this.options.setupAutocomplete();
					},
					onSteeringModeChange: (mode) => this.session.setSteeringMode(mode),
					onFollowUpModeChange: (mode) => this.session.setFollowUpMode(mode),
					onTransportChange: (transport) => {
						settings.setTransport(transport);
						this.session.agent.transport = transport;
					},
					onThinkingLevelChange: (level) => {
						this.session.setThinkingLevel(level);
						this.options.footer.invalidate();
						this.options.updateEditorBorderColor();
					},
					onThemeChange: (themeName) => {
						const result = setTheme(themeName, true);
						settings.setTheme(themeName);
						this.options.ui.invalidate();
						if (!result.success) {
							this.options.showError(
								`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`,
							);
						}
					},
					onThemePreview: (themeName) => {
						const result = setTheme(themeName, true);
						if (result.success) {
							this.options.ui.invalidate();
							this.options.ui.requestRender();
						}
					},
					onHideThinkingBlockChange: (hidden) => this.setThinkingVisibility(hidden, false),
					onCollapseChangelogChange: (collapsed) => settings.setCollapseChangelog(collapsed),
					onEnableInstallTelemetryChange: (enabled) => settings.setEnableInstallTelemetry(enabled),
					onQuietStartupChange: (enabled) => settings.setQuietStartup(enabled),
					onDoubleEscapeActionChange: (action) => settings.setDoubleEscapeAction(action),
					onTreeFilterModeChange: (mode) => settings.setTreeFilterMode(mode),
					onShowHardwareCursorChange: (enabled) => {
						settings.setShowHardwareCursor(enabled);
						this.options.ui.setShowHardwareCursor(enabled);
					},
					onEditorPaddingXChange: (padding) => {
						settings.setEditorPaddingX(padding);
						this.options.defaultEditor.setPaddingX(padding);
						const editor = this.options.getEditor();
						if (editor !== this.options.defaultEditor) editor.setPaddingX?.(padding);
					},
					onAutocompleteMaxVisibleChange: (maxVisible) => {
						settings.setAutocompleteMaxVisible(maxVisible);
						this.options.defaultEditor.setAutocompleteMaxVisible(maxVisible);
						const editor = this.options.getEditor();
						if (editor !== this.options.defaultEditor) editor.setAutocompleteMaxVisible?.(maxVisible);
					},
					onClearOnShrinkChange: (enabled) => {
						settings.setClearOnShrink(enabled);
						this.options.ui.setClearOnShrink(enabled);
					},
					onShowTerminalProgressChange: (enabled) => settings.setShowTerminalProgress(enabled),
					onWarningsChange: (warnings) => settings.setWarnings(warnings),
					onCancel: () => {
						done();
						this.options.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector.getSettingsList() };
		});
	}

	private setThinkingVisibility(hidden: boolean, showStatus: boolean): void {
		this.isThinkingHidden = hidden;
		this.session.settingsManager.setHideThinkingBlock(hidden);
		this.options.rebuildThinkingVisibility(hidden, showStatus);
		if (showStatus) {
			this.options.showStatus(`Thinking blocks: ${hidden ? "hidden" : "visible"}`);
		}
	}
}
