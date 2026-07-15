import { Container, type EditorComponent, type TUI } from "@fitclaw/tui";
import { describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { InteractiveAuthController } from "../src/modes/interactive/interactive-auth-controller.js";

function createSession(): AgentSession {
	return {
		settingsManager: {
			getWarnings: () => ({}),
		},
		modelRegistry: {
			authStorage: {
				get: () => undefined,
				getOAuthProviders: () => [],
				list: () => [],
			},
		},
	} as unknown as AgentSession;
}

function createController() {
	const showSelector = vi.fn();
	const showStatus = vi.fn();
	const controller = new InteractiveAuthController({
		getSession: () => createSession(),
		ui: { requestRender: vi.fn() } as unknown as TUI,
		editorContainer: new Container(),
		getEditor: () => new Container() as unknown as EditorComponent,
		showSelector,
		showStatus,
		showError: vi.fn(),
		showWarning: vi.fn(),
		updateAvailableProviderCount: async () => undefined,
		invalidateFooter: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		checkModelEasterEgg: vi.fn(),
	});
	return { controller, showSelector, showStatus };
}

describe("InteractiveAuthController", () => {
	test("opens the authentication method selector for login", () => {
		const harness = createController();

		harness.controller.show("login");

		expect(harness.showSelector).toHaveBeenCalledTimes(1);
		expect(harness.showStatus).not.toHaveBeenCalled();
	});

	test("reports when logout has no stored credentials", () => {
		const harness = createController();

		harness.controller.show("logout");

		expect(harness.showSelector).not.toHaveBeenCalled();
		expect(harness.showStatus).toHaveBeenCalledWith(
			"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
		);
	});
});
