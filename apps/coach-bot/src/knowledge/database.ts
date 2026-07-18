import { DatabaseSync } from "node:sqlite";

export const KNOWLEDGE_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  edition TEXT NOT NULL,
  collection TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  checksum TEXT NOT NULL,
  file_path TEXT NOT NULL
) STRICT;
CREATE TABLE pages (
  page_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  pdf_page INTEGER NOT NULL,
  book_page INTEGER,
  chapter TEXT,
  raw_text TEXT NOT NULL,
  search_text TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  needs_visual INTEGER NOT NULL CHECK (needs_visual IN (0, 1)),
  UNIQUE(source_id, pdf_page)
) STRICT;
CREATE VIRTUAL TABLE pages_fts USING fts5(page_id UNINDEXED, search_text, tokenize='trigram');
`;

export function validateKnowledgeDatabase(path: string, sourceId?: string, expectedPages?: number): void {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const integrity = database.prepare("PRAGMA integrity_check").get();
		if (integrity?.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
		database.prepare("SELECT page_id FROM pages_fts WHERE pages_fts MATCH ? LIMIT 1").all('"测试词"');
		if (sourceId !== undefined && expectedPages !== undefined) {
			const row = database.prepare("SELECT COUNT(*) AS count FROM pages WHERE source_id = ?").get(sourceId);
			if (Number(row?.count) !== expectedPages) {
				throw new Error(`Expected ${expectedPages} pages for ${sourceId}, found ${String(row?.count ?? 0)}`);
			}
			const gap = database
				.prepare(
					"SELECT MIN(pdf_page) AS min_page, MAX(pdf_page) AS max_page, COUNT(DISTINCT pdf_page) AS count FROM pages WHERE source_id = ?",
				)
				.get(sourceId);
			if (
				Number(gap?.min_page) !== 1 ||
				Number(gap?.max_page) !== expectedPages ||
				Number(gap?.count) !== expectedPages
			) {
				throw new Error(`PDF page sequence is incomplete for ${sourceId}`);
			}
		}
	} finally {
		database.close();
	}
}
