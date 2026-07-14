/**
 * Feishu message listener (placeholder).
 *
 * Will receive incoming messages from Feishu Bot API and convert them
 * into a standard format for the AgentRunner.
 */

import type { FeishuBotAdapter, FeishuConfig } from "./types.js";

export function createFeishuListener(_config: FeishuConfig): FeishuBotAdapter {
	throw new Error("Feishu Bot adapter not yet implemented. Use the FeishuBot class from feishu.ts directly.");
}
