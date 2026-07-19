/**
 * Generic Skill Data Persistence Tools (Model B).
 *
 * These tools are auto-registered by the framework for any skill that declares
 * `data:` namespaces in fitclaw.yaml. Skill authors never touch
 * this file — they just declare namespaces and the framework wires everything.
 */
import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import Schema, { type XSchema } from "typebox/schema";
import type { SkillDataStore } from "./data-store.js";
import type { SkillDataDeclaration } from "./skills.js";

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

function validateNamespaceKey(key: string): string | null {
	if (!/^[a-z][a-z0-9_]*$/.test(key)) {
		return `invalid namespace "${key}". Must match /^[a-z][a-z0-9_]*$/`;
	}
	return null;
}

function listDeclaredNamespaces(dataNamespaces: Map<string, SkillDataDeclaration>): string {
	return Array.from(dataNamespaces.keys())
		.map((k) => `"${k}"`)
		.join(", ");
}

interface SchemaIssue {
	instance_path: string;
	keyword: string;
	message: string;
}

class AppendSchemaValidationError extends Error {
	constructor(readonly issues: SchemaIssue[]) {
		super("Appended data does not match its declared schema");
	}
}

class AppendToNonArrayError extends Error {
	constructor(readonly actualType: string) {
		super("Cannot append to non-array data");
	}
}

function getSchemaIssues(schema: XSchema | undefined, data: unknown): SchemaIssue[] {
	if (schema === undefined) return [];

	const [isValid, errors] = Schema.Errors(schema, data);
	if (isValid) return [];

	return errors.slice(0, 8).map((error) => ({
		instance_path: error.instancePath,
		keyword: error.keyword,
		message: error.message,
	}));
}

function schemaValidationResult(key: string, issues: SchemaIssue[]) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					error: `data for "${key}" does not match its declared schema. Fix the listed issues and retry.`,
					issues,
				}),
			},
		],
		details: { namespace: key, error: "schema_validation", issues } as unknown as Record<string, unknown>,
	};
}

function appendToNonArrayResult(key: string, actualType: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					error: `cannot append to "${key}": current data is ${actualType}, not array. Use mode="replace" to overwrite.`,
				}),
			},
		],
		details: {
			namespace: key,
			error: "append_to_non_array",
		} as unknown as Record<string, unknown>,
	};
}

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

export function createSkillDataReadTool(
	store: SkillDataStore,
	skillName: string,
	dataNamespaces: Map<string, SkillDataDeclaration>,
): AgentTool<typeof dataReadSchema> {
	return {
		name: `data_${skillName}_read`,
		label: `Read ${skillName} Data`,
		description: `Read persisted JSON data for the ${skillName} skill. Returns the data for the given namespace, or null if it doesn't exist yet.`,
		parameters: dataReadSchema,
		async execute(_toolCallId, params) {
			const key = params.namespace;
			const namespaceError = validateNamespaceKey(key);
			if (namespaceError) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify({ error: namespaceError }) }],
					details: { namespace: key, error: "invalid_namespace" } as unknown as Record<string, unknown>,
				};
			}

			if (!dataNamespaces.has(key)) {
				const available = listDeclaredNamespaces(dataNamespaces);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `namespace "${key}" not declared in fitclaw.yaml data section. Available namespaces: [${available}]`,
							}),
						},
					],
					details: { namespace: key, error: "undeclared_namespace" } as unknown as Record<string, unknown>,
				};
			}

			const ns = resolveNamespace(skillName, key);

			try {
				const data = await store.load(ns);
				if (data === null) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									data: null,
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
	store: SkillDataStore,
	skillName: string,
	dataNamespaces: Map<string, SkillDataDeclaration>,
): AgentTool<typeof dataWriteSchema> {
	return {
		name: `data_${skillName}_write`,
		label: `Write ${skillName} Data`,
		description: `Persist JSON data for the ${skillName} skill. Declared namespaces: ${listDeclaredNamespaces(dataNamespaces)}. Use mode="replace" to overwrite (default for object namespaces) or mode="append" to add to an array (default for array namespaces). Schema-declared namespaces reject invalid data before saving.`,
		parameters: dataWriteSchema,
		async execute(_toolCallId, params) {
			const key = params.namespace;
			const namespaceError = validateNamespaceKey(key);
			if (namespaceError) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify({ error: namespaceError }) }],
					details: { namespace: key, error: "invalid_namespace" } as unknown as Record<string, unknown>,
				};
			}

			// Validate namespace declaration (write is strict)
			const decl = dataNamespaces.get(key);
			if (!decl) {
				const available = listDeclaredNamespaces(dataNamespaces);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `namespace "${key}" not declared in fitclaw.yaml data section. Available namespaces: [${available}]`,
							}),
						},
					],
					details: { namespace: key, error: "undeclared_namespace" } as unknown as Record<string, unknown>,
				};
			}

			const ns = resolveNamespace(skillName, key);

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
					const issues = getSchemaIssues(decl.schema, params.data);
					if (issues.length > 0) return schemaValidationResult(key, issues);

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

				// Append mode must read and merge while holding the store's cross-process lock.
				const nextData = await store.update<unknown[]>(ns, (existing) => {
					if (existing !== null && !Array.isArray(existing)) {
						throw new AppendToNonArrayError(typeof existing);
					}
					const next = [...(existing ?? []), params.data];
					const issues = getSchemaIssues(decl.schema, next);
					if (issues.length > 0) throw new AppendSchemaValidationError(issues);
					return next;
				});
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								namespace: key,
								mode: "append",
								newLength: nextData.length,
							}),
						},
					],
					details: {
						namespace: key,
						mode: "append",
						newLength: nextData.length,
					} as unknown as Record<string, unknown>,
				};
			} catch (error) {
				if (error instanceof AppendSchemaValidationError) return schemaValidationResult(key, error.issues);
				if (error instanceof AppendToNonArrayError) return appendToNonArrayResult(key, error.actualType);
				const message = error instanceof Error ? error.message : String(error);
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
