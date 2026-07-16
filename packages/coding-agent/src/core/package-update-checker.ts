import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageInstallLayout } from "./package-install-layout.js";
import type { NpmSource, PackageSourceResolver, SourceScope } from "./package-source-resolver.js";
import type { PackageSource } from "./settings-manager.js";

interface NpmCommand {
	command: string;
	args: string[];
}

interface PackageUpdateCheckerOptions {
	cwd: string;
	networkTimeoutMs: number;
	updateCheckConcurrency: number;
	installLayout: PackageInstallLayout;
	sourceResolver: PackageSourceResolver;
	getNpmCommand: () => NpmCommand;
	isOfflineModeEnabled: () => boolean;
	runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<void>;
	runCommandCapture: (
		command: string,
		args: string[],
		options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
	) => Promise<string>;
}

export interface PackageUpdate {
	source: string;
	displayName: string;
	type: "npm" | "git";
	scope: Exclude<SourceScope, "temporary">;
}

export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
	if (tasks.length === 0) {
		return [];
	}

	const results: T[] = new Array(tasks.length);
	let nextIndex = 0;
	const workerCount = Math.max(1, Math.min(limit, tasks.length));

	const worker = async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= tasks.length) {
				return;
			}
			results[index] = await tasks[index]();
		}
	};

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

export class PackageUpdateChecker {
	constructor(private readonly options: PackageUpdateCheckerOptions) {}

	async shouldUpdateNpmSource(source: NpmSource, scope: Exclude<SourceScope, "temporary">): Promise<boolean> {
		const installedPath = this.options.installLayout.getNpmInstallPath(source, scope);
		const installedVersion = existsSync(installedPath) ? this.getInstalledNpmVersion(installedPath) : undefined;
		if (!installedVersion) {
			return true;
		}

		try {
			const latestVersion = await this.getLatestNpmVersion(source.name);
			return latestVersion !== installedVersion;
		} catch {
			// Preserve update behavior when the registry cannot determine the latest version.
			return true;
		}
	}

	async installedNpmMatchesPinnedVersion(source: NpmSource, installedPath: string): Promise<boolean> {
		const installedVersion = this.getInstalledNpmVersion(installedPath);
		if (!installedVersion) {
			return false;
		}

		const { version: pinnedVersion } = this.options.sourceResolver.parseNpmSpec(source.spec);
		if (!pinnedVersion) {
			return true;
		}

		return installedVersion === pinnedVersion;
	}

	async checkForAvailableUpdates(
		globalPackages: PackageSource[],
		projectPackages: PackageSource[],
	): Promise<PackageUpdate[]> {
		if (this.options.isOfflineModeEnabled()) {
			return [];
		}

		const allPackages: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
		for (const pkg of projectPackages) {
			allPackages.push({ pkg, scope: "project" });
		}
		for (const pkg of globalPackages) {
			allPackages.push({ pkg, scope: "user" });
		}

		const packageSources = this.options.sourceResolver.dedupe(allPackages);
		const checks = packageSources
			.filter(
				(entry): entry is { pkg: PackageSource; scope: Exclude<SourceScope, "temporary"> } =>
					entry.scope !== "temporary",
			)
			.map((entry) => async (): Promise<PackageUpdate | undefined> => {
				const source = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
				const parsed = this.options.sourceResolver.parse(source);
				if (parsed.type === "local" || parsed.pinned) {
					return undefined;
				}

				if (parsed.type === "npm") {
					const installedPath = this.options.installLayout.getNpmInstallPath(parsed, entry.scope);
					if (!existsSync(installedPath)) {
						return undefined;
					}
					const hasUpdate = await this.npmHasAvailableUpdate(parsed, installedPath);
					if (!hasUpdate) {
						return undefined;
					}
					return {
						source,
						displayName: parsed.name,
						type: "npm",
						scope: entry.scope,
					};
				}

				const installedPath = this.options.installLayout.getGitInstallPath(parsed, entry.scope);
				if (!existsSync(installedPath)) {
					return undefined;
				}
				const hasUpdate = await this.gitHasAvailableUpdate(installedPath);
				if (!hasUpdate) {
					return undefined;
				}
				return {
					source,
					displayName: `${parsed.host}/${parsed.path}`,
					type: "git",
					scope: entry.scope,
				};
			});

		const results = await runWithConcurrency(checks, this.options.updateCheckConcurrency);
		return results.filter((result): result is PackageUpdate => result !== undefined);
	}

	async getLatestNpmVersion(packageName: string): Promise<string> {
		const npmCommand = this.options.getNpmCommand();
		const stdout = await this.options.runCommandCapture(
			npmCommand.command,
			[...npmCommand.args, "view", packageName, "version", "--json"],
			{ cwd: this.options.cwd, timeoutMs: this.options.networkTimeoutMs },
		);
		const raw = stdout.trim();
		if (!raw) throw new Error("Empty response from npm view");
		return JSON.parse(raw);
	}

	async gitHasAvailableUpdate(installedPath: string): Promise<boolean> {
		if (this.options.isOfflineModeEnabled()) {
			return false;
		}

		try {
			const localHead = await this.options.runCommandCapture("git", ["rev-parse", "HEAD"], {
				cwd: installedPath,
				timeoutMs: this.options.networkTimeoutMs,
			});
			const remoteHead = await this.getRemoteGitHead(installedPath);
			return localHead.trim() !== remoteHead.trim();
		} catch {
			return false;
		}
	}

	async getLocalGitUpdateTarget(installedPath: string): Promise<{ ref: string; head: string; fetchArgs: string[] }> {
		try {
			const upstream = await this.options.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
				cwd: installedPath,
				timeoutMs: this.options.networkTimeoutMs,
			});
			const trimmedUpstream = upstream.trim();
			if (!trimmedUpstream.startsWith("origin/")) {
				throw new Error(`Unsupported upstream remote: ${trimmedUpstream}`);
			}
			const branch = trimmedUpstream.slice("origin/".length);
			if (!branch) {
				throw new Error("Missing upstream branch name");
			}
			const head = await this.options.runCommandCapture("git", ["rev-parse", "@{upstream}"], {
				cwd: installedPath,
				timeoutMs: this.options.networkTimeoutMs,
			});
			return {
				ref: "@{upstream}",
				head,
				fetchArgs: [
					"fetch",
					"--prune",
					"--no-tags",
					"origin",
					`+refs/heads/${branch}:refs/remotes/origin/${branch}`,
				],
			};
		} catch {
			await this.options
				.runCommand("git", ["remote", "set-head", "origin", "-a"], { cwd: installedPath })
				.catch(() => {});
			const head = await this.options.runCommandCapture("git", ["rev-parse", "origin/HEAD"], {
				cwd: installedPath,
				timeoutMs: this.options.networkTimeoutMs,
			});
			const originHeadRef = await this.options
				.runCommandCapture("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
					cwd: installedPath,
					timeoutMs: this.options.networkTimeoutMs,
				})
				.catch(() => "");
			const branch = originHeadRef.trim().replace(/^refs\/remotes\/origin\//, "");
			if (branch) {
				return {
					ref: "origin/HEAD",
					head,
					fetchArgs: [
						"fetch",
						"--prune",
						"--no-tags",
						"origin",
						`+refs/heads/${branch}:refs/remotes/origin/${branch}`,
					],
				};
			}
			return {
				ref: "origin/HEAD",
				head,
				fetchArgs: ["fetch", "--prune", "--no-tags", "origin", "+HEAD:refs/remotes/origin/HEAD"],
			};
		}
	}

	private async npmHasAvailableUpdate(source: NpmSource, installedPath: string): Promise<boolean> {
		if (this.options.isOfflineModeEnabled()) {
			return false;
		}

		const installedVersion = this.getInstalledNpmVersion(installedPath);
		if (!installedVersion) {
			return false;
		}

		try {
			const latestVersion = await this.getLatestNpmVersion(source.name);
			return latestVersion !== installedVersion;
		} catch {
			return false;
		}
	}

	private getInstalledNpmVersion(installedPath: string): string | undefined {
		const packageJsonPath = join(installedPath, "package.json");
		if (!existsSync(packageJsonPath)) return undefined;
		try {
			const content = readFileSync(packageJsonPath, "utf-8");
			const pkg = JSON.parse(content) as { version?: string };
			return pkg.version;
		} catch {
			return undefined;
		}
	}

	private async getRemoteGitHead(installedPath: string): Promise<string> {
		const upstreamRef = await this.getGitUpstreamRef(installedPath);
		if (upstreamRef) {
			const remoteHead = await this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", upstreamRef]);
			const match = remoteHead.match(/^([0-9a-f]{40})\s+/m);
			if (match?.[1]) {
				return match[1];
			}
		}

		const remoteHead = await this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", "HEAD"]);
		const match = remoteHead.match(/^([0-9a-f]{40})\s+HEAD$/m);
		if (!match?.[1]) {
			throw new Error("Failed to determine remote HEAD");
		}
		return match[1];
	}

	private async getGitUpstreamRef(installedPath: string): Promise<string | undefined> {
		try {
			const upstream = await this.options.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
				cwd: installedPath,
				timeoutMs: this.options.networkTimeoutMs,
			});
			const trimmed = upstream.trim();
			if (!trimmed.startsWith("origin/")) {
				return undefined;
			}
			const branch = trimmed.slice("origin/".length);
			return branch ? `refs/heads/${branch}` : undefined;
		} catch {
			return undefined;
		}
	}

	private runGitRemoteCommand(installedPath: string, args: string[]): Promise<string> {
		return this.options.runCommandCapture("git", args, {
			cwd: installedPath,
			timeoutMs: this.options.networkTimeoutMs,
			env: {
				GIT_TERMINAL_PROMPT: "0",
			},
		});
	}
}
