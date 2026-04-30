import type {
	BodyMetrics,
	PersonalRecord,
	ProgressiveOverloadEvent,
	TrainingPlan,
	WorkoutRecord,
} from "../../fitness/schemas.js";

export interface FitnessData {
	workouts: WorkoutRecord[];
	metrics: BodyMetrics[];
	plan: TrainingPlan | null;
	progressiveOverloads: ProgressiveOverloadEvent[];
	personalRecords: PersonalRecord[];
}

function emptyData(): FitnessData {
	return {
		workouts: [],
		metrics: [],
		plan: null,
		progressiveOverloads: [],
		personalRecords: [],
	};
}

const stores = new Map<string, FitnessData>();

function getStore(dataDir: string): FitnessData {
	let store = stores.get(dataDir);
	if (!store) {
		store = emptyData();
		stores.set(dataDir, store);
	}
	return store;
}

/** Load persisted data from disk into memory (on first access). */
export async function loadFitnessData(dataDir: string): Promise<void> {
	if (stores.has(dataDir)) return;
	try {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const filePath = path.join(dataDir, "fitness-data.json");
		const raw = await fs.readFile(filePath, "utf-8");
		const data = JSON.parse(raw) as FitnessData;
		const store = emptyData();
		store.workouts = data.workouts ?? [];
		store.metrics = data.metrics ?? [];
		store.plan = data.plan ?? null;
		store.progressiveOverloads = data.progressiveOverloads ?? [];
		store.personalRecords = data.personalRecords ?? [];
		stores.set(dataDir, store);
	} catch {
		stores.set(dataDir, emptyData());
	}
}

/** Persist memory state to disk. */
async function saveFitnessData(dataDir: string): Promise<void> {
	const store = stores.get(dataDir);
	if (!store) return;
	try {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const filePath = path.join(dataDir, "fitness-data.json");
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, JSON.stringify(store, null, 2));
	} catch (err) {
		console.error(
			`[fitness-store] Failed to persist data to ${dataDir}:`,
			err instanceof Error ? err.message : String(err),
		);
	}
}

/** Call after any mutation to flush to disk. */
export async function persist(dataDir: string): Promise<void> {
	await saveFitnessData(dataDir);
}

// ── Typed accessors ──

export function getWorkouts(dataDir: string): WorkoutRecord[] {
	return getStore(dataDir).workouts;
}

export function getMetrics(dataDir: string): BodyMetrics[] {
	return getStore(dataDir).metrics;
}

export function getPlan(dataDir: string): TrainingPlan | null {
	return getStore(dataDir).plan;
}

export function setPlan(dataDir: string, plan: TrainingPlan): void {
	getStore(dataDir).plan = plan;
}

export function getProgressiveOverloads(dataDir: string): ProgressiveOverloadEvent[] {
	return getStore(dataDir).progressiveOverloads;
}

export function getPersonalRecords(dataDir: string): PersonalRecord[] {
	return getStore(dataDir).personalRecords;
}
