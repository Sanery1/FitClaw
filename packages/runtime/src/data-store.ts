import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import lockfile from "proper-lockfile";

/** Generic persisted data boundary for a Skill's declared namespaces. */
export interface SkillDataStore {
	readonly dataDir: string;
	/** Load the latest persisted data from disk and refresh the last-read snapshot. */
	load<T>(namespace: string): Promise<T | null>;
	/** Read the last loaded or persisted snapshot (must call load() first). */
	read<T>(namespace: string): T | null;
	/** Write data to cache and persist to disk. */
	save<T>(namespace: string, data: T): Promise<void>;
	/** Atomically load, synchronously update, and persist the latest data under the cross-process lock. */
	update<T>(namespace: string, updater: (current: T | null) => T): Promise<T>;
}

/**
 * File-based SkillDataStore.
 * Data is persisted to {dataDir}/sport-data/{namespace}.json
 */
export class FileSkillDataStore implements SkillDataStore {
	readonly dataDir: string;
	private cache = new Map<string, unknown>();

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	private resolveNamespacePath(namespace: string): string {
		const parts = namespace.split("/");
		if (parts.length !== 2 || parts.some((part) => !/^[a-z0-9][a-z0-9_-]*$/.test(part))) {
			throw new Error(`Invalid namespace "${namespace}"`);
		}

		const sportDataDir = resolve(this.dataDir, "sport-data");
		const filePath = resolve(sportDataDir, parts[0], `${parts[1]}.json`);
		const relativePath = relative(sportDataDir, filePath);
		if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
			throw new Error(`Invalid namespace "${namespace}"`);
		}

		return filePath;
	}

	async load<T>(namespace: string): Promise<T | null> {
		const filePath = this.resolveNamespacePath(namespace);
		const data = await this.loadFromDisk<T>(namespace, filePath);
		this.cache.set(namespace, data);
		return data;
	}

	private async loadFromDisk<T>(namespace: string, filePath: string): Promise<T | null> {
		try {
			const raw = await readFile(filePath, "utf-8");
			return JSON.parse(raw) as T;
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			if (error instanceof SyntaxError) {
				throw new Error(`Invalid JSON in skill data namespace "${namespace}": ${error.message}`);
			}
			throw error;
		}
	}

	read<T>(namespace: string): T | null {
		this.resolveNamespacePath(namespace);
		return (this.cache.get(namespace) as T) ?? null;
	}

	async save<T>(namespace: string, data: T): Promise<void> {
		const filePath = this.resolveNamespacePath(namespace);
		await mkdir(dirname(filePath), { recursive: true });
		await this.withLock(filePath, async () => {
			await this.writeAtomically(filePath, data);
			this.cache.set(namespace, data);
		});
	}

	async update<T>(namespace: string, updater: (current: T | null) => T): Promise<T> {
		const filePath = this.resolveNamespacePath(namespace);
		await mkdir(dirname(filePath), { recursive: true });
		return this.withLock(filePath, async () => {
			const current = await this.loadFromDisk<T>(namespace, filePath);
			const next = updater(current);
			if (isPromiseLike(next)) {
				void Promise.resolve(next).catch(() => undefined);
				throw new TypeError("Skill data updater must return a value synchronously");
			}
			await this.writeAtomically(filePath, next);
			this.cache.set(namespace, next);
			return next;
		});
	}

	private async withLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
		const release = await lockfile.lock(filePath, {
			realpath: false,
			retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 1_000 },
		});
		try {
			return await operation();
		} finally {
			await release();
		}
	}

	private async writeAtomically<T>(filePath: string, data: T): Promise<void> {
		const tempPath = join(dirname(filePath), `.${process.pid}.${randomUUID()}.tmp`);
		try {
			await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
			await rename(tempPath, filePath);
		} finally {
			await rm(tempPath, { force: true });
		}
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
	return "then" in value && typeof value.then === "function";
}
