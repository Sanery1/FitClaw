import type { Component, Container, EditorComponent, TUI } from "@fitclaw/tui";
import type { ExtensionUIDialogOptions } from "../../core/extensions/index.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import { formatMissingSessionCwdPrompt, type MissingSessionCwdError } from "../../core/session-cwd.js";
import { ExtensionEditorComponent } from "./components/extension-editor.js";
import { ExtensionInputComponent } from "./components/extension-input.js";
import { ExtensionSelectorComponent } from "./components/extension-selector.js";

export interface InteractiveExtensionDialogControllerOptions {
	ui: TUI;
	editorContainer: Container;
	getEditor: () => EditorComponent;
	keybindings: KeybindingsManager;
}

export class InteractiveExtensionDialogController {
	private selector: ExtensionSelectorComponent | undefined;
	private inputComponent: ExtensionInputComponent | undefined;
	private editorComponent: ExtensionEditorComponent | undefined;

	constructor(private readonly options: InteractiveExtensionDialogControllerOptions) {}

	select(title: string, choices: string[], options?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (options?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideSelector();
				resolve(undefined);
			};
			options?.signal?.addEventListener("abort", onAbort, { once: true });

			this.selector = new ExtensionSelectorComponent(
				title,
				choices,
				(choice) => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideSelector();
					resolve(choice);
				},
				() => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideSelector();
					resolve(undefined);
				},
				{ tui: this.options.ui, timeout: options?.timeout },
			);

			this.show(this.selector);
		});
	}

	async confirm(title: string, message: string, options?: ExtensionUIDialogOptions): Promise<boolean> {
		const result = await this.select(`${title}\n${message}`, ["Yes", "No"], options);
		return result === "Yes";
	}

	async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		const isConfirmed = await this.confirm("Session cwd not found", formatMissingSessionCwdPrompt(error.issue));
		return isConfirmed ? error.issue.fallbackCwd : undefined;
	}

	input(title: string, placeholder?: string, options?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (options?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideInput();
				resolve(undefined);
			};
			options?.signal?.addEventListener("abort", onAbort, { once: true });

			this.inputComponent = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideInput();
					resolve(value);
				},
				() => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideInput();
					resolve(undefined);
				},
				{ tui: this.options.ui, timeout: options?.timeout },
			);

			this.show(this.inputComponent);
		});
	}

	editor(title: string, prefill?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.editorComponent = new ExtensionEditorComponent(
				this.options.ui,
				this.options.keybindings,
				title,
				prefill,
				(value) => {
					this.hideEditor();
					resolve(value);
				},
				() => {
					this.hideEditor();
					resolve(undefined);
				},
			);

			this.show(this.editorComponent);
		});
	}

	reset(): void {
		if (this.selector) this.hideSelector();
		if (this.inputComponent) this.hideInput();
		if (this.editorComponent) this.hideEditor();
	}

	private show(component: Component): void {
		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(component);
		this.options.ui.setFocus(component);
		this.options.ui.requestRender();
	}

	private hideSelector(): void {
		this.selector?.dispose();
		this.selector = undefined;
		this.restoreEditor();
	}

	private hideInput(): void {
		this.inputComponent?.dispose();
		this.inputComponent = undefined;
		this.restoreEditor();
	}

	private hideEditor(): void {
		this.editorComponent = undefined;
		this.restoreEditor();
	}

	private restoreEditor(): void {
		const editor = this.options.getEditor();
		this.options.editorContainer.clear();
		this.options.editorContainer.addChild(editor);
		this.options.ui.setFocus(editor);
		this.options.ui.requestRender();
	}
}
