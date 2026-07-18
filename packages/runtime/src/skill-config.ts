import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import Schema, { IsSchema, type XSchema } from "typebox/schema";
import { parse as parseYaml } from "yaml";
import type { ResourceDiagnostic } from "./resource.js";
import type { SkillDataDeclaration, SkillPermissions } from "./skills.js";

const CONFIG_FILE_NAME = "fitclaw.yaml";
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*$/;
const COLLECTION_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface SkillConfig {
	dataNamespaces?: Map<string, SkillDataDeclaration>;
	permissions?: SkillPermissions;
	knowledgeCollections?: readonly string[];
}

export interface SkillConfigResult {
	config: SkillConfig | null;
	diagnostics: ResourceDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizePath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function addUnknownKeyDiagnostics(
	value: Record<string, unknown>,
	allowedKeys: readonly string[],
	prefix: string,
	path: string,
	diagnostics: ResourceDiagnostic[],
): void {
	const allowed = new Set(allowedKeys);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			diagnostics.push({ type: "warning", message: `${prefix}${key} is not supported`, path });
		}
	}
}

function parseData(
	value: unknown,
	path: string,
	diagnostics: ResourceDiagnostic[],
): Map<string, SkillDataDeclaration> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push({ type: "warning", message: "data must be an object", path });
		return undefined;
	}

	const namespaces = new Map<string, SkillDataDeclaration>();
	for (const [key, declaration] of Object.entries(value)) {
		if (!NAMESPACE_PATTERN.test(key)) {
			diagnostics.push({
				type: "warning",
				message: `data namespace key "${key}" must match [a-z][a-z0-9_]*`,
				path,
			});
			continue;
		}
		if (!isRecord(declaration)) {
			diagnostics.push({ type: "warning", message: `data.${key} must be an object`, path });
			continue;
		}

		addUnknownKeyDiagnostics(declaration, ["type", "schema"], `data.${key}.`, path, diagnostics);
		if (declaration.type !== undefined && declaration.type !== "object" && declaration.type !== "array") {
			diagnostics.push({
				type: "warning",
				message: `data.${key}.type must be "object" or "array"`,
				path,
			});
			continue;
		}

		const type = declaration.type === "array" ? "array" : "object";
		const schema = declaration.schema;
		if (schema === undefined) {
			namespaces.set(key, { type });
			continue;
		}
		if (!IsSchema(schema)) {
			diagnostics.push({
				type: "warning",
				message: `data namespace "${key}" schema must be a JSON Schema object or boolean`,
				path,
			});
			continue;
		}

		const rootType = typeof schema === "object" && "type" in schema ? schema.type : undefined;
		if (typeof rootType === "string" && rootType !== type) {
			diagnostics.push({
				type: "warning",
				message: `data namespace "${key}" schema type "${rootType}" must match declaration type "${type}"`,
				path,
			});
			continue;
		}

		try {
			Schema.Compile(schema);
			namespaces.set(key, { type, schema: schema as XSchema });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			diagnostics.push({
				type: "warning",
				message: `data namespace "${key}" schema could not be compiled: ${message}`,
				path,
			});
		}
	}

	return namespaces.size > 0 ? namespaces : undefined;
}

function parsePermissions(
	value: unknown,
	skillDir: string,
	path: string,
	diagnostics: ResourceDiagnostic[],
): SkillPermissions | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push({ type: "warning", message: "permissions must be an object", path });
		return undefined;
	}
	addUnknownKeyDiagnostics(value, ["network", "commands"], "permissions.", path, diagnostics);
	if (value.network !== false) {
		diagnostics.push({
			type: "warning",
			message: "permissions.network must be false; network-enabled Skill commands are not supported",
			path,
		});
		return undefined;
	}
	if (value.commands === undefined) return { network: false };
	if (!isRecord(value.commands)) {
		diagnostics.push({ type: "warning", message: "permissions.commands must be an object", path });
		return undefined;
	}
	addUnknownKeyDiagnostics(value.commands, ["allow"], "permissions.commands.", path, diagnostics);
	if (!Array.isArray(value.commands.allow)) {
		diagnostics.push({ type: "warning", message: "permissions.commands.allow must be an array", path });
		return undefined;
	}

	const allow: Array<{ executable: string; args: readonly string[] }> = [];
	for (const [index, entry] of value.commands.allow.entries()) {
		const prefix = `permissions.commands.allow[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push({ type: "warning", message: `${prefix} must be an object`, path });
			continue;
		}
		addUnknownKeyDiagnostics(entry, ["executable", "args"], `${prefix}.`, path, diagnostics);
		if (typeof entry.executable !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.executable)) {
			diagnostics.push({
				type: "warning",
				message: `${prefix}.executable must be a command name without a path`,
				path,
			});
			continue;
		}
		if (
			!Array.isArray(entry.args) ||
			entry.args.length === 0 ||
			!entry.args.every(
				(argument) => typeof argument === "string" && argument.length > 0 && !argument.includes("\0"),
			)
		) {
			diagnostics.push({ type: "warning", message: `${prefix}.args must be a non-empty string array`, path });
			continue;
		}

		const args = entry.args as string[];
		const targetPath = resolve(skillDir, args[0]);
		const relativeTarget = relative(canonicalizePath(skillDir), canonicalizePath(targetPath));
		let isFile = false;
		try {
			isFile = statSync(targetPath).isFile();
		} catch {}
		if (isAbsolute(args[0]) || relativeTarget.startsWith("..") || isAbsolute(relativeTarget) || !isFile) {
			diagnostics.push({
				type: "warning",
				message: `${prefix}.args[0] must reference a file inside the Skill directory`,
				path,
			});
			continue;
		}
		allow.push({ executable: entry.executable, args: [...args] });
	}

	return allow.length > 0 ? { network: false, commands: { allow } } : { network: false };
}

function parseKnowledge(
	value: unknown,
	path: string,
	diagnostics: ResourceDiagnostic[],
): readonly string[] | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push({ type: "warning", message: "knowledge must be an object", path });
		return undefined;
	}
	addUnknownKeyDiagnostics(value, ["collections"], "knowledge.", path, diagnostics);
	if (!Array.isArray(value.collections) || value.collections.length === 0) {
		diagnostics.push({ type: "warning", message: "knowledge.collections must be a non-empty array", path });
		return undefined;
	}
	if (!value.collections.every((entry) => typeof entry === "string" && COLLECTION_PATTERN.test(entry))) {
		diagnostics.push({
			type: "warning",
			message: "knowledge.collections entries must match [a-z][a-z0-9-]*",
			path,
		});
		return undefined;
	}
	return Array.from(new Set(value.collections as string[]));
}

export function loadSkillConfig(skillDir: string): SkillConfigResult {
	const path = join(skillDir, CONFIG_FILE_NAME);
	if (!existsSync(path)) return { config: {}, diagnostics: [] };

	const diagnostics: ResourceDiagnostic[] = [];
	try {
		const parsed: unknown = parseYaml(readFileSync(path, "utf-8"));
		if (!isRecord(parsed)) {
			return { config: null, diagnostics: [{ type: "warning", message: "fitclaw.yaml must be an object", path }] };
		}
		addUnknownKeyDiagnostics(parsed, ["version", "data", "permissions", "knowledge"], "", path, diagnostics);
		if (parsed.version !== 1) {
			diagnostics.push({ type: "warning", message: "version must be 1", path });
		}

		const config: SkillConfig = {
			dataNamespaces: parseData(parsed.data, path, diagnostics),
			permissions: parsePermissions(parsed.permissions, skillDir, path, diagnostics),
			knowledgeCollections: parseKnowledge(parsed.knowledge, path, diagnostics),
		};
		return diagnostics.length > 0 ? { config: null, diagnostics } : { config, diagnostics };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { config: null, diagnostics: [{ type: "warning", message: `invalid fitclaw.yaml: ${message}`, path }] };
	}
}
