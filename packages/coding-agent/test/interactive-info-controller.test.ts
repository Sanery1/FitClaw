import { Container, Markdown, setKeybindings, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { formatKeyDisplay, keyDisplay } from "../src/modes/interactive/components/keybinding-hints.js";
import { InteractiveInfoController } from "../src/modes/interactive/interactive-info-controller.js";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.js";

function renderAll(container: Container, width = 240): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

function createInfoFixture(initialName?: string) {
	let sessionName = initialName;
	const setSessionName = vi.fn((name: string) => {
		sessionName = name;
	});
	const getShortcuts = vi.fn(
		() =>
			new Map([
				[
					"ctrl+shift+x",
					{
						description: "Extension action",
						extensionPath: "/tmp/extension.ts",
					},
				],
			]),
	);
	const session = {
		extensionRunner: { getShortcuts },
		getSessionStats: () => ({
			sessionFile: undefined,
			sessionId: "session-123",
			userMessages: 2,
			assistantMessages: 3,
			toolCalls: 4,
			toolResults: 4,
			totalMessages: 9,
			tokens: {
				input: 1_200,
				output: 300,
				cacheRead: 50,
				cacheWrite: 25,
				total: 1_575,
			},
			cost: 0.125,
		}),
		sessionManager: { getSessionName: () => sessionName },
		setSessionName,
	} as unknown as AgentSession;
	const chatContainer = new Container();
	const requestRender = vi.fn();
	const showWarning = vi.fn();
	const keybindings = new KeybindingsManager();
	const controller = new InteractiveInfoController({
		getSession: () => session,
		ui: { requestRender } as unknown as TUI,
		chatContainer,
		keybindings,
		getMarkdownTheme,
		showWarning,
	});

	return { chatContainer, controller, getShortcuts, requestRender, setSessionName, showWarning };
}

describe("InteractiveInfoController", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("shows and updates the session name", () => {
		const fixture = createInfoFixture("existing");

		fixture.controller.handleNameCommand("/name");
		expect(renderAll(fixture.chatContainer)).toContain("Session name: existing");

		fixture.controller.handleNameCommand("/name renamed session");
		expect(fixture.setSessionName).toHaveBeenCalledWith("renamed session");
		expect(renderAll(fixture.chatContainer)).toContain("Session name set: renamed session");
	});

	it("shows name usage when the session is unnamed", () => {
		const fixture = createInfoFixture();

		fixture.controller.handleNameCommand("/name");

		expect(fixture.showWarning).toHaveBeenCalledWith("Usage: /name <name>");
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});

	it("renders session message, token, and cost statistics", () => {
		const fixture = createInfoFixture("training");

		fixture.controller.showSessionInfo();
		const output = renderAll(fixture.chatContainer);

		expect(output).toContain("Session Info");
		expect(output).toContain("session-123");
		expect(output).toContain("1,200");
		expect(output).toContain("0.1250");
	});

	it("renders configured and extension keyboard shortcuts", () => {
		const fixture = createInfoFixture();

		fixture.controller.showHotkeys();
		const output = renderAll(fixture.chatContainer);

		expect(output).toContain("Keyboard Shortcuts");
		expect(output).toContain("Navigation");
		expect(output).toContain("Ctrl+P");
		expect(output).toContain("Extension action");
		expect(fixture.getShortcuts).toHaveBeenCalledTimes(1);
	});

	it("mounts the changelog markdown panel", () => {
		const fixture = createInfoFixture();

		fixture.controller.showChangelog();

		expect(fixture.chatContainer.children[2]?.render(120).join("\n")).toContain("What's New");
		expect(fixture.chatContainer.children[4]).toBeInstanceOf(Markdown);
	});

	it("formats configured and raw key combinations consistently", () => {
		expect(keyDisplay("app.model.cycleBackward")).toBe("Shift+Ctrl+P");
		expect(formatKeyDisplay("ctrl+p/alt+p")).toBe("Ctrl+P/Alt+P");
	});
});
