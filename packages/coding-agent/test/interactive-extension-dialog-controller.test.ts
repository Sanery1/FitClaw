import { type Component, Container, type EditorComponent, setKeybindings, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { MissingSessionCwdError } from "../src/core/session-cwd.js";
import type { ExtensionEditorComponent } from "../src/modes/interactive/components/extension-editor.js";
import type { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.js";
import { InteractiveExtensionDialogController } from "../src/modes/interactive/interactive-extension-dialog-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createDialogFixture() {
	const editor = new Container() as unknown as EditorComponent;
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const setFocus = vi.fn<(component: Component) => void>();
	const requestRender = vi.fn();
	const ui = { requestRender, setFocus } as unknown as TUI;
	const controller = new InteractiveExtensionDialogController({
		ui,
		editorContainer,
		getEditor: () => editor,
		keybindings: new KeybindingsManager(),
	});

	return { controller, editor, editorContainer, requestRender, setFocus };
}

function getSelector(container: Container): ExtensionSelectorComponent {
	return container.children[0] as ExtensionSelectorComponent;
}

describe("InteractiveExtensionDialogController", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("returns the selected option and restores the active editor", async () => {
		const fixture = createDialogFixture();

		const resultPromise = fixture.controller.select("Choose", ["First", "Second"]);
		getSelector(fixture.editorContainer).handleInput("\n");

		await expect(resultPromise).resolves.toBe("First");
		expect(fixture.editorContainer.children).toEqual([fixture.editor]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(fixture.editor);
		expect(fixture.requestRender).toHaveBeenCalledTimes(2);
	});

	it("cancels an input when its abort signal fires", async () => {
		const fixture = createDialogFixture();
		const abortController = new AbortController();

		const resultPromise = fixture.controller.input("Value", undefined, {
			signal: abortController.signal,
		});
		abortController.abort();

		await expect(resultPromise).resolves.toBeUndefined();
		expect(fixture.editorContainer.children).toEqual([fixture.editor]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(fixture.editor);
	});

	it("returns the fallback cwd after confirmation", async () => {
		const fixture = createDialogFixture();
		const error = new MissingSessionCwdError({
			sessionCwd: "/missing/project",
			fallbackCwd: "/current/project",
		});

		const resultPromise = fixture.controller.promptForMissingSessionCwd(error);
		const selector = getSelector(fixture.editorContainer);
		expect(selector.render(120).join("\n")).toContain("/missing/project");
		selector.handleInput("\n");

		await expect(resultPromise).resolves.toBe("/current/project");
		expect(fixture.editorContainer.children).toEqual([fixture.editor]);
	});

	it("submits multi-line editor content and restores the active editor", async () => {
		const fixture = createDialogFixture();

		const resultPromise = fixture.controller.editor("Instructions", "Existing draft");
		const extensionEditor = fixture.editorContainer.children[0] as ExtensionEditorComponent;
		extensionEditor.handleInput("\r");

		await expect(resultPromise).resolves.toBe("Existing draft");
		expect(fixture.editorContainer.children).toEqual([fixture.editor]);
		expect(fixture.setFocus).toHaveBeenLastCalledWith(fixture.editor);
	});

	it("restores the editor when active dialogs are reset", async () => {
		const fixture = createDialogFixture();
		const abortController = new AbortController();
		const resultPromise = fixture.controller.select("Choose", ["First"], {
			signal: abortController.signal,
		});

		fixture.controller.reset();
		expect(fixture.editorContainer.children).toEqual([fixture.editor]);

		abortController.abort();
		await expect(resultPromise).resolves.toBeUndefined();
	});
});
