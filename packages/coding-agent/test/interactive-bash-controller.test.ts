import { Container, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { BashResult } from "../src/core/bash-executor.js";
import type { UserBashEventResult } from "../src/core/extensions/index.js";
import type { BashOperations } from "../src/core/tools/bash.js";
import type { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.js";
import { InteractiveBashController } from "../src/modes/interactive/interactive-bash-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

interface BashFixtureOptions {
	eventResult?: UserBashEventResult;
	executeBash?: AgentSession["executeBash"];
	isStreaming?: boolean;
}

function createBashResult(overrides: Partial<BashResult> = {}): BashResult {
	return {
		output: "output",
		exitCode: 0,
		cancelled: false,
		truncated: false,
		...overrides,
	};
}

function createBashFixture(options: BashFixtureOptions = {}) {
	const emitUserBash = vi.fn(async () => options.eventResult);
	const recordBashResult = vi.fn();
	const executeBash = vi.fn<AgentSession["executeBash"]>(
		options.executeBash ??
			(async (_command, onChunk) => {
				onChunk?.("streamed output");
				return createBashResult({ output: "streamed output" });
			}),
	);
	const session = {
		executeBash,
		extensionRunner: { emitUserBash },
		isStreaming: options.isStreaming ?? false,
		recordBashResult,
		sessionManager: { getCwd: () => "/project" },
	} as unknown as AgentSession;
	const requestRender = vi.fn();
	const intervalHandle = { dispose: vi.fn() };
	const ui = {
		addInterval: vi.fn(() => intervalHandle),
		removeInterval: vi.fn(),
		requestRender,
		terminal: { columns: 120, rows: 24 },
	} as unknown as TUI;
	const chatContainer = new Container();
	const pendingMessagesContainer = new Container();
	const addPendingBashComponent = vi.fn<(component: BashExecutionComponent) => void>();
	const showError = vi.fn();
	const controller = new InteractiveBashController({
		getSession: () => session,
		ui,
		chatContainer,
		pendingMessagesContainer,
		addPendingBashComponent,
		showError,
	});

	return {
		addPendingBashComponent,
		chatContainer,
		controller,
		emitUserBash,
		executeBash,
		pendingMessagesContainer,
		recordBashResult,
		requestRender,
		showError,
	};
}

function renderAll(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("InteractiveBashController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("renders and records extension-provided execution results", async () => {
		const result = createBashResult({ output: "extension output" });
		const fixture = createBashFixture({ eventResult: { result } });

		await fixture.controller.handle("echo extension", true);

		expect(fixture.emitUserBash).toHaveBeenCalledWith({
			type: "user_bash",
			command: "echo extension",
			excludeFromContext: true,
			cwd: "/project",
		});
		expect(fixture.executeBash).not.toHaveBeenCalled();
		expect(fixture.recordBashResult).toHaveBeenCalledWith("echo extension", result, {
			excludeFromContext: true,
		});
		expect(renderAll(fixture.chatContainer)).toContain("extension output");
	});

	it("places executions in the pending area while the agent is streaming", async () => {
		const fixture = createBashFixture({ isStreaming: true });

		await fixture.controller.handle("echo pending");

		expect(fixture.chatContainer.children).toHaveLength(0);
		expect(fixture.pendingMessagesContainer.children).toHaveLength(1);
		expect(fixture.addPendingBashComponent).toHaveBeenCalledWith(fixture.pendingMessagesContainer.children[0]);
		expect(renderAll(fixture.pendingMessagesContainer)).toContain("streamed output");
	});

	it("forwards extension-provided bash operations", async () => {
		const operations = {} as BashOperations;
		const fixture = createBashFixture({ eventResult: { operations } });

		await fixture.controller.handle("remote command");

		expect(fixture.executeBash).toHaveBeenCalledWith("remote command", expect.any(Function), {
			excludeFromContext: false,
			operations,
		});
	});

	it("marks failed executions complete and reports the error", async () => {
		const fixture = createBashFixture({
			executeBash: async () => {
				throw new Error("shell unavailable");
			},
		});

		await fixture.controller.handle("broken command");

		expect(fixture.showError).toHaveBeenCalledWith("Bash command failed: shell unavailable");
		expect(renderAll(fixture.chatContainer)).toContain("broken command");
		expect(fixture.requestRender).toHaveBeenCalled();
	});
});
