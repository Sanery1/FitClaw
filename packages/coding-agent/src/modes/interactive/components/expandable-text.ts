import { Text } from "@fitclaw/tui";

export interface Expandable {
	setExpanded(expanded: boolean): void;
}

export function isExpandable(value: unknown): value is Expandable {
	return (
		typeof value === "object" && value !== null && "setExpanded" in value && typeof value.setExpanded === "function"
	);
}

export class ExpandableText extends Text implements Expandable {
	constructor(
		private readonly getCollapsedText: () => string,
		private readonly getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}
