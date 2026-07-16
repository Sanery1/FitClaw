import { join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../config.js";
import { type GitSource, parseGitUrl } from "../utils/git.js";
import { isLocalPath } from "../utils/paths.js";
import { getHomeDir } from "./package-resource-discovery.js";
import type { PackageSource } from "./settings-manager.js";

export type SourceScope = "user" | "project" | "temporary";

export type NpmSource = {
	type: "npm";
	spec: string;
	name: string;
	pinned: boolean;
};

export type LocalSource = {
	type: "local";
	path: string;
};

export type ParsedSource = NpmSource | GitSource | LocalSource;

interface PackageSourceResolverOptions {
	cwd: string;
	agentDir: string;
}

export class PackageSourceResolver {
	constructor(private readonly options: PackageSourceResolverOptions) {}

	parse(source: string): ParsedSource {
		if (source.startsWith("npm:")) {
			const spec = source.slice("npm:".length).trim();
			const { name, version } = this.parseNpmSpec(spec);
			return {
				type: "npm",
				spec,
				name,
				pinned: Boolean(version),
			};
		}

		if (isLocalPath(source)) {
			return { type: "local", path: source };
		}

		const gitParsed = parseGitUrl(source);
		if (gitParsed) {
			return gitParsed;
		}

		return { type: "local", path: source };
	}

	parseNpmSpec(spec: string): { name: string; version?: string } {
		const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
		if (!match) {
			return { name: spec };
		}
		const name = match[1] ?? spec;
		const version = match[2];
		return { name, version };
	}

	getSourceString(pkg: PackageSource): string {
		return typeof pkg === "string" ? pkg : pkg.source;
	}

	matches(existing: PackageSource, inputSource: string, scope: SourceScope): boolean {
		const left = this.getSourceMatchKeyForSettings(this.getSourceString(existing), scope);
		const right = this.getSourceMatchKeyForInput(inputSource);
		return left === right;
	}

	normalizeForSettings(source: string, scope: SourceScope): string {
		const parsed = this.parse(source);
		if (parsed.type !== "local") {
			return source;
		}
		const baseDir = this.getBaseDir(scope);
		const resolved = this.resolvePath(parsed.path);
		const relativePath = relative(baseDir, resolved);
		return relativePath || ".";
	}

	buildNoMatchingPackageMessage(source: string, configuredPackages: PackageSource[]): string {
		const suggestion = this.findSuggestedConfiguredSource(source, configuredPackages);
		if (!suggestion) {
			return `No matching package found for ${source}`;
		}
		return `No matching package found for ${source}. Did you mean ${suggestion}?`;
	}

	getIdentity(source: string, scope?: SourceScope): string {
		const parsed = this.parse(source);
		if (parsed.type === "npm") {
			return `npm:${parsed.name}`;
		}
		if (parsed.type === "git") {
			return `git:${parsed.host}/${parsed.path}`;
		}
		if (scope) {
			const baseDir = this.getBaseDir(scope);
			return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
		}
		return `local:${this.resolvePath(parsed.path)}`;
	}

	dedupe(
		packages: Array<{ pkg: PackageSource; scope: SourceScope }>,
	): Array<{ pkg: PackageSource; scope: SourceScope }> {
		const seen = new Map<string, { pkg: PackageSource; scope: SourceScope }>();

		for (const entry of packages) {
			const source = this.getSourceString(entry.pkg);
			const identity = this.getIdentity(source, entry.scope);

			const existing = seen.get(identity);
			if (!existing) {
				seen.set(identity, entry);
			} else if (entry.scope === "project" && existing.scope === "user") {
				seen.set(identity, entry);
			}
		}

		return Array.from(seen.values());
	}

	getBaseDir(scope: SourceScope): string {
		if (scope === "project") {
			return join(this.options.cwd, CONFIG_DIR_NAME);
		}
		if (scope === "user") {
			return this.options.agentDir;
		}
		return this.options.cwd;
	}

	resolvePath(input: string): string {
		return this.resolvePathFromBase(input, this.options.cwd);
	}

	resolvePathFromBase(input: string, baseDir: string): string {
		const trimmed = input.trim();
		if (trimmed === "~") return getHomeDir();
		if (trimmed.startsWith("~/")) return join(getHomeDir(), trimmed.slice(2));
		if (trimmed.startsWith("~")) return join(getHomeDir(), trimmed.slice(1));
		return resolve(baseDir, trimmed);
	}

	private getSourceMatchKeyForInput(source: string): string {
		const parsed = this.parse(source);
		if (parsed.type === "npm") {
			return `npm:${parsed.name}`;
		}
		if (parsed.type === "git") {
			return `git:${parsed.host}/${parsed.path}`;
		}
		return `local:${this.resolvePath(parsed.path)}`;
	}

	private getSourceMatchKeyForSettings(source: string, scope: SourceScope): string {
		const parsed = this.parse(source);
		if (parsed.type === "npm") {
			return `npm:${parsed.name}`;
		}
		if (parsed.type === "git") {
			return `git:${parsed.host}/${parsed.path}`;
		}
		const baseDir = this.getBaseDir(scope);
		return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
	}

	private findSuggestedConfiguredSource(source: string, configuredPackages: PackageSource[]): string | undefined {
		const trimmedSource = source.trim();
		const suggestions = new Set<string>();

		for (const pkg of configuredPackages) {
			const sourceString = this.getSourceString(pkg);
			const parsed = this.parse(sourceString);
			if (parsed.type === "npm") {
				if (trimmedSource === parsed.name || trimmedSource === parsed.spec) {
					suggestions.add(sourceString);
				}
				continue;
			}
			if (parsed.type === "git") {
				const shorthand = `${parsed.host}/${parsed.path}`;
				const shorthandWithRef = parsed.ref ? `${shorthand}@${parsed.ref}` : undefined;
				if (trimmedSource === shorthand || (shorthandWithRef && trimmedSource === shorthandWithRef)) {
					suggestions.add(sourceString);
				}
			}
		}

		return suggestions.values().next().value;
	}
}
