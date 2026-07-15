import { type Container, Markdown, type MarkdownTheme, Spacer, Text, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { formatKeyDisplay, keyDisplay } from "./components/keybinding-hints.js";
import { theme } from "./theme/theme.js";

export interface InteractiveInfoControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	chatContainer: Container;
	keybindings: KeybindingsManager;
	getMarkdownTheme: () => MarkdownTheme;
	showWarning: (message: string) => void;
}

export class InteractiveInfoController {
	constructor(private readonly options: InteractiveInfoControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	handleNameCommand(text: string): void {
		const name = text.replace(/^\/name\s*/, "").trim();
		if (!name) {
			const currentName = this.session.sessionManager.getSessionName();
			if (currentName) {
				this.showText(`Session name: ${currentName}`);
			} else {
				this.options.showWarning("Usage: /name <name>");
				this.options.ui.requestRender();
			}
			return;
		}

		this.session.setSessionName(name);
		this.showText(`Session name set: ${name}`);
	}

	showSessionInfo(): void {
		const stats = this.session.getSessionStats();
		const sessionName = this.session.sessionManager.getSessionName();

		let info = `${theme.bold("Session Info")}\n\n`;
		if (sessionName) {
			info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
		}
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
		}

		this.showText(info, false);
	}

	showChangelog(): void {
		const entries = parseChangelog(getChangelogPath());
		const markdown =
			entries.length > 0
				? entries
						.reverse()
						.map((entry) => entry.content)
						.join("\n\n")
				: "No changelog entries found.";

		this.showMarkdownPanel("What's New", markdown);
	}

	showHotkeys(): void {
		const cursorUp = keyDisplay("tui.editor.cursorUp");
		const cursorDown = keyDisplay("tui.editor.cursorDown");
		const cursorLeft = keyDisplay("tui.editor.cursorLeft");
		const cursorRight = keyDisplay("tui.editor.cursorRight");
		const cursorWordLeft = keyDisplay("tui.editor.cursorWordLeft");
		const cursorWordRight = keyDisplay("tui.editor.cursorWordRight");
		const cursorLineStart = keyDisplay("tui.editor.cursorLineStart");
		const cursorLineEnd = keyDisplay("tui.editor.cursorLineEnd");
		const jumpForward = keyDisplay("tui.editor.jumpForward");
		const jumpBackward = keyDisplay("tui.editor.jumpBackward");
		const pageUp = keyDisplay("tui.editor.pageUp");
		const pageDown = keyDisplay("tui.editor.pageDown");
		const submit = keyDisplay("tui.input.submit");
		const newLine = keyDisplay("tui.input.newLine");
		const deleteWordBackward = keyDisplay("tui.editor.deleteWordBackward");
		const deleteWordForward = keyDisplay("tui.editor.deleteWordForward");
		const deleteToLineStart = keyDisplay("tui.editor.deleteToLineStart");
		const deleteToLineEnd = keyDisplay("tui.editor.deleteToLineEnd");
		const yank = keyDisplay("tui.editor.yank");
		const yankPop = keyDisplay("tui.editor.yankPop");
		const undo = keyDisplay("tui.editor.undo");
		const tab = keyDisplay("tui.input.tab");
		const interrupt = keyDisplay("app.interrupt");
		const clear = keyDisplay("app.clear");
		const exit = keyDisplay("app.exit");
		const suspend = keyDisplay("app.suspend");
		const cycleThinkingLevel = keyDisplay("app.thinking.cycle");
		const cycleModelForward = keyDisplay("app.model.cycleForward");
		const selectModel = keyDisplay("app.model.select");
		const expandTools = keyDisplay("app.tools.expand");
		const toggleThinking = keyDisplay("app.thinking.toggle");
		const externalEditor = keyDisplay("app.editor.external");
		const cycleModelBackward = keyDisplay("app.model.cycleBackward");
		const followUp = keyDisplay("app.message.followUp");
		const dequeue = keyDisplay("app.message.dequeue");
		const pasteImage = keyDisplay("app.clipboard.pasteImage");

		let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

		const shortcuts = this.session.extensionRunner.getShortcuts(this.options.keybindings.getEffectiveConfig());
		if (shortcuts.size > 0) {
			hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
			for (const [key, shortcut] of shortcuts) {
				const description = shortcut.description ?? shortcut.extensionPath;
				hotkeys += `| \`${formatKeyDisplay(key)}\` | ${description} |\n`;
			}
		}

		this.showMarkdownPanel("Keyboard Shortcuts", hotkeys.trim());
	}

	private showText(content: string, isDim = true): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new Text(isDim ? theme.fg("dim", content) : content, 1, 0));
		this.options.ui.requestRender();
	}

	private showMarkdownPanel(title: string, markdown: string): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new DynamicBorder());
		this.options.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new Markdown(markdown, 1, 1, this.options.getMarkdownTheme()));
		this.options.chatContainer.addChild(new DynamicBorder());
		this.options.ui.requestRender();
	}
}
