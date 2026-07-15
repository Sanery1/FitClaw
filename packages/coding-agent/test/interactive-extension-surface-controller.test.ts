import type { Component, EditorComponent, OverlayHandle, TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import { InteractiveExtensionSurfaceController } from "../src/modes/interactive/interactive-extension-surface-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

interface TestEditor extends EditorComponent {
	actionHandlers: Map<string, () => void>;
	onCtrlD?: () => void;
	onEscape?: () => void;
	onExtensionShortcut?: (data: string) => boolean | undefined;
	onPasteImage?: () => void;
	setPaddingX: ReturnType<typeof vi.fn>;
}

function createEditor(initialText: string): TestEditor & { getPaddingX: () => number } {
	let text = initialText;
	return {
		actionHandlers: new Map(),
		borderColor: (value) => value,
		getPaddingX: () => 3,
		getText: () => text,
		handleInput: vi.fn(),
		invalidate: vi.fn(),
		render: () => [],
		setPaddingX: vi.fn(),
		setText: vi.fn((value: string) => {
			text = value;
		}),
	};
}

function createComponent(width?: number): Component & { dispose: ReturnType<typeof vi.fn>; width?: number } {
	return {
		dispose: vi.fn(),
		invalidate: vi.fn(),
		render: () => [],
		...(width === undefined ? {} : { width }),
	};
}

function createSurfaceFixture() {
	const defaultEditor = createEditor("draft");
	const setFocus = vi.fn();
	const requestRender = vi.fn();
	const hideOverlay = vi.fn();
	const overlayHandle = {} as OverlayHandle;
	const showOverlay = vi.fn(() => overlayHandle);
	const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
	const addInputListener = vi.fn(() => {
		const unsubscribe = vi.fn();
		unsubscribers.push(unsubscribe);
		return unsubscribe;
	});
	const ui = { addInputListener, hideOverlay, requestRender, setFocus, showOverlay } as unknown as TUI;
	const applyAutocompleteToEditor = vi.fn<(editor: EditorComponent) => void>();
	const controller = new InteractiveExtensionSurfaceController({
		ui,
		defaultEditor: defaultEditor as unknown as CustomEditor,
		keybindings: new KeybindingsManager(),
		applyAutocompleteToEditor,
	});

	return {
		applyAutocompleteToEditor,
		controller,
		defaultEditor,
		hideOverlay,
		overlayHandle,
		requestRender,
		setFocus,
		showOverlay,
		unsubscribers,
	};
}

describe("InteractiveExtensionSurfaceController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("switches custom editors while preserving callbacks, text, appearance, and actions", () => {
		const fixture = createSurfaceFixture();
		const onSubmit = vi.fn();
		const onChange = vi.fn();
		const onEscape = vi.fn();
		const action = vi.fn();
		fixture.defaultEditor.onSubmit = onSubmit;
		fixture.defaultEditor.onChange = onChange;
		fixture.defaultEditor.onEscape = onEscape;
		fixture.defaultEditor.actionHandlers.set("app.test", action);
		const customEditor = createEditor("");

		fixture.controller.setCustomEditor(() => customEditor);

		expect(fixture.controller.editor).toBe(customEditor);
		expect(fixture.controller.editorContainer.children).toEqual([customEditor]);
		expect(customEditor.setText).toHaveBeenCalledWith("draft");
		expect(customEditor.onSubmit).toBe(onSubmit);
		expect(customEditor.onChange).toBe(onChange);
		expect(customEditor.borderColor).toBe(fixture.defaultEditor.borderColor);
		expect(customEditor.setPaddingX).toHaveBeenCalledWith(3);
		expect(fixture.applyAutocompleteToEditor).toHaveBeenCalledWith(customEditor);
		expect(customEditor.actionHandlers.get("app.test")).toBe(action);
		customEditor.onEscape?.();
		expect(onEscape).toHaveBeenCalledTimes(1);

		fixture.controller.setEditorText("updated");
		expect(fixture.controller.getEditorText()).toBe("updated");
		fixture.controller.pasteToEditor(" pasted ");
		expect(customEditor.handleInput).toHaveBeenCalledWith("\x1b[200~ pasted \x1b[201~");

		fixture.controller.setCustomEditor(undefined);
		expect(fixture.controller.editor).toBe(fixture.defaultEditor);
		expect(fixture.defaultEditor.setText).toHaveBeenLastCalledWith("updated");
		expect(fixture.setFocus).toHaveBeenLastCalledWith(fixture.defaultEditor);
	});

	it("mounts selectors and restores the active editor through done", () => {
		const fixture = createSurfaceFixture();
		const component = createComponent();
		const focus = createComponent();
		let done: (() => void) | undefined;

		fixture.controller.showSelector((restore) => {
			done = restore;
			return { component, focus };
		});

		expect(fixture.controller.editorContainer.children).toEqual([component]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(focus);
		done?.();
		expect(fixture.controller.editorContainer.children).toEqual([fixture.defaultEditor]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(fixture.defaultEditor);
	});

	it("tracks terminal listeners until individually removed or cleared", () => {
		const fixture = createSurfaceFixture();
		const removeFirst = fixture.controller.addTerminalInputListener(() => undefined);
		fixture.controller.addTerminalInputListener(() => undefined);

		removeFirst();
		expect(fixture.unsubscribers[0]).toHaveBeenCalledTimes(1);
		expect(fixture.unsubscribers[1]).not.toHaveBeenCalled();

		fixture.controller.clearTerminalInputListeners();
		expect(fixture.unsubscribers[1]).toHaveBeenCalledTimes(1);
	});

	it("mounts inline custom UI and restores the active editor on completion", async () => {
		const fixture = createSurfaceFixture();
		const component = createComponent();
		let close: ((result: string) => void) | undefined;
		const resultPromise = fixture.controller.showCustom<string>((_ui, _theme, _keybindings, done) => {
			close = done;
			return component;
		});
		await Promise.resolve();

		expect(fixture.controller.editorContainer.children).toEqual([component]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(component);
		close?.("complete");

		await expect(resultPromise).resolves.toBe("complete");
		expect(fixture.controller.editorContainer.children).toEqual([fixture.defaultEditor]);
		expect(fixture.defaultEditor.setText).toHaveBeenLastCalledWith("draft");
		expect(component.dispose).toHaveBeenCalledTimes(1);
	});

	it("shows overlay custom UI with component width and exposes its handle", async () => {
		const fixture = createSurfaceFixture();
		const component = createComponent(42);
		const onHandle = vi.fn();
		let close: ((result: number) => void) | undefined;
		const resultPromise = fixture.controller.showCustom<number>(
			(_ui, _theme, _keybindings, done) => {
				close = done;
				return component;
			},
			{ overlay: true, onHandle },
		);
		await Promise.resolve();

		expect(fixture.showOverlay).toHaveBeenCalledWith(component, { width: 42 });
		expect(onHandle).toHaveBeenCalledWith(fixture.overlayHandle);
		close?.(42);

		await expect(resultPromise).resolves.toBe(42);
		expect(fixture.hideOverlay).toHaveBeenCalledTimes(1);
		expect(component.dispose).toHaveBeenCalledTimes(1);
	});
});
