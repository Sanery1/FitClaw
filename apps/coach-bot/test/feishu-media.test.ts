import type * as Lark from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { FeishuBot } from "../src/feishu.js";

interface TestBotOptions {
	imageKey?: string;
	fileKey?: string;
	createImage?: () => Promise<{ image_key?: string }>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createTestBot(options: TestBotOptions = {}) {
	const imageCreate = vi.fn(async (_payload: unknown) => {
		if (options.createImage) return options.createImage();
		return options.imageKey === undefined ? {} : { image_key: options.imageKey };
	});
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

	it("does not send a media reply when access is revoked during upload", async () => {
		const uploadStarted = deferred<void>();
		const uploadFinished = deferred<{ image_key: string }>();
		const controller = new AbortController();
		const { bot, reply } = createTestBot({
			createImage: async () => {
				uploadStarted.resolve();
				return uploadFinished.promise;
			},
		});

		const sending = bot.sendMediaReply(
			"message-4",
			{ data: Buffer.from("image-data"), fileName: "press.png" },
			controller.signal,
		);
		await uploadStarted.promise;
		controller.abort();
		uploadFinished.resolve({ image_key: "img_test" });

		await expect(sending).rejects.toThrow();
		expect(reply).not.toHaveBeenCalled();
	});
});
