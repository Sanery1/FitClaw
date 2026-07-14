#!/usr/bin/env node

import { join, resolve } from "path";
import { renderFeishuCard } from "./adapters/feishu/card-renderer.js";
import { type AgentRunner, getOrCreateRunner } from "./agent.js";
import { FeishuBot, type FeishuEvent } from "./feishu.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { ChannelStore } from "./store.js";
import type { BotContext } from "./types.js";

// ============================================================================
// Config
// ============================================================================

const FEISHU_APP_ID = process.env.MOM_FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.MOM_FEISHU_APP_SECRET;
const FEISHU_BOT_NAME = process.env.MOM_FEISHU_BOT_NAME || "FitCoach";

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
// State (per channel)
// ============================================================================

interface ChannelState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
}

const channelStates = new Map<string, ChannelState>();

function getState(channelId: string, userId?: string): ChannelState {
	const stateKey = userId ? `${channelId}/${userId}` : channelId;
	let state = channelStates.get(stateKey);
	if (!state) {
		const channelDir = userId ? join(workingDir, channelId, userId) : join(workingDir, channelId);
		state = {
			running: false,
			runner: getOrCreateRunner(sandbox, stateKey, channelDir),
			store: new ChannelStore({ workingDir }),
		};
		channelStates.set(stateKey, state);
	}
	return state;
}

// ============================================================================
// Feishu Context Adapter
// ============================================================================

function createFeishuContext(event: FeishuEvent, bot: FeishuBot, _state: ChannelState): BotContext {
	let accumulatedText = "";
	let _isWorking = true;
	let updatePromise = Promise.resolve();
	let finalSent = false;

	const flushResponse = async () => {
		if (finalSent || !accumulatedText.trim()) return;
		finalSent = true;
		try {
			const card = renderFeishuCard(accumulatedText);
			const cardJson = JSON.stringify(card);
			log.logInfo(`Sending card: ${card.elements?.length || 0} elements, ${cardJson.length} bytes`);
			await bot.sendCardMessage(event.messageId, card);
			log.logInfo("Card sent successfully");
		} catch (err) {
			log.logWarning(
				"Feishu card render/send failed, falling back to text",
				err instanceof Error ? err.message : String(err),
			);
			try {
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

		uploadFile: async (_filePath: string, _title?: string) => {
			// Feishu file upload not implemented in v1.
		},

		setWorking: async (working: boolean) => {
			updatePromise = updatePromise.then(async () => {
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

bot.onMessage(async (event) => {
	// Download attachments before processing
	if (event.files) {
		for (const f of event.files) {
			try {
				f.downloadedPath = await bot.downloadFile(f.messageId, f.fileKey, f.type);
			} catch (err) {
				log.logWarning("Feishu download attachment error", err instanceof Error ? err.message : String(err));
			}
		}
	}

	const isGroup = event.type === "mention";
	const userId = isGroup ? event.user.openId : undefined;
	const state = getState(event.chatId, userId);
	state.running = true;

	log.logInfo(`[${event.chatId}] Feishu ${event.type}: ${event.text.substring(0, 50)}`);

	try {
		const ctx = createFeishuContext(event, bot, state);
		await ctx.setTyping(true);
		await ctx.setWorking(true);
		const result = await state.runner.run(ctx, state.store);
		await ctx.setWorking(false);

		if (result.errorMessage) {
			await ctx.respond(`Error: ${result.errorMessage}`);
		}
	} catch (err) {
		log.logWarning(`[${event.chatId}] Run error`, err instanceof Error ? err.message : String(err));
	} finally {
		state.running = false;
	}
});

await bot.start();
log.logInfo("FitClaw Feishu Bot (FitCoach) is running. Press Ctrl+C to exit.");

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
