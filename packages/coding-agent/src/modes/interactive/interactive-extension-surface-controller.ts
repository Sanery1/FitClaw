import type { Component, EditorComponent, EditorTheme, OverlayHandle, OverlayOptions, TUI } from "@fitclaw/tui";
import { Container } from "@fitclaw/tui";
import type { KeybindingsManager } from "../../core/keybindings.js";
import type { CustomEditor } from "./components/custom-editor.js";
import { getEditorTheme, type Theme, theme } from "./theme/theme.js";

type CustomEditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;
type CustomComponent = Component & { dispose?(): void };

export interface ExtensionCustomOptions {
	overlay?: boolean;
	overlayOptions?: OverlayOptions | (() => OverlayOptions);
	onHandle?: (handle: OverlayHandle) => void;
}

export interface InteractiveExtensionSurfaceControllerOptions {
	ui: TUI;
	defaultEditor: CustomEditor;
	keybindings: KeybindingsManager;
	applyAutocompleteToEditor: (editor: EditorComponent) => void;
}

export class InteractiveExtensionSurfaceController {
	readonly editorContainer = new Container();

	private activeEditor: EditorComponent;
	private readonly terminalInputUnsubscribers = new Set<() => void>();

	constructor(private readonly options: InteractiveExtensionSurfaceControllerOptions) {
		this.activeEditor = options.defaultEditor;
		this.editorContainer.addChild(this.activeEditor);
	}

	get editor(): EditorComponent {
		return this.activeEditor;
	}

	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.activeEditor);
			this.options.ui.setFocus(this.activeEditor);
		};
		const { component, focus } = create(done);
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.options.ui.setFocus(focus);
		this.options.ui.requestRender();
	}

	setCustomEditor(factory: CustomEditorFactory | undefined): void {
		const currentText = this.activeEditor.getText();
		this.editorContainer.clear();

		if (factory) {
			const newEditor = factory(this.options.ui, getEditorTheme(), this.options.keybindings);
			newEditor.onSubmit = this.options.defaultEditor.onSubmit;
			newEditor.onChange = this.options.defaultEditor.onChange;
			newEditor.setText(currentText);

			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.options.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.options.defaultEditor.getPaddingX());
			}
			this.options.applyAutocompleteToEditor(newEditor);
			this.copyCustomEditorHandlers(newEditor);
			this.activeEditor = newEditor;
		} else {
			this.options.defaultEditor.setText(currentText);
			this.activeEditor = this.options.defaultEditor;
		}

		this.editorContainer.addChild(this.activeEditor);
		this.options.ui.setFocus(this.activeEditor);
		this.options.ui.requestRender();
	}

	addTerminalInputListener(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void {
		const unsubscribe = this.options.ui.addInputListener(handler);
		this.terminalInputUnsubscribers.add(unsubscribe);
		return () => {
			unsubscribe();
			this.terminalInputUnsubscribers.delete(unsubscribe);
		};
	}

	clearTerminalInputListeners(): void {
		for (const unsubscribe of this.terminalInputUnsubscribers) unsubscribe();
		this.terminalInputUnsubscribers.clear();
	}

	hideOverlay(): void {
		this.options.ui.hideOverlay();
	}

	pasteToEditor(text: string): void {
		this.activeEditor.handleInput(`\x1b[200~${text}\x1b[201~`);
	}

	setEditorText(text: string): void {
		this.activeEditor.setText(text);
	}

	getEditorText(): string {
		return this.activeEditor.getExpandedText?.() ?? this.activeEditor.getText();
	}

	showCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => CustomComponent | Promise<CustomComponent>,
		options?: ExtensionCustomOptions,
	): Promise<T> {
		const savedText = this.activeEditor.getText();
		const isOverlay = options?.overlay ?? false;

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.activeEditor);
			this.activeEditor.setText(savedText);
			this.options.ui.setFocus(this.activeEditor);
			this.options.ui.requestRender();
		};

		return new Promise((resolve, reject) => {
			let component: CustomComponent;
			let isClosed = false;

			const close = (result: T) => {
				if (isClosed) return;
				isClosed = true;
				if (isOverlay) this.options.ui.hideOverlay();
				else restoreEditor();
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					// Component cleanup must not change the completed result.
				}
			};

			Promise.resolve(factory(this.options.ui, theme, this.options.keybindings, close))
				.then((createdComponent) => {
					if (isClosed) return;
					component = createdComponent;
					if (isOverlay) {
						const overlayOptions = this.resolveOverlayOptions(component, options?.overlayOptions);
						const handle = this.options.ui.showOverlay(component, overlayOptions);
						options?.onHandle?.(handle);
					} else {
						this.editorContainer.clear();
						this.editorContainer.addChild(component);
						this.options.ui.setFocus(component);
						this.options.ui.requestRender();
					}
				})
				.catch((error: unknown) => {
					if (isClosed) return;
					if (!isOverlay) restoreEditor();
					reject(error);
				});
		});
	}

	private copyCustomEditorHandlers(newEditor: EditorComponent): void {
		const customEditor = newEditor as unknown as Record<string, unknown>;
		if (!("actionHandlers" in customEditor) || !(customEditor.actionHandlers instanceof Map)) return;

		if (!customEditor.onEscape) {
			customEditor.onEscape = () => this.options.defaultEditor.onEscape?.();
		}
		if (!customEditor.onCtrlD) {
			customEditor.onCtrlD = () => this.options.defaultEditor.onCtrlD?.();
		}
		if (!customEditor.onPasteImage) {
			customEditor.onPasteImage = () => this.options.defaultEditor.onPasteImage?.();
		}
		if (!customEditor.onExtensionShortcut) {
			customEditor.onExtensionShortcut = (data: string) => this.options.defaultEditor.onExtensionShortcut?.(data);
		}
		for (const [action, handler] of this.options.defaultEditor.actionHandlers) {
			(customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
		}
	}

	private resolveOverlayOptions(
		component: CustomComponent,
		overlayOptions: OverlayOptions | (() => OverlayOptions) | undefined,
	): OverlayOptions | undefined {
		if (overlayOptions) {
			return typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
		}
		const width = (component as { width?: number }).width;
		return width ? { width } : undefined;
	}
}
