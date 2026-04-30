/**
 * Feishu rich text card renderer.
 *
 * Converts text content into Feishu Message Card JSON format.
 * Reference: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-components
 */

interface FeishuCardHeader {
	title: { tag: "plain_text"; content: string };
	template?: string;
}

interface FeishuCardElement {
	tag: "div" | "hr";
	text?: { tag: "lark_md"; content: string };
}

interface FeishuCard {
	config?: { wide_screen_mode: boolean };
	header?: FeishuCardHeader;
	elements?: FeishuCardElement[];
}

export function renderFeishuCard(content: string): FeishuCard {
	const lines = content.split("\n");
	const elements: FeishuCardElement[] = [];
	let headerText = "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (elements.length > 0) {
				elements.push({ tag: "hr" });
			}
			continue;
		}

		if (!headerText && !trimmed.startsWith("-") && !trimmed.startsWith("```")) {
			headerText = trimmed.slice(0, 64);
			continue;
		}

		elements.push({
			tag: "div",
			text: { tag: "lark_md", content: trimmed.slice(0, 2000) },
		});
	}

	const card: FeishuCard = {
		config: { wide_screen_mode: true },
		elements:
			elements.length > 0 ? elements : [{ tag: "div", text: { tag: "lark_md", content: content.slice(0, 2000) } }],
	};

	if (headerText) {
		card.header = {
			title: { tag: "plain_text", content: headerText },
		};
	}

	return card;
}
