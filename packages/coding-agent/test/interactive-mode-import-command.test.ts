import { Container, type EditorComponent, type TUI } from "@fitclaw/tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { type AgentSessionRuntime, SessionImportFileNotFoundError } from "../src/core/agent-session-runtime.js";
import { MissingSessionCwdError } from "../src/core/session-cwd.js";
import {
	getPathCommandArgument,
	InteractiveSessionTransferController,
} from "../src/modes/interactive/interactive-session-transfer-controller.js";

interface TransferFixtureOptions {
	importFromJsonl?: AgentSessionRuntime["importFromJsonl"];
	selectedCwd?: string;
}

function createTransferFixture(options: TransferFixtureOptions = {}) {
	const exportToHtml = vi.fn<AgentSession["exportToHtml"]>(async (outputPath) => outputPath ?? "session.html");
	const exportToJsonl = vi.fn<AgentSession["exportToJsonl"]>((outputPath) => outputPath ?? "session.jsonl");
	const session = {
		exportToHtml,
		exportToJsonl,
		getLastAssistantText: () => undefined,
	} as unknown as AgentSession;
	const importFromJsonl = vi.fn<AgentSessionRuntime["importFromJsonl"]>(
		options.importFromJsonl ?? (async () => ({ cancelled: false })),
	);
	const showConfirm = vi.fn(async () => true);
	const promptForMissingSessionCwd = vi.fn(async () => options.selectedCwd);
	const stopWorkingLoader = vi.fn();
	const renderCurrentSessionState = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const handleFatalRuntimeError = vi.fn(async (_prefix: string, error: unknown): Promise<never> => {
		throw error;
	});
	const controller = new InteractiveSessionTransferController({
		getSession: () => session,
		runtimeHost: { importFromJsonl },
		ui: {} as TUI,
		editorContainer: new Container(),
		getEditor: () => new Container() as unknown as EditorComponent,
		showConfirm,
		promptForMissingSessionCwd,
		stopWorkingLoader,
		renderCurrentSessionState,
		showStatus,
		showError,
		handleFatalRuntimeError,
	});

	return {
		controller,
		exportToHtml,
		exportToJsonl,
		handleFatalRuntimeError,
		importFromJsonl,
		promptForMissingSessionCwd,
		renderCurrentSessionState,
		showConfirm,
		showError,
		showStatus,
		stopWorkingLoader,
	};
}

describe("session transfer path parsing", () => {
	it("strips quotes from path arguments", () => {
		expect(getPathCommandArgument('/import "path/to/session.jsonl"', "/import")).toBe("path/to/session.jsonl");
		expect(getPathCommandArgument('/import "path with spaces/session.jsonl"', "/import")).toBe(
			"path with spaces/session.jsonl",
		);
	});

	it("preserves apostrophes in unquoted path arguments", () => {
		expect(getPathCommandArgument("/import john's/session.jsonl", "/import")).toBe("john's/session.jsonl");
	});

	it("enforces command token boundaries", () => {
		expect(getPathCommandArgument("/important /tmp/session.jsonl", "/import")).toBe(undefined);
		expect(getPathCommandArgument("/exporter out.html", "/export")).toBe(undefined);
		expect(getPathCommandArgument("/import /tmp/session.jsonl", "/import")).toBe("/tmp/session.jsonl");
	});
});

describe("InteractiveSessionTransferController export", () => {
	it("exports .jsonl paths as JSONL", async () => {
		const fixture = createTransferFixture();

		await fixture.controller.handleExportCommand("/export session.jsonl");

		expect(fixture.exportToJsonl).toHaveBeenCalledWith("session.jsonl");
		expect(fixture.exportToHtml).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Session exported to: session.jsonl");
	});

	it("exports other paths as HTML", async () => {
		const fixture = createTransferFixture();

		await fixture.controller.handleExportCommand("/export session.html");

		expect(fixture.exportToHtml).toHaveBeenCalledWith("session.html");
		expect(fixture.exportToJsonl).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Session exported to: session.html");
	});
});

describe("InteractiveSessionTransferController import", () => {
	it("passes an unquoted path to the runtime", async () => {
		const fixture = createTransferFixture();

		await fixture.controller.handleImportCommand('/import "path/to/session.jsonl"');

		expect(fixture.showConfirm).toHaveBeenCalledWith(
			"Import session",
			"Replace current session with path/to/session.jsonl?",
		);
		expect(fixture.stopWorkingLoader).toHaveBeenCalledOnce();
		expect(fixture.importFromJsonl).toHaveBeenCalledWith("path/to/session.jsonl");
		expect(fixture.renderCurrentSessionState).toHaveBeenCalledOnce();
		expect(fixture.showError).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Session imported from: path/to/session.jsonl");
	});

	it("passes an unquoted apostrophe path unchanged", async () => {
		const fixture = createTransferFixture();

		await fixture.controller.handleImportCommand("/import john's/session.jsonl");

		expect(fixture.importFromJsonl).toHaveBeenCalledWith("john's/session.jsonl");
		expect(fixture.showError).not.toHaveBeenCalled();
	});

	it("shows a non-fatal error when the path does not exist", async () => {
		const importFromJsonl = vi.fn<AgentSessionRuntime["importFromJsonl"]>(async () => {
			throw new SessionImportFileNotFoundError("/tmp/missing-session.jsonl");
		});
		const fixture = createTransferFixture({ importFromJsonl });

		await fixture.controller.handleImportCommand("/import /tmp/missing-session.jsonl");

		expect(fixture.showError).toHaveBeenCalledWith(
			"Failed to import session: File not found: /tmp/missing-session.jsonl",
		);
		expect(fixture.showStatus).not.toHaveBeenCalled();
		expect(fixture.handleFatalRuntimeError).not.toHaveBeenCalled();
	});

	it("retries in the selected cwd when the stored cwd is missing", async () => {
		const missingCwdError = new MissingSessionCwdError({
			sessionFile: "session.jsonl",
			sessionCwd: "missing-cwd",
			fallbackCwd: "current-cwd",
		});
		const importFromJsonl = vi
			.fn<AgentSessionRuntime["importFromJsonl"]>()
			.mockRejectedValueOnce(missingCwdError)
			.mockResolvedValueOnce({ cancelled: false });
		const fixture = createTransferFixture({ importFromJsonl, selectedCwd: "current-cwd" });

		await fixture.controller.handleImportCommand("/import session.jsonl");

		expect(fixture.promptForMissingSessionCwd).toHaveBeenCalledWith(missingCwdError);
		expect(fixture.importFromJsonl).toHaveBeenNthCalledWith(1, "session.jsonl");
		expect(fixture.importFromJsonl).toHaveBeenNthCalledWith(2, "session.jsonl", "current-cwd");
		expect(fixture.renderCurrentSessionState).toHaveBeenCalledOnce();
		expect(fixture.showStatus).toHaveBeenCalledWith("Session imported from: session.jsonl");
	});
});
