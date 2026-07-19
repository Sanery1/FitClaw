import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { CoachUserScope } from "./runtime/coach-scope.js";

export const FITCLAW_MEMORY_POLICY_VERSION = "2026-07-19";

export type CoachRelationshipStatus = "invited" | "active" | "declined" | "revoked" | "invite_failed";
export type CoachInvitationSource = "employee_created" | "private_chat" | "migration";

export interface CoachRelationship {
	version: 1;
	tenantKey: string;
	openId: string;
	status: CoachRelationshipStatus;
	invitationSource?: CoachInvitationSource;
	inviteState?: "pending" | "sent" | "failed";
	invitedAt?: string;
	inviteMessageId?: string;
	inviteFailure?: {
		at: string;
		reason: string;
	};
	activatedAt?: string;
	declinedAt?: string;
	revokedAt?: string;
	memoryPolicyVersion?: string;
	trainingRemindersEnabled: boolean;
	updatedAt: string;
}

export interface CoachRelationshipStore {
	load(scope: CoachUserScope): Promise<CoachRelationship | null>;
	save(scope: CoachUserScope, relationship: CoachRelationship): Promise<void>;
}

export class FileCoachRelationshipStore implements CoachRelationshipStore {
	async load(scope: CoachUserScope): Promise<CoachRelationship | null> {
		try {
			const raw = await readFile(join(scope.userDir, "relationship.json"), "utf-8");
			return parseRelationship(JSON.parse(raw) as unknown, scope);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") return null;
			if (error instanceof SyntaxError) {
				throw new Error(`Invalid JSON in relationship for ${scope.userKey}: ${error.message}`);
			}
			throw error;
		}
	}

	async save(scope: CoachUserScope, relationship: CoachRelationship): Promise<void> {
		const validated = parseRelationship(relationship, scope);
		await mkdir(scope.userDir, { recursive: true });
		const release = await lockfile.lock(scope.userDir, {
			realpath: false,
			retries: { retries: 5, factor: 2, minTimeout: 10, maxTimeout: 200 },
		});
		const targetPath = join(scope.userDir, "relationship.json");
		const tempPath = join(scope.userDir, `.relationship.${process.pid}.${randomUUID()}.tmp`);
		try {
			await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
			await rename(tempPath, targetPath);
		} finally {
			await rm(tempPath, { force: true });
			await release();
		}
	}
}

export function createRelationship(
	scope: CoachUserScope,
	status: CoachRelationshipStatus,
	now: string,
	additional: Partial<CoachRelationship> = {},
): CoachRelationship {
	return {
		...additional,
		version: 1,
		tenantKey: scope.tenantKey,
		openId: scope.openId,
		status,
		trainingRemindersEnabled: additional.trainingRemindersEnabled ?? false,
		updatedAt: now,
	};
}

function parseRelationship(value: unknown, scope: CoachUserScope): CoachRelationship {
	if (!isRecord(value)) throw new Error(`Invalid relationship for ${scope.userKey}`);
	if (value.version !== 1 || value.tenantKey !== scope.tenantKey || value.openId !== scope.openId) {
		throw new Error(`Relationship identity mismatch for ${scope.userKey}`);
	}
	if (!isRelationshipStatus(value.status) || typeof value.trainingRemindersEnabled !== "boolean") {
		throw new Error(`Invalid relationship state for ${scope.userKey}`);
	}
	if (typeof value.updatedAt !== "string") throw new Error(`Invalid relationship timestamp for ${scope.userKey}`);
	return value as unknown as CoachRelationship;
}

function isRelationshipStatus(value: unknown): value is CoachRelationshipStatus {
	return ["invited", "active", "declined", "revoked", "invite_failed"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
