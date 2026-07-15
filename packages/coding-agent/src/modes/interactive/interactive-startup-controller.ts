import { type Container, Markdown, type MarkdownTheme, Spacer, Text } from "@fitclaw/tui";
import { spawn } from "child_process";
import { getAgentDir } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { DefaultPackageManager } from "../../core/package-manager.js";
import { isInstallTelemetryEnabled } from "../../core/telemetry.js";
import { type ChangelogEntry, getChangelogPath, getNewEntries, parseChangelog } from "../../utils/changelog.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { theme } from "./theme/theme.js";

export interface InteractiveStartupControllerOptions {
	getSession: () => AgentSession;
	chatContainer: Container;
	version: string;
	getMarkdownTheme: () => MarkdownTheme;
	loadChangelogEntries?: () => ChangelogEntry[];
}

export interface InteractiveStartupCheckHandlers {
	showNewVersion: (version: string) => void;
	showPackageUpdates: (packages: string[]) => void;
	showWarning: (warning: string) => void;
}

export class InteractiveStartupController {
	private changelogMarkdown: string | undefined;
	private areNoticesShown = false;

	constructor(private readonly options: InteractiveStartupControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	prepareChangelog(): void {
		this.changelogMarkdown = this.getChangelogForDisplay();
	}

	showNotices(): void {
		if (this.areNoticesShown) return;
		this.areNoticesShown = true;
		if (!this.changelogMarkdown) return;

		if (this.options.chatContainer.children.length > 0) {
			this.options.chatContainer.addChild(new Spacer(1));
		}
		this.options.chatContainer.addChild(new DynamicBorder());
		if (this.session.settingsManager.getCollapseChangelog()) {
			const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : this.options.version;
			this.options.chatContainer.addChild(
				new Text(`Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`, 1, 0),
			);
		} else {
			this.options.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.options.chatContainer.addChild(new Spacer(1));
			this.options.chatContainer.addChild(
				new Markdown(this.changelogMarkdown.trim(), 1, 0, this.options.getMarkdownTheme()),
			);
			this.options.chatContainer.addChild(new Spacer(1));
		}
		this.options.chatContainer.addChild(new DynamicBorder());
	}

	startBackgroundChecks(handlers: InteractiveStartupCheckHandlers): void {
		void this.checkForNewVersion().then((version) => {
			if (version) handlers.showNewVersion(version);
		});
		void this.checkForPackageUpdates().then((updates) => {
			if (updates.length > 0) handlers.showPackageUpdates(updates);
		});
		void this.checkTmuxKeyboardSetup().then((warning) => {
			if (warning) handlers.showWarning(warning);
		});
	}

	async checkForNewVersion(): Promise<string | undefined> {
		if (process.env.FITCLAW_SKIP_VERSION_CHECK || process.env.FITCLAW_OFFLINE) return undefined;

		try {
			const response = await fetch("https://registry.npmjs.org/@fitclaw/claw/latest", {
				signal: AbortSignal.timeout(10000),
			});
			if (!response.ok) return undefined;

			const data = (await response.json()) as { version?: string };
			return data.version && data.version !== this.options.version ? data.version : undefined;
		} catch {
			return undefined;
		}
	}

	async checkForPackageUpdates(): Promise<string[]> {
		if (process.env.FITCLAW_OFFLINE) return [];

		try {
			const packageManager = new DefaultPackageManager({
				cwd: this.session.sessionManager.getCwd(),
				agentDir: getAgentDir(),
				settingsManager: this.session.settingsManager,
			});
			const updates = await packageManager.checkForAvailableUpdates();
			return updates.map((update) => update.displayName);
		} catch {
			return [];
		}
	}

	async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		if (!process.env.TMUX) return undefined;

		const [extendedKeys, extendedKeysFormat] = await Promise.all([
			this.runTmuxShow("extended-keys"),
			this.runTmuxShow("extended-keys-format"),
		]);
		if (extendedKeys === undefined) return undefined;
		if (extendedKeys !== "on" && extendedKeys !== "always") {
			return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
		}
		if (extendedKeysFormat === "xterm") {
			return "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
		}
		return undefined;
	}

	private getChangelogForDisplay(): string | undefined {
		if (this.session.state.messages.length > 0) return undefined;

		const settings = this.session.settingsManager;
		const lastVersion = settings.getLastChangelogVersion();
		const entries = this.options.loadChangelogEntries?.() ?? parseChangelog(getChangelogPath());
		if (!lastVersion) {
			settings.setLastChangelogVersion(this.options.version);
			this.reportInstallTelemetry(this.options.version);
			return undefined;
		}

		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length === 0) return undefined;

		settings.setLastChangelogVersion(this.options.version);
		this.reportInstallTelemetry(this.options.version);
		return newEntries.map((entry) => entry.content).join("\n\n");
	}

	private reportInstallTelemetry(version: string): void {
		if (process.env.FITCLAW_OFFLINE || !isInstallTelemetryEnabled(this.session.settingsManager)) return;

		void fetch(`https://pi.dev/install?version=${encodeURIComponent(version)}`, {
			signal: AbortSignal.timeout(5000),
		})
			.then(() => undefined)
			.catch(() => undefined);
	}

	private runTmuxShow(option: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			const processHandle = spawn("tmux", ["show", "-gv", option], {
				stdio: ["ignore", "pipe", "ignore"],
			});
			let stdout = "";
			const timer = setTimeout(() => {
				processHandle.kill();
				resolve(undefined);
			}, 2000);

			processHandle.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			processHandle.on("error", () => {
				clearTimeout(timer);
				resolve(undefined);
			});
			processHandle.on("close", (code) => {
				clearTimeout(timer);
				resolve(code === 0 ? stdout.trim() : undefined);
			});
		});
	}
}
