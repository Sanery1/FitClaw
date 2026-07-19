import { join, resolve } from "node:path";

const FEISHU_PATH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface CoachUserIdentity {
	tenantKey: string;
	openId: string;
}

export interface CoachSessionIdentity extends CoachUserIdentity {
	chatId: string;
}

export interface CoachUserScope extends CoachUserIdentity {
	userKey: string;
	userDir: string;
	userDataDir: string;
}

export interface CoachSessionScope extends CoachUserScope {
	chatId: string;
	sessionKey: string;
	sessionDir: string;
}

export function assertFeishuPathId(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !FEISHU_PATH_ID_PATTERN.test(value)) {
		throw new Error(`Invalid or missing Feishu ${field}`);
	}
}

export function resolveCoachUserScope(workspaceDir: string, identity: CoachUserIdentity): CoachUserScope {
	assertFeishuPathId(identity.tenantKey, "tenantKey");
	assertFeishuPathId(identity.openId, "openId");

	const workspaceRoot = resolve(workspaceDir);
	const userDir = join(workspaceRoot, "tenants", identity.tenantKey, "users", identity.openId);
	return {
		...identity,
		userKey: `${identity.tenantKey}/${identity.openId}`,
		userDir,
		userDataDir: userDir,
	};
}

export function resolveCoachSessionScope(workspaceDir: string, identity: CoachSessionIdentity): CoachSessionScope {
	assertFeishuPathId(identity.chatId, "chatId");
	const userScope = resolveCoachUserScope(workspaceDir, identity);
	return {
		...userScope,
		chatId: identity.chatId,
		sessionKey: `${userScope.userKey}/${identity.chatId}`,
		sessionDir: join(userScope.userDir, "sessions", identity.chatId),
	};
}
