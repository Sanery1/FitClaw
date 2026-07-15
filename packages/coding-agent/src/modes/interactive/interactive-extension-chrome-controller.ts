import { type Component, Container, Spacer, Text, type TUI } from "@fitclaw/tui";
import type { ExtensionWidgetOptions } from "../../core/extensions/index.js";
import type { FooterDataProvider, ReadonlyFooterDataProvider } from "../../core/footer-data-provider.js";
import { isExpandable } from "./components/expandable-text.js";
import type { FooterComponent } from "./components/footer.js";
import { type Theme, theme } from "./theme/theme.js";

type DisposableComponent = Component & { dispose?(): void };
type WidgetFactory = (tui: TUI, theme: Theme) => DisposableComponent;
type FooterFactory = (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => DisposableComponent;
type HeaderFactory = (tui: TUI, theme: Theme) => DisposableComponent;

export interface InteractiveExtensionChromeControllerOptions {
	ui: TUI;
	footer: FooterComponent;
	footerDataProvider: FooterDataProvider;
	getToolOutputExpanded: () => boolean;
}

export class InteractiveExtensionChromeController {
	private static readonly MAX_WIDGET_LINES = 10;

	readonly headerContainer = new Container();
	readonly widgetContainerAbove = new Container();
	readonly widgetContainerBelow = new Container();

	private readonly widgetsAbove = new Map<string, DisposableComponent>();
	private readonly widgetsBelow = new Map<string, DisposableComponent>();
	private builtInHeader: Component | undefined;
	private customHeader: DisposableComponent | undefined;
	private customFooter: DisposableComponent | undefined;

	constructor(private readonly options: InteractiveExtensionChromeControllerOptions) {}

	setBuiltInHeader(header: Component): void {
		this.builtInHeader = header;
	}

	setStatus(key: string, text: string | undefined): void {
		this.options.footerDataProvider.setExtensionStatus(key, text);
		this.options.ui.requestRender();
	}

	setWidget(key: string, content: string[] | WidgetFactory | undefined, options?: ExtensionWidgetOptions): void {
		this.removeWidget(this.widgetsAbove, key);
		this.removeWidget(this.widgetsBelow, key);

		if (content === undefined) {
			this.renderWidgets();
			return;
		}

		let component: DisposableComponent;
		if (Array.isArray(content)) {
			const container = new Container();
			for (const line of content.slice(0, InteractiveExtensionChromeController.MAX_WIDGET_LINES)) {
				container.addChild(new Text(line, 1, 0));
			}
			if (content.length > InteractiveExtensionChromeController.MAX_WIDGET_LINES) {
				container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
			}
			component = container;
		} else {
			component = content(this.options.ui, theme);
		}

		const target = options?.placement === "belowEditor" ? this.widgetsBelow : this.widgetsAbove;
		target.set(key, component);
		this.renderWidgets();
	}

	clearWidgets(): void {
		for (const widget of this.widgetsAbove.values()) widget.dispose?.();
		for (const widget of this.widgetsBelow.values()) widget.dispose?.();
		this.widgetsAbove.clear();
		this.widgetsBelow.clear();
		this.renderWidgets();
	}

	renderWidgets(): void {
		this.renderWidgetContainer(this.widgetContainerAbove, this.widgetsAbove, true, true);
		this.renderWidgetContainer(this.widgetContainerBelow, this.widgetsBelow, false, false);
		this.options.ui.requestRender();
	}

	setFooter(factory: FooterFactory | undefined): void {
		this.customFooter?.dispose?.();
		if (this.customFooter) {
			this.options.ui.removeChild(this.customFooter);
		} else {
			this.options.ui.removeChild(this.options.footer);
		}

		if (factory) {
			this.customFooter = factory(this.options.ui, theme, this.options.footerDataProvider);
			this.options.ui.addChild(this.customFooter);
		} else {
			this.customFooter = undefined;
			this.options.ui.addChild(this.options.footer);
		}
		this.options.ui.requestRender();
	}

	setHeader(factory: HeaderFactory | undefined): void {
		if (!this.builtInHeader) return;

		this.customHeader?.dispose?.();
		const currentHeader = this.customHeader ?? this.builtInHeader;
		const index = this.headerContainer.children.indexOf(currentHeader);

		if (factory) {
			this.customHeader = factory(this.options.ui, theme);
			this.setHeaderExpanded(this.options.getToolOutputExpanded());
			if (index !== -1) {
				this.headerContainer.children[index] = this.customHeader;
			} else {
				this.headerContainer.children.unshift(this.customHeader);
			}
		} else {
			this.customHeader = undefined;
			this.setHeaderExpanded(this.options.getToolOutputExpanded());
			if (index !== -1) {
				this.headerContainer.children[index] = this.builtInHeader;
			}
		}
		this.options.ui.requestRender();
	}

	setHeaderExpanded(expanded: boolean): void {
		const activeHeader = this.customHeader ?? this.builtInHeader;
		if (isExpandable(activeHeader)) {
			activeHeader.setExpanded(expanded);
		}
	}

	reset(): void {
		this.setFooter(undefined);
		this.setHeader(undefined);
		this.clearWidgets();
		this.options.footerDataProvider.clearExtensionStatuses();
		this.options.footer.invalidate();
	}

	private removeWidget(widgets: Map<string, DisposableComponent>, key: string): void {
		widgets.get(key)?.dispose?.();
		widgets.delete(key);
	}

	private renderWidgetContainer(
		container: Container,
		widgets: Map<string, DisposableComponent>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		container.clear();
		if (widgets.size === 0) {
			if (spacerWhenEmpty) container.addChild(new Spacer(1));
			return;
		}
		if (leadingSpacer) container.addChild(new Spacer(1));
		for (const component of widgets.values()) container.addChild(component);
	}
}
