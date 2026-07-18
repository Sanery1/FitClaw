import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KNOWLEDGE_SCHEMA, validateKnowledgeDatabase } from "./database.js";
import { loadKnowledgeLibrary, resolveSourcePdfPath } from "./manifest.js";
import { detectChapter, normalizePageText } from "./normalize.js";
import { PdfJsExtractor } from "./pdf-extractor.js";
import type { IngestReport, KnowledgePaths, PdfExtractor } from "./types.js";

interface IngestKnowledgeSourceOptions {
	paths: KnowledgePaths;
	sourceId: string;
	extractor?: PdfExtractor;
	validateDatabase?: (path: string, sourceId: string, expectedPages: number) => void;
}

async function sha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

function reportFileName(sourceId: string, startedAt: string): string {
	return `${sourceId}-${startedAt.replace(/[:.]/g, "-")}.json`;
}

async function saveReport(paths: KnowledgePaths, report: IngestReport): Promise<void> {
	await mkdir(paths.reports, { recursive: true });
	await writeFile(
		join(paths.reports, reportFileName(report.sourceId, report.startedAt)),
		`${JSON.stringify(report, null, 2)}\n`,
	);
}

function createTemporaryDatabase(path: string): DatabaseSync {
	const database = new DatabaseSync(path);
	try {
		database.exec(KNOWLEDGE_SCHEMA);
		return database;
	} catch (error) {
		database.close();
		throw error;
	}
}

export async function ingestKnowledgeSource(options: IngestKnowledgeSourceOptions): Promise<IngestReport> {
	const startedAt = new Date().toISOString();
	const reportBase = { sourceId: options.sourceId, startedAt };
	await mkdir(options.paths.root, { recursive: true });
	const lockPath = `${options.paths.database}.ingest.lock`;
	let lock: Awaited<ReturnType<typeof open>> | undefined;
	let temporaryDatabasePath: string | undefined;

	try {
		try {
			lock = await open(lockPath, "wx");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST") {
				throw new Error("Another knowledge ingestion is already running");
			}
			throw error;
		}

		const library = loadKnowledgeLibrary(options.paths.library);
		const source = library.sources.find((entry) => entry.sourceId === options.sourceId);
		if (!source) throw new Error(`Unknown knowledge source: ${options.sourceId}`);
		const pdfPath = resolveSourcePdfPath(options.paths.root, source);
		if (!existsSync(pdfPath)) throw new Error(`Knowledge source PDF is missing: ${basename(source.file)}`);
		const checksum = await sha256(pdfPath);
		if (checksum !== source.checksum) throw new Error("Knowledge source checksum does not match library.yaml");

		const extractor = options.extractor ?? new PdfJsExtractor();
		const extractedPages = await extractor.extract(pdfPath);
		if (extractedPages.length !== source.expectedPages) {
			throw new Error(`Expected ${source.expectedPages} PDF pages, extracted ${extractedPages.length}`);
		}
		const expectedPageNumbers = new Set(Array.from({ length: source.expectedPages }, (_, index) => index + 1));
		for (const page of extractedPages) expectedPageNumbers.delete(page.pdfPage);
		if (expectedPageNumbers.size > 0) {
			throw new Error(`PDF page sequence has gaps: ${Array.from(expectedPageNumbers).slice(0, 10).join(", ")}`);
		}

		temporaryDatabasePath = `${options.paths.database}.tmp-${process.pid}-${Date.now()}`;
		const database = createTemporaryDatabase(temporaryDatabasePath);
		const lowTextPages: number[] = [];
		try {
			database.exec("BEGIN IMMEDIATE");
			const insertSource = database.prepare(
				"INSERT INTO sources (source_id, title, edition, collection, tier, status, checksum, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			);
			insertSource.run(
				source.sourceId,
				source.title,
				source.edition,
				source.collection,
				source.tier,
				source.status,
				source.checksum,
				source.file,
			);
			const insertPage = database.prepare(
				"INSERT INTO pages (page_id, source_id, pdf_page, book_page, chapter, raw_text, search_text, quality_status, needs_visual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			);
			const insertFts = database.prepare("INSERT INTO pages_fts (page_id, search_text) VALUES (?, ?)");
			let chapter: string | null = null;
			for (const page of extractedPages) {
				const searchText = normalizePageText(page.text, source.headerLines);
				chapter = detectChapter(searchText, chapter);
				const isLowText = searchText.length < 50;
				if (isLowText) lowTextPages.push(page.pdfPage);
				const qualityStatus = isLowText ? (searchText.length === 0 ? "visual_only" : "review_required") : "text_ok";
				const bookPage =
					page.pdfPage >= source.contentStartPdfPage && page.pdfPage <= source.contentEndPdfPage
						? page.pdfPage - source.bookPageOffset
						: null;
				const pageId = `${source.sourceId}:pdf:${page.pdfPage.toString().padStart(4, "0")}`;
				insertPage.run(
					pageId,
					source.sourceId,
					page.pdfPage,
					bookPage,
					chapter,
					page.text,
					searchText,
					qualityStatus,
					isLowText ? 1 : 0,
				);
				insertFts.run(pageId, searchText);
			}
			database.exec("COMMIT");
		} catch (error) {
			if (database.isTransaction) database.exec("ROLLBACK");
			throw error;
		} finally {
			database.close();
		}

		const validate = options.validateDatabase ?? validateKnowledgeDatabase;
		validate(temporaryDatabasePath, source.sourceId, source.expectedPages);
		await rename(temporaryDatabasePath, options.paths.database);
		temporaryDatabasePath = undefined;

		const report: IngestReport = {
			...reportBase,
			status: "passed",
			completedAt: new Date().toISOString(),
			checksum,
			expectedPages: source.expectedPages,
			extractedPages: extractedPages.length,
			lowTextPages,
		};
		await saveReport(options.paths, report);
		return report;
	} catch (error) {
		const report: IngestReport = {
			...reportBase,
			status: "failed",
			completedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		};
		await saveReport(options.paths, report);
		throw error;
	} finally {
		if (temporaryDatabasePath) await rm(temporaryDatabasePath, { force: true });
		if (lock) {
			await lock.close();
			await rm(lockPath, { force: true });
		}
	}
}

export async function validateKnowledgeSource(paths: KnowledgePaths, sourceId: string): Promise<IngestReport> {
	const startedAt = new Date().toISOString();
	try {
		const library = loadKnowledgeLibrary(paths.library);
		const source = library.sources.find((entry) => entry.sourceId === sourceId);
		if (!source) throw new Error(`Unknown knowledge source: ${sourceId}`);
		const pdfPath = resolveSourcePdfPath(paths.root, source);
		if (!existsSync(pdfPath)) throw new Error(`Knowledge source PDF is missing: ${basename(source.file)}`);
		const checksum = await sha256(pdfPath);
		if (checksum !== source.checksum) throw new Error("Knowledge source checksum does not match library.yaml");
		validateKnowledgeDatabase(paths.database, source.sourceId, source.expectedPages);
		const report: IngestReport = {
			sourceId,
			status: "passed",
			startedAt,
			completedAt: new Date().toISOString(),
			checksum,
			expectedPages: source.expectedPages,
		};
		await saveReport(paths, report);
		return report;
	} catch (error) {
		const report: IngestReport = {
			sourceId,
			status: "failed",
			startedAt,
			completedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		};
		await saveReport(paths, report);
		throw error;
	}
}
