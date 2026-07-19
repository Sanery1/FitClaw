import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeishuEvent, FeishuUserLifecycleEvent } from "../src/feishu.js";
import { GROUP_PRIVACY_REDIRECT, PrivateCoachService } from "../src/private-coach-service.js";
import { FileCoachRelationshipStore } from "../src/relationships.js";
import { resolveCoachSessionScope, resolveCoachUserScope } from "../src/runtime/coach-scope.js";

function message(text: string, chatType: "p2p" | "group" = "p2p"): FeishuEvent {
	return {
		type: chatType === "p2p" ? "dm" : "mention",
		chatType,
		tenantKey: "tenant_a",
		chatId: "oc_chat_a",
		messageId: `om_${text.length}_${chatType}`,
		user: { openId: "ou_user_a" },
		text,
	};
}

const joined: FeishuUserLifecycleEvent = { type: "joined", tenantKey: "tenant_a", openId: "ou_user_a" };

describe("PrivateCoachService", () => {
	let workspaceDir: string;
	let directMessages: string[];
	let replies: string[];
	let runCoach: ReturnType<typeof vi.fn>;
	let service: PrivateCoachService;
	let relationships: FileCoachRelationshipStore;

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-private-coach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		directMessages = [];
		replies = [];
		runCoach = vi.fn(async () => undefined);
		relationships = new FileCoachRelationshipStore();
		service = new PrivateCoachService({
			relationships,
			transport: {
				sendDirectMessage: async (openId, text) => {
					directMessages.push(`${openId}:${text}`);
					return "om_invitation";
				},
				sendThreadMessage: async (_messageId, text) => {
					replies.push(text);
				},
			},
			runCoach,
			resolveUserScope: (event) => resolveCoachUserScope(workspaceDir, event),
			resolveSessionScope: (event) =>
				resolveCoachSessionScope(workspaceDir, {
					tenantKey: event.tenantKey,
					openId: event.user.openId,
					chatId: event.chatId,
				}),
			now: () => new Date("2026-07-19T08:00:00.000Z"),
		});
	});

	afterEach(() => rmSync(workspaceDir, { recursive: true, force: true }));

	it("sends exactly one invitation for duplicate employee events", async () => {
		expect((await service.handleUserJoined(joined)).status).toBe("invited");
		expect((await service.handleUserJoined(joined)).status).toBe("skipped");
		expect(directMessages).toHaveLength(1);
		const relationship = await relationships.load(resolveCoachUserScope(workspaceDir, joined));
		expect(relationship).toMatchObject({ status: "invited", inviteState: "sent", inviteMessageId: "om_invitation" });
	});

	it("does not create sport data before activation", async () => {
		await service.handleMessage(message("你好"));
		const scope = resolveCoachUserScope(workspaceDir, joined);

		expect((await relationships.load(scope))?.status).toBe("invited");
		expect(existsSync(join(scope.userDir, "sport-data"))).toBe(false);
		expect(runCoach).not.toHaveBeenCalled();
	});

	it("activates from private chat and only then runs the coach", async () => {
		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("active");
		expect(runCoach).not.toHaveBeenCalled();

		await service.handleMessage(message("我的目标是增肌"));
		expect(runCoach).toHaveBeenCalledOnce();
	});

	it("declines and revokes without invoking the coach", async () => {
		await service.handleMessage(message("暂不"));
		await service.handleMessage(message("帮我读取计划"));
		expect(runCoach).not.toHaveBeenCalled();

		await service.handleUserLeft({ ...joined, type: "left" });
		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("revoked");
		expect(runCoach).not.toHaveBeenCalled();
	});

	it("redirects group messages without loading relationships or running the coach", async () => {
		const loadSpy = vi.spyOn(relationships, "load");
		await service.handleMessage(message("@FitClaw 帮我看计划", "group"));

		expect(replies).toEqual([GROUP_PRIVACY_REDIRECT]);
		expect(loadSpy).not.toHaveBeenCalled();
		expect(runCoach).not.toHaveBeenCalled();
	});

	it("persists a clear invitation failure and does not retry duplicate callbacks", async () => {
		const failedService = new PrivateCoachService({
			relationships,
			transport: {
				sendDirectMessage: async () => {
					throw new Error("user is outside app availability");
				},
				sendThreadMessage: async () => undefined,
			},
			runCoach,
			resolveUserScope: (event) => resolveCoachUserScope(workspaceDir, event),
			resolveSessionScope: (event) =>
				resolveCoachSessionScope(workspaceDir, { ...event, openId: event.user.openId }),
		});

		expect(await failedService.handleUserJoined(joined)).toMatchObject({ status: "failed" });
		expect(await failedService.handleUserJoined(joined)).toEqual({ status: "skipped" });
		expect(await relationships.load(resolveCoachUserScope(workspaceDir, joined))).toMatchObject({
			status: "invite_failed",
			inviteFailure: { reason: "user is outside app availability" },
		});
	});
});
