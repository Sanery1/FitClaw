import type { EditorComponent, TUI } from "@fitclaw/tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.js";
import { InteractiveTerminalController } from "../src/modes/interactive/interactive-terminal-controller.js";

type ProcessSignalHandler = () => void;

function createTerminalFixture(initialStreaming = false) {
	let isStreaming = initialStreaming;
	const drainInput = vi.fn(async () => undefined);
	const start = vi.fn();
	const stop = vi.fn();
	const requestRender = vi.fn();
	const ui = {
		requestRender,
		start,
		stop,
		terminal: { drainInput },
	} as unknown as TUI;
	const disposeRuntime = vi.fn(async () => undefined);
	const runtimeHost = { dispose: disposeRuntime } as unknown as Pick<AgentSessionRuntime, "dispose">;
	const editor = {
		getText: () => "draft",
		handleInput: vi.fn(),
		invalidate: vi.fn(),
		render: () => [],
		setText: vi.fn(),
	} as EditorComponent;
	const clearEditor = vi.fn();
	const stopInteractiveMode = vi.fn();
	const showStatus = vi.fn();
	const showWarning = vi.fn();
	const exitProcess = vi.fn();
	const controller = new InteractiveTerminalController({
		runtimeHost,
		ui,
		getEditor: () => editor,
		isStreaming: () => isStreaming,
		clearEditor,
		stopInteractiveMode,
		showStatus,
		showWarning,
		exitProcess,
	});

	return {
		clearEditor,
		controller,
		disposeRuntime,
		drainInput,
		exitProcess,
		requestRender,
		setStreaming: (streaming: boolean) => {
			isStreaming = streaming;
		},
		showStatus,
		showWarning,
		start,
		stop,
		stopInteractiveMode,
	};
}

describe("InteractiveTerminalController", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("clears once and shuts down on a second interrupt within 500ms", async () => {
		const fixture = createTerminalFixture();
		vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);

		fixture.controller.handleInterruptKey();
		fixture.controller.handleInterruptKey();

		expect(fixture.clearEditor).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(fixture.disposeRuntime).toHaveBeenCalledTimes(1));
		expect(fixture.drainInput).toHaveBeenCalledWith(1_000);
		expect(fixture.stopInteractiveMode).toHaveBeenCalledTimes(1);
		expect(fixture.exitProcess).toHaveBeenCalledWith(0);
	});

	it("defers a shutdown request until streaming finishes", async () => {
		const fixture = createTerminalFixture(true);

		fixture.controller.requestShutdown();
		expect(fixture.disposeRuntime).not.toHaveBeenCalled();

		fixture.setStreaming(false);
		await fixture.controller.checkShutdownRequested();

		expect(fixture.disposeRuntime).toHaveBeenCalledTimes(1);
		expect(fixture.exitProcess).toHaveBeenCalledWith(0);
	});

	it("keeps shortcut shutdown deferred even while idle", async () => {
		const fixture = createTerminalFixture();

		fixture.controller.deferShutdown();
		expect(fixture.disposeRuntime).not.toHaveBeenCalled();

		await fixture.controller.checkShutdownRequested();

		expect(fixture.disposeRuntime).toHaveBeenCalledTimes(1);
	});

	it("registers and removes process shutdown handlers", () => {
		const fixture = createTerminalFixture();
		const registered = new Map<string, ProcessSignalHandler>();
		const processOn = vi.spyOn(process, "on").mockImplementation(((signal: string, handler: ProcessSignalHandler) => {
			registered.set(signal, handler);
			return process;
		}) as typeof process.on);
		const processOff = vi.spyOn(process, "off").mockImplementation((() => process) as typeof process.off);

		fixture.controller.registerSignalHandlers();
		expect(processOn).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

		fixture.controller.dispose();
		expect(processOff).toHaveBeenCalledWith("SIGTERM", registered.get("SIGTERM"));
	});

	it("shows a status message and skips suspend on Windows", () => {
		const fixture = createTerminalFixture();
		const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
		Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		const processOnSpy = vi.spyOn(process, "on");
		const processOnceSpy = vi.spyOn(process, "once");
		const processKillSpy = vi.spyOn(process, "kill");

		try {
			fixture.controller.suspend();
		} finally {
			if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
		}

		expect(fixture.showStatus).toHaveBeenCalledWith("Suspend to background is not supported on Windows");
		expect(fixture.stop).not.toHaveBeenCalled();
		expect(setIntervalSpy).not.toHaveBeenCalled();
		expect(processOnSpy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));
		expect(processOnceSpy).not.toHaveBeenCalledWith("SIGCONT", expect.any(Function));
		expect(processKillSpy).not.toHaveBeenCalled();
	});

	it("keeps the process alive while suspended and restores the TUI on SIGCONT", () => {
		const fixture = createTerminalFixture();
		const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
		Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
		const keepAliveHandle = setTimeout(() => undefined, 0);
		clearTimeout(keepAliveHandle);
		let sigintHandler: ProcessSignalHandler | undefined;
		let sigcontHandler: ProcessSignalHandler | undefined;
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(keepAliveHandle);
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
		const processOnSpy = vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
			if (event === "SIGINT") sigintHandler = listener;
			return process;
		}) as typeof process.on);
		vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
			if (event === "SIGCONT") sigcontHandler = listener;
			return process;
		}) as typeof process.once);
		const removeListenerSpy = vi
			.spyOn(process, "removeListener")
			.mockImplementation(((_event: string, _listener: () => void) => process) as typeof process.removeListener);
		const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

		try {
			fixture.controller.suspend();
		} finally {
			if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
		}

		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2 ** 30);
		expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
		expect(fixture.stop).toHaveBeenCalledTimes(1);
		expect(processKillSpy).toHaveBeenCalledWith(0, "SIGTSTP");

		sigcontHandler?.();
		expect(clearIntervalSpy).toHaveBeenCalledWith(keepAliveHandle);
		expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", sigintHandler);
		expect(fixture.start).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalledWith(true);
	});

	it("cleans up temporary handlers if suspension fails", () => {
		const fixture = createTerminalFixture();
		const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
		Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
		const keepAliveHandle = setTimeout(() => undefined, 0);
		clearTimeout(keepAliveHandle);
		const suspendError = new Error("suspend failed");
		vi.spyOn(globalThis, "setInterval").mockReturnValue(keepAliveHandle);
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
		vi.spyOn(process, "on").mockImplementation((() => process) as typeof process.on);
		const removeListenerSpy = vi
			.spyOn(process, "removeListener")
			.mockImplementation(((_event: string, _listener: () => void) => process) as typeof process.removeListener);
		vi.spyOn(process, "once").mockImplementation((() => process) as typeof process.once);
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw suspendError;
		});

		try {
			expect(() => fixture.controller.suspend()).toThrow(suspendError);
		} finally {
			if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
		}

		expect(fixture.stop).toHaveBeenCalledTimes(1);
		expect(clearIntervalSpy).toHaveBeenCalledWith(keepAliveHandle);
		expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
		expect(fixture.start).not.toHaveBeenCalled();
		expect(fixture.requestRender).not.toHaveBeenCalled();
	});

	it("warns when no external editor is configured", () => {
		const fixture = createTerminalFixture();
		const previousVisual = process.env.VISUAL;
		const previousEditor = process.env.EDITOR;
		delete process.env.VISUAL;
		delete process.env.EDITOR;

		try {
			fixture.controller.openExternalEditor();
		} finally {
			if (previousVisual === undefined) delete process.env.VISUAL;
			else process.env.VISUAL = previousVisual;
			if (previousEditor === undefined) delete process.env.EDITOR;
			else process.env.EDITOR = previousEditor;
		}

		expect(fixture.showWarning).toHaveBeenCalledWith(
			"No editor configured. Set $VISUAL or $EDITOR environment variable.",
		);
		expect(fixture.stop).not.toHaveBeenCalled();
	});
});
