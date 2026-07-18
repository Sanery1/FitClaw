import type { KnowledgeSourceStatus, KnowledgeSourceTier } from "@fitclaw/runtime";

export interface KnowledgeSourceManifest {
	sourceId: string;
	title: string;
	edition: string;
	collection: string;
	tier: KnowledgeSourceTier;
	status: KnowledgeSourceStatus;
	file: string;
	checksum: string;
	license: string;
	expectedPages: number;
	bookPageOffset: number;
	contentStartPdfPage: number;
	contentEndPdfPage: number;
	headerLines: readonly string[];
}

export interface KnowledgeLibrary {
	version: 1;
	sources: readonly KnowledgeSourceManifest[];
}

export interface ExtractedPdfPage {
	pdfPage: number;
	text: string;
}

export interface PdfExtractor {
	extract(path: string): Promise<readonly ExtractedPdfPage[]>;
}

export interface PageRenderer {
	render(input: {
		sourceId: string;
		pdfPath: string;
		pdfPage: number;
	}): Promise<{ data: string; mimeType: "image/png" }>;
}

export interface IngestReport {
	sourceId: string;
	status: "passed" | "failed";
	startedAt: string;
	completedAt: string;
	checksum?: string;
	expectedPages?: number;
	extractedPages?: number;
	lowTextPages?: readonly number[];
	error?: string;
}

export interface KnowledgePaths {
	root: string;
	library: string;
	database: string;
	pageCache: string;
	reports: string;
}
