import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type {
	EvalFauxResponse,
	EvalFauxToolCall,
	EvalGrader,
	EvalKnowledgeFixture,
	EvalKnowledgePage,
	EvalTask,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) throw new Error(`${context} contains unsupported fields: ${unknown.join(", ")}`);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`Eval task field "${field}" must be a non-empty string.`);
	}
	return value;
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Eval task field "${field}" must be a finite number.`);
	}
	return value;
}

function requireInteger(value: unknown, field: string): number {
	const number = requireNumber(value, field);
	if (!Number.isInteger(number)) throw new Error(`Eval task field "${field}" must be an integer.`);
	return number;
}

function requirePositiveInteger(value: unknown, field: string): number {
	const number = requireInteger(value, field);
	if (number < 1) throw new Error(`Eval task field "${field}" must be positive.`);
	return number;
}

function requireStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
		throw new Error(`Eval task field "${field}" must be an array of non-empty strings.`);
	}
	return value;
}

function parseToolCall(value: unknown, index: number): EvalFauxToolCall {
	if (!isRecord(value)) {
		throw new Error(`fauxResponses tool call ${index} must be an object.`);
	}
	const name = requireString(value.name, `fauxResponses.toolCalls[${index}].name`);
	const args = value.args === undefined ? {} : value.args;
	if (!isRecord(args)) {
		throw new Error(`fauxResponses tool call "${name}" args must be an object.`);
	}
	return { name, args };
}

function parseFauxResponse(value: unknown, index: number): EvalFauxResponse {
	if (typeof value === "string") {
		return { text: value };
	}
	if (!isRecord(value)) {
		throw new Error(`fauxResponses[${index}] must be a string or object.`);
	}
	const text = value.text === undefined ? undefined : requireString(value.text, `fauxResponses[${index}].text`);
	const rawToolCalls = value.toolCalls;
	if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
		throw new Error(`fauxResponses[${index}].toolCalls must be an array.`);
	}
	const toolCalls = rawToolCalls?.map((toolCall, toolCallIndex) => parseToolCall(toolCall, toolCallIndex));
	return { text, toolCalls };
}

function parseKnowledgePage(value: unknown, index: number): EvalKnowledgePage {
	if (!isRecord(value)) throw new Error(`knowledge.pages[${index}] must be an object.`);
	requireOnlyKeys(
		value,
		[
			"page_id",
			"source_id",
			"title",
			"edition",
			"collection",
			"chapter",
			"book_page",
			"pdf_page",
			"text",
			"keywords",
			"needs_visual",
		],
		`knowledge.pages[${index}]`,
	);
	const bookPage = value.book_page;
	if (bookPage !== null && (typeof bookPage !== "number" || !Number.isInteger(bookPage) || bookPage < 0)) {
		throw new Error(`Eval task field "knowledge.pages[${index}].book_page" must be null or a non-negative integer.`);
	}
	const chapter = value.chapter;
	if (chapter !== null && chapter !== undefined && typeof chapter !== "string") {
		throw new Error(`Eval task field "knowledge.pages[${index}].chapter" must be null or a string.`);
	}
	const keywords =
		value.keywords === undefined ? [] : requireStringArray(value.keywords, `knowledge.pages[${index}].keywords`);
	if (value.needs_visual !== undefined && typeof value.needs_visual !== "boolean") {
		throw new Error(`Eval task field "knowledge.pages[${index}].needs_visual" must be a boolean.`);
	}
	return {
		pageId: requireString(value.page_id, `knowledge.pages[${index}].page_id`),
		sourceId: requireString(value.source_id, `knowledge.pages[${index}].source_id`),
		title: requireString(value.title, `knowledge.pages[${index}].title`),
		edition: requireString(value.edition, `knowledge.pages[${index}].edition`),
		collection: requireString(value.collection, `knowledge.pages[${index}].collection`),
		chapter: chapter ?? null,
		bookPage,
		pdfPage: requirePositiveInteger(value.pdf_page, `knowledge.pages[${index}].pdf_page`),
		text: requireString(value.text, `knowledge.pages[${index}].text`),
		keywords,
		needsVisual: value.needs_visual ?? false,
	};
}

function parseKnowledgeFixture(value: unknown): EvalKnowledgeFixture | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error('Eval task field "knowledge" must be an object.');
	requireOnlyKeys(value, ["allowed_collections", "pages"], "knowledge");
	const allowedCollections = requireStringArray(value.allowed_collections, "knowledge.allowed_collections");
	if (allowedCollections.length === 0) {
		throw new Error('Eval task field "knowledge.allowed_collections" must not be empty.');
	}
	if (!Array.isArray(value.pages) || value.pages.length === 0) {
		throw new Error('Eval task field "knowledge.pages" must be a non-empty array.');
	}
	const pages = value.pages.map(parseKnowledgePage);
	if (new Set(pages.map((page) => page.pageId)).size !== pages.length) {
		throw new Error('Eval task field "knowledge.pages" contains duplicate page IDs.');
	}
	if (pages.some((page) => !allowedCollections.includes(page.collection))) {
		throw new Error("Every knowledge page collection must be listed in knowledge.allowed_collections.");
	}
	return { allowedCollections, pages };
}

function parseGrader(value: unknown, index: number): EvalGrader {
	if (!isRecord(value)) {
		throw new Error(`graders[${index}] must be an object.`);
	}
	const type = requireString(value.type, `graders[${index}].type`);
	if (type === "final_contains") {
		return { type, text: requireString(value.text, `graders[${index}].text`) };
	}
	if (type === "final_contains_any") {
		return { type, texts: requireStringArray(value.texts, `graders[${index}].texts`) };
	}
	if (type === "final_not_contains") {
		return { type, text: requireString(value.text, `graders[${index}].text`) };
	}
	if (type === "tool_called") {
		return { type, tool: requireString(value.tool, `graders[${index}].tool`) };
	}
	if (type === "tool_not_called") {
		return { type, tool: requireString(value.tool, `graders[${index}].tool`) };
	}
	if (type === "tool_sequence") {
		return { type, tools: requireStringArray(value.tools, `graders[${index}].tools`) };
	}
	if (type === "tool_args_match") {
		const args = value.args === undefined ? {} : value.args;
		if (!isRecord(args)) {
			throw new Error(`Eval task field "graders[${index}].args" must be an object.`);
		}
		return { type, tool: requireString(value.tool, `graders[${index}].tool`), args };
	}
	if (type === "json_path_equals") {
		return {
			type,
			file: requireString(value.file, `graders[${index}].file`),
			path: requireString(value.path, `graders[${index}].path`),
			equals: value.equals,
		};
	}
	if (type === "file_exists") {
		return { type, file: requireString(value.file, `graders[${index}].file`) };
	}
	if (type === "file_not_exists") {
		return { type, file: requireString(value.file, `graders[${index}].file`) };
	}
	if (type === "max_tool_calls") {
		return { type, max: requireNumber(value.max, `graders[${index}].max`) };
	}
	if (type === "max_turns") {
		return { type, max: requireNumber(value.max, `graders[${index}].max`) };
	}
	if (type === "retrieved_page_ids") {
		return {
			type,
			pageIds: requireStringArray(value.page_ids, `graders[${index}].page_ids`),
			tool: value.tool === undefined ? undefined : requireString(value.tool, `graders[${index}].tool`),
		};
	}
	if (type === "citation_present") {
		const bookPage = value.book_page;
		if (bookPage !== null && (typeof bookPage !== "number" || !Number.isInteger(bookPage) || bookPage < 0)) {
			throw new Error(`Eval task field "graders[${index}].book_page" must be null or a non-negative integer.`);
		}
		return {
			type,
			title: requireString(value.title, `graders[${index}].title`),
			edition: requireString(value.edition, `graders[${index}].edition`),
			bookPage,
			pdfPage: requirePositiveInteger(value.pdf_page, `graders[${index}].pdf_page`),
		};
	}
	if (type === "citation_absent") return { type };
	throw new Error(`Unsupported grader type "${type}".`);
}

export function parseEvalTask(source: string): EvalTask {
	const raw = parse(source) as unknown;
	if (!isRecord(raw)) {
		throw new Error("Eval task must be a YAML object.");
	}
	const rawResponses = raw.fauxResponses;
	if (rawResponses !== undefined && (!Array.isArray(rawResponses) || rawResponses.length === 0)) {
		throw new Error('Eval task field "fauxResponses" must be a non-empty array when provided.');
	}
	const rawGraders = raw.graders;
	if (!Array.isArray(rawGraders) || rawGraders.length === 0) {
		throw new Error('Eval task field "graders" must be a non-empty array.');
	}
	return {
		id: requireString(raw.id, "id"),
		suite: requireString(raw.suite, "suite"),
		prompt: requireString(raw.prompt, "prompt"),
		systemPrompt: raw.systemPrompt === undefined ? undefined : requireString(raw.systemPrompt, "systemPrompt"),
		initialData: isRecord(raw.initialData) ? raw.initialData : {},
		knowledge: parseKnowledgeFixture(raw.knowledge),
		fauxResponses: rawResponses?.map((response, index) => parseFauxResponse(response, index)),
		graders: rawGraders.map((grader, index) => parseGrader(grader, index)),
	};
}

export function loadEvalTask(path: string): EvalTask {
	return parseEvalTask(readFileSync(path, "utf-8"));
}
