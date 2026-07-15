import * as fs from "node:fs";
import * as path from "node:path";
import { type Container, Spacer, Text, type TUI, visibleWidth } from "@fitclaw/tui";
import { APP_NAME, getDebugLogPath } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { ArminComponent } from "./components/armin.js";
import { DaxnutsComponent } from "./components/daxnuts.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { EarendilAnnouncementComponent } from "./components/earendil-announcement.js";
import { theme } from "./theme/theme.js";

export interface InteractiveFeedbackControllerOptions {
	getSession: () => AgentSession;
	ui: TUI;
	chatContainer: Container;
}

export class InteractiveFeedbackController {
	private lastStatusSpacer: Spacer | undefined;
	private lastStatusText: Text | undefined;

	constructor(private readonly options: InteractiveFeedbackControllerOptions) {}

	showStatus(message: string): void {
		const children = this.options.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
			this.lastStatusText.setText(theme.fg("dim", message));
			this.options.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		this.options.chatContainer.addChild(spacer);
		this.options.chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		this.options.ui.requestRender();
	}

	showError(message: string): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
		this.options.ui.requestRender();
	}

	showWarning(message: string): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${message}`), 1, 0));
		this.options.ui.requestRender();
	}

	showVersionUpdate(newVersion: string): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;
		const changelogUrl = theme.fg(
			"accent",
			"https://github.com/Sanery1/FitClaw/blob/main/packages/coding-agent/CHANGELOG.md",
		);
		const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

		this.showUpdatePanel("Update Available", `${updateInstruction}\n${changelogLine}`);
	}

	showPackageUpdates(packages: string[]): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
		const packageLines = packages.map((packageName) => `- ${packageName}`).join("\n");
		const content = `${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`;

		this.showUpdatePanel("Package Updates Available", content);
	}

	showExtensionNotification(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.showError(message);
		} else if (type === "warning") {
			this.showWarning(message);
		} else {
			this.showStatus(message);
		}
	}

	showExtensionError(extensionPath: string, error: string, stack?: string): void {
		const errorMessage = `Extension "${extensionPath}" error: ${error}`;
		this.options.chatContainer.addChild(new Text(theme.fg("error", errorMessage), 1, 0));
		if (stack) {
			const stackLines = stack
				.split("\n")
				.slice(1)
				.map((line) => theme.fg("dim", `  ${line.trim()}`))
				.join("\n");
			if (stackLines) {
				this.options.chatContainer.addChild(new Text(stackLines, 1, 0));
			}
		}
		this.options.ui.requestRender();
	}

	writeDebugLog(): void {
		const width = this.options.ui.terminal.columns;
		const height = this.options.ui.terminal.rows;
		const allLines = this.options.ui.render(width);
		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal: ${width}x${height}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, index) => `[${index}] (w=${visibleWidth(line)}) ${JSON.stringify(line)}`),
			"",
			"=== Agent messages (JSONL) ===",
			...this.options.getSession().messages.map((message) => JSON.stringify(message)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(
			new Text(`${theme.fg("accent", "\u2713 Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.options.ui.requestRender();
	}

	showArmin(): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new ArminComponent(this.options.ui));
		this.options.ui.requestRender();
	}

	showDementedDelves(): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new EarendilAnnouncementComponent());
		this.options.ui.requestRender();
	}

	showDaxnuts(): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new DaxnutsComponent(this.options.ui));
		this.options.ui.requestRender();
	}

	checkModelEasterEgg(model: { provider: string; id: string }): void {
		if (model.provider === "opencode" && model.id.toLowerCase().includes("kimi-k2.5")) {
			this.showDaxnuts();
		}
	}

	private showUpdatePanel(title: string, content: string): void {
		this.options.chatContainer.addChild(new Spacer(1));
		this.options.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.options.chatContainer.addChild(new Text(`${theme.bold(theme.fg("warning", title))}\n${content}`, 1, 0));
		this.options.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.options.ui.requestRender();
	}
}
