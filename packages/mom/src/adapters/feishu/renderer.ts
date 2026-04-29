/**
 * Feishu rich text card renderer (placeholder).
 *
 * Will convert Agent messages into Feishu Message Card JSON format.
 */

export function renderFeishuCard(_content: string): Record<string, unknown> {
	throw new Error("Feishu card renderer not yet implemented. Set FITCLAW_BOT_PROVIDER=slack to use Slack instead.");
}
