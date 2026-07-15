import { Container, setKeybindings, Text, type TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.js";
import { InteractiveWorkingController } from "../src/modes/interactive/interactive-working-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createWorkingFixture() {
	const statusContainer = new Container();
	const requestRender = vi.fn();
	const ui = { requestRender } as unknown as TUI;
	let isStreaming = false;
	const controller = new InteractiveWorkingController({
		ui,
		statusContainer,
		isStreaming: () => isStreaming,
	});

	return {
		controller,
		requestRender,
		setStreaming: (streaming: boolean) => {
			isStreaming = streaming;
		},
		statusContainer,
	};
}

function renderStatus(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("InteractiveWorkingController", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("starts and stops agent activity with the configured message and indicator", () => {
		const fixture = createWorkingFixture();
		fixture.controller.setMessage("Indexing workspace");
		fixture.controller.setIndicator({ frames: ["#"] });

		fixture.controller.startAgentActivity();
		expect(fixture.statusContainer.children).toHaveLength(1);
		expect(renderStatus(fixture.statusContainer)).toContain("#");
		expect(renderStatus(fixture.statusContainer)).toContain("Indexing workspace");

		fixture.controller.stopAgentActivity();
		expect(fixture.statusContainer.children).toHaveLength(0);
	});

	it("restores activity while streaming when visibility is re-enabled", () => {
		const fixture = createWorkingFixture();
		fixture.setStreaming(true);

		fixture.controller.setVisible(false);
		fixture.controller.startAgentActivity();
		expect(fixture.statusContainer.children).toHaveLength(0);

		fixture.controller.setVisible(true);
		expect(fixture.statusContainer.children).toHaveLength(1);
		expect(renderStatus(fixture.statusContainer)).toContain("Working...");

		fixture.controller.setVisible(false);
		expect(fixture.statusContainer.children).toHaveLength(0);
	});

	it("resets extension overrides on an active loader", () => {
		const fixture = createWorkingFixture();
		fixture.controller.setMessage("Custom work");
		fixture.controller.setIndicator({ frames: ["!"] });
		fixture.controller.startAgentActivity();

		fixture.controller.reset();

		const rendered = renderStatus(fixture.statusContainer);
		expect(rendered).toContain("Working...");
		expect(rendered).toContain("to interrupt");
		expect(rendered).not.toContain("Custom work");
		expect(fixture.requestRender).toHaveBeenCalled();
		fixture.controller.dispose();
	});

	it("clears stale status content even when no loader is active", () => {
		const fixture = createWorkingFixture();
		fixture.statusContainer.addChild(new Text("stale", 0, 0));

		fixture.controller.stop();

		expect(fixture.statusContainer.children).toHaveLength(0);
	});
});
