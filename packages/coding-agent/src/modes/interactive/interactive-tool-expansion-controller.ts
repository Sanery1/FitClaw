import type { Container, TUI } from "@fitclaw/tui";
import { isExpandable } from "./components/expandable-text.js";

export interface InteractiveToolExpansionControllerOptions {
	ui: TUI;
	chatContainer: Container;
	setHeaderExpanded: (expanded: boolean) => void;
}

export class InteractiveToolExpansionController {
	private currentExpanded = false;

	constructor(private readonly options: InteractiveToolExpansionControllerOptions) {}

	get isExpanded(): boolean {
		return this.currentExpanded;
	}

	toggle(): void {
		this.setExpanded(!this.currentExpanded);
	}

	setExpanded(expanded: boolean): void {
		this.currentExpanded = expanded;
		this.options.setHeaderExpanded(expanded);
		for (const child of this.options.chatContainer.children) {
			if (isExpandable(child)) child.setExpanded(expanded);
		}
		this.options.ui.requestRender();
	}
}
