import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runKnowledgeRetrievalEval } from "./eval.js";
import { ingestKnowledgeSource, validateKnowledgeSource } from "./ingest.js";
import { createKnowledgePaths } from "./paths.js";

interface KnowledgeCliArgs {
	action: "eval" | "ingest" | "validate";
	sourceId?: string;
	workspacePath: string;
	casesPath?: string;
}

function optionValue(args: readonly string[], name: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${name}=`));
	if (inline) return inline.slice(name.length + 1);
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function parseKnowledgeCliArgs(args: readonly string[]): KnowledgeCliArgs {
	const action = args[0];
	if (action !== "ingest" && action !== "validate" && action !== "eval") {
		throw new Error(
			"Usage: fitclaw-coach knowledge <ingest|validate|eval> [--source <source-id>] [--workspace <path>] [--cases <path>]",
		);
	}
	const sourceId = optionValue(args, "--source");
	if (action !== "eval" && !sourceId) throw new Error("Missing required option: --source <source-id>");
	const workspacePath = resolve(
		optionValue(args, "--workspace") ?? process.env.FITCLAW_WORKSPACE ?? resolve(process.cwd(), "feishu-workspace"),
	);
	const casesPath = optionValue(args, "--cases");
	return { action, sourceId, workspacePath, casesPath: casesPath ? resolve(casesPath) : undefined };
}

function defaultEvalCasesPath(): string {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(moduleDir, "..", "..", "evals", "knowledge-smoke.yaml"),
		resolve(moduleDir, "..", "evals", "knowledge-smoke.yaml"),
	];
	const path = candidates.find(existsSync);
	if (!path) throw new Error("Default knowledge eval cases are unavailable; pass --cases <path>");
	return path;
}

export async function runKnowledgeCli(args: readonly string[]): Promise<void> {
	const parsed = parseKnowledgeCliArgs(args);
	const paths = createKnowledgePaths(parsed.workspacePath);
	if (parsed.action === "eval") {
		const report = await runKnowledgeRetrievalEval({
			paths,
			casesPath: parsed.casesPath ?? defaultEvalCasesPath(),
			expectedSourceId: parsed.sourceId,
		});
		console.log(
			JSON.stringify({
				status: report.status,
				source_id: report.sourceId,
				recall_at_k: report.metrics.recallAtK,
				mrr: report.metrics.mrr,
				report: report.reportPath,
			}),
		);
		if (report.status === "failed") throw new Error("Knowledge retrieval eval did not meet its rollout thresholds");
		return;
	}
	const sourceId = parsed.sourceId;
	if (!sourceId) throw new Error("Missing required option: --source <source-id>");
	const report =
		parsed.action === "ingest"
			? await ingestKnowledgeSource({ paths, sourceId })
			: await validateKnowledgeSource(paths, sourceId);
	console.log(
		JSON.stringify({
			status: report.status,
			source_id: report.sourceId,
			extracted_pages: report.extractedPages,
			low_text_pages: report.lowTextPages,
		}),
	);
}
