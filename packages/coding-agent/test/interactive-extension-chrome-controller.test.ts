import type { Component, TUI } from "@fitclaw/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FooterDataProvider } from "../src/core/footer-data-provider.js";
import type { FooterComponent } from "../src/modes/interactive/components/footer.js";
import { InteractiveExtensionChromeController } from "../src/modes/interactive/interactive-extension-chrome-controller.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

interface DisposableTestComponent extends Component {
	dispose: ReturnType<typeof vi.fn>;
}

function createComponent(): DisposableTestComponent {
	return {
		dispose: vi.fn(),
		invalidate: vi.fn(),
		render: () => [],
	};
}

function createChromeFixture() {
	const footerDataProvider = new FooterDataProvider("/project");
	const invalidateFooter = vi.fn();
	const footer = {
		invalidate: invalidateFooter,
		render: () => [],
	} as unknown as FooterComponent;
	const rootChildren: Component[] = [footer];
	const addChild = vi.fn((component: Component) => rootChildren.push(component));
	const removeChild = vi.fn((component: Component) => {
		const index = rootChildren.indexOf(component);
		if (index !== -1) rootChildren.splice(index, 1);
	});
	const requestRender = vi.fn();
	const ui = { addChild, removeChild, requestRender } as unknown as TUI;
	let isExpanded = true;
	const controller = new InteractiveExtensionChromeController({
		ui,
		footer,
		footerDataProvider,
		getToolOutputExpanded: () => isExpanded,
	});

	return {
		controller,
		footer,
		footerDataProvider,
		invalidateFooter,
		requestRender,
		rootChildren,
		setExpanded: (expanded: boolean) => {
			isExpanded = expanded;
		},
	};
}

describe("InteractiveExtensionChromeController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("renders, moves, truncates, and disposes widgets", () => {
		const fixture = createChromeFixture();
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);

		fixture.controller.setWidget("details", lines);
		const rendered = fixture.controller.widgetContainerAbove.children[1]?.render(120).join("\n") ?? "";
		expect(rendered).toContain("line 10");
		expect(rendered).not.toContain("line 11");
		expect(rendered).toContain("widget truncated");

		const customWidget = createComponent();
		fixture.controller.setWidget("details", () => customWidget, { placement: "belowEditor" });
		expect(fixture.controller.widgetContainerAbove.children).toHaveLength(1);
		expect(fixture.controller.widgetContainerBelow.children).toEqual([customWidget]);

		fixture.controller.clearWidgets();
		expect(customWidget.dispose).toHaveBeenCalledTimes(1);
		expect(fixture.controller.widgetContainerAbove.children).toHaveLength(1);
		expect(fixture.controller.widgetContainerBelow.children).toHaveLength(0);
	});

	it("replaces and restores the built-in footer", () => {
		const fixture = createChromeFixture();
		const customFooter = createComponent();

		fixture.controller.setFooter(() => customFooter);
		expect(fixture.rootChildren).toEqual([customFooter]);

		fixture.controller.setFooter(undefined);
		expect(customFooter.dispose).toHaveBeenCalledTimes(1);
		expect(fixture.rootChildren).toEqual([fixture.footer]);
	});

	it("keeps expansion state while replacing and restoring the header", () => {
		const fixture = createChromeFixture();
		const setBuiltInExpanded = vi.fn();
		const builtInHeader = { ...createComponent(), setExpanded: setBuiltInExpanded };
		const setCustomExpanded = vi.fn();
		const customHeader = { ...createComponent(), setExpanded: setCustomExpanded };
		fixture.controller.setBuiltInHeader(builtInHeader);
		fixture.controller.headerContainer.addChild(builtInHeader);

		fixture.controller.setHeader(() => customHeader);
		expect(fixture.controller.headerContainer.children).toEqual([customHeader]);
		expect(setCustomExpanded).toHaveBeenCalledWith(true);

		fixture.setExpanded(false);
		fixture.controller.setHeaderExpanded(false);
		expect(setCustomExpanded).toHaveBeenLastCalledWith(false);

		fixture.controller.setHeader(undefined);
		expect(customHeader.dispose).toHaveBeenCalledTimes(1);
		expect(fixture.controller.headerContainer.children).toEqual([builtInHeader]);
		expect(setBuiltInExpanded).toHaveBeenLastCalledWith(false);
	});

	it("clears extension statuses and invalidates the footer on reset", () => {
		const fixture = createChromeFixture();

		fixture.controller.setStatus("sync", "ready");
		expect(fixture.footerDataProvider.getExtensionStatuses().get("sync")).toBe("ready");

		fixture.controller.reset();
		expect(fixture.footerDataProvider.getExtensionStatuses().size).toBe(0);
		expect(fixture.invalidateFooter).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalled();
	});
});
