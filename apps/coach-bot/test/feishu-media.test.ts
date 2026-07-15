import type * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { FeishuBot } from "../src/feishu.js";

function createTestBot(options: { imageKey?: string; fileKey?: string } = {}) {
	const imageCreate = vi.fn(async (_payload: unknown) =>
		options.imageKey === undefined ? {} : { image_key: options.imageKey },
	);
	const fileCreate = vi.fn(async (_payload: unknown) =>
		options.fileKey === undefined ? {} : { file_key: options.fileKey },
	);
	const reply = vi.fn(async (_payload: unknown) => ({ code: 0 }));
	const client = {
		im: {
			v1: { image: { create: imageCreate }, file: { create: fileCreate } },
			message: { reply },
		},
	} as unknown as Lark.Client;
	const wsClient = { start: vi.fn() } as unknown as Lark.WSClient;
	const bot = new FeishuBot({ appId: "test-app", appSecret: "test-secret" }, "/tmp/fitclaw-test", {
		client,
		wsClient,
	});
	return { bot, fileCreate, imageCreate, reply };
}

describe("Feishu media replies", () => {
	it("uploads an exercise image and replies with its image key", async () => {
		const { bot, fileCreate, imageCreate, reply } = createTestBot({ imageKey: "img_test" });
		const data = Buffer.from("image-data");

		await bot.sendMediaReply("message-1", { data, fileName: "press.JPG", title: "Incline press" });

		expect(imageCreate).toHaveBeenCalledWith({ data: { image_type: "message", image: data } });
		expect(fileCreate).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith({
			path: { message_id: "message-1" },
			data: { content: JSON.stringify({ image_key: "img_test" }), msg_type: "image" },
		});
	});

	it("uploads a non-image using the matching Feishu file type", async () => {
		const { bot, fileCreate, imageCreate, reply } = createTestBot({ fileKey: "file_test" });
		const data = Buffer.from("document-data");

		await bot.sendMediaReply("message-2", { data, fileName: "plan.pdf", title: "Training plan.pdf" });

		expect(fileCreate).toHaveBeenCalledWith({
			data: { file_type: "pdf", file_name: "Training plan.pdf", file: data },
		});
		expect(imageCreate).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith({
			path: { message_id: "message-2" },
			data: { content: JSON.stringify({ file_key: "file_test" }), msg_type: "file" },
		});
	});

	it("fails clearly when Feishu returns no uploaded media key", async () => {
		const { bot, reply } = createTestBot();

		await expect(
			bot.sendMediaReply("message-3", { data: Buffer.from("image-data"), fileName: "press.png" }),
		).rejects.toThrow(/image_key/);
		expect(reply).not.toHaveBeenCalled();
	});
});
