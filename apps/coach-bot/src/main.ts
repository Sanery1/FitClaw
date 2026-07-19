#!/usr/bin/env node

import { join, resolve } from "path";
import { renderFeishuCard } from "./adapters/feishu/card-renderer.js";
import { abortUserRunners, getOrCreateRunner } from "./agent.js";
import { runExistingUserInvitationCli } from "./existing-user-invitations.js";
import { FeishuBot, type FeishuEvent } from "./feishu.js";
import { runKnowledgeCli } from "./knowledge/cli.js";
import * as log from "./log.js";
import { runMemoryMigrationCli } from "./memory-migration.js";
import { PrivateCoachService } from "./private-coach-service.js";
import { FileCoachRelationshipStore } from "./relationships.js";
import { resolveCoachSessionScope, resolveCoachUserScope } from "./runtime/coach-scope.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import type { BotContext } from "./types.js";

// ============================================================================
// Config
// ============================================================================

const FEISHU_APP_ID = process.env.MOM_FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.MOM_FEISHU_APP_SECRET;
const FEISHU_BOT_NAME = process.env.MOM_FEISHU_BOT_NAME || "FitClaw";

if (process.argv[2] === "knowledge") {
	try {
		await runKnowledgeCli(process.argv.slice(3));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	process.exit(0);
}

if (process.argv[2] === "migrate-memory") {
	try {
		await runMemoryMigrationCli(process.argv.slice(3));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	process.exit(0);
}

if (process.argv[2] === "invite-existing") {
	try {
		let invitationService: PrivateCoachService | undefined;
		await runExistingUserInvitationCli(process.argv.slice(3), async (invitationWorkspace, event) => {
			if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
				throw new Error("MOM_FEISHU_APP_ID and MOM_FEISHU_APP_SECRET are required with --send");
			}
			if (!invitationService) {
				const invitationBot = new FeishuBot(
					{ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET, botName: FEISHU_BOT_NAME },
					invitationWorkspace,
				);
				invitationService = new PrivateCoachService({
					relationships: new FileCoachRelationshipStore(),
					transport: invitationBot,
					runCoach: async () => undefined,
					resolveUserScope: (lifecycleEvent) => resolveCoachUserScope(invitationWorkspace, lifecycleEvent),
					resolveSessionScope: (messageEvent) =>
						resolveCoachSessionScope(invitationWorkspace, {
							tenantKey: messageEvent.tenantKey,
							openId: messageEvent.user.openId,
							chatId: messageEvent.chatId,
						}),
				});
			}
			return invitationService.inviteUser(event, "migration");
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	process.exit(0);
}

interface ParsedArgs {
	workingDir?: string;
	sandbox: SandboxConfig;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			sandbox = parseSandboxArg(args[++i] || "");
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	return {
		workingDir: workingDir ? resolve(workingDir) : undefined,
		sandbox,
	};
}

const parsedArgs = parseArgs();

if (!parsedArgs.workingDir) {
	console.error("Usage: fitclaw-coach [--sandbox=host|docker:<name>] <working-directory>");
	process.exit(1);
}

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
	console.error("Missing required environment variables:");
	console.error("  MOM_FEISHU_APP_ID");
	console.error("  MOM_FEISHU_APP_SECRET");
	process.exit(1);
}

const { workingDir, sandbox } = { workingDir: parsedArgs.workingDir, sandbox: parsedArgs.sandbox };

await validateSandbox(sandbox);

// ============================================================================
// Feishu Context Adapter
// ============================================================================

function createFeishuContext(event: FeishuEvent, bot: FeishuBot, signal: AbortSignal): BotContext {
	let accumulatedText = "";
	let _isWorking = true;
	let updatePromise = Promise.resolve();
	let finalSent = false;

	const flushResponse = async () => {
		if (signal.aborted || finalSent || !accumulatedText.trim()) return;
		finalSent = true;
		try {
			const card = renderFeishuCard(accumulatedText);
			const cardJson = JSON.stringify(card);
			log.logInfo(`Sending card: ${card.elements?.length || 0} elements, ${cardJson.length} bytes`);
			signal.throwIfAborted();
			await bot.sendCardMessage(event.messageId, card);
			log.logInfo("Card sent successfully");
		} catch (err) {
			if (signal.aborted) return;
			log.logWarning(
				"Feishu card render/send failed, falling back to text",
				err instanceof Error ? err.message : String(err),
			);
			try {
				signal.throwIfAborted();
				await bot.sendThreadMessage(event.messageId, accumulatedText);
			} catch (err2) {
				log.logWarning("Feishu flush response error", err2 instanceof Error ? err2.message : String(err2));
			}
		}
	};

	return {
		message: {
			text: event.text,
			rawText: event.text,
			user: event.user.openId,
			userName: event.user.name,
			channel: event.chatId,
			ts: event.messageId,
			attachments: (event.files || []).map((f) => ({ local: f.downloadedPath || "" })),
		},
		channels: [],
		users: event.user.name
			? [{ id: event.user.openId, userName: event.user.name, displayName: event.user.name }]
			: [],

		respond: async (text: string, _shouldLog?: boolean) => {
			updatePromise = updatePromise.then(async () => {
				if (signal.aborted) return;
				accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;

				const MAX_MAIN_LENGTH = 30000;
				const truncationNote = "\n\n_(message truncated)_";
				if (accumulatedText.length > MAX_MAIN_LENGTH) {
					accumulatedText = accumulatedText.substring(0, MAX_MAIN_LENGTH - truncationNote.length) + truncationNote;
				}
			});
			await updatePromise;
		},

		replaceMessage: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				if (signal.aborted) return;
				accumulatedText = text;
			});
			await updatePromise;
		},

		respondInThread: async (_text: string) => {
			// Suppressed in Feishu v1. Final response is sent via flushResponse().
		},

		setTyping: async () => {
			// Feishu text messages cannot be edited. No typing indicator.
		},

		uploadFile: async (upload) => {
			signal.throwIfAborted();
			await bot.sendMediaReply(event.messageId, upload, signal);
		},

		setWorking: async (working: boolean) => {
			updatePromise = updatePromise.then(async () => {
				if (signal.aborted) return;
				_isWorking = working;
				if (!working) {
					await flushResponse();
				}
			});
			await updatePromise;
		},

		deleteMessage: async () => {
			// Feishu message deletion not implemented in v1.
		},
	};
}

// ============================================================================
// Start
// ============================================================================

log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

const bot = new FeishuBot({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET, botName: FEISHU_BOT_NAME }, workingDir);
const relationships = new FileCoachRelationshipStore();
const service = new PrivateCoachService({
	relationships,
	transport: bot,
	resolveUserScope: (event) => resolveCoachUserScope(workingDir, event),
	resolveSessionScope: (event) =>
		resolveCoachSessionScope(workingDir, {
			tenantKey: event.tenantKey,
			openId: event.user.openId,
			chatId: event.chatId,
		}),
	abortUserRuns: async (scope) => {
		const abortedCount = await abortUserRunners(scope.userKey);
		log.logInfo(`Aborted ${abortedCount} private coach session(s) for ${scope.userKey}`);
	},
	runCoach: async (event, scope, signal) => {
		const runner = getOrCreateRunner({
			sandboxConfig: sandbox,
			workspaceDir: workingDir,
			userKey: scope.userKey,
			sessionKey: scope.sessionKey,
			sessionDir: scope.sessionDir,
			userDataDir: scope.userDataDir,
		});
		const abortRunner = () => {
			void runner
				.abort()
				.catch((error) =>
					log.logWarning(
						"Failed to abort private coach runner",
						error instanceof Error ? error.message : String(error),
					),
				);
		};
		if (signal.aborted) {
			await runner.abort();
			return;
		}
		signal.addEventListener("abort", abortRunner, { once: true });
		try {
			if (event.files) {
				const attachmentDir = join(scope.sessionDir, "attachments");
				for (const file of event.files) {
					try {
						file.downloadedPath = await bot.downloadFile(file.messageId, file.fileKey, file.type, attachmentDir);
					} catch (error) {
						log.logWarning(
							"Feishu download attachment error",
							error instanceof Error ? error.message : String(error),
						);
					}
				}
			}

			if (signal.aborted) return;
			log.logInfo(`Running private coach session ${scope.sessionKey} for message ${event.messageId}`);
			const ctx = createFeishuContext(event, bot, signal);
			try {
				await ctx.setTyping(true);
				await ctx.setWorking(true);
				const result = await runner.run(ctx);
				if (result.errorMessage) await ctx.respond(`Error: ${result.errorMessage}`);
			} finally {
				let isStillActive = false;
				try {
					isStillActive = (await relationships.load(scope))?.status === "active";
				} catch (error) {
					log.logWarning(
						"Failed to verify private coach relationship before sending a response",
						error instanceof Error ? error.message : String(error),
					);
				}
				if (!signal.aborted && isStillActive) await ctx.setWorking(false);
			}
		} finally {
			signal.removeEventListener("abort", abortRunner);
		}
	},
});

bot.onMessage(async (event) => {
	try {
		await service.handleMessage(event);
	} catch (error) {
		log.logWarning(
			`Feishu message ${event.messageId} failed`,
			error instanceof Error ? error.message : String(error),
		);
	}
});

bot.onUserJoined(async (event) => {
	try {
		const result = await service.handleUserJoined(event);
		if (result.status === "failed") log.logWarning("FitClaw private invitation failed", result.reason);
	} catch (error) {
		log.logWarning(
			`Feishu user invitation failed for ${event.tenantKey}/${event.openId}`,
			error instanceof Error ? error.message : String(error),
		);
	}
});

bot.onUserLeft(async (event) => {
	try {
		await service.handleUserLeft(event);
	} catch (error) {
		log.logWarning(
			`Feishu user revocation failed for ${event.tenantKey}/${event.openId}`,
			error instanceof Error ? error.message : String(error),
		);
	}
});

await bot.start();
log.logInfo("FitClaw Feishu Bot is running. Press Ctrl+C to exit.");

// Handle shutdown
process.on("SIGINT", () => {
	log.logInfo("Shutting down...");
	process.exit(0);
});
process.on("SIGTERM", () => {
	log.logInfo("Shutting down...");
	process.exit(0);
});

await new Promise(() => {}); // block forever
