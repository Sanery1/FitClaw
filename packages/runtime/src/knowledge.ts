export const KNOWLEDGE_ERROR_CODES = [
	"collection_forbidden",
	"knowledge_unavailable",
	"invalid_query",
	"invalid_page_id",
	"output_budget_exceeded",
	"render_unavailable",
] as const;

export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[number];

export type KnowledgeSourceTier = "primary" | "secondary" | "legacy";
export type KnowledgeSourceStatus = "candidate" | "enabled" | "legacy" | "disabled";

export interface KnowledgeSearchInput {
	query: string;
	collection: string;
	limit: number;
}

export interface KnowledgeReadInput {
	pageIds: readonly string[];
	includeVisual: boolean;
}

export interface KnowledgeSearchResult {
	pageId: string;
	sourceId: string;
	title: string;
	edition: string;
	collection: string;
	tier: KnowledgeSourceTier;
	status: KnowledgeSourceStatus;
	chapter: string | null;
	bookPage: number | null;
	pdfPage: number;
	excerpt: string;
	rank: number;
	needsVisual: boolean;
}

export interface KnowledgeVisual {
	data: string;
	mimeType: "image/png";
}

export interface KnowledgePage {
	pageId: string;
	sourceId: string;
	title: string;
	edition: string;
	collection: string;
	tier: KnowledgeSourceTier;
	status: KnowledgeSourceStatus;
	chapter: string | null;
	bookPage: number | null;
	pdfPage: number;
	text: string;
	needsVisual: boolean;
	visual?: KnowledgeVisual;
	visualErrorCode?: "render_unavailable";
}

export interface KnowledgeStore {
	search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
	read(input: KnowledgeReadInput): Promise<KnowledgePage[]>;
}

export class KnowledgeError extends Error {
	readonly code: KnowledgeErrorCode;

	constructor(code: KnowledgeErrorCode, message: string) {
		super(message);
		this.name = "KnowledgeError";
		this.code = code;
	}
}
