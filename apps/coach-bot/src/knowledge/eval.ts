import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadKnowledgeLibrary } from "./manifest.js";
import { SqliteKnowledgeStore } from "./sqlite-store.js";
import type { KnowledgePaths } from "./types.js";

const CATEGORIES = ["exact_term", "concept", "short", "visual"] as const;
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type KnowledgeEvalCategory = (typeof CATEGORIES)[number];

interface KnowledgeEvalCase {
	category: KnowledgeEvalCategory;
	query: string;
	relevantPageIds: readonly string[];
}

interface KnowledgeEvalThresholds {
	k: number;
	minRecallAtK: number;
	minMrr: number;
	categoryMinRecallAtK: ReadonlyMap<KnowledgeEvalCategory, number>;
}

interface KnowledgeEvalSuite {
	sourceId: string;
	thresholds: KnowledgeEvalThresholds;
	queries: readonly KnowledgeEvalCase[];
}

export interface KnowledgeEvalCaseResult {
	category: KnowledgeEvalCategory;
	query: string;
	relevantPageIds: readonly string[];
	retrievedPageIds: readonly string[];
	firstRelevantRank: number | null;
	recalledAtK: boolean;
}

export interface KnowledgeEvalMetrics {
	queryCount: number;
	recallAtK: number;
	mrr: number;
	byCategory: Record<KnowledgeEvalCategory, { queryCount: number; recallAtK: number; mrr: number }>;
}

export interface KnowledgeEvalReport {
	version: 1;
	status: "passed" | "failed";
	sourceId: string;
	casesFile: string;
	createdAt: string;
	thresholds: {
		k: number;
		minRecallAtK: number;
		minMrr: number;
		categoryMinRecallAtK: Record<KnowledgeEvalCategory, number>;
	};
	metrics: KnowledgeEvalMetrics;
	results: readonly KnowledgeEvalCaseResult[];
	reportPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) throw new Error(`${context} contains unsupported fields: ${unknown.join(", ")}`);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`);
	return value;
}

function requireRate(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${field} must be a number from 0 to 1`);
	}
	return value;
}

function requireCategory(value: unknown, field: string): KnowledgeEvalCategory {
	if (value === "exact_term" || value === "concept" || value === "short" || value === "visual") return value;
	throw new Error(`${field} must be one of ${CATEGORIES.join(", ")}`);
}

function requirePageIds(value: unknown, field: string, sourceId: string): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((pageId) => typeof pageId !== "string" || !new RegExp(`^${sourceId}:pdf:\\d{4}$`).test(pageId))
	) {
		throw new Error(`${field} must contain at least one stable page ID for ${sourceId}`);
	}
	return Array.from(new Set(value as string[]));
}

function parseThresholds(value: unknown): KnowledgeEvalThresholds {
	if (!isRecord(value)) throw new Error("thresholds must be an object");
	requireOnlyKeys(value, ["k", "min_recall_at_k", "min_mrr", "category_min_recall_at_k"], "thresholds");
	if (typeof value.k !== "number" || !Number.isInteger(value.k) || value.k < 1 || value.k > 8) {
		throw new Error("thresholds.k must be an integer from 1 to 8");
	}
	if (!isRecord(value.category_min_recall_at_k)) {
		throw new Error("thresholds.category_min_recall_at_k must be an object");
	}
	requireOnlyKeys(value.category_min_recall_at_k, CATEGORIES, "thresholds.category_min_recall_at_k");
	const categoryMinRecallAtK = new Map<KnowledgeEvalCategory, number>();
	for (const category of CATEGORIES) {
		categoryMinRecallAtK.set(
			category,
			requireRate(value.category_min_recall_at_k[category], `thresholds.category_min_recall_at_k.${category}`),
		);
	}
	return {
		k: value.k,
		minRecallAtK: requireRate(value.min_recall_at_k, "thresholds.min_recall_at_k"),
		minMrr: requireRate(value.min_mrr, "thresholds.min_mrr"),
		categoryMinRecallAtK,
	};
}

export function parseKnowledgeEvalSuite(source: string): KnowledgeEvalSuite {
	const value: unknown = parseYaml(source);
	if (!isRecord(value)) throw new Error("Knowledge eval suite must be an object");
	requireOnlyKeys(value, ["version", "source_id", "thresholds", "queries"], "knowledge eval suite");
	if (value.version !== 1) throw new Error("Knowledge eval suite version must be 1");
	const sourceId = requireString(value.source_id, "source_id");
	if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error("source_id is invalid");
	const thresholds = parseThresholds(value.thresholds);
	if (!Array.isArray(value.queries) || value.queries.length === 0) {
		throw new Error("queries must be a non-empty array");
	}
	const queries = value.queries.map((entry, index): KnowledgeEvalCase => {
		if (!isRecord(entry)) throw new Error(`queries[${index}] must be an object`);
		requireOnlyKeys(entry, ["category", "query", "relevant_page_ids"], `queries[${index}]`);
		return {
			category: requireCategory(entry.category, `queries[${index}].category`),
			query: requireString(entry.query, `queries[${index}].query`),
			relevantPageIds: requirePageIds(entry.relevant_page_ids, `queries[${index}].relevant_page_ids`, sourceId),
		};
	});
	for (const category of CATEGORIES) {
		if (!queries.some((entry) => entry.category === category)) {
			throw new Error(`queries must include category ${category}`);
		}
	}
	return { sourceId, thresholds, queries };
}

function rate(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

function calculateMetrics(results: readonly KnowledgeEvalCaseResult[], k: number): KnowledgeEvalMetrics {
	const categoryEntries = CATEGORIES.map((category) => {
		const cases = results.filter((result) => result.category === category);
		return [
			category,
			{
				queryCount: cases.length,
				recallAtK: rate(cases.filter((result) => result.recalledAtK).length, cases.length),
				mrr: rate(
					cases.reduce((sum, result) => sum + (result.firstRelevantRank ? 1 / result.firstRelevantRank : 0), 0),
					cases.length,
				),
			},
		] as const;
	});
	return {
		queryCount: results.length,
		recallAtK: rate(
			results.filter((result) => result.firstRelevantRank !== null && result.firstRelevantRank <= k).length,
			results.length,
		),
		mrr: rate(
			results.reduce((sum, result) => sum + (result.firstRelevantRank ? 1 / result.firstRelevantRank : 0), 0),
			results.length,
		),
		byCategory: Object.fromEntries(categoryEntries) as KnowledgeEvalMetrics["byCategory"],
	};
}

function thresholdsPass(metrics: KnowledgeEvalMetrics, thresholds: KnowledgeEvalThresholds): boolean {
	if (metrics.recallAtK < thresholds.minRecallAtK || metrics.mrr < thresholds.minMrr) return false;
	return CATEGORIES.every(
		(category) => metrics.byCategory[category].recallAtK >= (thresholds.categoryMinRecallAtK.get(category) ?? 1),
	);
}

export async function runKnowledgeRetrievalEval(input: {
	paths: KnowledgePaths;
	casesPath: string;
	expectedSourceId?: string;
}): Promise<KnowledgeEvalReport> {
	const suite = parseKnowledgeEvalSuite(await readFile(input.casesPath, "utf-8"));
	if (input.expectedSourceId && suite.sourceId !== input.expectedSourceId) {
		throw new Error(`Eval suite source_id ${suite.sourceId} does not match ${input.expectedSourceId}`);
	}
	const library = loadKnowledgeLibrary(input.paths.library);
	const source = library.sources.find((entry) => entry.sourceId === suite.sourceId);
	if (!source) throw new Error(`Knowledge source not found: ${suite.sourceId}`);
	const store = new SqliteKnowledgeStore({
		databasePath: input.paths.database,
		knowledgeRoot: input.paths.root,
		allowCandidate: true,
		aliasesPath: input.paths.aliases,
	});
	const results: KnowledgeEvalCaseResult[] = [];
	for (const evalCase of suite.queries) {
		const retrieved = await store.search({
			query: evalCase.query,
			collection: source.collection,
			limit: 8,
		});
		const retrievedPageIds = retrieved.map((entry) => entry.pageId);
		const relevant = new Set(evalCase.relevantPageIds);
		const firstRelevantIndex = retrievedPageIds.findIndex((pageId) => relevant.has(pageId));
		const firstRelevantRank = firstRelevantIndex < 0 ? null : firstRelevantIndex + 1;
		results.push({
			...evalCase,
			retrievedPageIds,
			firstRelevantRank,
			recalledAtK: firstRelevantRank !== null && firstRelevantRank <= suite.thresholds.k,
		});
	}
	const metrics = calculateMetrics(results, suite.thresholds.k);
	const status = thresholdsPass(metrics, suite.thresholds) ? "passed" : "failed";
	const createdAt = new Date().toISOString();
	const reportPath = resolve(
		input.paths.reports,
		`knowledge-eval-${suite.sourceId}-${createdAt.replace(/[:.]/g, "-")}.json`,
	);
	const categoryThresholds = Object.fromEntries(
		CATEGORIES.map((category) => [category, suite.thresholds.categoryMinRecallAtK.get(category) ?? 1]),
	) as Record<KnowledgeEvalCategory, number>;
	const report: KnowledgeEvalReport = {
		version: 1,
		status,
		sourceId: suite.sourceId,
		casesFile: basename(input.casesPath),
		createdAt,
		thresholds: {
			k: suite.thresholds.k,
			minRecallAtK: suite.thresholds.minRecallAtK,
			minMrr: suite.thresholds.minMrr,
			categoryMinRecallAtK: categoryThresholds,
		},
		metrics,
		results,
		reportPath,
	};
	await mkdir(input.paths.reports, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
	return report;
}
