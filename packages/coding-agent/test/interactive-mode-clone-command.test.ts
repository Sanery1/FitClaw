import type { Container, EditorComponent, TUI } from "@fitclaw/tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.js";
import type { KeybindingsManager } from "../src/core/keybindings.js";
import { MissingSessionCwdError } from "../src/core/session-cwd.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import {
	InteractiveSessionNavigationController,
	type InteractiveSessionNavigationControllerOptions,
} from "../src/modes/interactive/interactive-session-navigation-controller.js";

interface ControllerFixtureOptions {
	leafId?: string | null;
	selectedCwd?: string;
	switchSessionImplementation?: AgentSessionRuntime["switchSession"];
}

function createControllerFixture(options: ControllerFixtureOptions = {}) {
	const leafId = options.leafId === undefined ? "leaf-123" : options.leafId;
	const session = {
		sessionManager: { getLeafId: () => leafId },
	} as unknown as AgentSession;
	const fork = vi.fn<AgentSessionRuntime["fork"]>(async () => ({ cancelled: false }));
	const switchSession = vi.fn<AgentSessionRuntime["switchSession"]>(
		options.switchSessionImplementation ?? (async () => ({ cancelled: false })),
	);
	const renderCurrentSessionState = vi.fn();
	const setText = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const requestRender = vi.fn();
	const stopWorkingLoader = vi.fn();
	const promptForMissingSessionCwd = vi.fn(async () => options.selectedCwd);
	const editor = { getText: () => "", setText } as unknown as EditorComponent;

	const controllerOptions: InteractiveSessionNavigationControllerOptions = {
		getSession: () => session,
		runtimeHost: { fork, switchSession },
		ui: { requestRender } as unknown as TUI,
		chatContainer: {} as Container,
		statusContainer: {} as Container,
		defaultEditor: {} as CustomEditor,
		getEditor: () => editor,
		keybindings: {} as KeybindingsManager,
		showSelector: vi.fn(),
		showExtensionSelector: vi.fn(async () => undefined),
		showExtensionEditor: vi.fn(async () => undefined),
		promptForMissingSessionCwd,
		stopWorkingLoader,
		renderCurrentSessionState,
		renderInitialMessages: vi.fn(),
		showStatus,
		showError,
		handleFatalRuntimeError: async (_prefix, error): Promise<never> => {
			throw error;
		},
		flushCompactionQueue: vi.fn(async () => undefined),
		shutdown: vi.fn(async () => undefined),
	};

	return {
		controller: new InteractiveSessionNavigationController(controllerOptions),
		fork,
		promptForMissingSessionCwd,
		renderCurrentSessionState,
		requestRender,
		setText,
		showError,
		showStatus,
		stopWorkingLoader,
		switchSession,
	};
}

describe("InteractiveSessionNavigationController /clone", () => {
	it("clones the current leaf into a new session", async () => {
		const fixture = createControllerFixture();

		await fixture.controller.handleCloneCommand();

		expect(fixture.fork).toHaveBeenCalledWith("leaf-123", { position: "at" });
		expect(fixture.renderCurrentSessionState).toHaveBeenCalled();
		expect(fixture.setText).toHaveBeenCalledWith("");
		expect(fixture.showStatus).toHaveBeenCalledWith("Cloned to new session");
		expect(fixture.showError).not.toHaveBeenCalled();
		expect(fixture.requestRender).not.toHaveBeenCalled();
	});

	it("shows a status message when there is nothing to clone", async () => {
		const fixture = createControllerFixture({ leafId: null });

		await fixture.controller.handleCloneCommand();

		expect(fixture.fork).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Nothing to clone yet");
		expect(fixture.showError).not.toHaveBeenCalled();
	});
});

describe("InteractiveSessionNavigationController resume", () => {
	it("retries in the selected cwd when the stored session cwd is missing", async () => {
		const missingCwdError = new MissingSessionCwdError({
			sessionFile: "session.jsonl",
			sessionCwd: "missing-cwd",
			fallbackCwd: "current-cwd",
		});
		const switchSessionImplementation = vi
			.fn<AgentSessionRuntime["switchSession"]>()
			.mockRejectedValueOnce(missingCwdError)
			.mockResolvedValueOnce({ cancelled: false });
		const fixture = createControllerFixture({
			selectedCwd: "current-cwd",
			switchSessionImplementation,
		});

		const result = await fixture.controller.handleResumeSession("session.jsonl");

		expect(result).toEqual({ cancelled: false });
		expect(fixture.stopWorkingLoader).toHaveBeenCalledOnce();
		expect(fixture.promptForMissingSessionCwd).toHaveBeenCalledWith(missingCwdError);
		expect(fixture.switchSession).toHaveBeenNthCalledWith(1, "session.jsonl", { withSession: undefined });
		expect(fixture.switchSession).toHaveBeenNthCalledWith(2, "session.jsonl", {
			cwdOverride: "current-cwd",
			withSession: undefined,
		});
		expect(fixture.renderCurrentSessionState).toHaveBeenCalledOnce();
		expect(fixture.showStatus).toHaveBeenCalledWith("Resumed session in current cwd");
	});
});
