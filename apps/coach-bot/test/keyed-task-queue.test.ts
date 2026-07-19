import { describe, expect, it } from "vitest";
import { KeyedTaskQueue } from "../src/runtime/keyed-task-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("KeyedTaskQueue", () => {
	it("serializes tasks for the same user", async () => {
		const queue = new KeyedTaskQueue();
		const gate = deferred();
		const started = deferred();
		const events: string[] = [];
		const first = queue.run("tenant/user", async () => {
			events.push("first-start");
			started.resolve();
			await gate.promise;
			events.push("first-end");
		});
		const second = queue.run("tenant/user", async () => {
			events.push("second-start");
		});

		await started.promise;
		expect(events).toEqual(["first-start"]);
		gate.resolve();
		await Promise.all([first, second]);
		expect(events).toEqual(["first-start", "first-end", "second-start"]);
	});

	it("allows different users to run concurrently", async () => {
		const queue = new KeyedTaskQueue();
		const gate = deferred();
		const events: string[] = [];
		const first = queue.run("tenant/user-a", async () => {
			events.push("a");
			await gate.promise;
		});
		const second = queue.run("tenant/user-b", async () => {
			events.push("b");
		});

		await second;
		expect(events).toEqual(["a", "b"]);
		gate.resolve();
		await first;
	});

	it("prevents same-user read-modify-write updates from losing records", async () => {
		const queue = new KeyedTaskQueue();
		const dataDir = join(tmpdir(), `fitclaw-queued-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const append = (id: string) =>
			queue.run("tenant/user", async () => {
				const store = new FileSkillDataStore(dataDir);
				const current = (await store.load<Array<{ id: string }>>("bodybuilding/training_log")) ?? [];
				await store.save("bodybuilding/training_log", [...current, { id }]);
			});
		try {
			await Promise.all([append("first"), append("second")]);
			const store = new FileSkillDataStore(dataDir);
			expect(await store.load("bodybuilding/training_log")).toEqual([{ id: "first" }, { id: "second" }]);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});
});

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSkillDataStore } from "@fitclaw/runtime";
