import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeishuEvent, FeishuUserLifecycleEvent } from "../src/feishu.js";
import {
	GROUP_PRIVACY_REDIRECT,
	PRIVATE_COACH_ACTIVATION_PROMPT,
	PrivateCoachService,
} from "../src/private-coach-service.js";
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("PrivateCoachService", () => {
	let workspaceDir: string;
	let directMessages: string[];
	let replies: string[];
	let runCoach: ReturnType<typeof vi.fn>;
	let abortUserRuns: ReturnType<typeof vi.fn>;
	let service: PrivateCoachService;
	let relationships: FileCoachRelationshipStore;

	beforeEach(() => {
		workspaceDir = join(tmpdir(), `fitclaw-private-coach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		directMessages = [];
		replies = [];
		runCoach = vi.fn(async () => undefined);
		abortUserRuns = vi.fn();
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
			abortUserRuns,
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
		const results = await Promise.all([service.handleUserJoined(joined), service.handleUserJoined(joined)]);
		expect(results.map((result) => result.status).sort()).toEqual(["invited", "skipped"]);
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

	it("shows the memory policy before accepting a first-message activation", async () => {
		await service.handleMessage(message("开始"));
		const invited = await relationships.load(resolveCoachUserScope(workspaceDir, joined));
		expect(invited).toMatchObject({ status: "invited", inviteState: "sent" });
		expect(invited?.memoryPolicyVersion).toBeUndefined();
		expect(replies).toEqual([PRIVATE_COACH_ACTIVATION_PROMPT]);
		expect(runCoach).not.toHaveBeenCalled();

		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("active");

		await service.handleMessage(message("我的目标是增肌"));
		expect(runCoach).toHaveBeenCalledOnce();
	});

	it("allows opt-in after declining and lets an active user withdraw", async () => {
		await service.handleMessage(message("你好"));
		await service.handleMessage(message("暂不"));
		await service.handleMessage(message("帮我读取计划"));
		expect(runCoach).not.toHaveBeenCalled();

		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("active");
		await service.handleMessage(message("停用"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("declined");
		expect(runCoach).not.toHaveBeenCalled();
		expect(abortUserRuns).toHaveBeenCalledOnce();
	});

	it("persists an active user's withdrawal and aborts the current run immediately", async () => {
		await service.handleMessage(message("你好"));
		await service.handleMessage(message("开始"));
		const started = deferred();
		let statusAtAbort: string | undefined;
		runCoach.mockImplementationOnce(async (_event, scope, signal: AbortSignal) => {
			started.resolve();
			await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			statusAtAbort = (await relationships.load(scope))?.status;
		});

		const running = service.handleMessage(message("开始今天的训练"));
		await started.promise;
		const withdrawing = service.handleMessage(message("停用"));

		await Promise.all([running, withdrawing]);
		expect(statusAtAbort).toBe("declined");
		expect(abortUserRuns).toHaveBeenCalledOnce();
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("declined");
	});

	it("persists revocation and aborts an in-flight coach run", async () => {
		await service.handleMessage(message("你好"));
		await service.handleMessage(message("开始"));
		const started = deferred();
		let didObserveAbort = false;
		runCoach.mockImplementationOnce(async (_event, _scope, signal: AbortSignal) => {
			started.resolve();
			await new Promise<void>((resolve) => {
				if (signal.aborted) resolve();
				else signal.addEventListener("abort", () => resolve(), { once: true });
			});
			didObserveAbort = true;
		});

		const running = service.handleMessage(message("开始今天的训练"));
		await started.promise;
		const repliesBeforeRevocation = [...replies];
		const queued = service.handleMessage(message("读取我的计划"));
		abortUserRuns.mockImplementationOnce(async (scope) => {
			expect((await relationships.load(scope))?.status).toBe("revoked");
		});
		const leaving = service.handleUserLeft({ ...joined, type: "left" });

		await leaving;
		await Promise.all([running, queued]);
		expect(abortUserRuns).toHaveBeenCalledOnce();
		expect(didObserveAbort).toBe(true);
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("revoked");
		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("revoked");
		expect(runCoach).toHaveBeenCalledOnce();
		expect(replies).toEqual(repliesBeforeRevocation);
	});

	it("re-invites a revoked user without restoring access before consent", async () => {
		await service.handleMessage(message("你好"));
		await service.handleMessage(message("开始"));
		await service.handleUserLeft({ ...joined, type: "left" });

		expect((await service.handleUserJoined(joined)).status).toBe("invited");
		expect((await service.handleUserJoined(joined)).status).toBe("skipped");
		expect(directMessages).toHaveLength(1);
		expect(await relationships.load(resolveCoachUserScope(workspaceDir, joined))).toMatchObject({
			status: "invited",
			inviteState: "sent",
		});
		expect(runCoach).not.toHaveBeenCalled();

		await service.handleMessage(message("开始"));
		expect((await relationships.load(resolveCoachUserScope(workspaceDir, joined)))?.status).toBe("active");
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
