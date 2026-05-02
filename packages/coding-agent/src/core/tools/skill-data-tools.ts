/**
 * Generic Skill Data Persistence Tools (Model B).
 *
 * These tools are auto-registered by the framework for any skill that declares
 * `data:` namespaces in its SKILL.md frontmatter. Skill authors never touch
 * this file — they just declare namespaces and the framework wires everything.
 */
import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { SkillDataDeclaration } from "../skills.js";
import type { FileSportDataStore } from "./fitness/sport-data-store.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const dataReadSchema = Type.Object({
	namespace: Type.String({ description: "Data namespace to read (e.g. 'user_profile')" }),
});

const dataWriteSchema = Type.Object({
	namespace: Type.String({ description: "Data namespace to write (e.g. 'training_log')" }),
	data: Type.Any({ description: "JSON data to persist" }),
	mode: Type.Optional(
		Type.String({
			description:
				"'replace' to overwrite entire namespace, 'append' to add to end of array. Default: 'replace' for object namespaces, 'append' for array namespaces.",
		}),
	),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNamespace(skillName: string, key: string): string {
	return `${skillName}/${key}`;
}

function listDeclaredNamespaces(dataNamespaces: Map<string, SkillDataDeclaration>): string {
	return Array.from(dataNamespaces.keys())
		.map((k) => `"${k}"`)
		.join(", ");
}

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

export function createSkillDataReadTool(
	store: FileSportDataStore,
	skillName: string,
	dataNamespaces: Map<string, SkillDataDeclaration>,
): AgentTool<typeof dataReadSchema> {
	return {
		name: `data:${skillName}:read`,
		label: `Read ${skillName} Data`,
		description: `Read persisted JSON data for the ${skillName} skill. Returns the data for the given namespace, or null if it doesn't exist yet.`,
		parameters: dataReadSchema,
		async execute(_toolCallId, params) {
			const key = params.namespace;
			const ns = resolveNamespace(skillName, key);

			const isDeclared = dataNamespaces.has(key);

			try {
				const data = await store.load(ns);
				if (data === null) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									data: null,
									...(isDeclared
										? {}
										: { warning: `namespace "${key}" not declared in SKILL.md data: section` }),
								}),
							},
						],
						details: { namespace: key, data: null } as unknown as Record<string, unknown>,
					};
				}

				return {
					content: [{ type: "text" as const, text: JSON.stringify({ data }) }],
					details: { namespace: key, data } as unknown as Record<string, unknown>,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Failed to read "${key}": ${message}`,
							}),
						},
					],
					details: { namespace: key, error: message } as unknown as Record<string, unknown>,
				};
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Write tool
// ---------------------------------------------------------------------------

export function createSkillDataWriteTool(
	store: FileSportDataStore,
	skillName: string,
	dataNamespaces: Map<string, SkillDataDeclaration>,
): AgentTool<typeof dataWriteSchema> {
	return {
		name: `data:${skillName}:write`,
		label: `Write ${skillName} Data`,
		description: `Persist JSON data for the ${skillName} skill. Declared namespaces: ${listDeclaredNamespaces(dataNamespaces)}. Use mode="replace" to overwrite (default for object namespaces) or mode="append" to add to an array (default for array namespaces).`,
		parameters: dataWriteSchema,
		async execute(_toolCallId, params) {
			const key = params.namespace;
			const ns = resolveNamespace(skillName, key);

			// Validate namespace declaration (write is strict)
			const decl = dataNamespaces.get(key);
			if (!decl) {
				const available = listDeclaredNamespaces(dataNamespaces);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `namespace "${key}" not declared in SKILL.md data: section. Available namespaces: [${available}]`,
							}),
						},
					],
					details: { namespace: key, error: "undeclared_namespace" } as unknown as Record<string, unknown>,
				};
			}

			// Determine effective mode
			const defaultMode = decl.type === "array" ? "append" : "replace";
			const rawMode = params.mode as string | undefined;
			let mode: "replace" | "append";
			if (rawMode === "replace" || rawMode === "append") {
				mode = rawMode;
			} else if (rawMode !== undefined && rawMode !== null && rawMode !== "") {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `invalid mode "${rawMode}". Must be "replace" or "append".`,
							}),
						},
					],
					details: { namespace: key, error: "invalid_mode" } as unknown as Record<string, unknown>,
				};
			} else {
				mode = defaultMode;
			}

			try {
				if (mode === "replace") {
					await store.save(ns, params.data);
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({ success: true, namespace: key, mode: "replace" }),
							},
						],
						details: { namespace: key, mode: "replace" } as unknown as Record<string, unknown>,
					};
				}

				// Append mode
				const existing = await store.load<unknown[]>(ns);
				if (existing === null) {
					// No existing data, create new array
					await store.save(ns, [params.data]);
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({ success: true, namespace: key, mode: "append", newLength: 1 }),
							},
						],
						details: { namespace: key, mode: "append", newLength: 1 } as unknown as Record<string, unknown>,
					};
				}

				if (!Array.isArray(existing)) {
					// Auto-downgrade: cannot append to non-array
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: `cannot append to "${key}": current data is ${typeof existing}, not array. Use mode="replace" to overwrite.`,
								}),
							},
						],
						details: {
							namespace: key,
							error: "append_to_non_array",
						} as unknown as Record<string, unknown>,
					};
				}

				existing.push(params.data);
				await store.save(ns, existing);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								namespace: key,
								mode: "append",
								newLength: existing.length,
							}),
						},
					],
					details: {
						namespace: key,
						mode: "append",
						newLength: existing.length,
					} as unknown as Record<string, unknown>,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Failed to write "${key}": ${message}`,
							}),
						},
					],
					details: { namespace: key, error: message } as unknown as Record<string, unknown>,
				};
			}
		},
	};
}
