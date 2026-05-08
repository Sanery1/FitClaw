import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";

const skillDataWriteSchema = Type.Object({
	namespace: Type.String(),
	data: Type.Any(),
	mode: Type.Optional(Type.String()),
});

const BODYBUILDING_NAMESPACES = new Set([
	"user_profile",
	"training_log",
	"training_plan",
	"body_metrics",
	"progress_events",
	"preferences",
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

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function createEvalTools(workspaceDir: string): AgentTool[] {
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

	return [dataBodybuildingWrite];
}
