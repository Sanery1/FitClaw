import { describe, expect, it } from "vitest";
import { resolveBotProvider } from "../src/types.js";

describe("resolveBotProvider", () => {
	it("returns 'slack' by default", () => {
		expect(resolveBotProvider()).toBe("slack");
	});

	it("returns 'feishu' when FITCLAW_BOT_PROVIDER=feishu", () => {
		process.env.FITCLAW_BOT_PROVIDER = "feishu";
		expect(resolveBotProvider()).toBe("feishu");
		delete process.env.FITCLAW_BOT_PROVIDER;
	});

	it("returns 'slack' for unknown provider value", () => {
		process.env.FITCLAW_BOT_PROVIDER = "unknown";
		expect(resolveBotProvider()).toBe("slack");
		delete process.env.FITCLAW_BOT_PROVIDER;
	});

	it("handles case-insensitive input", () => {
		process.env.FITCLAW_BOT_PROVIDER = "FEISHU";
		expect(resolveBotProvider()).toBe("feishu");
		delete process.env.FITCLAW_BOT_PROVIDER;
	});
});
