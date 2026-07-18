import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseKnowledgeEvalSuite, runKnowledgeRetrievalEval } from "../src/knowledge/eval.js";
import { ingestKnowledgeSource } from "../src/knowledge/ingest.js";
import { createKnowledgePaths } from "../src/knowledge/paths.js";
import type { ExtractedPdfPage, PdfExtractor } from "../src/knowledge/types.js";

const PDF_CONTENT = "knowledge-eval-pdf";

class FakePdfExtractor implements PdfExtractor {
	async extract(): Promise<readonly ExtractedPdfPage[]> {
		return [
			{ pdfPage: 1, text: "肩关节概览。" },
			{ pdfPage: 2, text: "肩胛肱骨节律描述肩胛骨与肱骨的配合。" },
			{ pdfPage: 3, text: "肌肉长度张力曲线图。" },
			{ pdfPage: 4, text: "髋关节稳定结构。" },
		];
	}
}

function writeWorkspace(workspace: string): void {
	const checksum = createHash("sha256").update(PDF_CONTENT).digest("hex");
	mkdirSync(join(workspace, "knowledge", "sources"), { recursive: true });
	writeFileSync(join(workspace, "knowledge", "sources", "book.pdf"), PDF_CONTENT);
	writeFileSync(
		join(workspace, "knowledge", "library.yaml"),
		[
			"version: 1",
			"sources:",
			"  - source_id: eval-book",
			"    title: 评测教材",
			"    edition: 第1版",
			"    collection: kinesiology",
			"    tier: primary",
			"    status: candidate",
			"    file: sources/book.pdf",
			`    checksum: ${checksum}`,
			"    license: Private test fixture",
			"    expected_pages: 4",
			"    book_page_offset: 0",
			"    content_start_pdf_page: 1",
			"    content_end_pdf_page: 4",
			"    header_lines: []",
		].join("\n"),
		"utf-8",
	);
}

function suiteYaml(minRecall = 1): string {
	return [
		"version: 1",
		"source_id: eval-book",
		"thresholds:",
		"  k: 2",
		`  min_recall_at_k: ${minRecall}`,
		"  min_mrr: 1",
		"  category_min_recall_at_k:",
		"    exact_term: 1",
		"    concept: 1",
		"    short: 1",
		"    visual: 1",
		"queries:",
		"  - category: exact_term",
		"    query: 肩胛肱骨节律",
		"    relevant_page_ids: [eval-book:pdf:0002]",
		"  - category: concept",
		"    query: 肩胛骨与肱骨",
		"    relevant_page_ids: [eval-book:pdf:0002]",
		"  - category: short",
		"    query: 髋",
		"    relevant_page_ids: [eval-book:pdf:0004]",
		"  - category: visual",
		"    query: 肌肉长度张力曲线图",
		"    relevant_page_ids: [eval-book:pdf:0003]",
	].join("\n");
}

describe("knowledge retrieval eval", () => {
	const workspaces: string[] = [];

	afterEach(() => {
		for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
		workspaces.length = 0;
	});

	it("runs the real SQLite store and writes a passing layered report", async () => {
		const workspace = join(tmpdir(), `fitclaw-knowledge-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		workspaces.push(workspace);
		writeWorkspace(workspace);
		const paths = createKnowledgePaths(workspace);
		await ingestKnowledgeSource({ paths, sourceId: "eval-book", extractor: new FakePdfExtractor() });
		const casesPath = join(workspace, "cases.yaml");
		writeFileSync(casesPath, suiteYaml(), "utf-8");

		const report = await runKnowledgeRetrievalEval({ paths, casesPath });

		expect(report.status).toBe("passed");
		expect(report.metrics).toMatchObject({ queryCount: 4, recallAtK: 1, mrr: 1 });
		expect(report.metrics.byCategory.visual.recallAtK).toBe(1);
		expect(report.reportPath).toContain(paths.reports);
	});

	it("rejects weak or incomplete suites before they can gate rollout", () => {
		expect(() =>
			parseKnowledgeEvalSuite(suiteYaml().replace("  - category: visual", "  - category: unsupported")),
		).toThrow("must be one of");
		expect(() =>
			parseKnowledgeEvalSuite(
				suiteYaml().replace("    relevant_page_ids: [eval-book:pdf:0003]", "    relevant_page_ids: []"),
			),
		).toThrow("must contain at least one stable page ID");
	});
});
