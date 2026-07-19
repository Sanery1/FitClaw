import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExistingUserInvitationCli } from "../src/existing-user-invitations.js";

describe("existing user invitations", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("is dry-run by default and deduplicates users from the mapping", async () => {
		const dir = join(tmpdir(), `fitclaw-existing-invite-${Date.now()}`);
		tempDirs.push(dir);
		mkdirSync(dir, { recursive: true });
		const mappingPath = join(dir, "mapping.json");
		writeFileSync(
			mappingPath,
			JSON.stringify({
				version: 1,
				sessions: [
					{ chatId: "oc_a", tenantKey: "tenant_a", openId: "ou_a", kind: "dm" },
					{ chatId: "oc_b", tenantKey: "tenant_a", openId: "ou_a", kind: "dm" },
				],
			}),
		);
		const sendInvitation = vi.fn(async () => ({ status: "invited" as const, messageId: "om_sent" }));
		const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runExistingUserInvitationCli([dir, "--mapping", mappingPath], sendInvitation);
		expect(sendInvitation).not.toHaveBeenCalled();
		expect(output).toHaveBeenCalledOnce();
		expect(String(output.mock.calls[0][0])).toContain('"result": "candidate"');
	});

	it("requires --send before dispatching one invitation per user", async () => {
		const dir = join(tmpdir(), `fitclaw-existing-send-${Date.now()}`);
		tempDirs.push(dir);
		mkdirSync(dir, { recursive: true });
		const mappingPath = join(dir, "mapping.json");
		writeFileSync(
			mappingPath,
			JSON.stringify({
				version: 1,
				sessions: [{ chatId: "oc_a", tenantKey: "tenant_a", openId: "ou_a", kind: "dm" }],
			}),
		);
		const sendInvitation = vi.fn(async () => ({ status: "invited" as const, messageId: "om_sent" }));
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runExistingUserInvitationCli([dir, "--mapping", mappingPath, "--send"], sendInvitation);
		expect(sendInvitation).toHaveBeenCalledOnce();
	});
});
