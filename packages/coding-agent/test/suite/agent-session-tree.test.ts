import { fauxAssistantMessage } from "@fitclaw/ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.js";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession tree navigation", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("navigates to a user message and restores its text for editing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const targetId = harness.sessionManager.appendMessage(userMsg("first message"));
		harness.sessionManager.appendMessage(assistantMsg("first reply"));
		harness.sessionManager.appendMessage(userMsg("second message"));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const result = await harness.session.navigateTree(targetId, { summarize: false });

		expect(result).toEqual({ editorText: "first message", cancelled: false, summaryEntry: undefined });
		expect(harness.sessionManager.getLeafId()).toBeNull();
		expect(harness.session.messages).toEqual([]);
		expect(harness.session.getUserMessagesForForking()).toEqual([
			{ entryId: targetId, text: "first message" },
			expect.objectContaining({ text: "second message" }),
		]);
	});

	it("uses an extension summary and emits the resulting tree event", async () => {
		const treeEvents: Array<{ fromExtension?: boolean; summary?: string }> = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_tree", () => ({
						summary: { summary: "extension branch summary", details: { source: "extension" } },
						label: "abandoned branch",
					}));
					pi.on("session_tree", (event) => {
						treeEvents.push({
							fromExtension: event.fromExtension,
							summary: event.summaryEntry?.summary,
						});
					});
				},
			],
		});
		harnesses.push(harness);
		const targetId = harness.sessionManager.appendMessage(userMsg("keep this prompt"));
		harness.sessionManager.appendMessage(assistantMsg("old answer"));
		harness.sessionManager.appendMessage(userMsg("abandoned work"));

		const result = await harness.session.navigateTree(targetId, { summarize: true });

		expect(result.cancelled).toBe(false);
		expect(result.summaryEntry).toMatchObject({
			type: "branch_summary",
			summary: "extension branch summary",
			fromHook: true,
		});
		expect(harness.sessionManager.getLabel(result.summaryEntry!.id)).toBe("abandoned branch");
		expect(treeEvents).toEqual([{ fromExtension: true, summary: "extension branch summary" }]);
	});

	it("generates a branch summary through the configured model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const targetId = harness.sessionManager.appendMessage(userMsg("original prompt"));
		harness.sessionManager.appendMessage(assistantMsg("old answer"));
		harness.sessionManager.appendMessage(userMsg("work to summarize"));
		harness.setResponses([fauxAssistantMessage("generated branch summary")]);

		const result = await harness.session.navigateTree(targetId, { summarize: true });

		expect(result.cancelled).toBe(false);
		expect(result.summaryEntry).toMatchObject({
			type: "branch_summary",
			fromHook: false,
		});
		expect(result.summaryEntry?.summary).toContain("generated branch summary");
		expect(harness.faux.state.callCount).toBe(1);
	});
});
