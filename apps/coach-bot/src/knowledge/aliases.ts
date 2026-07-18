import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const MAX_ALIASES_PER_TERM = 8;
const MAX_QUERY_VARIANTS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) throw new Error(`${context} contains unsupported fields: ${unknown.join(", ")}`);
}

export function loadKnowledgeAliases(path: string, collection: string): ReadonlyMap<string, readonly string[]> {
	if (!existsSync(path)) return new Map();
	const parsed: unknown = parseYaml(readFileSync(path, "utf-8"));
	if (!isRecord(parsed)) throw new Error("aliases.yaml must be an object");
	requireOnlyKeys(parsed, ["version", "collections"], "aliases.yaml");
	if (parsed.version !== 1) throw new Error("aliases.yaml version must be 1");
	if (!isRecord(parsed.collections)) throw new Error("aliases.yaml collections must be an object");
	const rawAliases = parsed.collections[collection];
	if (rawAliases === undefined) return new Map();
	if (!isRecord(rawAliases)) throw new Error(`aliases.yaml collection "${collection}" must be an object`);

	const aliases = new Map<string, readonly string[]>();
	for (const [term, replacements] of Object.entries(rawAliases)) {
		if (!term.trim() || term !== term.normalize("NFKC")) {
			throw new Error(`aliases.yaml term "${term}" must be non-empty NFKC text`);
		}
		if (
			!Array.isArray(replacements) ||
			replacements.length === 0 ||
			replacements.length > MAX_ALIASES_PER_TERM ||
			!replacements.every(
				(replacement) =>
					typeof replacement === "string" &&
					replacement.trim().length > 0 &&
					replacement === replacement.normalize("NFKC"),
			)
		) {
			throw new Error(`aliases.yaml term "${term}" must map to 1-${MAX_ALIASES_PER_TERM} non-empty NFKC strings`);
		}
		aliases.set(term, Array.from(new Set(replacements as string[])));
	}
	return aliases;
}

export function expandKnowledgeQuery(
	query: string,
	aliases: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
	const variants = [query];
	for (const [term, replacements] of aliases) {
		const currentVariants = [...variants];
		for (const variant of currentVariants) {
			if (!variant.includes(term)) continue;
			for (const replacement of replacements) {
				const expanded = variant.replaceAll(term, replacement);
				if (!variants.includes(expanded)) variants.push(expanded);
				if (variants.length >= MAX_QUERY_VARIANTS) return variants;
			}
		}
	}
	return variants;
}
