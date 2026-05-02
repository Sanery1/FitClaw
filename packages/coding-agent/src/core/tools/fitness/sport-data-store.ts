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

	async load<T>(namespace: string): Promise<T | null> {
		if (this.cache.has(namespace)) {
			return this.cache.get(namespace) as T;
		}
		try {
			const fs = await import("node:fs/promises");
			const path = await import("node:path");
			const filePath = path.join(this.dataDir, "sport-data", `${namespace}.json`);
			const raw = await fs.readFile(filePath, "utf-8");
			const data = JSON.parse(raw) as T;
			this.cache.set(namespace, data);
			return data;
		} catch {
			return null;
		}
	}

	read<T>(namespace: string): T | null {
		return (this.cache.get(namespace) as T) ?? null;
	}

	async save<T>(namespace: string, data: T): Promise<void> {
		this.cache.set(namespace, data);
		try {
			const fs = await import("node:fs/promises");
			const path = await import("node:path");
			const filePath = path.join(this.dataDir, "sport-data", `${namespace}.json`);
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, JSON.stringify(data, null, 2));
		} catch (err) {
			console.error(
				`[sport-data-store] Failed to persist ${namespace}:`,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}
