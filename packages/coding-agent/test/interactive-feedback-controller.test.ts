import { Container, Text, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { DaxnutsComponent } from "../src/modes/interactive/components/daxnuts.js";
import { InteractiveFeedbackController } from "../src/modes/interactive/interactive-feedback-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderAll(container: Container, width = 160): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

function renderLast(container: Container, width = 160): string {
	return container.children.at(-1)?.render(width).join("\n") ?? "";
}

function createFeedbackFixture() {
	const chatContainer = new Container();
	const requestRender = vi.fn();
	const ui = { requestRender } as unknown as TUI;
	const session = { messages: [] } as unknown as AgentSession;
	const controller = new InteractiveFeedbackController({
		getSession: () => session,
		ui,
		chatContainer,
	});
	return { chatContainer, controller, requestRender };
}

describe("InteractiveFeedbackController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("coalesces immediately sequential status messages", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.showStatus("STATUS_ONE");
		fixture.controller.showStatus("STATUS_TWO");

		expect(fixture.chatContainer.children).toHaveLength(2);
		expect(renderLast(fixture.chatContainer)).toContain("STATUS_TWO");
		expect(renderLast(fixture.chatContainer)).not.toContain("STATUS_ONE");
	});

	it("appends a status after another chat component", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.showStatus("STATUS_ONE");
		fixture.chatContainer.addChild(new Text("OTHER", 0, 0));
		fixture.controller.showStatus("STATUS_TWO");

		expect(fixture.chatContainer.children).toHaveLength(5);
		expect(renderLast(fixture.chatContainer)).toContain("STATUS_TWO");
	});

	it("renders errors, warnings, and extension notifications", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.showError("broken");
		fixture.controller.showWarning("careful");
		fixture.controller.showExtensionNotification("extension info");

		const output = renderAll(fixture.chatContainer);
		expect(output).toContain("Error: broken");
		expect(output).toContain("Warning: careful");
		expect(output).toContain("extension info");
	});

	it("renders version and package update panels", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.showVersionUpdate("9.9.9");
		fixture.controller.showPackageUpdates(["package-a", "package-b"]);

		const output = renderAll(fixture.chatContainer);
		expect(output).toContain("Update Available");
		expect(output).toContain("9.9.9");
		expect(output).toContain("Package Updates Available");
		expect(output).toContain("package-a");
	});

	it("renders an extension error without duplicating the first stack line", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.showExtensionError(
			"/tmp/extension.ts",
			"failed",
			"Error: failed\n    at first.ts:1\n    at second.ts:2",
		);

		const output = renderAll(fixture.chatContainer);
		expect(output).toContain('Extension "/tmp/extension.ts" error: failed');
		expect(output).toContain("at first.ts:1");
		expect(output).not.toContain("Error: failed");
	});

	it("shows the model easter egg only for matching models", () => {
		const fixture = createFeedbackFixture();

		fixture.controller.checkModelEasterEgg({ provider: "openai", id: "kimi-k2.5" });
		expect(fixture.chatContainer.children).toHaveLength(0);

		fixture.controller.checkModelEasterEgg({ provider: "opencode", id: "KIMI-K2.5" });
		expect(fixture.chatContainer.children[1]).toBeInstanceOf(DaxnutsComponent);
	});
});
