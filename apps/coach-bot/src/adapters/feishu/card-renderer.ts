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
	[key: string]: unknown;
}

/** Check if a line is mostly box-drawing / ASCII art characters */
function isBoxArtLine(line: string): boolean {
	if (!line.trim()) return false;
	const artChars = /[═║╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼─│█░▒▓━┃┏┓┗┛┣┫┳┻╋▪▫■□●○◆◇★☆▸▹►▻▷▶◀◄◁▾▿△▵▲▴↑↓←→↔]/;
	const artCount = (line.match(new RegExp(artChars.source, "g")) || []).length;
	// High density of art chars
	if (artCount > line.length * 0.3) return true;
	// Starts and ends with box-drawing chars (border line like "║  Header  ║")
	const trimmed = line.trim();
	if (trimmed.length > 2 && artChars.test(trimmed[0]) && artChars.test(trimmed[trimmed.length - 1])) {
		return true;
	}
	return false;
}

/** Extract meaningful text from an ASCII art line, stripping decorative characters */
function extractTextFromArt(line: string): string {
	// Strip box-drawing, block elements, and common art chars
	let s = line.replace(/[═║╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼─│█░▒▓━┃┏┓┗┛┣┫┳┻╋╭╮╰╯]/g, "");
	// Strip multiple spaces
	s = s.replace(/\s{2,}/g, " ").trim();
	return s;
}

/** Check if a code block is mostly ASCII art (needs data extraction) */
function isMostlyArt(lines: string[]): boolean {
	if (lines.length === 0) return false;
	const artLineCount = lines.filter((l) => isBoxArtLine(l)).length;
	return artLineCount > lines.length * 0.5;
}

/** Extract meaningful data lines from ASCII art code block */
function extractDataFromArtBlock(lines: string[]): string[] {
	const nonArtLines = lines.map((line) => line.trim()).filter((line) => line && !isBoxArtLine(line));
	if (nonArtLines.length > 0) {
		return nonArtLines;
	}

	const results: string[] = [];
	for (const line of lines) {
		const text = extractTextFromArt(line);
		// Keep lines with meaningful content (letters, numbers, Chinese chars)
		if (text.length >= 3 && /[a-zA-Z0-9一-鿿]/.test(text)) {
			results.push(text);
		}
	}
	return results;
}

/** Clean a line for lark_md display: strip markdown decorations that don't render well */
function cleanForLarkMd(line: string): string {
	let s = line;
	// Convert markdown bold to Feishu bold (both use ** in lark_md, but strip if it looks like decoration)
	// Feishu lark_md actually supports **bold**, so keep it
	// Remove leading markdown heading markers (## etc) — the card header handles that
	s = s.replace(/^#{1,6}\s+/, "");
	// Remove leading bullet markers that are redundant in card divs
	// Keep "-" bullets as-is since lark_md renders them
	return s;
}

export function renderFeishuCard(content: string): FeishuCard {
	const lines = content.split("\n");
	const elements: FeishuCardElement[] = [];
	let headerText = "";
	let inCodeBlock = false;
	let codeBlockLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Handle code block boundaries
		if (trimmed.startsWith("```")) {
			if (inCodeBlock) {
				// End of code block — process collected lines
				if (isMostlyArt(codeBlockLines)) {
					// Extract meaningful data from ASCII art
					const dataLines = extractDataFromArtBlock(codeBlockLines);
					if (dataLines.length > 0) {
						elements.push({
							tag: "div",
							text: { tag: "lark_md", content: dataLines.join("\n").slice(0, 2000) },
						});
					}
				} else {
					// Normal code block — filter out any box-art lines
					const cleanedLines = codeBlockLines.filter((l) => !isBoxArtLine(l));
					if (cleanedLines.length > 0) {
						elements.push({
							tag: "div",
							text: { tag: "lark_md", content: cleanedLines.join("\n").slice(0, 2000) },
						});
					}
				}
				codeBlockLines = [];
			} else {
				// Start of code block — flush any pending non-code content
			}
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (inCodeBlock) {
			codeBlockLines.push(line);
			continue;
		}

		if (!trimmed) {
			if (elements.length > 0 || headerText) {
				elements.push({ tag: "hr" });
			}
			continue;
		}

		if (trimmed === "---" || trimmed === "***") {
			elements.push({ tag: "hr" });
			continue;
		}

		if (!headerText && !trimmed.startsWith("-") && !trimmed.startsWith("```")) {
			headerText = cleanForLarkMd(trimmed).slice(0, 64);
			continue;
		}

		const cleaned = cleanForLarkMd(trimmed);
		if (cleaned) {
			elements.push({
				tag: "div",
				text: { tag: "lark_md", content: cleaned.slice(0, 2000) },
			});
		}
	}

	// Flush any remaining code block lines
	if (inCodeBlock && codeBlockLines.length > 0) {
		if (isMostlyArt(codeBlockLines)) {
			const dataLines = extractDataFromArtBlock(codeBlockLines);
			if (dataLines.length > 0) {
				elements.push({
					tag: "div",
					text: { tag: "lark_md", content: dataLines.join("\n").slice(0, 2000) },
				});
			}
		} else {
			const cleanedLines = codeBlockLines.filter((l) => !isBoxArtLine(l));
			if (cleanedLines.length > 0) {
				elements.push({
					tag: "div",
					text: { tag: "lark_md", content: cleanedLines.join("\n").slice(0, 2000) },
				});
			}
		}
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
