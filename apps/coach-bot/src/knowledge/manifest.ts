import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { KnowledgeLibrary, KnowledgeSourceManifest } from "./types.js";

const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLLECTION_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) throw new Error(`${context} contains unsupported fields: ${unknown.join(", ")}`);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function requireInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`${field} must be a non-negative integer`);
	}
	return value;
}

function parseSource(value: unknown, index: number): KnowledgeSourceManifest {
	if (!isRecord(value)) throw new Error(`sources[${index}] must be an object`);
	requireKeys(
		value,
		[
			"source_id",
			"title",
			"edition",
			"collection",
			"tier",
			"status",
			"file",
			"checksum",
			"license",
			"expected_pages",
			"book_page_offset",
			"content_start_pdf_page",
			"content_end_pdf_page",
			"header_lines",
		],
		`sources[${index}]`,
	);

	const sourceId = requireString(value.source_id, `sources[${index}].source_id`);
	const collection = requireString(value.collection, `sources[${index}].collection`);
	const checksum = requireString(value.checksum, `sources[${index}].checksum`).toLowerCase();
	if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error(`sources[${index}].source_id is invalid`);
	if (!COLLECTION_PATTERN.test(collection)) throw new Error(`sources[${index}].collection is invalid`);
	if (!SHA256_PATTERN.test(checksum)) throw new Error(`sources[${index}].checksum must be a SHA-256 hex digest`);
	if (value.tier !== "primary" && value.tier !== "secondary" && value.tier !== "legacy") {
		throw new Error(`sources[${index}].tier is invalid`);
	}
	if (
		value.status !== "candidate" &&
		value.status !== "enabled" &&
		value.status !== "legacy" &&
		value.status !== "disabled"
	) {
		throw new Error(`sources[${index}].status is invalid`);
	}
	const headerLines = value.header_lines ?? [];
	if (!Array.isArray(headerLines) || !headerLines.every((entry) => typeof entry === "string")) {
		throw new Error(`sources[${index}].header_lines must be a string array`);
	}

	const source: KnowledgeSourceManifest = {
		sourceId,
		title: requireString(value.title, `sources[${index}].title`),
		edition: requireString(value.edition, `sources[${index}].edition`),
		collection,
		tier: value.tier,
		status: value.status,
		file: requireString(value.file, `sources[${index}].file`),
		checksum,
		license: requireString(value.license, `sources[${index}].license`),
		expectedPages: requireInteger(value.expected_pages, `sources[${index}].expected_pages`),
		bookPageOffset: requireInteger(value.book_page_offset, `sources[${index}].book_page_offset`),
		contentStartPdfPage: requireInteger(value.content_start_pdf_page, `sources[${index}].content_start_pdf_page`),
		contentEndPdfPage: requireInteger(value.content_end_pdf_page, `sources[${index}].content_end_pdf_page`),
		headerLines: [...headerLines],
	};
	if (
		source.expectedPages < 1 ||
		source.contentStartPdfPage < 1 ||
		source.contentEndPdfPage < source.contentStartPdfPage ||
		source.contentEndPdfPage > source.expectedPages
	) {
		throw new Error(`sources[${index}] has an invalid PDF page range`);
	}
	return source;
}

export function loadKnowledgeLibrary(path: string): KnowledgeLibrary {
	if (!existsSync(path)) throw new Error("Knowledge library manifest is missing");
	const value: unknown = parseYaml(readFileSync(path, "utf-8"));
	if (!isRecord(value)) throw new Error("Knowledge library manifest must be an object");
	requireKeys(value, ["version", "sources"], "library.yaml");
	if (value.version !== 1) throw new Error("library.yaml version must be 1");
	if (!Array.isArray(value.sources) || value.sources.length === 0) {
		throw new Error("library.yaml sources must be a non-empty array");
	}
	const sources = value.sources.map(parseSource);
	if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
		throw new Error("library.yaml source_id values must be unique");
	}
	return { version: 1, sources };
}

export function resolveSourcePdfPath(knowledgeRoot: string, source: KnowledgeSourceManifest): string {
	if (isAbsolute(source.file)) throw new Error("Knowledge source file must be relative to the knowledge directory");
	const path = resolve(knowledgeRoot, source.file);
	const relativePath = relative(knowledgeRoot, path);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error("Knowledge source file resolves outside the knowledge directory");
	}
	return path;
}
