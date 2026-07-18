import { resolve } from "node:path";
import { ingestKnowledgeSource, validateKnowledgeSource } from "./ingest.js";
import { createKnowledgePaths } from "./paths.js";

interface KnowledgeCliArgs {
	action: "ingest" | "validate";
	sourceId: string;
	workspacePath: string;
}

function optionValue(args: readonly string[], name: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${name}=`));
	if (inline) return inline.slice(name.length + 1);
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function parseKnowledgeCliArgs(args: readonly string[]): KnowledgeCliArgs {
	const action = args[0];
	if (action !== "ingest" && action !== "validate") {
		throw new Error("Usage: fitclaw-coach knowledge <ingest|validate> --source <source-id> [--workspace <path>]");
	}
	const sourceId = optionValue(args, "--source");
	if (!sourceId) throw new Error("Missing required option: --source <source-id>");
	const workspacePath = resolve(
		optionValue(args, "--workspace") ?? process.env.FITCLAW_WORKSPACE ?? resolve(process.cwd(), "feishu-workspace"),
	);
	return { action, sourceId, workspacePath };
}

export async function runKnowledgeCli(args: readonly string[]): Promise<void> {
	const parsed = parseKnowledgeCliArgs(args);
	const paths = createKnowledgePaths(parsed.workspacePath);
	const report =
		parsed.action === "ingest"
			? await ingestKnowledgeSource({ paths, sourceId: parsed.sourceId })
			: await validateKnowledgeSource(paths, parsed.sourceId);
	console.log(
		JSON.stringify({
			status: report.status,
			source_id: report.sourceId,
			extracted_pages: report.extractedPages,
			low_text_pages: report.lowTextPages,
		}),
	);
}
