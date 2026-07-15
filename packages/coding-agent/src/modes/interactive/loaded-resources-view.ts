import * as os from "node:os";
import * as path from "node:path";
import { type Container, Spacer, Text } from "@fitclaw/tui";
import type { ResourceDiagnostic } from "../../core/resource-loader.js";
import type { SourceInfo } from "../../core/source-info.js";
import { parseGitUrl } from "../../utils/git.js";
import { ExpandableText } from "./components/expandable-text.js";
import { type ThemeColor, theme } from "./theme/theme.js";

interface ResourceItem {
	path: string;
	sourceInfo?: SourceInfo;
}

interface ScopeGroup {
	scope: "user" | "project" | "path";
	paths: ResourceItem[];
	packages: Map<string, ResourceItem[]>;
}

export interface LoadedResourcesData {
	contextFiles: ReadonlyArray<{ path: string }>;
	skills: ReadonlyArray<{ filePath: string; name: string; sourceInfo?: SourceInfo }>;
	promptTemplates: ReadonlyArray<{ filePath: string; name: string; sourceInfo?: SourceInfo }>;
	extensions: ReadonlyArray<ResourceItem>;
	themes: ReadonlyArray<{ name?: string; sourcePath?: string; sourceInfo?: SourceInfo }>;
	skillDiagnostics: readonly ResourceDiagnostic[];
	promptDiagnostics: readonly ResourceDiagnostic[];
	extensionDiagnostics: readonly ResourceDiagnostic[];
	themeDiagnostics: readonly ResourceDiagnostic[];
}

export interface LoadedResourcesViewInput {
	chatContainer: Container;
	cwd: string;
	isVerbose: boolean;
	isExpanded: boolean;
	isQuietStartup: boolean;
	resources: LoadedResourcesData;
}

export interface LoadedResourcesDisplayOptions {
	force?: boolean;
	showDiagnosticsWhenQuiet?: boolean;
}

function formatDisplayPath(resourcePath: string): string {
	const home = os.homedir();
	if (resourcePath.startsWith(home)) {
		return `~${resourcePath.slice(home.length)}`;
	}
	return resourcePath;
}

function formatExtensionDisplayPath(resourcePath: string): string {
	return formatDisplayPath(resourcePath)
		.replace(/\/index\.ts$/, "")
		.replace(/\/index\.js$/, "");
}

function formatContextPath(cwd: string, resourcePath: string): string {
	const resolvedCwd = path.resolve(cwd);
	const absolutePath = path.isAbsolute(resourcePath)
		? path.resolve(resourcePath)
		: path.resolve(resolvedCwd, resourcePath);
	const relativePath = path.relative(resolvedCwd, absolutePath);
	const isInsideCwd =
		relativePath === "" ||
		(!relativePath.startsWith("..") && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));

	if (isInsideCwd) {
		return relativePath || ".";
	}
	return formatDisplayPath(absolutePath);
}

function isPackageSource(sourceInfo?: SourceInfo): boolean {
	const source = sourceInfo?.source ?? "";
	return source.startsWith("npm:") || source.startsWith("git:");
}

function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
	const baseDir = sourceInfo?.baseDir;
	if (baseDir && isPackageSource(sourceInfo)) {
		const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
		if (
			relativePath &&
			relativePath !== "." &&
			!relativePath.startsWith("..") &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath)
		) {
			return relativePath.replace(/\\/g, "/");
		}
	}

	const source = sourceInfo?.source ?? "";
	const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
	if (npmMatch && source.startsWith("npm:")) {
		return npmMatch[2]!;
	}

	const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
	if (gitMatch && source.startsWith("git:")) {
		return gitMatch[1]!;
	}

	return formatDisplayPath(fullPath);
}

function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	const shortPath = getShortPath(resourcePath, sourceInfo);
	const normalizedPath = shortPath.replace(/\\/g, "/");
	const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
	return segments.length > 0 ? segments[segments.length - 1]! : shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
	const source = sourceInfo?.source ?? "";
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length) || source;
	}

	const gitSource = parseGitUrl(source);
	if (gitSource) {
		return gitSource.path || source;
	}
	return source;
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (!isPackageSource(sourceInfo)) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}

	const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
	if (!sourceLabel) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}

	const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
	const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
	const parsedPath = path.posix.parse(packagePath);
	if (parsedPath.name === "index") {
		return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
	}
	return `${sourceLabel}:${packagePath}`;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
	return formatDisplayPath(resourcePath)
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactNonPackageExtensionLabel(
	resourcePath: string,
	index: number,
	allPaths: ReadonlyArray<{ path: string; segments: string[] }>,
): string {
	const segments = allPaths[index]?.segments;
	if (!segments || segments.length === 0) {
		return getCompactPathLabel(resourcePath);
	}

	for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
		const candidate = segments.slice(-segmentCount).join("/");
		const isUnique = allPaths.every((item, itemIndex) => {
			if (itemIndex === index) return true;
			return item.segments.slice(-segmentCount).join("/") !== candidate;
		});
		if (isUnique) return candidate;
	}
	return segments.join("/");
}

function getCompactExtensionLabels(extensions: ReadonlyArray<ResourceItem>): string[] {
	const nonPackageExtensions = extensions
		.map((extension) => {
			const segments = getCompactDisplayPathSegments(extension.path);
			const lastSegment = segments[segments.length - 1];
			if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
				segments.pop();
			}
			return { ...extension, segments };
		})
		.filter((extension) => !isPackageSource(extension.sourceInfo));

	return extensions.map((extension) => {
		if (isPackageSource(extension.sourceInfo)) {
			return getCompactExtensionLabel(extension.path, extension.sourceInfo);
		}
		const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
		if (nonPackageIndex === -1) {
			return getCompactPathLabel(extension.path, extension.sourceInfo);
		}
		return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
	});
}

function getDisplaySourceInfo(sourceInfo?: SourceInfo): { label: string; scopeLabel?: string } {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "local") {
		if (scope === "user") return { label: "user" };
		if (scope === "project") return { label: "project" };
		if (scope === "temporary") return { label: "path", scopeLabel: "temp" };
		return { label: "path" };
	}
	if (source === "cli") {
		return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined };
	}
	const scopeLabel =
		scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
	return { label: source, scopeLabel };
}

function getScopeGroup(sourceInfo?: SourceInfo): ScopeGroup["scope"] {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "cli" || scope === "temporary") return "path";
	if (scope === "user") return "user";
	if (scope === "project") return "project";
	return "path";
}

function buildScopeGroups(items: ReadonlyArray<ResourceItem>): ScopeGroup[] {
	const groups: Record<ScopeGroup["scope"], ScopeGroup> = {
		user: { scope: "user", paths: [], packages: new Map() },
		project: { scope: "project", paths: [], packages: new Map() },
		path: { scope: "path", paths: [], packages: new Map() },
	};

	for (const item of items) {
		const group = groups[getScopeGroup(item.sourceInfo)];
		const source = item.sourceInfo?.source ?? "local";
		if (isPackageSource(item.sourceInfo)) {
			const packageItems = group.packages.get(source) ?? [];
			packageItems.push(item);
			group.packages.set(source, packageItems);
		} else {
			group.paths.push(item);
		}
	}

	return [groups.project, groups.user, groups.path].filter(
		(group) => group.paths.length > 0 || group.packages.size > 0,
	);
}

function formatScopeGroups(
	groups: ReadonlyArray<ScopeGroup>,
	options: {
		formatPath: (item: ResourceItem) => string;
		formatPackagePath: (item: ResourceItem, source: string) => string;
	},
): string {
	const lines: string[] = [];
	for (const group of groups) {
		lines.push(`  ${theme.fg("accent", group.scope)}`);
		for (const item of [...group.paths].sort((a, b) => a.path.localeCompare(b.path))) {
			lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
		}
		for (const [source, items] of [...group.packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(`    ${theme.fg("mdLink", source)}`);
			for (const item of [...items].sort((a, b) => a.path.localeCompare(b.path))) {
				lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
			}
		}
	}
	return lines.join("\n");
}

function findSourceInfoForPath(
	resourcePath: string,
	sourceInfos: ReadonlyMap<string, SourceInfo>,
): SourceInfo | undefined {
	const exact = sourceInfos.get(resourcePath);
	if (exact) return exact;

	let current = resourcePath;
	while (current.includes("/")) {
		current = current.substring(0, current.lastIndexOf("/"));
		const parent = sourceInfos.get(current);
		if (parent) return parent;
	}
	return undefined;
}

function formatPathWithSource(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (!sourceInfo) return formatDisplayPath(resourcePath);
	const shortPath = getShortPath(resourcePath, sourceInfo);
	const { label, scopeLabel } = getDisplaySourceInfo(sourceInfo);
	return `${scopeLabel ? `${label} (${scopeLabel})` : label} ${shortPath}`;
}

function formatDiagnostics(
	diagnostics: readonly ResourceDiagnostic[],
	sourceInfos: ReadonlyMap<string, SourceInfo>,
): string {
	const lines: string[] = [];
	const collisions = new Map<string, ResourceDiagnostic[]>();
	const otherDiagnostics: ResourceDiagnostic[] = [];

	for (const diagnostic of diagnostics) {
		if (diagnostic.type === "collision" && diagnostic.collision) {
			const list = collisions.get(diagnostic.collision.name) ?? [];
			list.push(diagnostic);
			collisions.set(diagnostic.collision.name, list);
		} else {
			otherDiagnostics.push(diagnostic);
		}
	}

	for (const [name, collisionList] of collisions) {
		const first = collisionList[0]?.collision;
		if (!first) continue;
		lines.push(theme.fg("warning", `  "${name}" collision:`));
		lines.push(
			theme.fg(
				"dim",
				`    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
			),
		);
		for (const diagnostic of collisionList) {
			if (!diagnostic.collision) continue;
			lines.push(
				theme.fg(
					"dim",
					`    ${theme.fg("warning", "✗")} ${formatPathWithSource(diagnostic.collision.loserPath, findSourceInfoForPath(diagnostic.collision.loserPath, sourceInfos))} (skipped)`,
				),
			);
		}
	}

	for (const diagnostic of otherDiagnostics) {
		const color = diagnostic.type === "error" ? "error" : "warning";
		if (diagnostic.path) {
			const formattedPath = formatPathWithSource(
				diagnostic.path,
				findSourceInfoForPath(diagnostic.path, sourceInfos),
			);
			lines.push(theme.fg(color, `  ${formattedPath}`));
			lines.push(theme.fg(color, `    ${diagnostic.message}`));
		} else {
			lines.push(theme.fg(color, `  ${diagnostic.message}`));
		}
	}
	return lines.join("\n");
}

export function renderLoadedResources(input: LoadedResourcesViewInput, options?: LoadedResourcesDisplayOptions): void {
	const showListing = options?.force === true || input.isVerbose || !input.isQuietStartup;
	const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
	if (!showListing && !showDiagnostics) return;

	const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
	const formatCompactList = (items: string[], shouldSort = true): string => {
		const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
		if (shouldSort) labels.sort((a, b) => a.localeCompare(b));
		return theme.fg("dim", `  ${labels.join(", ")}`);
	};
	const addLoadedSection = (
		name: string,
		collapsedBody: string,
		expandedBody = collapsedBody,
		color: ThemeColor = "mdHeading",
	): void => {
		input.chatContainer.addChild(
			new ExpandableText(
				() => `${sectionHeader(name, color)}\n${collapsedBody}`,
				() => `${sectionHeader(name, color)}\n${expandedBody}`,
				input.isExpanded,
			),
		);
		input.chatContainer.addChild(new Spacer(1));
	};

	const { resources } = input;
	const sourceInfos = new Map<string, SourceInfo>();
	for (const extension of resources.extensions) {
		if (extension.sourceInfo) sourceInfos.set(extension.path, extension.sourceInfo);
	}
	for (const skill of resources.skills) {
		if (skill.sourceInfo) sourceInfos.set(skill.filePath, skill.sourceInfo);
	}
	for (const prompt of resources.promptTemplates) {
		if (prompt.sourceInfo) sourceInfos.set(prompt.filePath, prompt.sourceInfo);
	}
	for (const loadedTheme of resources.themes) {
		if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
			sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
		}
	}

	if (showListing) {
		if (resources.contextFiles.length > 0) {
			input.chatContainer.addChild(new Spacer(1));
			const contextList = resources.contextFiles
				.map((file) => theme.fg("dim", `  ${formatDisplayPath(file.path)}`))
				.join("\n");
			const compactList = formatCompactList(
				resources.contextFiles.map((file) => formatContextPath(input.cwd, file.path)),
				false,
			);
			addLoadedSection("Context", compactList, contextList);
		}

		if (resources.skills.length > 0) {
			const groups = buildScopeGroups(
				resources.skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
			);
			const expanded = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
			});
			addLoadedSection("Skills", formatCompactList(resources.skills.map((skill) => skill.name)), expanded);
		}

		if (resources.promptTemplates.length > 0) {
			const groups = buildScopeGroups(
				resources.promptTemplates.map((prompt) => ({ path: prompt.filePath, sourceInfo: prompt.sourceInfo })),
			);
			const templatesByPath = new Map(resources.promptTemplates.map((template) => [template.filePath, template]));
			const formatTemplate = (item: ResourceItem) => {
				const template = templatesByPath.get(item.path);
				return template ? `/${template.name}` : formatDisplayPath(item.path);
			};
			addLoadedSection(
				"Prompts",
				formatCompactList(resources.promptTemplates.map((template) => `/${template.name}`)),
				formatScopeGroups(groups, { formatPath: formatTemplate, formatPackagePath: formatTemplate }),
			);
		}

		if (resources.extensions.length > 0) {
			const groups = buildScopeGroups(resources.extensions);
			const expanded = formatScopeGroups(groups, {
				formatPath: (item) => formatExtensionDisplayPath(item.path),
				formatPackagePath: (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo)),
			});
			addLoadedSection("Extensions", formatCompactList(getCompactExtensionLabels(resources.extensions)), expanded);
		}

		const customThemes = resources.themes.filter((loadedTheme) => loadedTheme.sourcePath);
		if (customThemes.length > 0) {
			const groups = buildScopeGroups(
				customThemes.map((loadedTheme) => ({
					path: loadedTheme.sourcePath!,
					sourceInfo: loadedTheme.sourceInfo,
				})),
			);
			const expanded = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
			});
			addLoadedSection(
				"Themes",
				formatCompactList(
					customThemes.map(
						(loadedTheme) =>
							loadedTheme.name ?? getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
					),
				),
				expanded,
			);
		}
	}

	if (!showDiagnostics) return;
	const addDiagnostics = (name: string, diagnostics: readonly ResourceDiagnostic[]): void => {
		if (diagnostics.length === 0) return;
		input.chatContainer.addChild(
			new Text(`${theme.fg("warning", `[${name}]`)}\n${formatDiagnostics(diagnostics, sourceInfos)}`, 0, 0),
		);
		input.chatContainer.addChild(new Spacer(1));
	};
	addDiagnostics("Skill conflicts", resources.skillDiagnostics);
	addDiagnostics("Prompt conflicts", resources.promptDiagnostics);
	addDiagnostics("Extension issues", resources.extensionDiagnostics);
	addDiagnostics("Theme conflicts", resources.themeDiagnostics);
}
