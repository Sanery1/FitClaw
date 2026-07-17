import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME } from "../paths.js";

export type SettingsScope = "global" | "project";

export interface SettingsStorage {
	read(scope: SettingsScope): string | undefined;
	update(scope: SettingsScope, fn: (current: string | undefined) => string): void;
}

export class FileSettingsStorage implements SettingsStorage {
	private readonly globalSettingsPath: string;
	private readonly projectSettingsPath: string;

	constructor(cwd: string, agentDir: string) {
		this.globalSettingsPath = join(agentDir, "settings.json");
		this.projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
	}

	private getPath(scope: SettingsScope): string {
		return scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
	}

	read(scope: SettingsScope): string | undefined {
		const path = this.getPath(scope);
		if (!existsSync(path)) {
			return undefined;
		}

		const release = this.acquireLockSyncWithRetry(path);
		try {
			return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
		} finally {
			release();
		}
	}

	update(scope: SettingsScope, fn: (current: string | undefined) => string): void {
		const path = this.getPath(scope);
		const dir = dirname(path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Lock before reading so concurrent first writes observe each other's changes.
		const release = this.acquireLockSyncWithRetry(path);
		try {
			const current = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
			writeFileSync(path, fn(current), "utf-8");
		} finally {
			release();
		}
	}
}

export class InMemorySettingsStorage implements SettingsStorage {
	private global: string | undefined;
	private project: string | undefined;

	read(scope: SettingsScope): string | undefined {
		return scope === "global" ? this.global : this.project;
	}

	update(scope: SettingsScope, fn: (current: string | undefined) => string): void {
		if (scope === "global") {
			this.global = fn(this.global);
			return;
		}

		this.project = fn(this.project);
	}
}
