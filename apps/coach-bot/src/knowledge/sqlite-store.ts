import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import {
	KnowledgeError,
	type KnowledgePage,
	type KnowledgeReadInput,
	type KnowledgeSearchInput,
	type KnowledgeSearchResult,
	type KnowledgeSourceStatus,
	type KnowledgeSourceTier,
	type KnowledgeStore,
} from "@fitclaw/runtime";
import { normalizeSearchQuery } from "./normalize.js";
import type { PageRenderer } from "./types.js";

const PAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:pdf:\d{4}$/;

interface SqliteKnowledgeStoreOptions {
	databasePath: string;
	knowledgeRoot: string;
	allowCandidate: boolean;
	renderer?: PageRenderer;
}

function asString(value: SQLOutputValue | undefined, field: string): string {
	if (typeof value !== "string")
		throw new KnowledgeError("knowledge_unavailable", `Invalid ${field} in knowledge database`);
	return value;
}

function asNullableString(value: SQLOutputValue | undefined, field: string): string | null {
	if (value === null) return null;
	return asString(value, field);
}

function asNumber(value: SQLOutputValue | undefined, field: string): number {
	if (typeof value !== "number")
		throw new KnowledgeError("knowledge_unavailable", `Invalid ${field} in knowledge database`);
	return value;
}

function asNullableNumber(value: SQLOutputValue | undefined, field: string): number | null {
	if (value === null) return null;
	return asNumber(value, field);
}

function asTier(value: SQLOutputValue | undefined): KnowledgeSourceTier {
	if (value === "primary" || value === "secondary" || value === "legacy") return value;
	throw new KnowledgeError("knowledge_unavailable", "Invalid source tier in knowledge database");
}

function asStatus(value: SQLOutputValue | undefined): KnowledgeSourceStatus {
	if (value === "candidate" || value === "enabled" || value === "legacy" || value === "disabled") return value;
	throw new KnowledgeError("knowledge_unavailable", "Invalid source status in knowledge database");
}

function createFtsQuery(query: string): string | null {
	const terms: string[] = [];
	for (const segment of query.split(" ")) {
		const characters = Array.from(segment);
		for (let index = 0; index <= characters.length - 3; index++) {
			const term = characters
				.slice(index, index + 3)
				.join("")
				.replace(/"/g, '""');
			if (!terms.includes(term)) terms.push(term);
			if (terms.length >= 32) break;
		}
		if (terms.length >= 32) break;
	}
	return terms.length > 0 ? terms.map((term) => `"${term}"`).join(" OR ") : null;
}

function statusClause(allowCandidate: boolean): string {
	return allowCandidate ? "s.status IN ('enabled', 'candidate')" : "s.status = 'enabled'";
}

export class SqliteKnowledgeStore implements KnowledgeStore {
	constructor(private readonly options: SqliteKnowledgeStoreOptions) {}

	private openDatabase(): DatabaseSync {
		if (!existsSync(this.options.databasePath)) {
			throw new KnowledgeError("knowledge_unavailable", "The knowledge database is not available.");
		}
		try {
			return new DatabaseSync(this.options.databasePath, { readOnly: true });
		} catch {
			throw new KnowledgeError("knowledge_unavailable", "The knowledge database is missing or invalid.");
		}
	}

	async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
		const query = normalizeSearchQuery(input.query);
		if (!query) throw new KnowledgeError("invalid_query", "Query contains no searchable characters.");
		const ftsQuery = createFtsQuery(query);
		const database = this.openDatabase();
		try {
			const rows =
				ftsQuery === null
					? database
							.prepare(
								`SELECT p.page_id, p.source_id, p.pdf_page, p.book_page, p.chapter,
							        p.search_text, p.needs_visual, s.title, s.edition, s.collection,
							        s.tier, s.status
							 FROM pages p JOIN sources s ON s.source_id = p.source_id
							 WHERE s.collection = ? AND ${statusClause(this.options.allowCandidate)}
							   AND instr(p.search_text, ?) > 0
							 ORDER BY p.source_id, p.pdf_page LIMIT ?`,
							)
							.all(input.collection, query, input.limit)
					: database
							.prepare(
								`SELECT p.page_id, p.source_id, p.pdf_page, p.book_page, p.chapter,
							        snippet(pages_fts, 1, '', '', '…', 32) AS search_text,
							        p.needs_visual, s.title, s.edition, s.collection, s.tier, s.status,
							        bm25(pages_fts) AS score
							 FROM pages_fts
							 JOIN pages p ON p.page_id = pages_fts.page_id
							 JOIN sources s ON s.source_id = p.source_id
							 WHERE pages_fts MATCH ? AND s.collection = ?
							   AND ${statusClause(this.options.allowCandidate)}
							 ORDER BY score, p.pdf_page LIMIT ?`,
							)
							.all(ftsQuery, input.collection, input.limit);

			return rows.map((row, index) => ({
				pageId: asString(row.page_id, "page_id"),
				sourceId: asString(row.source_id, "source_id"),
				title: asString(row.title, "title"),
				edition: asString(row.edition, "edition"),
				collection: asString(row.collection, "collection"),
				tier: asTier(row.tier),
				status: asStatus(row.status),
				chapter: asNullableString(row.chapter, "chapter"),
				bookPage: asNullableNumber(row.book_page, "book_page"),
				pdfPage: asNumber(row.pdf_page, "pdf_page"),
				excerpt: asString(row.search_text, "search_text").slice(0, 600),
				rank: index + 1,
				needsVisual: asNumber(row.needs_visual, "needs_visual") === 1,
			}));
		} catch (error) {
			if (error instanceof KnowledgeError) throw error;
			throw new KnowledgeError("knowledge_unavailable", "The knowledge database could not complete the search.");
		} finally {
			database.close();
		}
	}

	async read(input: KnowledgeReadInput): Promise<KnowledgePage[]> {
		if (
			input.pageIds.length === 0 ||
			input.pageIds.length > 5 ||
			input.pageIds.some((pageId) => !PAGE_ID_PATTERN.test(pageId))
		) {
			throw new KnowledgeError("invalid_page_id", "One or more page IDs are invalid.");
		}
		const database = this.openDatabase();
		try {
			const placeholders = input.pageIds.map(() => "?").join(", ");
			const rows = database
				.prepare(
					`SELECT p.page_id, p.source_id, p.pdf_page, p.book_page, p.chapter,
					        p.raw_text, p.needs_visual, s.title, s.edition, s.collection,
					        s.tier, s.status, s.file_path
					 FROM pages p JOIN sources s ON s.source_id = p.source_id
					 WHERE p.page_id IN (${placeholders}) AND ${statusClause(this.options.allowCandidate)}`,
				)
				.all(...input.pageIds);
			const rowsByPageId = new Map(rows.map((row) => [asString(row.page_id, "page_id"), row]));
			const orderedRows = input.pageIds.flatMap((pageId) => {
				const row = rowsByPageId.get(pageId);
				return row ? [row] : [];
			});
			const pages: KnowledgePage[] = [];
			let renderedCount = 0;
			for (const row of orderedRows) {
				const page: KnowledgePage = {
					pageId: asString(row.page_id, "page_id"),
					sourceId: asString(row.source_id, "source_id"),
					title: asString(row.title, "title"),
					edition: asString(row.edition, "edition"),
					collection: asString(row.collection, "collection"),
					tier: asTier(row.tier),
					status: asStatus(row.status),
					chapter: asNullableString(row.chapter, "chapter"),
					bookPage: asNullableNumber(row.book_page, "book_page"),
					pdfPage: asNumber(row.pdf_page, "pdf_page"),
					text: asString(row.raw_text, "raw_text"),
					needsVisual: asNumber(row.needs_visual, "needs_visual") === 1,
				};
				if (input.includeVisual && renderedCount < 2) {
					renderedCount++;
					try {
						if (!this.options.renderer)
							throw new KnowledgeError("render_unavailable", "PDF rendering is unavailable.");
						const relativeFilePath = asString(row.file_path, "file_path");
						const pdfPath = resolve(this.options.knowledgeRoot, relativeFilePath);
						const relativePath = relative(this.options.knowledgeRoot, pdfPath);
						if (isAbsolute(relativeFilePath) || relativePath.startsWith("..") || isAbsolute(relativePath)) {
							throw new KnowledgeError("knowledge_unavailable", "Knowledge source path is invalid.");
						}
						page.visual = await this.options.renderer.render({
							sourceId: page.sourceId,
							pdfPath,
							pdfPage: page.pdfPage,
						});
					} catch (error) {
						if (error instanceof KnowledgeError && error.code !== "render_unavailable") throw error;
						page.visualErrorCode = "render_unavailable";
					}
				}
				pages.push(page);
			}
			return pages;
		} catch (error) {
			if (error instanceof KnowledgeError) throw error;
			throw new KnowledgeError(
				"knowledge_unavailable",
				"The knowledge database could not read the requested pages.",
			);
		} finally {
			database.close();
		}
	}
}
