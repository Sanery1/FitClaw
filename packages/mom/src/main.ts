#!/usr/bin/env node

import { join, resolve } from "path";
import { type AgentRunner, getOrCreateRunner } from "./agent.js";
import { downloadChannel } from "./download.js";
import { createEventsWatcher } from "./events.js";
import { FeishuBot, type FeishuEvent } from "./feishu.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { type MomHandler, type SlackBot, SlackBot as SlackBotClass, type SlackEvent } from "./slack.js";
import { ChannelStore } from "./store.js";
import type { BotContext } from "./types.js";

// ============================================================================
// Config
// ============================================================================

const MOM_SLACK_APP_TOKEN = process.env.MOM_SLACK_APP_TOKEN;
const MOM_SLACK_BOT_TOKEN = process.env.MOM_SLACK_BOT_TOKEN;

const MOM_FEISHU_APP_ID = process.env.MOM_FEISHU_APP_ID;
const MOM_FEISHU_APP_SECRET = process.env.MOM_FEISHU_APP_SECRET;
const MOM_FEISHU_BOT_NAME = process.env.MOM_FEISHU_BOT_NAME || "FitCoach";

interface ParsedArgs {
	workingDir?: string;
	sandbox: SandboxConfig;
	downloadChannel?: string;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;
	let downloadChannelId: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			sandbox = parseSandboxArg(args[++i] || "");
		} else if (arg.startsWith("--download=")) {
			downloadChannelId = arg.slice("--download=".length);
		} else if (arg === "--download") {
			downloadChannelId = args[++i];
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	return {
		workingDir: workingDir ? resolve(workingDir) : undefined,
		sandbox,
		downloadChannel: downloadChannelId,
	};
}

const parsedArgs = parseArgs();

// Handle --download mode
if (parsedArgs.downloadChannel) {
	if (!MOM_SLACK_BOT_TOKEN) {
		console.error("Missing env: MOM_SLACK_BOT_TOKEN");
		process.exit(1);
	}
	await downloadChannel(parsedArgs.downloadChannel, MOM_SLACK_BOT_TOKEN);
	process.exit(0);
}

// Normal bot mode - require working dir
if (!parsedArgs.workingDir) {
	console.error("Usage: mom [--sandbox=host|docker:<name>] <working-directory>");
	console.error("       mom --download <channel-id>");
	process.exit(1);
}

const { workingDir, sandbox } = { workingDir: parsedArgs.workingDir, sandbox: parsedArgs.sandbox };

if (!MOM_FEISHU_APP_ID && (!MOM_SLACK_APP_TOKEN || !MOM_SLACK_BOT_TOKEN)) {
	console.error("Missing env: set MOM_FEISHU_APP_ID+MOM_FEISHU_APP_SECRET or MOM_SLACK_APP_TOKEN+MOM_SLACK_BOT_TOKEN");
	process.exit(1);
}

await validateSandbox(sandbox);

// ============================================================================
// State (per channel)
// ============================================================================

interface ChannelState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
	stopRequested: boolean;
	stopMessageTs?: string;
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
			store: new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN }),
			stopRequested: false,
		};
		channelStates.set(stateKey, state);
	}
	return state;
}

// ============================================================================
// Create SlackContext adapter
// ============================================================================

function createSlackContext(event: SlackEvent, slack: SlackBot, state: ChannelState, isEvent?: boolean) {
	let messageTs: string | null = null;
	const threadMessageTs: string[] = [];
	let accumulatedText = "";
	let isWorking = true;
	const workingIndicator = " ...";
	let updatePromise = Promise.resolve();

	const user = slack.getUser(event.user);

	// Extract event filename for status message
	const eventFilename = isEvent ? event.text.match(/^\[EVENT:([^:]+):/)?.[1] : undefined;

	return {
		message: {
			text: event.text,
			rawText: event.text,
			user: event.user,
			userName: user?.userName,
			channel: event.channel,
			ts: event.ts,
			attachments: (event.attachments || []).map((a) => ({ local: a.local })),
		},
		channelName: slack.getChannel(event.channel)?.name,
		store: state.store,
		channels: slack.getAllChannels().map((c) => ({ id: c.id, name: c.name })),
		users: slack.getAllUsers().map((u) => ({ id: u.id, userName: u.userName, displayName: u.displayName })),

		respond: async (text: string, shouldLog = true) => {
			updatePromise = updatePromise.then(async () => {
				try {
					accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;

					// Truncate accumulated text if too long (Slack limit is 40K, we use 35K for safety)
					const MAX_MAIN_LENGTH = 35000;
					const truncationNote = "\n\n_(message truncated, ask me to elaborate on specific parts)_";
					if (accumulatedText.length > MAX_MAIN_LENGTH) {
						accumulatedText =
							accumulatedText.substring(0, MAX_MAIN_LENGTH - truncationNote.length) + truncationNote;
					}

					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

					if (messageTs) {
						await slack.updateMessage(event.channel, messageTs, displayText);
					} else {
						messageTs = await slack.postMessage(event.channel, displayText);
					}

					if (shouldLog && messageTs) {
						slack.logBotResponse(event.channel, text, messageTs);
					}
				} catch (err) {
					log.logWarning("Slack respond error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		replaceMessage: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				try {
					// Replace the accumulated text entirely, with truncation
					const MAX_MAIN_LENGTH = 35000;
					const truncationNote = "\n\n_(message truncated, ask me to elaborate on specific parts)_";
					if (text.length > MAX_MAIN_LENGTH) {
						accumulatedText = text.substring(0, MAX_MAIN_LENGTH - truncationNote.length) + truncationNote;
					} else {
						accumulatedText = text;
					}

					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

					if (messageTs) {
						await slack.updateMessage(event.channel, messageTs, displayText);
					} else {
						messageTs = await slack.postMessage(event.channel, displayText);
					}
				} catch (err) {
					log.logWarning("Slack replaceMessage error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		respondInThread: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				try {
					if (messageTs) {
						// Truncate thread messages if too long (20K limit for safety)
						const MAX_THREAD_LENGTH = 20000;
						let threadText = text;
						if (threadText.length > MAX_THREAD_LENGTH) {
							threadText = `${threadText.substring(0, MAX_THREAD_LENGTH - 50)}\n\n_(truncated)_`;
						}

						const ts = await slack.postInThread(event.channel, messageTs, threadText);
						threadMessageTs.push(ts);
					}
				} catch (err) {
					log.logWarning("Slack respondInThread error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		setTyping: async (isTyping: boolean) => {
			if (isTyping && !messageTs) {
				updatePromise = updatePromise.then(async () => {
					try {
						if (!messageTs) {
							accumulatedText = eventFilename ? `_Starting event: ${eventFilename}_` : "_Thinking_";
							messageTs = await slack.postMessage(event.channel, accumulatedText + workingIndicator);
						}
					} catch (err) {
						log.logWarning("Slack setTyping error", err instanceof Error ? err.message : String(err));
					}
				});
				await updatePromise;
			}
		},

		uploadFile: async (filePath: string, title?: string) => {
			await slack.uploadFile(event.channel, filePath, title);
		},

		setWorking: async (working: boolean) => {
			log.logInfo(`[DEBUG] setWorking called — working=${working} accumulatedLen=${accumulatedText.length}`);
			updatePromise = updatePromise.then(async () => {
				try {
					isWorking = working;
					if (messageTs) {
						const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
						await slack.updateMessage(event.channel, messageTs, displayText);
					}
				} catch (err) {
					log.logWarning("Slack setWorking error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		deleteMessage: async () => {
			updatePromise = updatePromise.then(async () => {
				// Delete thread messages first (in reverse order)
				for (let i = threadMessageTs.length - 1; i >= 0; i--) {
					try {
						await slack.deleteMessage(event.channel, threadMessageTs[i]);
					} catch {
						// Ignore errors deleting thread messages
					}
				}
				threadMessageTs.length = 0;
				// Then delete main message
				if (messageTs) {
					await slack.deleteMessage(event.channel, messageTs);
					messageTs = null;
				}
			});
			await updatePromise;
		},
	};
}

// ============================================================================
// Handler
// ============================================================================

const handler: MomHandler = {
	isRunning(channelId: string): boolean {
		const state = channelStates.get(channelId);
		return state?.running ?? false;
	},

	async handleStop(channelId: string, slack: SlackBot): Promise<void> {
		const state = channelStates.get(channelId);
		if (state?.running) {
			state.stopRequested = true;
			state.runner.abort();
			const ts = await slack.postMessage(channelId, "_Stopping..._");
			state.stopMessageTs = ts; // Save for updating later
		} else {
			await slack.postMessage(channelId, "_Nothing running_");
		}
	},

	async handleEvent(event: SlackEvent, slack: SlackBot, isEvent?: boolean): Promise<void> {
		const state = getState(event.channel);

		// Start run
		state.running = true;
		state.stopRequested = false;

		log.logInfo(`[${event.channel}] Starting run: ${event.text.substring(0, 50)}`);

		try {
			// Create context adapter
			const ctx = createSlackContext(event, slack, state, isEvent);

			// Run the agent
			await ctx.setTyping(true);
			await ctx.setWorking(true);
			const result = await state.runner.run(ctx as any, state.store);
			log.logInfo(`[DEBUG] runner.run() completed — result keys: ${Object.keys(result || {}).join(",")}`);
			await ctx.setWorking(false);
			log.logInfo("[DEBUG] setWorking(false) completed");

			if (result.stopReason === "aborted" && state.stopRequested) {
				if (state.stopMessageTs) {
					await slack.updateMessage(event.channel, state.stopMessageTs, "_Stopped_");
					state.stopMessageTs = undefined;
				} else {
					await slack.postMessage(event.channel, "_Stopped_");
				}
			}
		} catch (err) {
			log.logWarning(`[${event.channel}] Run error`, err instanceof Error ? err.message : String(err));
		} finally {
			state.running = false;
		}
	},
};

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
			await bot.sendThreadMessage(event.messageId, accumulatedText);
		} catch (err) {
			log.logWarning("Feishu flush response error", err instanceof Error ? err.message : String(err));
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

		respond: async (text: string) => {
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
			// Thinking content and tool details are suppressed in Feishu v1.
			// The final response is sent once via flushResponse() as a reply to the original message.
		},

		setTyping: async () => {
			// Feishu text messages cannot be edited. Response sent once when complete.
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
// Feishu Mode
// ============================================================================

async function runFeishuMode() {
	if (!MOM_FEISHU_APP_ID || !MOM_FEISHU_APP_SECRET) {
		console.error("Missing required environment variables:");
		console.error("  MOM_FEISHU_APP_ID");
		console.error("  MOM_FEISHU_APP_SECRET");
		process.exit(1);
	}

	// NOTE: Events watcher (scheduled/periodic events) is not supported in Feishu mode v1.
	// EventsWatcher is tightly coupled to SlackBot.

	const bot = new FeishuBot(
		{ appId: MOM_FEISHU_APP_ID, appSecret: MOM_FEISHU_APP_SECRET, botName: MOM_FEISHU_BOT_NAME },
		workingDir,
	);

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
}

// ============================================================================
// Start
// ============================================================================

log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

if (MOM_FEISHU_APP_ID) {
	// === Feishu mode ===
	await runFeishuMode();
} else if (MOM_SLACK_APP_TOKEN && MOM_SLACK_BOT_TOKEN) {
	// === Slack mode (original code, unchanged) ===
	const sharedStore = new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN });

	const bot = new SlackBotClass(handler, {
		appToken: MOM_SLACK_APP_TOKEN,
		botToken: MOM_SLACK_BOT_TOKEN,
		workingDir,
		store: sharedStore,
	});

	// Start events watcher
	const eventsWatcher = createEventsWatcher(workingDir, bot);
	eventsWatcher.start();

	// Handle shutdown
	process.on("SIGINT", () => {
		log.logInfo("Shutting down...");
		eventsWatcher.stop();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		log.logInfo("Shutting down...");
		eventsWatcher.stop();
		process.exit(0);
	});

	bot.start();
} else {
	console.error("No bot platform configured.");
	console.error("Please set one of the following environment variable groups:");
	console.error("  Feishu: MOM_FEISHU_APP_ID + MOM_FEISHU_APP_SECRET");
	console.error("  Slack: MOM_SLACK_APP_TOKEN + MOM_SLACK_BOT_TOKEN");
	process.exit(1);
}
