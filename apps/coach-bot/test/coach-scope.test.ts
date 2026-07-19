import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCoachSessionScope } from "../src/runtime/coach-scope.js";

describe("private coach scope", () => {
	const workspaceDir = join("tmp", "fitclaw-scope");

	it("shares user data across private chats but separates sessions", () => {
		const first = resolveCoachSessionScope(workspaceDir, {
			tenantKey: "tenant_a",
			openId: "ou_user_a",
			chatId: "oc_chat_a",
		});
		const second = resolveCoachSessionScope(workspaceDir, {
			tenantKey: "tenant_a",
			openId: "ou_user_a",
			chatId: "oc_chat_b",
		});

		expect(first.userDataDir).toBe(second.userDataDir);
		expect(first.sessionDir).not.toBe(second.sessionDir);
	});

	it("isolates the same open_id across tenants", () => {
		const first = resolveCoachSessionScope(workspaceDir, {
			tenantKey: "tenant_a",
			openId: "ou_shared",
			chatId: "oc_chat_a",
		});
		const second = resolveCoachSessionScope(workspaceDir, {
			tenantKey: "tenant_b",
			openId: "ou_shared",
			chatId: "oc_chat_b",
		});

		expect(first.userDataDir).not.toBe(second.userDataDir);
		expect(first.userKey).not.toBe(second.userKey);
	});

	it.each([
		{ tenantKey: "", openId: "ou_user", chatId: "oc_chat" },
		{ tenantKey: "tenant", openId: "unknown/user", chatId: "oc_chat" },
		{ tenantKey: "tenant", openId: "ou_user", chatId: "../escape" },
	])("rejects missing or unsafe identity values", (identity) => {
		expect(() => resolveCoachSessionScope(workspaceDir, identity)).toThrow(/invalid or missing/i);
	});
});
