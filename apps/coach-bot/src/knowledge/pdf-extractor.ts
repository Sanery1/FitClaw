import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedPdfPage, PdfExtractor } from "./types.js";

function extractText(items: readonly unknown[]): string {
	let text = "";
	for (const item of items) {
		if (typeof item !== "object" || item === null || !("str" in item) || typeof item.str !== "string") continue;
		text += item.str;
		text += "hasEOL" in item && item.hasEOL === true ? "\n" : " ";
	}
	return text.trim();
}

export class PdfJsExtractor implements PdfExtractor {
	async extract(path: string): Promise<readonly ExtractedPdfPage[]> {
		const bytes = await readFile(path);
		const loadingTask = getDocument({
			data: new Uint8Array(bytes),
			isEvalSupported: false,
			useSystemFonts: true,
		});
		const document = await loadingTask.promise;
		try {
			const pages: ExtractedPdfPage[] = [];
			for (let pdfPage = 1; pdfPage <= document.numPages; pdfPage++) {
				const page = await document.getPage(pdfPage);
				const content = await page.getTextContent();
				pages.push({ pdfPage, text: extractText(content.items) });
				page.cleanup();
			}
			return pages;
		} finally {
			await document.destroy();
		}
	}
}
