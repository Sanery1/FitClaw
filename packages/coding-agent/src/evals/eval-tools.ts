import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { AgentTool } from "@fitclaw/agent-core";
import {
	createKnowledgeReadTool,
	createKnowledgeSearchTool,
	type KnowledgePage,
	type KnowledgeSearchResult,
	type KnowledgeStore,
} from "@fitclaw/runtime";
import { Type } from "typebox";
import type { EvalKnowledgeFixture, EvalKnowledgePage } from "./types.js";

const skillDataWriteSchema = Type.Object({
	namespace: Type.String(),
	data: Type.Any(),
	mode: Type.Optional(Type.String()),
});

const skillDataReadSchema = Type.Object({
	namespace: Type.String(),
});

const BODYBUILDING_NAMESPACES = new Set([
	"user_profile",
	"training_log",
	"training_plan",
	"body_metrics",
	"progression",
	"personal_records",
]);

function resolveInside(root: string, relativePath: string): string {
	const resolved = normalize(join(root, relativePath));
	const normalizedRoot = normalize(root);
	if (
		resolved !== normalizedRoot &&
		!resolved.startsWith(`${normalizedRoot}\\`) &&
		!resolved.startsWith(`${normalizedRoot}/`)
	) {
		throw new Error(`Path escapes eval workspace: ${relativePath}`);
	}
	return resolved;
}

function readJsonArray(path: string): unknown[] {
	if (!existsSync(path)) {
		return [];
	}
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error(`Cannot append to non-array JSON file: ${path}`);
	}
	return parsed;
}

function readJson(path: string): unknown {
	if (!existsSync(path)) {
		return null;
	}
	return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function normalizeKnowledgeText(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, "");
}

function knowledgeScore(page: EvalKnowledgePage, query: string): number {
	const normalizedQuery = normalizeKnowledgeText(query);
	if (!normalizedQuery) return 0;
	const normalizedKeywords = page.keywords.map(normalizeKnowledgeText);
	const searchable = normalizeKnowledgeText([page.title, page.chapter ?? "", page.text, ...page.keywords].join(" "));
	if (searchable.includes(normalizedQuery)) return 1000 + normalizedQuery.length;
	const keywordMatches = normalizedKeywords.filter(
		(keyword) => keyword.includes(normalizedQuery) || normalizedQuery.includes(keyword),
	).length;
	if (keywordMatches > 0) return 500 + keywordMatches;
	const bigrams = Array.from({ length: Math.max(0, normalizedQuery.length - 1) }, (_, index) =>
		normalizedQuery.slice(index, index + 2),
	);
	return bigrams.filter((bigram) => searchable.includes(bigram)).length;
}

function toKnowledgePage(page: EvalKnowledgePage): KnowledgePage {
	return {
		pageId: page.pageId,
		sourceId: page.sourceId,
		title: page.title,
		edition: page.edition,
		collection: page.collection,
		tier: "primary",
		status: "enabled",
		chapter: page.chapter,
		bookPage: page.bookPage,
		pdfPage: page.pdfPage,
		text: page.text,
		needsVisual: page.needsVisual,
	};
}

function createEvalKnowledgeStore(fixture: EvalKnowledgeFixture): KnowledgeStore {
	const pagesById = new Map(fixture.pages.map((page) => [page.pageId, page]));
	return {
		async search(input): Promise<KnowledgeSearchResult[]> {
			return fixture.pages
				.filter((page) => page.collection === input.collection)
				.map((page) => ({ page, score: knowledgeScore(page, input.query) }))
				.filter((entry) => entry.score > 0)
				.sort((left, right) => right.score - left.score || left.page.pdfPage - right.page.pdfPage)
				.slice(0, input.limit)
				.map(({ page }, index) => ({
					...toKnowledgePage(page),
					excerpt: page.text.slice(0, 600),
					rank: index + 1,
				}));
		},
		async read(input): Promise<KnowledgePage[]> {
			return input.pageIds.flatMap((pageId) => {
				const page = pagesById.get(pageId);
				return page ? [toKnowledgePage(page)] : [];
			});
		},
	};
}

export function createEvalTools(workspaceDir: string, knowledge?: EvalKnowledgeFixture): AgentTool[] {
	const dataBodybuildingRead: AgentTool<typeof skillDataReadSchema> = {
		name: "data_bodybuilding_read",
		label: "Read Bodybuilding Data",
		description: "Eval fixture tool that reads bodybuilding JSON data under sport-data/bodybuilding.",
		parameters: skillDataReadSchema,
		execute: async (_toolCallId, params) => {
			const namespace = params.namespace;
			if (!BODYBUILDING_NAMESPACES.has(namespace)) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `namespace "${namespace}" is not declared for bodybuilding eval data`,
							}),
						},
					],
					details: { namespace, error: "undeclared_namespace" },
				};
			}
			const filePath = resolveInside(workspaceDir, join("sport-data", "bodybuilding", `${namespace}.json`));
			const data = readJson(filePath);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ namespace, data }),
					},
				],
				details: { namespace, data },
			};
		},
	};

	const dataBodybuildingWrite: AgentTool<typeof skillDataWriteSchema> = {
		name: "data_bodybuilding_write",
		label: "Write Bodybuilding Data",
		description: "Eval fixture tool that persists bodybuilding JSON data under sport-data/bodybuilding.",
		parameters: skillDataWriteSchema,
		execute: async (_toolCallId, params) => {
			const namespace = params.namespace;
			if (!BODYBUILDING_NAMESPACES.has(namespace)) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `namespace "${namespace}" is not declared for bodybuilding eval data`,
							}),
						},
					],
					details: { namespace, error: "undeclared_namespace" },
				};
			}
			const mode = params.mode === "replace" ? "replace" : "append";
			const filePath = resolveInside(workspaceDir, join("sport-data", "bodybuilding", `${namespace}.json`));
			const nextData = mode === "replace" ? params.data : [...readJsonArray(filePath), params.data];
			writeJson(filePath, nextData);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ success: true, namespace, mode }),
					},
				],
				details: { namespace, mode },
			};
		},
	};

	const knowledgeStore = knowledge ? createEvalKnowledgeStore(knowledge) : undefined;
	const knowledgeTools =
		knowledge && knowledgeStore
			? [
					createKnowledgeSearchTool(knowledgeStore, knowledge.allowedCollections),
					createKnowledgeReadTool(knowledgeStore, knowledge.allowedCollections),
				]
			: [];
	return [dataBodybuildingRead, dataBodybuildingWrite, ...knowledgeTools];
}
