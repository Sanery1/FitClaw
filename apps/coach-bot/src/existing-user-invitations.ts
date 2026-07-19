import type { FeishuUserLifecycleEvent } from "./feishu.js";
import { loadMemoryMigrationManifest } from "./memory-migration.js";
import type { InvitationResult } from "./private-coach-service.js";

export interface ExistingUserInvitationReport {
	mode: "dry-run" | "send";
	workspaceDir: string;
	users: Array<{
		tenantKey: string;
		openId: string;
		result: "candidate" | InvitationResult["status"];
		reason?: string;
	}>;
}

export async function runExistingUserInvitationCli(
	args: string[],
	sendInvitation: (workspaceDir: string, event: FeishuUserLifecycleEvent) => Promise<InvitationResult>,
): Promise<void> {
	let workspaceDir: string | undefined;
	let mappingPath: string | undefined;
	let shouldSend = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--mapping") mappingPath = requireValue(args, ++index, "--mapping");
		else if (arg === "--send") shouldSend = true;
		else if (!arg.startsWith("-") && workspaceDir === undefined) workspaceDir = arg;
		else throw new Error(`Unknown invite-existing argument: ${arg}`);
	}
	if (!workspaceDir || !mappingPath) {
		throw new Error("Usage: fitclaw-coach invite-existing <working-directory> --mapping <manifest.json> [--send]");
	}

	const manifest = await loadMemoryMigrationManifest(mappingPath);
	const uniqueUsers = new Map<string, FeishuUserLifecycleEvent>();
	for (const entry of manifest.sessions) {
		const key = `${entry.tenantKey}/${entry.openId}`;
		uniqueUsers.set(key, { type: "joined", tenantKey: entry.tenantKey, openId: entry.openId });
	}
	const report: ExistingUserInvitationReport = { mode: shouldSend ? "send" : "dry-run", workspaceDir, users: [] };
	for (const event of uniqueUsers.values()) {
		if (!shouldSend) {
			report.users.push({ tenantKey: event.tenantKey, openId: event.openId, result: "candidate" });
			continue;
		}
		const result = await sendInvitation(workspaceDir, event);
		report.users.push({
			tenantKey: event.tenantKey,
			openId: event.openId,
			result: result.status,
			...(result.status === "failed" ? { reason: result.reason } : {}),
		});
	}
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function requireValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
	return value;
}
