import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, isBunRuntime } from "../config.js";
import type { GitSource } from "../utils/git.js";
import type { NpmSource, SourceScope } from "./package-source-resolver.js";

interface NpmCommand {
	command: string;
	args: string[];
}

interface PackageInstallLayoutOptions {
	cwd: string;
	agentDir: string;
	getNpmCommand: () => NpmCommand;
	runCommandSync: (command: string, args: string[]) => string;
}

export class PackageInstallLayout {
	private globalNpmRoot: string | undefined;
	private globalNpmRootCommandKey: string | undefined;

	constructor(private readonly options: PackageInstallLayoutOptions) {}

	ensureNpmProject(installRoot: string): void {
		if (!existsSync(installRoot)) {
			mkdirSync(installRoot, { recursive: true });
		}
		this.ensureGitIgnore(installRoot);
		const packageJsonPath = join(installRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			const packageJson = { name: "pi-extensions", private: true };
			writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf-8");
		}
	}

	ensureGitIgnore(dir: string): void {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const ignorePath = join(dir, ".gitignore");
		if (!existsSync(ignorePath)) {
			writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
		}
	}

	getNpmInstallRoot(scope: SourceScope, isTemporary: boolean): string {
		if (isTemporary) {
			return this.getTemporaryDir("npm");
		}
		if (scope === "project") {
			return join(this.options.cwd, CONFIG_DIR_NAME, "npm");
		}
		return join(this.getGlobalNpmRoot(), "..");
	}

	getGlobalNpmRoot(): string {
		const npmCommand = this.options.getNpmCommand();
		const commandKey = [npmCommand.command, ...npmCommand.args].join("\0");
		if (this.globalNpmRoot && this.globalNpmRootCommandKey === commandKey) {
			return this.globalNpmRoot;
		}
		if (isBunRuntime) {
			const binDir = this.options.runCommandSync("bun", ["pm", "bin", "-g"]).trim();
			this.globalNpmRoot = join(dirname(binDir), "install", "global", "node_modules");
		} else {
			this.globalNpmRoot = this.runNpmCommandSync(["root", "-g"]).trim();
		}
		this.globalNpmRootCommandKey = commandKey;
		return this.globalNpmRoot;
	}

	getNpmInstallPath(source: NpmSource, scope: SourceScope): string {
		if (scope === "temporary") {
			return join(this.getTemporaryDir("npm"), "node_modules", source.name);
		}
		if (scope === "project") {
			return join(this.options.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
		}
		return join(this.getGlobalNpmRoot(), source.name);
	}

	getGitInstallPath(source: GitSource, scope: SourceScope): string {
		if (scope === "temporary") {
			return this.getTemporaryDir(`git-${source.host}`, source.path);
		}
		if (scope === "project") {
			return join(this.options.cwd, CONFIG_DIR_NAME, "git", source.host, source.path);
		}
		return join(this.options.agentDir, "git", source.host, source.path);
	}

	getGitInstallRoot(scope: SourceScope): string | undefined {
		if (scope === "temporary") {
			return undefined;
		}
		if (scope === "project") {
			return join(this.options.cwd, CONFIG_DIR_NAME, "git");
		}
		return join(this.options.agentDir, "git");
	}

	pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): void {
		if (!installRoot) return;
		const resolvedRoot = resolve(installRoot);
		let current = dirname(targetDir);
		while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
			if (!existsSync(current)) {
				current = dirname(current);
				continue;
			}
			const entries = readdirSync(current);
			if (entries.length > 0) {
				break;
			}
			try {
				rmSync(current, { recursive: true, force: true });
			} catch {
				break;
			}
			current = dirname(current);
		}
	}

	private getTemporaryDir(prefix: string, suffix?: string): string {
		const hash = createHash("sha256")
			.update(`${prefix}-${suffix ?? ""}`)
			.digest("hex")
			.slice(0, 8);
		return join(tmpdir(), "pi-extensions", prefix, hash, suffix ?? "");
	}

	private runNpmCommandSync(args: string[]): string {
		const npmCommand = this.options.getNpmCommand();
		return this.options.runCommandSync(npmCommand.command, [...npmCommand.args, ...args]);
	}
}
