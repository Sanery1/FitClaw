import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "../config.js";
import type { GitSource } from "../utils/git.js";
import { PackageCommandRunner } from "./package-command-runner.js";
import { PackageInstallLayout } from "./package-install-layout.js";
import {
	PackageResourceCollector,
	type PathMetadata,
	type ResolvedPaths,
	type ResourceAccumulator,
} from "./package-resource-collector.js";
import { type PackageFilter, RESOURCE_TYPES } from "./package-resource-discovery.js";
import {
	type LocalSource,
	type NpmSource,
	PackageSourceResolver,
	type ParsedSource,
	type SourceScope,
} from "./package-source-resolver.js";
import { type PackageUpdate, PackageUpdateChecker, runWithConcurrency } from "./package-update-checker.js";
import type { PackageSource, SettingsManager } from "./settings-manager.js";

export type { PathMetadata, ResolvedPaths, ResolvedResource } from "./package-resource-collector.js";
export type { PackageUpdate } from "./package-update-checker.js";

const NETWORK_TIMEOUT_MS = 10000;
const UPDATE_CHECK_CONCURRENCY = 4;
const GIT_UPDATE_CONCURRENCY = 4;

function isOfflineModeEnabled(): boolean {
	const value = process.env.FITCLAW_OFFLINE;
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export type MissingSourceAction = "install" | "skip" | "error";

export interface ProgressEvent {
	type: "start" | "progress" | "complete" | "error";
	action: "install" | "remove" | "update" | "clone" | "pull";
	source: string;
	message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface ConfiguredPackage {
	source: string;
	scope: "user" | "project";
	filtered: boolean;
	installedPath?: string;
}

export interface PackageManager {
	resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
	install(source: string, options?: { local?: boolean }): Promise<void>;
	installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
	remove(source: string, options?: { local?: boolean }): Promise<void>;
	removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
	update(source?: string): Promise<void>;
	listConfiguredPackages(): ConfiguredPackage[];
	resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths>;
	addSourceToSettings(source: string, options?: { local?: boolean }): boolean;
	removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean;
	setProgressCallback(callback: ProgressCallback | undefined): void;
	getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
}

interface PackageManagerOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
}

type InstalledSourceScope = Exclude<SourceScope, "temporary">;

interface ConfiguredUpdateSource {
	source: string;
	scope: InstalledSourceScope;
}

interface NpmUpdateTarget extends ConfiguredUpdateSource {
	parsed: NpmSource;
}

interface GitUpdateTarget extends ConfiguredUpdateSource {
	parsed: GitSource;
}

export class DefaultPackageManager implements PackageManager {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private progressCallback: ProgressCallback | undefined;
	private readonly commandRunner = new PackageCommandRunner();
	private readonly installLayout: PackageInstallLayout;
	private readonly resourceCollector: PackageResourceCollector;
	private readonly sourceResolver: PackageSourceResolver;
	private readonly updateChecker: PackageUpdateChecker;

	constructor(options: PackageManagerOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.settingsManager = options.settingsManager;
		this.installLayout = new PackageInstallLayout({
			cwd: this.cwd,
			agentDir: this.agentDir,
			getNpmCommand: () => this.getNpmCommand(),
			runCommandSync: (command, args) => this.runCommandSync(command, args),
		});
		this.sourceResolver = new PackageSourceResolver({ cwd: this.cwd, agentDir: this.agentDir });
		this.updateChecker = new PackageUpdateChecker({
			cwd: this.cwd,
			networkTimeoutMs: NETWORK_TIMEOUT_MS,
			updateCheckConcurrency: UPDATE_CHECK_CONCURRENCY,
			installLayout: this.installLayout,
			sourceResolver: this.sourceResolver,
			getNpmCommand: () => this.getNpmCommand(),
			isOfflineModeEnabled,
			runCommand: (command, args, commandOptions) => this.runCommand(command, args, commandOptions),
			runCommandCapture: (command, args, commandOptions) => this.runCommandCapture(command, args, commandOptions),
		});
		this.resourceCollector = new PackageResourceCollector({ cwd: this.cwd, sourceResolver: this.sourceResolver });
	}

	setProgressCallback(callback: ProgressCallback | undefined): void {
		this.progressCallback = callback;
	}

	addSourceToSettings(source: string, options?: { local?: boolean }): boolean {
		const scope: SourceScope = options?.local ? "project" : "user";
		const currentSettings =
			scope === "project" ? this.settingsManager.getProjectSettings() : this.settingsManager.getGlobalSettings();
		const currentPackages = currentSettings.packages ?? [];
		const normalizedSource = this.sourceResolver.normalizeForSettings(source, scope);
		const exists = currentPackages.some((existing) => this.sourceResolver.matches(existing, source, scope));
		if (exists) {
			return false;
		}
		const nextPackages = [...currentPackages, normalizedSource];
		if (scope === "project") {
			this.settingsManager.setProjectPackages(nextPackages);
		} else {
			this.settingsManager.setPackages(nextPackages);
		}
		return true;
	}

	removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean {
		const scope: SourceScope = options?.local ? "project" : "user";
		const currentSettings =
			scope === "project" ? this.settingsManager.getProjectSettings() : this.settingsManager.getGlobalSettings();
		const currentPackages = currentSettings.packages ?? [];
		const nextPackages = currentPackages.filter((existing) => !this.sourceResolver.matches(existing, source, scope));
		const changed = nextPackages.length !== currentPackages.length;
		if (!changed) {
			return false;
		}
		if (scope === "project") {
			this.settingsManager.setProjectPackages(nextPackages);
		} else {
			this.settingsManager.setPackages(nextPackages);
		}
		return true;
	}

	getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
		const parsed = this.parseSource(source);
		if (parsed.type === "npm") {
			const path = this.installLayout.getNpmInstallPath(parsed, scope);
			return existsSync(path) ? path : undefined;
		}
		if (parsed.type === "git") {
			const path = this.installLayout.getGitInstallPath(parsed, scope);
			return existsSync(path) ? path : undefined;
		}
		if (parsed.type === "local") {
			const baseDir = this.sourceResolver.getBaseDir(scope);
			const path = this.sourceResolver.resolvePathFromBase(parsed.path, baseDir);
			return existsSync(path) ? path : undefined;
		}
		return undefined;
	}

	private emitProgress(event: ProgressEvent): void {
		this.progressCallback?.(event);
	}

	private async withProgress(
		action: ProgressEvent["action"],
		source: string,
		message: string,
		operation: () => Promise<void>,
	): Promise<void> {
		this.emitProgress({ type: "start", action, source, message });
		try {
			await operation();
			this.emitProgress({ type: "complete", action, source });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emitProgress({ type: "error", action, source, message: errorMessage });
			throw error;
		}
	}

	async resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
		const accumulator = this.resourceCollector.createAccumulator();
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();

		// Collect all packages with scope (project first so cwd resources win collisions)
		const allPackages: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
		for (const pkg of projectSettings.packages ?? []) {
			allPackages.push({ pkg, scope: "project" });
		}
		for (const pkg of globalSettings.packages ?? []) {
			allPackages.push({ pkg, scope: "user" });
		}

		// Dedupe: project scope wins over global for same package identity
		const packageSources = this.sourceResolver.dedupe(allPackages);
		await this.resolvePackageSources(packageSources, accumulator, onMissing);

		const globalBaseDir = this.agentDir;
		const projectBaseDir = join(this.cwd, CONFIG_DIR_NAME);

		for (const resourceType of RESOURCE_TYPES) {
			const target = this.resourceCollector.getTargetMap(accumulator, resourceType);
			const globalEntries = (globalSettings[resourceType] ?? []) as string[];
			const projectEntries = (projectSettings[resourceType] ?? []) as string[];
			this.resourceCollector.resolveLocalEntries(
				projectEntries,
				resourceType,
				target,
				{
					source: "local",
					scope: "project",
					origin: "top-level",
				},
				projectBaseDir,
			);
			this.resourceCollector.resolveLocalEntries(
				globalEntries,
				resourceType,
				target,
				{
					source: "local",
					scope: "user",
					origin: "top-level",
				},
				globalBaseDir,
			);
		}

		this.resourceCollector.addAutoDiscoveredResources(
			accumulator,
			globalSettings,
			projectSettings,
			globalBaseDir,
			projectBaseDir,
		);

		return this.resourceCollector.toResolvedPaths(accumulator);
	}

	async resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths> {
		const accumulator = this.resourceCollector.createAccumulator();
		const scope: SourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "user";
		const packageSources = sources.map((source) => ({ pkg: source as PackageSource, scope }));
		await this.resolvePackageSources(packageSources, accumulator);
		return this.resourceCollector.toResolvedPaths(accumulator);
	}

	listConfiguredPackages(): ConfiguredPackage[] {
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();
		const configuredPackages: ConfiguredPackage[] = [];

		for (const pkg of globalSettings.packages ?? []) {
			const source = typeof pkg === "string" ? pkg : pkg.source;
			configuredPackages.push({
				source,
				scope: "user",
				filtered: typeof pkg === "object",
				installedPath: this.getInstalledPath(source, "user"),
			});
		}

		for (const pkg of projectSettings.packages ?? []) {
			const source = typeof pkg === "string" ? pkg : pkg.source;
			configuredPackages.push({
				source,
				scope: "project",
				filtered: typeof pkg === "object",
				installedPath: this.getInstalledPath(source, "project"),
			});
		}

		return configuredPackages;
	}

	async install(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "user";
		await this.withProgress("install", source, `Installing ${source}...`, async () => {
			if (parsed.type === "npm") {
				await this.installNpm(parsed, scope, false);
				return;
			}
			if (parsed.type === "git") {
				await this.installGit(parsed, scope);
				return;
			}
			if (parsed.type === "local") {
				const resolved = this.sourceResolver.resolvePath(parsed.path);
				if (!existsSync(resolved)) {
					throw new Error(`Path does not exist: ${resolved}`);
				}
				return;
			}
			throw new Error(`Unsupported install source: ${source}`);
		});
	}

	async installAndPersist(source: string, options?: { local?: boolean }): Promise<void> {
		await this.install(source, options);
		this.addSourceToSettings(source, options);
	}

	async remove(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "user";
		await this.withProgress("remove", source, `Removing ${source}...`, async () => {
			if (parsed.type === "npm") {
				await this.uninstallNpm(parsed, scope);
				return;
			}
			if (parsed.type === "git") {
				await this.removeGit(parsed, scope);
				return;
			}
			if (parsed.type === "local") {
				return;
			}
			throw new Error(`Unsupported remove source: ${source}`);
		});
	}

	async removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean> {
		await this.remove(source, options);
		return this.removeSourceFromSettings(source, options);
	}

	async update(source?: string): Promise<void> {
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();
		const identity = source ? this.getPackageIdentity(source) : undefined;
		let matched = false;
		const updateSources: ConfiguredUpdateSource[] = [];

		for (const pkg of globalSettings.packages ?? []) {
			const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
			if (identity && this.getPackageIdentity(sourceStr, "user") !== identity) continue;
			matched = true;
			updateSources.push({ source: sourceStr, scope: "user" });
		}
		for (const pkg of projectSettings.packages ?? []) {
			const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
			if (identity && this.getPackageIdentity(sourceStr, "project") !== identity) continue;
			matched = true;
			updateSources.push({ source: sourceStr, scope: "project" });
		}

		if (source && !matched) {
			throw new Error(
				this.sourceResolver.buildNoMatchingPackageMessage(source, [
					...(globalSettings.packages ?? []),
					...(projectSettings.packages ?? []),
				]),
			);
		}

		await this.updateConfiguredSources(updateSources);
	}

	private async updateConfiguredSources(sources: ConfiguredUpdateSource[]): Promise<void> {
		if (isOfflineModeEnabled() || sources.length === 0) {
			return;
		}

		const npmCandidates: NpmUpdateTarget[] = [];
		const gitCandidates: GitUpdateTarget[] = [];

		for (const entry of sources) {
			const parsed = this.parseSource(entry.source);
			if (parsed.type === "local" || parsed.pinned) {
				continue;
			}
			if (parsed.type === "npm") {
				npmCandidates.push({ ...entry, parsed });
				continue;
			}
			gitCandidates.push({ ...entry, parsed });
		}

		const npmCheckTasks = npmCandidates.map((entry) => async () => ({
			entry,
			shouldUpdate: await this.updateChecker.shouldUpdateNpmSource(entry.parsed, entry.scope),
		}));
		const npmCheckResults = await runWithConcurrency(npmCheckTasks, UPDATE_CHECK_CONCURRENCY);
		const userNpmUpdates: NpmUpdateTarget[] = [];
		const projectNpmUpdates: NpmUpdateTarget[] = [];
		for (const result of npmCheckResults) {
			if (!result.shouldUpdate) {
				continue;
			}
			if (result.entry.scope === "user") {
				userNpmUpdates.push(result.entry);
			} else {
				projectNpmUpdates.push(result.entry);
			}
		}

		const tasks: Promise<void>[] = [];
		if (userNpmUpdates.length > 0) {
			tasks.push(this.updateNpmBatch(userNpmUpdates, "user"));
		}
		if (projectNpmUpdates.length > 0) {
			tasks.push(this.updateNpmBatch(projectNpmUpdates, "project"));
		}
		if (gitCandidates.length > 0) {
			const gitTasks = gitCandidates.map(
				(entry) => async () =>
					this.withProgress("update", entry.source, `Updating ${entry.source}...`, async () => {
						await this.updateGit(entry.parsed, entry.scope);
					}),
			);
			tasks.push(runWithConcurrency(gitTasks, GIT_UPDATE_CONCURRENCY).then(() => {}));
		}

		await Promise.all(tasks);
	}

	private async updateNpmBatch(sources: NpmUpdateTarget[], scope: InstalledSourceScope): Promise<void> {
		if (sources.length === 0) {
			return;
		}

		const sourceLabel = sources.length === 1 ? sources[0].source : `${scope} npm packages`;
		const message = sources.length === 1 ? `Updating ${sources[0].source}...` : `Updating ${scope} npm packages...`;
		const specs = sources.map((entry) => `${entry.parsed.name}@latest`);

		await this.withProgress("update", sourceLabel, message, async () => {
			await this.installNpmBatch(specs, scope);
		});
	}

	private async installNpmBatch(specs: string[], scope: InstalledSourceScope): Promise<void> {
		if (scope === "user") {
			await this.runNpmCommand(["install", "-g", ...specs]);
			return;
		}
		const installRoot = this.installLayout.getNpmInstallRoot(scope, false);
		this.installLayout.ensureNpmProject(installRoot);
		await this.runNpmCommand(["install", ...specs, "--prefix", installRoot]);
	}

	async checkForAvailableUpdates(): Promise<PackageUpdate[]> {
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();
		return this.updateChecker.checkForAvailableUpdates(globalSettings.packages ?? [], projectSettings.packages ?? []);
	}

	private async resolvePackageSources(
		sources: Array<{ pkg: PackageSource; scope: SourceScope }>,
		accumulator: ResourceAccumulator,
		onMissing?: (source: string) => Promise<MissingSourceAction>,
	): Promise<void> {
		for (const { pkg, scope } of sources) {
			const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
			const filter = typeof pkg === "object" ? pkg : undefined;
			const parsed = this.parseSource(sourceStr);
			const metadata: PathMetadata = { source: sourceStr, scope, origin: "package" };

			if (parsed.type === "local") {
				const baseDir = this.sourceResolver.getBaseDir(scope);
				this.resolveLocalExtensionSource(parsed, accumulator, filter, metadata, baseDir);
				continue;
			}

			const installMissing = async (): Promise<boolean> => {
				if (isOfflineModeEnabled()) {
					return false;
				}
				if (!onMissing) {
					await this.installParsedSource(parsed, scope);
					return true;
				}
				const action = await onMissing(sourceStr);
				if (action === "skip") return false;
				if (action === "error") throw new Error(`Missing source: ${sourceStr}`);
				await this.installParsedSource(parsed, scope);
				return true;
			};

			if (parsed.type === "npm") {
				const installedPath = this.installLayout.getNpmInstallPath(parsed, scope);
				const needsInstall =
					!existsSync(installedPath) ||
					(parsed.pinned && !(await this.updateChecker.installedNpmMatchesPinnedVersion(parsed, installedPath)));
				if (needsInstall) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				metadata.baseDir = installedPath;
				this.resourceCollector.collectPackageResources(installedPath, accumulator, filter, metadata);
				continue;
			}

			if (parsed.type === "git") {
				const installedPath = this.installLayout.getGitInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				} else if (scope === "temporary" && !parsed.pinned && !isOfflineModeEnabled()) {
					await this.refreshTemporaryGitSource(parsed, sourceStr);
				}
				metadata.baseDir = installedPath;
				this.resourceCollector.collectPackageResources(installedPath, accumulator, filter, metadata);
			}
		}
	}

	private resolveLocalExtensionSource(
		source: LocalSource,
		accumulator: ResourceAccumulator,
		filter: PackageFilter | undefined,
		metadata: PathMetadata,
		baseDir: string,
	): void {
		const resolved = this.sourceResolver.resolvePathFromBase(source.path, baseDir);
		if (!existsSync(resolved)) {
			return;
		}

		try {
			const stats = statSync(resolved);
			if (stats.isFile()) {
				metadata.baseDir = dirname(resolved);
				this.resourceCollector.addResource(accumulator.extensions, resolved, metadata, true);
				return;
			}
			if (stats.isDirectory()) {
				metadata.baseDir = resolved;
				const resources = this.resourceCollector.collectPackageResources(resolved, accumulator, filter, metadata);
				if (!resources) {
					this.resourceCollector.addResource(accumulator.extensions, resolved, metadata, true);
				}
			}
		} catch {
			return;
		}
	}

	private async installParsedSource(parsed: ParsedSource, scope: SourceScope): Promise<void> {
		if (parsed.type === "npm") {
			await this.installNpm(parsed, scope, scope === "temporary");
			return;
		}
		if (parsed.type === "git") {
			await this.installGit(parsed, scope);
			return;
		}
	}

	private parseSource(source: string): ParsedSource {
		return this.sourceResolver.parse(source);
	}

	/**
	 * Get a unique identity for a package, ignoring version/ref.
	 * Used to detect when the same package is in both global and project settings.
	 * For git packages, uses normalized host/path to ensure SSH and HTTPS URLs
	 * for the same repository are treated as identical.
	 */
	private getPackageIdentity(source: string, scope?: SourceScope): string {
		return this.sourceResolver.getIdentity(source, scope);
	}

	private getNpmCommand(): { command: string; args: string[] } {
		const configuredCommand = this.settingsManager.getNpmCommand();
		if (!configuredCommand || configuredCommand.length === 0) {
			return { command: "npm", args: [] };
		}
		const [command, ...args] = configuredCommand;
		if (!command) {
			throw new Error("Invalid npmCommand: first array entry must be a non-empty command");
		}
		return { command, args };
	}

	private async runNpmCommand(args: string[], options?: { cwd?: string }): Promise<void> {
		const npmCommand = this.getNpmCommand();
		await this.runCommand(npmCommand.command, [...npmCommand.args, ...args], options);
	}

	private getGitDependencyInstallArgs(): string[] {
		const configuredCommand = this.settingsManager.getNpmCommand();
		if (configuredCommand && configuredCommand.length > 0) {
			return ["install"];
		}
		return ["install", "--omit=dev"];
	}

	private async installNpm(source: NpmSource, scope: SourceScope, temporary: boolean): Promise<void> {
		if (scope === "user" && !temporary) {
			await this.runNpmCommand(["install", "-g", source.spec]);
			return;
		}
		const installRoot = this.installLayout.getNpmInstallRoot(scope, temporary);
		this.installLayout.ensureNpmProject(installRoot);
		await this.runNpmCommand(["install", source.spec, "--prefix", installRoot]);
	}

	private async uninstallNpm(source: NpmSource, scope: SourceScope): Promise<void> {
		if (scope === "user") {
			await this.runNpmCommand(["uninstall", "-g", source.name]);
			return;
		}
		const installRoot = this.installLayout.getNpmInstallRoot(scope, false);
		if (!existsSync(installRoot)) {
			return;
		}
		await this.runNpmCommand(["uninstall", source.name, "--prefix", installRoot]);
	}

	private async installGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.installLayout.getGitInstallPath(source, scope);
		if (existsSync(targetDir)) {
			return;
		}
		const gitRoot = this.installLayout.getGitInstallRoot(scope);
		if (gitRoot) {
			this.installLayout.ensureGitIgnore(gitRoot);
		}
		mkdirSync(dirname(targetDir), { recursive: true });

		await this.runCommand("git", ["clone", source.repo, targetDir]);
		if (source.ref) {
			await this.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
		}
		const packageJsonPath = join(targetDir, "package.json");
		if (existsSync(packageJsonPath)) {
			await this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir });
		}
	}

	private async updateGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.installLayout.getGitInstallPath(source, scope);
		if (!existsSync(targetDir)) {
			await this.installGit(source, scope);
			return;
		}

		const target = await this.updateChecker.getLocalGitUpdateTarget(targetDir);

		// Fetch only the ref we will reset to, avoiding unrelated branch/tag noise.
		await this.runCommand("git", target.fetchArgs, { cwd: targetDir });

		const localHead = await this.runCommandCapture("git", ["rev-parse", "HEAD"], {
			cwd: targetDir,
			timeoutMs: NETWORK_TIMEOUT_MS,
		});
		const refreshedTargetHead = await this.runCommandCapture("git", ["rev-parse", target.ref], {
			cwd: targetDir,
			timeoutMs: NETWORK_TIMEOUT_MS,
		});
		if (localHead.trim() === refreshedTargetHead.trim()) {
			return;
		}

		await this.runCommand("git", ["reset", "--hard", target.ref], { cwd: targetDir });

		// Clean untracked files (extensions should be pristine)
		await this.runCommand("git", ["clean", "-fdx"], { cwd: targetDir });

		const packageJsonPath = join(targetDir, "package.json");
		if (existsSync(packageJsonPath)) {
			await this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir });
		}
	}

	private async refreshTemporaryGitSource(source: GitSource, sourceStr: string): Promise<void> {
		if (isOfflineModeEnabled()) {
			return;
		}
		try {
			await this.withProgress("pull", sourceStr, `Refreshing ${sourceStr}...`, async () => {
				await this.updateGit(source, "temporary");
			});
		} catch {
			// Keep cached temporary checkout if refresh fails.
		}
	}

	private async removeGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.installLayout.getGitInstallPath(source, scope);
		if (!existsSync(targetDir)) return;
		rmSync(targetDir, { recursive: true, force: true });
		this.installLayout.pruneEmptyGitParents(targetDir, this.installLayout.getGitInstallRoot(scope));
	}

	private runCommandCapture(
		command: string,
		args: string[],
		options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
	): Promise<string> {
		return this.commandRunner.capture(command, args, options);
	}

	private runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
		return this.commandRunner.run(command, args, options);
	}

	private runCommandSync(command: string, args: string[]): string {
		return this.commandRunner.runSync(command, args);
	}
}
