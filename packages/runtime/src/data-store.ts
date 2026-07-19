import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import lockfile from "proper-lockfile";

/** Generic persisted data boundary for a Skill's declared namespaces. */
export interface SkillDataStore {
	readonly dataDir: string;
	/** Load persisted data from disk into memory. Idempotent. */
	load<T>(namespace: string): Promise<T | null>;
	/** Read cached data (must call load() first). */
	read<T>(namespace: string): T | null;
	/** Write data to cache and persist to disk. */
	save<T>(namespace: string, data: T): Promise<void>;
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
		if (this.cache.has(namespace)) {
			return this.cache.get(namespace) as T;
		}
		try {
			const raw = await readFile(filePath, "utf-8");
			const data = JSON.parse(raw) as T;
			this.cache.set(namespace, data);
			return data;
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
		const sportDataDir = resolve(this.dataDir, "sport-data");
		await mkdir(dirname(filePath), { recursive: true });
		const release = await lockfile.lock(sportDataDir, {
			realpath: false,
			retries: { retries: 5, factor: 2, minTimeout: 10, maxTimeout: 200 },
		});
		const tempPath = join(dirname(filePath), `.${process.pid}.${randomUUID()}.tmp`);
		try {
			await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
			await rename(tempPath, filePath);
			this.cache.set(namespace, data);
		} finally {
			await rm(tempPath, { force: true });
			await release();
		}
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
