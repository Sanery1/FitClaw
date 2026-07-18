const PUNCTUATION_PATTERN = /[\p{P}\p{S}]+/gu;
const WHITESPACE_PATTERN = /\s+/g;

export function normalizeSearchQuery(query: string): string {
	return query.normalize("NFKC").replace(PUNCTUATION_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
}

export function normalizePageText(rawText: string, headerLines: readonly string[]): string {
	const ignored = new Set(headerLines.map((line) => line.normalize("NFKC").replace(WHITESPACE_PATTERN, " ").trim()));
	return rawText
		.normalize("NFKC")
		.split(/\r?\n/)
		.map((line) => line.replace(WHITESPACE_PATTERN, " ").trim())
		.filter((line) => line && !ignored.has(line))
		.join("\n")
		.trim();
}

export function countHanCharacters(text: string): number {
	return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

export function detectChapter(text: string, previous: string | null): string | null {
	const firstLines = text.split("\n").slice(0, 8);
	for (const line of firstLines) {
		const chineseChapter = line.match(/第\s*[一二三四五六七八九十百0-9]+\s*章[^\n]{0,40}/u)?.[0];
		if (chineseChapter) return chineseChapter.replace(/\s+/g, " ").trim();
		const englishChapter = line.match(/(?:CHAPTER|Chapter)\s+\d+[^\n]{0,50}/u)?.[0];
		if (englishChapter) return englishChapter.replace(/\s+/g, " ").trim();
	}
	return previous;
}
