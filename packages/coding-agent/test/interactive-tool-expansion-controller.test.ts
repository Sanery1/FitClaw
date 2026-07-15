import { type Component, Container, type TUI } from "@fitclaw/tui";
import { describe, expect, it, vi } from "vitest";
import { InteractiveToolExpansionController } from "../src/modes/interactive/interactive-tool-expansion-controller.js";

function createExpansionFixture() {
	const chatContainer = new Container();
	const setExpanded = vi.fn();
	const expandable = { invalidate: vi.fn(), render: () => [], setExpanded } as Component & {
		setExpanded: (expanded: boolean) => void;
	};
	const staticComponent = { invalidate: vi.fn(), render: () => [] } as Component;
	chatContainer.addChild(expandable);
	chatContainer.addChild(staticComponent);
	const requestRender = vi.fn();
	const setHeaderExpanded = vi.fn();
	const controller = new InteractiveToolExpansionController({
		ui: { requestRender } as unknown as TUI,
		chatContainer,
		setHeaderExpanded,
	});

	return { controller, requestRender, setExpanded, setHeaderExpanded };
}

describe("InteractiveToolExpansionController", () => {
	it("applies expansion state to the active header and chat entries", () => {
		const fixture = createExpansionFixture();

		fixture.controller.setExpanded(true);

		expect(fixture.controller.isExpanded).toBe(true);
		expect(fixture.setHeaderExpanded).toHaveBeenCalledWith(true);
		expect(fixture.setExpanded).toHaveBeenCalledWith(true);
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
	});

	it("toggles from the current expansion state", () => {
		const fixture = createExpansionFixture();
		fixture.controller.setExpanded(true);

		fixture.controller.toggle();

		expect(fixture.controller.isExpanded).toBe(false);
		expect(fixture.setHeaderExpanded).toHaveBeenLastCalledWith(false);
		expect(fixture.setExpanded).toHaveBeenLastCalledWith(false);
		expect(fixture.requestRender).toHaveBeenCalledTimes(2);
	});
});
