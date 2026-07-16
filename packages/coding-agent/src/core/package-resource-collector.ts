import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import { canonicalizePath } from "../utils/paths.js";
import {
	applyPatterns,
	collectAncestorAgentsSkillDirs,
	collectAutoExtensionEntries,
	collectAutoPromptEntries,
	collectAutoSkillEntries,
	collectAutoThemeEntries,
	collectResourceFiles,
	type FitClawManifest,
	getHomeDir,
	hasGlobPattern,
	isEnabledByOverrides,
	isOverridePattern,
	type PackageFilter,
	RESOURCE_TYPES,
	type ResourceType,
	splitPatterns,
} from "./package-resource-discovery.js";
import type { PackageSourceResolver, SourceScope } from "./package-source-resolver.js";

export interface PathMetadata {
	source: string;
	scope: SourceScope;
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface ResolvedResource {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
}

export interface ResolvedPaths {
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
	themes: ResolvedResource[];
}

export interface ResourceAccumulator {
	extensions: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	skills: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	prompts: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	themes: Map<string, { metadata: PathMetadata; enabled: boolean }>;
}

interface ResourceSettings {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

interface PackageResourceCollectorOptions {
	cwd: string;
	sourceResolver: PackageSourceResolver;
}

function resourcePrecedenceRank(metadata: PathMetadata): number {
	// Explicit project resources precede auto-discovery, then user resources, then packages.
	if (metadata.origin === "package") return 4;
	const scopeBase = metadata.scope === "project" ? 0 : 2;
	return scopeBase + (metadata.source === "local" ? 0 : 1);
}

export class PackageResourceCollector {
	constructor(private readonly options: PackageResourceCollectorOptions) {}

	createAccumulator(): ResourceAccumulator {
		return {
			extensions: new Map(),
			skills: new Map(),
			prompts: new Map(),
			themes: new Map(),
		};
	}

	getTargetMap(
		accumulator: ResourceAccumulator,
		resourceType: ResourceType,
	): Map<string, { metadata: PathMetadata; enabled: boolean }> {
		switch (resourceType) {
			case "extensions":
				return accumulator.extensions;
			case "skills":
				return accumulator.skills;
			case "prompts":
				return accumulator.prompts;
			case "themes":
				return accumulator.themes;
			default:
				throw new Error(`Unknown resource type: ${resourceType}`);
		}
	}

	addResource(
		map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		path: string,
		metadata: PathMetadata,
		enabled: boolean,
	): void {
		if (!path) return;
		if (!map.has(path)) {
			map.set(path, { metadata, enabled });
		}
	}

	collectPackageResources(
		packageRoot: string,
		accumulator: ResourceAccumulator,
		filter: PackageFilter | undefined,
		metadata: PathMetadata,
	): boolean {
		if (filter) {
			for (const resourceType of RESOURCE_TYPES) {
				const patterns = filter[resourceType as keyof PackageFilter];
				const target = this.getTargetMap(accumulator, resourceType);
				if (patterns !== undefined) {
					this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
				} else {
					this.collectDefaultResources(packageRoot, resourceType, target, metadata);
				}
			}
			return true;
		}

		const manifest = this.readFitClawManifest(packageRoot);
		if (manifest) {
			for (const resourceType of RESOURCE_TYPES) {
				const entries = manifest[resourceType as keyof FitClawManifest];
				this.addManifestEntries(
					entries,
					packageRoot,
					resourceType,
					this.getTargetMap(accumulator, resourceType),
					metadata,
				);
			}
			return true;
		}

		let hasAnyDir = false;
		for (const resourceType of RESOURCE_TYPES) {
			const dir = join(packageRoot, resourceType);
			if (existsSync(dir)) {
				const files = collectResourceFiles(dir, resourceType);
				for (const file of files) {
					this.addResource(this.getTargetMap(accumulator, resourceType), file, metadata, true);
				}
				hasAnyDir = true;
			}
		}
		return hasAnyDir;
	}

	resolveLocalEntries(
		entries: string[],
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
		baseDir: string,
	): void {
		if (entries.length === 0) return;

		const { plain, patterns } = splitPatterns(entries);
		const resolvedPlain = plain.map((path) => this.options.sourceResolver.resolvePathFromBase(path, baseDir));
		const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);
		const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

		for (const file of allFiles) {
			this.addResource(target, file, metadata, enabledPaths.has(file));
		}
	}

	addAutoDiscoveredResources(
		accumulator: ResourceAccumulator,
		globalSettings: ResourceSettings,
		projectSettings: ResourceSettings,
		globalBaseDir: string,
		projectBaseDir: string,
	): void {
		const userMetadata: PathMetadata = {
			source: "auto",
			scope: "user",
			origin: "top-level",
			baseDir: globalBaseDir,
		};
		const projectMetadata: PathMetadata = {
			source: "auto",
			scope: "project",
			origin: "top-level",
			baseDir: projectBaseDir,
		};

		const userOverrides = {
			extensions: globalSettings.extensions ?? [],
			skills: globalSettings.skills ?? [],
			prompts: globalSettings.prompts ?? [],
			themes: globalSettings.themes ?? [],
		};
		const projectOverrides = {
			extensions: projectSettings.extensions ?? [],
			skills: projectSettings.skills ?? [],
			prompts: projectSettings.prompts ?? [],
			themes: projectSettings.themes ?? [],
		};

		const userDirs = {
			extensions: join(globalBaseDir, "extensions"),
			skills: join(globalBaseDir, "skills"),
			prompts: join(globalBaseDir, "prompts"),
			themes: join(globalBaseDir, "themes"),
		};
		const projectDirs = {
			extensions: join(projectBaseDir, "extensions"),
			skills: join(projectBaseDir, "skills"),
			prompts: join(projectBaseDir, "prompts"),
			themes: join(projectBaseDir, "themes"),
		};
		const userAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
		const projectAgentsSkillDirs = collectAncestorAgentsSkillDirs(this.options.cwd).filter(
			(dir) => resolve(dir) !== resolve(userAgentsSkillsDir),
		);

		const addResources = (
			resourceType: ResourceType,
			paths: string[],
			metadata: PathMetadata,
			overrides: string[],
			baseDir: string,
		) => {
			const target = this.getTargetMap(accumulator, resourceType);
			for (const path of paths) {
				const enabled = isEnabledByOverrides(path, overrides, baseDir);
				this.addResource(target, path, metadata, enabled);
			}
		};

		addResources(
			"extensions",
			collectAutoExtensionEntries(projectDirs.extensions),
			projectMetadata,
			projectOverrides.extensions,
			projectBaseDir,
		);
		addResources(
			"skills",
			[
				...collectAutoSkillEntries(projectDirs.skills, "fitclaw"),
				...projectAgentsSkillDirs.flatMap((dir) => collectAutoSkillEntries(dir, "agents")),
			],
			projectMetadata,
			projectOverrides.skills,
			projectBaseDir,
		);
		addResources(
			"prompts",
			collectAutoPromptEntries(projectDirs.prompts),
			projectMetadata,
			projectOverrides.prompts,
			projectBaseDir,
		);
		addResources(
			"themes",
			collectAutoThemeEntries(projectDirs.themes),
			projectMetadata,
			projectOverrides.themes,
			projectBaseDir,
		);

		addResources(
			"extensions",
			collectAutoExtensionEntries(userDirs.extensions),
			userMetadata,
			userOverrides.extensions,
			globalBaseDir,
		);
		addResources(
			"skills",
			[
				...collectAutoSkillEntries(userDirs.skills, "fitclaw"),
				...collectAutoSkillEntries(userAgentsSkillsDir, "agents"),
			],
			userMetadata,
			userOverrides.skills,
			globalBaseDir,
		);
		addResources(
			"prompts",
			collectAutoPromptEntries(userDirs.prompts),
			userMetadata,
			userOverrides.prompts,
			globalBaseDir,
		);
		addResources(
			"themes",
			collectAutoThemeEntries(userDirs.themes),
			userMetadata,
			userOverrides.themes,
			globalBaseDir,
		);
	}

	toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
		const mapToResolved = (
			entries: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		): ResolvedResource[] => {
			const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
				path,
				enabled,
				metadata,
			}));
			resolved.sort((left, right) => resourcePrecedenceRank(left.metadata) - resourcePrecedenceRank(right.metadata));

			const seen = new Set<string>();
			return resolved.filter((entry) => {
				const canonicalPath = canonicalizePath(entry.path);
				if (seen.has(canonicalPath)) return false;
				seen.add(canonicalPath);
				return true;
			});
		};

		return {
			extensions: mapToResolved(accumulator.extensions),
			skills: mapToResolved(accumulator.skills),
			prompts: mapToResolved(accumulator.prompts),
			themes: mapToResolved(accumulator.themes),
		};
	}

	private collectDefaultResources(
		packageRoot: string,
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		const manifest = this.readFitClawManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof FitClawManifest];
		if (entries) {
			this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
			return;
		}
		const dir = join(packageRoot, resourceType);
		if (existsSync(dir)) {
			const files = collectResourceFiles(dir, resourceType);
			for (const file of files) {
				this.addResource(target, file, metadata, true);
			}
		}
	}

	private applyPackageFilter(
		packageRoot: string,
		userPatterns: string[],
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);

		if (userPatterns.length === 0) {
			for (const file of allFiles) {
				this.addResource(target, file, metadata, false);
			}
			return;
		}

		const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);
		for (const file of allFiles) {
			this.addResource(target, file, metadata, enabledByUser.has(file));
		}
	}

	private collectManifestFiles(
		packageRoot: string,
		resourceType: ResourceType,
	): { allFiles: string[]; enabledByManifest: Set<string> } {
		const manifest = this.readFitClawManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof FitClawManifest];
		if (entries && entries.length > 0) {
			const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
			const manifestPatterns = entries.filter(isOverridePattern);
			const enabledByManifest =
				manifestPatterns.length > 0 ? applyPatterns(allFiles, manifestPatterns, packageRoot) : new Set(allFiles);
			return { allFiles: Array.from(enabledByManifest), enabledByManifest };
		}

		const conventionDir = join(packageRoot, resourceType);
		if (!existsSync(conventionDir)) {
			return { allFiles: [], enabledByManifest: new Set() };
		}
		const allFiles = collectResourceFiles(conventionDir, resourceType);
		return { allFiles, enabledByManifest: new Set(allFiles) };
	}

	private readFitClawManifest(packageRoot: string): FitClawManifest | null {
		const packageJsonPath = join(packageRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			return null;
		}

		try {
			const content = readFileSync(packageJsonPath, "utf-8");
			const pkg = JSON.parse(content) as { fitclaw?: FitClawManifest };
			return pkg.fitclaw ?? null;
		} catch {
			return null;
		}
	}

	private addManifestEntries(
		entries: string[] | undefined,
		root: string,
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		if (!entries) return;

		const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
		const patterns = entries.filter(isOverridePattern);
		const enabledPaths = applyPatterns(allFiles, patterns, root);

		for (const file of allFiles) {
			if (enabledPaths.has(file)) {
				this.addResource(target, file, metadata, true);
			}
		}
	}

	private collectFilesFromManifestEntries(entries: string[], root: string, resourceType: ResourceType): string[] {
		const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
		const resolved = sourceEntries.flatMap((entry) => {
			if (!hasGlobPattern(entry)) {
				return [resolve(root, entry)];
			}

			return globSync(entry, {
				cwd: root,
				absolute: true,
				dot: false,
				nodir: false,
			}).map((match) => resolve(match));
		});
		return this.collectFilesFromPaths(resolved, resourceType);
	}

	private collectFilesFromPaths(paths: string[], resourceType: ResourceType): string[] {
		const files: string[] = [];
		for (const path of paths) {
			if (!existsSync(path)) continue;

			try {
				const stats = statSync(path);
				if (stats.isFile()) {
					files.push(path);
				} else if (stats.isDirectory()) {
					files.push(...collectResourceFiles(path, resourceType));
				}
			} catch {
				// Preserve discovery behavior when an entry disappears during collection.
			}
		}
		return files;
	}
}
