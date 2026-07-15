import { fauxAssistantMessage } from "@fitclaw/ai";
import { Container, type EditorComponent, Text, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { SessionContext } from "../src/core/session-manager.js";
import type { CustomEditor } from "../src/modes/interactive/components/custom-editor.js";
import { InteractiveSessionViewController } from "../src/modes/interactive/interactive-session-view-controller.js";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.js";

function renderAll(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("InteractiveSessionViewController compaction events", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("rebuilds chat and appends a synthetic compaction summary at the bottom", async () => {
		const chatContainer = new Container();
		chatContainer.addChild(new Text("stale chat"));
		const flushCompactionQueue = vi.fn(async () => undefined);
		const session = {
			settingsManager: { getShowTerminalProgress: () => false },
			sessionManager: {
				buildSessionContext: () => ({ messages: [] }) as unknown as SessionContext,
				getEntries: () => [],
			},
		} as unknown as AgentSession;
		const controller = new InteractiveSessionViewController({
			getSession: () => session,
			ui: {
				requestRender: vi.fn(),
				terminal: { setProgress: vi.fn() },
			} as unknown as TUI,
			chatContainer,
			statusContainer: new Container(),
			defaultEditor: { onEscape: undefined } as unknown as CustomEditor,
			getEditor: () => new Container() as unknown as EditorComponent,
			isInitialized: () => true,
			initialize: async () => undefined,
			invalidateFooter: vi.fn(),
			updateEditorBorderColor: vi.fn(),
			startAgentActivity: vi.fn(),
			stopAgentActivity: vi.fn(),
			updatePendingMessagesDisplay: vi.fn(),
			updateTerminalTitle: vi.fn(),
			checkShutdownRequested: async () => undefined,
			showError: vi.fn(),
			showStatus: vi.fn(),
			flushCompactionQueue,
			getHideThinkingBlock: () => false,
			getHiddenThinkingLabel: () => "Thinking...",
			getToolOutputExpanded: () => true,
			getMarkdownTheme,
		});

		await controller.handle({
			type: "compaction_end",
			reason: "manual",
			result: {
				tokensBefore: 123,
				summary: "summary",
				firstKeptEntryId: "entry-1",
			},
			aborted: false,
			willRetry: false,
		});

		const output = renderAll(chatContainer);
		expect(output).not.toContain("stale chat");
		expect(output).toContain("Compacted from 123 tokens");
		expect(output).toContain("summary");
		expect(flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false });
	});

	test("renders streaming assistant updates into the chat", async () => {
		const chatContainer = new Container();
		const session = {
			settingsManager: {
				getShowTerminalProgress: () => false,
				getShowImages: () => false,
				getImageWidthCells: () => 80,
			},
			sessionManager: { getCwd: () => "/tmp/project" },
			getToolDefinition: () => undefined,
		} as unknown as AgentSession;
		const controller = new InteractiveSessionViewController({
			getSession: () => session,
			ui: {
				requestRender: vi.fn(),
				terminal: { setProgress: vi.fn() },
			} as unknown as TUI,
			chatContainer,
			statusContainer: new Container(),
			defaultEditor: { onEscape: undefined } as unknown as CustomEditor,
			getEditor: () => new Container() as unknown as EditorComponent,
			isInitialized: () => true,
			initialize: async () => undefined,
			invalidateFooter: vi.fn(),
			updateEditorBorderColor: vi.fn(),
			startAgentActivity: vi.fn(),
			stopAgentActivity: vi.fn(),
			updatePendingMessagesDisplay: vi.fn(),
			updateTerminalTitle: vi.fn(),
			checkShutdownRequested: async () => undefined,
			showError: vi.fn(),
			showStatus: vi.fn(),
			flushCompactionQueue: async () => undefined,
			getHideThinkingBlock: () => false,
			getHiddenThinkingLabel: () => "Thinking...",
			getToolOutputExpanded: () => false,
			getMarkdownTheme,
		});
		const initialMessage = fauxAssistantMessage("");
		const updatedMessage = fauxAssistantMessage("streamed response");

		await controller.handle({ type: "message_start", message: initialMessage });
		await controller.handle({
			type: "message_update",
			message: updatedMessage,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "streamed response",
				partial: updatedMessage,
			},
		});
		await controller.handle({ type: "message_end", message: updatedMessage });

		expect(renderAll(chatContainer)).toContain("streamed response");
	});
});
