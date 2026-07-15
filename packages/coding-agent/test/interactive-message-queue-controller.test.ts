import { Container, type EditorComponent, Text, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.js";
import { InteractiveMessageQueueController } from "../src/modes/interactive/interactive-message-queue-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

interface QueueFixtureOptions {
	currentText?: string;
	extensionCommands?: string[];
	followUpMessages?: string[];
	isCompacting?: boolean;
	isStreaming?: boolean;
	steeringMessages?: string[];
}

function createQueueFixture(options: QueueFixtureOptions = {}) {
	const prompt = vi.fn(async () => undefined);
	const followUp = vi.fn(async () => undefined);
	const steer = vi.fn(async () => undefined);
	const abort = vi.fn();
	let steeringMessages = [...(options.steeringMessages ?? [])];
	let followUpMessages = [...(options.followUpMessages ?? [])];
	const clearQueue = vi.fn(() => {
		const queuedMessages = { steering: steeringMessages, followUp: followUpMessages };
		steeringMessages = [];
		followUpMessages = [];
		return queuedMessages;
	});
	const extensionCommands = new Set(options.extensionCommands ?? []);
	const session = {
		agent: { abort },
		clearQueue,
		extensionRunner: {
			getCommand: (name: string) => (extensionCommands.has(name) ? { name } : undefined),
		},
		followUp,
		getFollowUpMessages: () => followUpMessages,
		getSteeringMessages: () => steeringMessages,
		isCompacting: options.isCompacting ?? false,
		isStreaming: options.isStreaming ?? false,
		prompt,
		steer,
	} as unknown as AgentSession;
	const setText = vi.fn();
	const addToHistory = vi.fn();
	const onSubmit = vi.fn();
	const editor = {
		addToHistory,
		getText: () => options.currentText ?? "",
		onSubmit,
		setText,
	} as unknown as EditorComponent;
	const chatContainer = new Container();
	const pendingMessagesContainer = new Container();
	const requestRender = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const controller = new InteractiveMessageQueueController({
		getSession: () => session,
		getEditor: () => editor,
		ui: { requestRender } as unknown as TUI,
		chatContainer,
		pendingMessagesContainer,
		getDequeueKeyDisplay: () => "Ctrl+E",
		showStatus,
		showError,
	});

	return {
		abort,
		addToHistory,
		chatContainer,
		clearQueue,
		controller,
		followUp,
		onSubmit,
		pendingMessagesContainer,
		prompt,
		requestRender,
		setText,
		showError,
		showStatus,
		steer,
	};
}

function renderAll(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("InteractiveMessageQueueController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("restores session and compaction queues to the editor in delivery order", () => {
		const fixture = createQueueFixture({
			currentText: "draft",
			steeringMessages: ["session steer"],
			followUpMessages: ["session follow-up"],
		});
		fixture.controller.queueCompactionMessage("compaction steer", "steer");
		fixture.controller.queueCompactionMessage("compaction follow-up", "followUp");

		const restored = fixture.controller.restoreQueuedMessagesToEditor({ abort: true });

		expect(restored).toBe(4);
		expect(fixture.setText).toHaveBeenLastCalledWith(
			"session steer\n\ncompaction steer\n\nsession follow-up\n\ncompaction follow-up\n\ndraft",
		);
		expect(fixture.clearQueue).toHaveBeenCalledOnce();
		expect(fixture.abort).toHaveBeenCalledOnce();
		expect(fixture.pendingMessagesContainer.children).toHaveLength(0);
	});

	it("routes queued messages to the retry turn without starting a new prompt", async () => {
		const fixture = createQueueFixture({ extensionCommands: ["extension"] });
		fixture.controller.queueCompactionMessage("/extension run", "steer");
		fixture.controller.queueCompactionMessage("follow later", "followUp");
		fixture.controller.queueCompactionMessage("steer now", "steer");

		await fixture.controller.flushCompactionQueue({ willRetry: true });

		expect(fixture.prompt).toHaveBeenCalledWith("/extension run");
		expect(fixture.followUp).toHaveBeenCalledWith("follow later");
		expect(fixture.steer).toHaveBeenCalledWith("steer now");
		expect(fixture.pendingMessagesContainer.children).toHaveLength(0);
	});

	it("starts the first prompt and queues remaining messages by mode", async () => {
		const fixture = createQueueFixture({ extensionCommands: ["extension"] });
		fixture.controller.queueCompactionMessage("first prompt", "steer");
		fixture.controller.queueCompactionMessage("follow later", "followUp");
		fixture.controller.queueCompactionMessage("/extension run", "steer");
		fixture.controller.queueCompactionMessage("steer later", "steer");

		await fixture.controller.flushCompactionQueue();

		expect(fixture.prompt).toHaveBeenNthCalledWith(1, "first prompt");
		expect(fixture.prompt).toHaveBeenNthCalledWith(2, "/extension run");
		expect(fixture.followUp).toHaveBeenCalledWith("follow later");
		expect(fixture.steer).toHaveBeenCalledWith("steer later");
	});

	it("restores the compaction queue when the first prompt fails", async () => {
		const fixture = createQueueFixture();
		fixture.prompt.mockRejectedValueOnce(new Error("send failed"));
		fixture.controller.queueCompactionMessage("retry me", "steer");

		await fixture.controller.flushCompactionQueue();

		await vi.waitFor(() => {
			expect(fixture.showError).toHaveBeenCalledWith("Failed to send queued message: send failed");
		});
		expect(fixture.clearQueue).toHaveBeenCalledOnce();
		expect(renderAll(fixture.pendingMessagesContainer)).toContain("Steering: retry me");
	});

	it("queues follow-up input during compaction", async () => {
		const fixture = createQueueFixture({ currentText: "later", isCompacting: true });

		await fixture.controller.handleFollowUp();

		expect(fixture.addToHistory).toHaveBeenCalledWith("later");
		expect(fixture.setText).toHaveBeenCalledWith("");
		expect(fixture.prompt).not.toHaveBeenCalled();
		expect(fixture.showStatus).toHaveBeenCalledWith("Queued message for after compaction");
		expect(renderAll(fixture.pendingMessagesContainer)).toContain("Follow-up: later");
	});

	it("moves completed deferred bash components into chat before submission", () => {
		const fixture = createQueueFixture();
		const component = new Text("deferred bash") as unknown as BashExecutionComponent;
		fixture.pendingMessagesContainer.addChild(component);
		fixture.controller.addPendingBashComponent(component);

		fixture.controller.flushPendingBashComponents();

		expect(fixture.pendingMessagesContainer.children).not.toContain(component);
		expect(fixture.chatContainer.children).toContain(component);
	});
});
