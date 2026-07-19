import type * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { FeishuBot, parseFeishuMessageEvent, parseFeishuUserLifecycleEvent } from "../src/feishu.js";

function rawMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		tenant_key: "tenant_a",
		sender: { sender_id: { open_id: "ou_user_a", union_id: "on_union_a" } },
		message: {
			chat_id: "oc_chat_a",
			message_id: "om_message_a",
			chat_type: "p2p",
			content: JSON.stringify({ text: "开始" }),
		},
		...overrides,
	};
}

function createBot(create: (payload: unknown) => Promise<unknown>) {
	const messageCreate = vi.fn(create);
	const client = { im: { v1: { message: { create: messageCreate } } } } as unknown as Lark.Client;
	const wsClient = { start: vi.fn() } as unknown as Lark.WSClient;
	return {
		bot: new FeishuBot({ appId: "app", appSecret: "secret", botName: "FitClaw" }, "/tmp", {
			client,
			wsClient,
		}),
		messageCreate,
	};
}

describe("Feishu private coach events", () => {
	it("strictly parses tenant, user, chat and message identity", () => {
		expect(parseFeishuMessageEvent(rawMessage(), "FitClaw")).toMatchObject({
			tenantKey: "tenant_a",
			chatId: "oc_chat_a",
			messageId: "om_message_a",
			chatType: "p2p",
			user: { openId: "ou_user_a", unionId: "on_union_a" },
		});

		expect(() => parseFeishuMessageEvent(rawMessage({ tenant_key: undefined }), "FitClaw")).toThrow(/tenantKey/);
		expect(() =>
			parseFeishuMessageEvent(rawMessage({ sender: { sender_id: { open_id: "../shared" } } }), "FitClaw"),
		).toThrow(/openId/);
	});

	it("ignores unmentioned group messages and parses mentioned ones", () => {
		const groupMessage = {
			...rawMessage(),
			message: {
				chat_id: "oc_group_a",
				message_id: "om_group_a",
				chat_type: "group",
				content: JSON.stringify({ text: "@_user_1 帮我" }),
				mentions: [{ key: "@_user_1", name: "FitClaw" }],
			},
		};
		expect(parseFeishuMessageEvent(groupMessage, "OtherBot")).toBeNull();
		expect(parseFeishuMessageEvent(groupMessage, "FitClaw")?.text).toBe("帮我");
	});

	it("parses created and deleted user events", () => {
		const raw = { tenant_key: "tenant_a", object: { open_id: "ou_user_a" } };
		expect(parseFeishuUserLifecycleEvent(raw, "joined")).toEqual({
			type: "joined",
			tenantKey: "tenant_a",
			openId: "ou_user_a",
		});
		expect(parseFeishuUserLifecycleEvent(raw, "left").type).toBe("left");
	});

	it("sends direct messages using open_id and returns the message id", async () => {
		const { bot, messageCreate } = createBot(async () => ({ code: 0, data: { message_id: "om_sent" } }));
		await expect(bot.sendDirectMessage("ou_user_a", "hello")).resolves.toBe("om_sent");
		expect(messageCreate).toHaveBeenCalledWith({
			params: { receive_id_type: "open_id" },
			data: { receive_id: "ou_user_a", msg_type: "text", content: JSON.stringify({ text: "hello" }) },
		});
	});

	it("throws when Feishu rejects a direct message or omits message_id", async () => {
		const rejected = createBot(async () => ({ code: 230013, msg: "outside availability" })).bot;
		const empty = createBot(async () => ({ code: 0, data: {} })).bot;
		await expect(rejected.sendDirectMessage("ou_user_a", "hello")).rejects.toThrow(/outside availability/);
		await expect(empty.sendDirectMessage("ou_user_a", "hello")).rejects.toThrow(/empty message_id/);
	});

	it("deduplicates callbacks by message_id", async () => {
		const { bot } = createBot(async () => ({ code: 0, data: { message_id: "om_sent" } }));
		const handler = vi.fn(async () => undefined);
		bot.onMessage(handler);
		const internal = bot as unknown as { handleMessage(data: unknown): Promise<void> };

		await internal.handleMessage(rawMessage());
		await internal.handleMessage(rawMessage({ event_id: "different_callback" }));
		expect(handler).toHaveBeenCalledOnce();
	});
});
