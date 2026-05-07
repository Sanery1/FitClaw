import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Generic sport data store interface.
 * Each sport skill gets its own namespace for data persistence.
 */
export interface SportDataStore {
	readonly dataDir: string;
	/** Load persisted data from disk into memory. Idempotent. */
	load<T>(namespace: string): Promise<T | null>;
	/** Read cached data (must call load() first). */
	read<T>(namespace: string): T | null;
	/** Write data to cache and persist to disk. */
	save<T>(namespace: string, data: T): Promise<void>;
}

/**
 * File-based SportDataStore.
 * Data is persisted to {dataDir}/sport-data/{namespace}.json
 */
export class FileSportDataStore implements SportDataStore {
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
				throw new Error(`Invalid JSON in sport data namespace "${namespace}": ${error.message}`);
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
		await writeFile(filePath, JSON.stringify(data, null, 2));
		this.cache.set(namespace, data);
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
