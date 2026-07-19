import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveCoachSessionScope } from "./runtime/coach-scope.js";

export interface MemoryMigrationEntry {
	chatId: string;
	tenantKey: string;
	openId: string;
	kind: "dm" | "group";
	legacyPath?: string;
	confirmedPersonalData?: boolean;
}

export interface MemoryMigrationManifest {
	version: 1;
	sessions: MemoryMigrationEntry[];
}

export interface MemoryMigrationOptions {
	workspaceDir: string;
	manifest: MemoryMigrationManifest;
	apply?: boolean;
	conflictStrategy?: "legacy" | "destination";
}

export interface MemoryMigrationOperation {
	type: "session" | "group_archive" | "sport_data";
	source: string;
	destination: string;
	action: "copy" | "merge" | "replace" | "skip";
	itemCount: number;
	hash: string;
}

export interface MemoryMigrationReport {
	mode: "dry-run" | "apply";
	startedAt: string;
	workspaceDir: string;
	operations: MemoryMigrationOperation[];
	warnings: string[];
}

interface PlannedMigration {
	operation: MemoryMigrationOperation;
	content: string;
}

export async function migrateCoachMemory(options: MemoryMigrationOptions): Promise<MemoryMigrationReport> {
	const workspaceDir = await resolveCanonicalWorkspace(options.workspaceDir);
	const manifest = validateManifest(options.manifest);
	const startedAt = new Date().toISOString();
	const operations: MemoryMigrationOperation[] = [];
	const warnings: string[] = [];
	const resolvedSourceOwners = new Map<string, string>();
	const virtualDestinations = new Map<string, string>();
	const plannedWrites = new Map<string, string>();

	for (const entry of manifest.sessions) {
		const scope = resolveCoachSessionScope(workspaceDir, entry);
		const requestedSourceDir = resolveLegacyPath(workspaceDir, entry.legacyPath ?? entry.chatId);
		const sourceDir = await resolveExistingLegacySource(workspaceDir, requestedSourceDir);
		if (!sourceDir) {
			warnings.push(`Legacy session not found: ${relative(workspaceDir, requestedSourceDir)}`);
			continue;
		}
		const existingOwner = resolvedSourceOwners.get(sourceDir);
		if (existingOwner && existingOwner !== scope.userKey) {
			throw new Error(
				`Legacy path ${relative(workspaceDir, requestedSourceDir)} resolves to a source mapped to multiple users`,
			);
		}
		resolvedSourceOwners.set(sourceDir, scope.userKey);

		const sourceContext = await resolveExistingSourceEntry(
			workspaceDir,
			sourceDir,
			join(sourceDir, "context.jsonl"),
			"file",
		);
		if (sourceContext) {
			const destinationContext =
				entry.kind === "dm"
					? join(scope.sessionDir, "context.jsonl")
					: join(workspaceDir, "migration-archive", "groups", entry.chatId, entry.openId, "context.jsonl");
			recordPlannedMigration(
				await planJsonLines(
					workspaceDir,
					sourceContext,
					destinationContext,
					entry.kind === "dm" ? "session" : "group_archive",
					virtualDestinations,
				),
				operations,
				virtualDestinations,
				plannedWrites,
			);
		}

		const sourceSportData = await resolveExistingSourceEntry(
			workspaceDir,
			sourceDir,
			join(sourceDir, "sport-data"),
			"directory",
		);
		if (sourceSportData) {
			if (entry.kind === "group" && entry.confirmedPersonalData !== true) {
				warnings.push(`Skipped unconfirmed group sport data: ${relative(workspaceDir, sourceSportData)}`);
				continue;
			}
			for (const sourceFile of await collectJsonFiles(sourceSportData, workspaceDir)) {
				const relativeFile = relative(sourceSportData, sourceFile);
				const destinationFile = join(scope.userDataDir, "sport-data", relativeFile);
				recordPlannedMigration(
					await planJsonFile(
						workspaceDir,
						sourceFile,
						destinationFile,
						virtualDestinations,
						options.conflictStrategy,
					),
					operations,
					virtualDestinations,
					plannedWrites,
				);
			}
		}

		const legacyFitnessData = await resolveExistingSourceEntry(
			workspaceDir,
			sourceDir,
			join(sourceDir, "fitness-data.json"),
			"file",
		);
		if (legacyFitnessData) {
			if (entry.kind === "group" && entry.confirmedPersonalData !== true) {
				warnings.push(`Skipped unconfirmed group fitness data: ${relative(workspaceDir, legacyFitnessData)}`);
				continue;
			}
			const legacyData = parseJson(await readFile(legacyFitnessData, "utf-8"), legacyFitnessData);
			if (!isRecord(legacyData)) throw new Error(`Legacy fitness data must be an object: ${legacyFitnessData}`);
			const legacyNamespaces = getLegacyFitnessNamespaces(legacyData);
			for (const [namespace, data] of legacyNamespaces) {
				const canonicalSource = sourceSportData
					? await resolveExistingSourceEntry(
							workspaceDir,
							sourceDir,
							join(sourceSportData, "bodybuilding", `${namespace}.json`),
							"file",
						)
					: null;
				if (canonicalSource) {
					warnings.push(
						`Skipped fitness-data.json#${namespace} because canonical sport-data exists: ${relative(workspaceDir, canonicalSource)}`,
					);
					continue;
				}
				recordPlannedMigration(
					await planJsonData(
						workspaceDir,
						data,
						`${legacyFitnessData}#${namespace}`,
						join(scope.userDataDir, "sport-data", "bodybuilding", `${namespace}.json`),
						virtualDestinations,
						options.conflictStrategy,
					),
					operations,
					virtualDestinations,
					plannedWrites,
				);
			}
		}
	}

	if (options.apply === true) await applyPlannedWrites(workspaceDir, plannedWrites);

	return {
		mode: options.apply === true ? "apply" : "dry-run",
		startedAt,
		workspaceDir,
		operations,
		warnings,
	};
}

export async function loadMemoryMigrationManifest(path: string): Promise<MemoryMigrationManifest> {
	const raw = await readFile(resolve(path), "utf-8");
	try {
		return validateManifest(JSON.parse(raw) as unknown);
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Invalid migration manifest JSON: ${error.message}`);
		throw error;
	}
}

export async function runMemoryMigrationCli(args: string[]): Promise<void> {
	let workspaceDir: string | undefined;
	let mappingPath: string | undefined;
	let reportPath: string | undefined;
	let apply = false;
	let conflictStrategy: MemoryMigrationOptions["conflictStrategy"];

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--mapping") mappingPath = requireValue(args, ++index, "--mapping");
		else if (arg === "--report") reportPath = requireValue(args, ++index, "--report");
		else if (arg === "--apply") apply = true;
		else if (arg === "--conflict") {
			const value = requireValue(args, ++index, "--conflict");
			if (value !== "legacy" && value !== "destination") {
				throw new Error('--conflict must be "legacy" or "destination"');
			}
			conflictStrategy = value;
		} else if (!arg.startsWith("-") && workspaceDir === undefined) workspaceDir = arg;
		else throw new Error(`Unknown migrate-memory argument: ${arg}`);
	}

	if (!workspaceDir || !mappingPath) {
		throw new Error(
			"Usage: fitclaw-coach migrate-memory <working-directory> --mapping <manifest.json> [--apply] [--conflict legacy|destination] [--report <report.json>]",
		);
	}
	const report = await migrateCoachMemory({
		workspaceDir,
		manifest: await loadMemoryMigrationManifest(mappingPath),
		apply,
		conflictStrategy,
	});
	const output = `${JSON.stringify(report, null, 2)}\n`;
	if (reportPath) await atomicWrite(resolve(reportPath), output);
	process.stdout.write(output);
}

async function planJsonLines(
	workspaceDir: string,
	source: string,
	destination: string,
	type: "session" | "group_archive",
	virtualDestinations: ReadonlyMap<string, string>,
): Promise<PlannedMigration> {
	const sourceItems = parseJsonLines(await readFile(source, "utf-8"), source);
	const destinationSnapshot = await readDestinationSnapshot(workspaceDir, destination, virtualDestinations);
	const destinationItems = destinationSnapshot.exists ? parseJsonLines(destinationSnapshot.content, destination) : [];
	const seen = new Set(destinationItems.map(canonicalJson));
	const additions = sourceItems.filter((item) => {
		const key = canonicalJson(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const merged = [...destinationItems, ...additions];
	const content = merged.map((item) => JSON.stringify(item)).join("\n") + (merged.length > 0 ? "\n" : "");
	const action = destinationItems.length === 0 ? "copy" : additions.length === 0 ? "skip" : "merge";
	return {
		operation: { type, source, destination, action, itemCount: merged.length, hash: sha256(content) },
		content,
	};
}

async function planJsonFile(
	workspaceDir: string,
	source: string,
	destination: string,
	virtualDestinations: ReadonlyMap<string, string>,
	conflictStrategy?: "legacy" | "destination",
): Promise<PlannedMigration> {
	const sourceData = parseJson(await readFile(source, "utf-8"), source);
	return planJsonData(workspaceDir, sourceData, source, destination, virtualDestinations, conflictStrategy);
}

async function planJsonData(
	workspaceDir: string,
	sourceData: unknown,
	source: string,
	destination: string,
	virtualDestinations: ReadonlyMap<string, string>,
	conflictStrategy?: "legacy" | "destination",
): Promise<PlannedMigration> {
	const destinationSnapshot = await readDestinationSnapshot(workspaceDir, destination, virtualDestinations);
	const destinationData = destinationSnapshot.exists ? parseJson(destinationSnapshot.content, destination) : undefined;
	let merged = sourceData;
	let action: MemoryMigrationOperation["action"] = "copy";

	if (destinationSnapshot.exists) {
		if (Array.isArray(sourceData) && Array.isArray(destinationData)) {
			const seen = new Set(destinationData.map(canonicalJson));
			merged = [
				...destinationData,
				...sourceData.filter((item) => {
					const key = canonicalJson(item);
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				}),
			];
			action = canonicalJson(merged) === canonicalJson(destinationData) ? "skip" : "merge";
		} else if (canonicalJson(sourceData) === canonicalJson(destinationData)) {
			merged = destinationData;
			action = "skip";
		} else if (conflictStrategy === "legacy") {
			merged = sourceData;
			action = "replace";
		} else if (conflictStrategy === "destination") {
			merged = destinationData;
			action = "skip";
		} else {
			throw new Error(`Conflicting object data at ${destination}; rerun with --conflict legacy|destination`);
		}
	}

	const content = `${JSON.stringify(merged, null, 2)}\n`;
	return {
		operation: {
			type: "sport_data",
			source,
			destination,
			action,
			itemCount: Array.isArray(merged) ? merged.length : 1,
			hash: sha256(content),
		},
		content,
	};
}

function recordPlannedMigration(
	plan: PlannedMigration,
	operations: MemoryMigrationOperation[],
	virtualDestinations: Map<string, string>,
	plannedWrites: Map<string, string>,
): void {
	operations.push(plan.operation);
	virtualDestinations.set(plan.operation.destination, plan.content);
	if (plan.operation.action !== "skip") plannedWrites.set(plan.operation.destination, plan.content);
}

async function readDestinationSnapshot(
	workspaceDir: string,
	destination: string,
	virtualDestinations: ReadonlyMap<string, string>,
): Promise<{ exists: boolean; content: string }> {
	const existsOnDisk = await assertSafeDestinationPath(workspaceDir, destination);
	const virtualContent = virtualDestinations.get(destination);
	if (virtualContent !== undefined) return { exists: true, content: virtualContent };
	if (!existsOnDisk) return { exists: false, content: "" };
	return { exists: true, content: await readFile(destination, "utf-8") };
}

async function applyPlannedWrites(workspaceDir: string, plannedWrites: ReadonlyMap<string, string>): Promise<void> {
	for (const destination of plannedWrites.keys()) await assertSafeDestinationPath(workspaceDir, destination);
	for (const [destination, content] of plannedWrites) {
		await atomicWriteMigrationDestination(workspaceDir, destination, content);
	}
}

async function atomicWriteMigrationDestination(
	workspaceDir: string,
	destination: string,
	content: string,
): Promise<void> {
	await assertSafeDestinationPath(workspaceDir, destination);
	await mkdir(dirname(destination), { recursive: true });
	await assertSafeDestinationPath(workspaceDir, destination);
	await atomicWrite(destination, content);
	await assertSafeDestinationPath(workspaceDir, destination);
	await verifyWrittenContent(destination, content);
}

function getLegacyFitnessNamespaces(data: Record<string, unknown>): Map<string, unknown> {
	const namespaces = new Map<string, unknown>();
	if (Array.isArray(data.workouts)) namespaces.set("training_log", data.workouts);
	if (Array.isArray(data.metrics)) namespaces.set("body_metrics", data.metrics);
	if (isRecord(data.plan)) {
		namespaces.set("training_plan", data.plan);
		const profile: Record<string, unknown> = {};
		if (typeof data.plan.goal === "string") profile.goal = data.plan.goal;
		if (typeof data.plan.experienceLevel === "string") profile.experience = data.plan.experienceLevel;
		if (Array.isArray(data.plan.availableEquipment)) profile.equipment = data.plan.availableEquipment;
		if (typeof data.plan.daysPerWeek === "number") profile.training_days_per_week = data.plan.daysPerWeek;
		if (Object.keys(profile).length > 0) namespaces.set("user_profile", { schema_version: 1, ...profile });
	}
	return namespaces;
}

async function collectJsonFiles(dir: string, workspaceDir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error(`Legacy source symbolic links are not supported: ${relative(workspaceDir, path)}`);
		}
		if (entry.isDirectory()) files.push(...(await collectJsonFiles(path, workspaceDir)));
		else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
	}
	return files.sort();
}

function validateManifest(value: unknown): MemoryMigrationManifest {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
		throw new Error("Migration manifest must contain version: 1 and a sessions array");
	}
	const sourceOwners = new Map<string, string>();
	const sessions = value.sessions.map((entry, index) => {
		if (!isRecord(entry) || (entry.kind !== "dm" && entry.kind !== "group")) {
			throw new Error(`Invalid migration session at index ${index}`);
		}
		const scope = resolveCoachSessionScope(process.cwd(), {
			tenantKey: entry.tenantKey as string,
			openId: entry.openId as string,
			chatId: entry.chatId as string,
		});
		if (entry.legacyPath !== undefined && typeof entry.legacyPath !== "string") {
			throw new Error(`Invalid legacyPath at index ${index}`);
		}
		if (entry.confirmedPersonalData !== undefined && typeof entry.confirmedPersonalData !== "boolean") {
			throw new Error(`Invalid confirmedPersonalData at index ${index}`);
		}
		const sourcePath = entry.legacyPath || scope.chatId;
		const owner = `${scope.tenantKey}/${scope.openId}`;
		const existingOwner = sourceOwners.get(sourcePath);
		if (existingOwner && existingOwner !== owner) {
			throw new Error(`Legacy path ${sourcePath} is mapped to multiple users`);
		}
		sourceOwners.set(sourcePath, owner);
		const kind: MemoryMigrationEntry["kind"] = entry.kind;
		return {
			tenantKey: scope.tenantKey,
			openId: scope.openId,
			chatId: scope.chatId,
			kind,
			...(entry.legacyPath ? { legacyPath: entry.legacyPath } : {}),
			...(entry.confirmedPersonalData === true ? { confirmedPersonalData: true } : {}),
		};
	});
	return { version: 1, sessions };
}

function resolveLegacyPath(workspaceDir: string, path: string): string {
	if (!path || isAbsolute(path)) throw new Error(`Legacy path must be relative: ${path}`);
	const resolved = resolve(workspaceDir, path);
	const relativePath = relative(workspaceDir, resolved);
	if (!relativePath || isOutsidePath(relativePath)) {
		throw new Error(`Legacy path escapes the workspace: ${path}`);
	}
	return resolved;
}

async function resolveCanonicalWorkspace(path: string): Promise<string> {
	const resolved = resolve(path);
	let canonicalPath: string;
	try {
		canonicalPath = await realpath(resolved);
	} catch (error) {
		if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
			throw new Error(`Migration workspace does not exist: ${resolved}`);
		}
		throw error;
	}
	if (!(await stat(canonicalPath)).isDirectory()) {
		throw new Error(`Migration workspace is not a directory: ${resolved}`);
	}
	return canonicalPath;
}

async function resolveExistingLegacySource(workspaceDir: string, requestedPath: string): Promise<string | null> {
	const canonicalPath = await realpathIfExists(requestedPath);
	if (!canonicalPath) return null;
	if (!isPathInside(canonicalPath, workspaceDir)) {
		throw new Error(
			`Legacy path escapes the workspace through a symbolic link: ${relative(workspaceDir, requestedPath)}`,
		);
	}
	if (!(await stat(canonicalPath)).isDirectory()) {
		throw new Error(`Legacy path is not a directory: ${relative(workspaceDir, requestedPath)}`);
	}
	return canonicalPath;
}

async function resolveExistingSourceEntry(
	workspaceDir: string,
	sourceDir: string,
	path: string,
	expectedType: "file" | "directory",
): Promise<string | null> {
	const canonicalPath = await realpathIfExists(path);
	if (!canonicalPath) return null;
	assertSourcePathInsideBoundaries(workspaceDir, sourceDir, path, canonicalPath);
	const pathStat = await stat(canonicalPath);
	const hasExpectedType = expectedType === "file" ? pathStat.isFile() : pathStat.isDirectory();
	if (!hasExpectedType) throw new Error(`Legacy source ${path} is not a ${expectedType}`);
	return canonicalPath;
}

function assertSourcePathInsideBoundaries(
	workspaceDir: string,
	sourceDir: string,
	requestedPath: string,
	canonicalPath: string,
): void {
	if (!isPathInsideOrEqual(canonicalPath, workspaceDir) || !isPathInsideOrEqual(canonicalPath, sourceDir)) {
		throw new Error(`Legacy source path escapes its workspace through a symbolic link: ${requestedPath}`);
	}
}

async function assertSafeDestinationPath(workspaceDir: string, destination: string): Promise<boolean> {
	const resolvedDestination = resolve(destination);
	if (!isPathInside(resolvedDestination, workspaceDir)) {
		throw new Error(`Migration destination escapes the workspace: ${destination}`);
	}

	const relativeDestination = relative(workspaceDir, resolvedDestination);
	const parts = relativeDestination.split(sep);
	let candidate = workspaceDir;
	for (let index = 0; index < parts.length; index++) {
		candidate = join(candidate, parts[index]);
		try {
			const candidateStat = await lstat(candidate);
			if (candidateStat.isSymbolicLink()) {
				throw new Error(`Migration destination symbolic links are not supported: ${relativeDestination}`);
			}
			if (index < parts.length - 1 && !candidateStat.isDirectory()) {
				throw new Error(`Migration destination parent is not a directory: ${candidate}`);
			}
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") return false;
			throw error;
		}
	}
	return true;
}

async function realpathIfExists(path: string): Promise<string | null> {
	try {
		return await realpath(path);
	} catch (error) {
		if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
		throw error;
	}
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
	const relativePath = relative(rootPath, candidatePath);
	return relativePath !== "" && !isOutsidePath(relativePath);
}

function isPathInsideOrEqual(candidatePath: string, rootPath: string): boolean {
	const relativePath = relative(rootPath, candidatePath);
	return relativePath === "" || !isOutsidePath(relativePath);
}

function isOutsidePath(relativePath: string): boolean {
	return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function parseJsonLines(content: string, path: string): unknown[] {
	return content
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line, index) => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				throw new Error(`Invalid JSONL at ${path}:${index + 1}`);
			}
		});
}

function parseJson(content: string, path: string): unknown {
	try {
		return JSON.parse(content) as unknown;
	} catch {
		throw new Error(`Invalid JSON at ${path}`);
	}
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
		await rename(tempPath, path);
	} finally {
		await rm(tempPath, { force: true });
	}
}

async function verifyWrittenContent(path: string, expected: string): Promise<void> {
	const actual = await readFile(path, "utf-8");
	if (sha256(actual) !== sha256(expected)) throw new Error(`Migration verification failed for ${path}`);
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function requireValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
