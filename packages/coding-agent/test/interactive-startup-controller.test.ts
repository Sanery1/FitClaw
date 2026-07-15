import { Container } from "@fitclaw/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { InteractiveStartupController } from "../src/modes/interactive/interactive-startup-controller.js";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.js";
import type { ChangelogEntry } from "../src/utils/changelog.js";

interface StartupFixtureOptions {
	changelogEntries?: ChangelogEntry[];
	isCollapsed?: boolean;
	lastVersion?: string;
	messageCount?: number;
}

function createStartupFixture(options: StartupFixtureOptions = {}) {
	const setLastChangelogVersion = vi.fn();
	const settingsManager = {
		getCollapseChangelog: () => options.isCollapsed ?? false,
		getEnableInstallTelemetry: () => false,
		getLastChangelogVersion: () => options.lastVersion,
		setLastChangelogVersion,
	};
	const session = {
		sessionManager: { getCwd: () => "/project" },
		settingsManager,
		state: { messages: Array.from({ length: options.messageCount ?? 0 }, () => ({ role: "user" })) },
	} as unknown as AgentSession;
	const chatContainer = new Container();
	const controller = new InteractiveStartupController({
		getSession: () => session,
		chatContainer,
		version: "2.0.0",
		getMarkdownTheme,
		loadChangelogEntries: () => options.changelogEntries ?? [],
	});

	return { chatContainer, controller, setLastChangelogVersion };
}

function renderAll(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("InteractiveStartupController", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("records the current version without showing a changelog on first install", () => {
		vi.stubEnv("FITCLAW_OFFLINE", "1");
		const fixture = createStartupFixture({
			changelogEntries: [{ major: 2, minor: 0, patch: 0, content: "## [2.0.0]\nChanges" }],
		});

		fixture.controller.prepareChangelog();
		fixture.controller.showNotices();

		expect(fixture.setLastChangelogVersion).toHaveBeenCalledWith("2.0.0");
		expect(fixture.chatContainer.children).toHaveLength(0);
	});

	it("shows new changelog entries only once", () => {
		vi.stubEnv("FITCLAW_OFFLINE", "1");
		const fixture = createStartupFixture({
			lastVersion: "1.0.0",
			changelogEntries: [{ major: 2, minor: 0, patch: 0, content: "## [2.0.0]\nImportant changes" }],
		});

		fixture.controller.prepareChangelog();
		fixture.controller.showNotices();
		const childCount = fixture.chatContainer.children.length;
		fixture.controller.showNotices();

		expect(renderAll(fixture.chatContainer)).toContain("What's New");
		expect(renderAll(fixture.chatContainer)).toContain("Important changes");
		expect(fixture.chatContainer.children).toHaveLength(childCount);
		expect(fixture.setLastChangelogVersion).toHaveBeenCalledWith("2.0.0");
	});

	it("renders a condensed changelog notice when collapse is enabled", () => {
		vi.stubEnv("FITCLAW_OFFLINE", "1");
		const fixture = createStartupFixture({
			isCollapsed: true,
			lastVersion: "1.0.0",
			changelogEntries: [{ major: 2, minor: 0, patch: 0, content: "## [2.0.0]\nImportant changes" }],
		});

		fixture.controller.prepareChangelog();
		fixture.controller.showNotices();

		expect(renderAll(fixture.chatContainer)).toContain("Updated to v2.0.0");
		expect(renderAll(fixture.chatContainer)).toContain("/changelog");
		expect(renderAll(fixture.chatContainer)).not.toContain("Important changes");
	});

	it("returns a newer registry version and respects offline mode", async () => {
		const fixture = createStartupFixture();
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ version: "3.0.0" }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		await expect(fixture.controller.checkForNewVersion()).resolves.toBe("3.0.0");
		vi.stubEnv("FITCLAW_OFFLINE", "1");
		await expect(fixture.controller.checkForNewVersion()).resolves.toBeUndefined();
		await expect(fixture.controller.checkForPackageUpdates()).resolves.toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("routes completed background checks to their handlers", async () => {
		const fixture = createStartupFixture();
		vi.spyOn(fixture.controller, "checkForNewVersion").mockResolvedValue("3.0.0");
		vi.spyOn(fixture.controller, "checkForPackageUpdates").mockResolvedValue(["extension-a"]);
		vi.spyOn(fixture.controller, "checkTmuxKeyboardSetup").mockResolvedValue("tmux warning");
		const handlers = {
			showNewVersion: vi.fn(),
			showPackageUpdates: vi.fn(),
			showWarning: vi.fn(),
		};

		fixture.controller.startBackgroundChecks(handlers);

		await vi.waitFor(() => {
			expect(handlers.showNewVersion).toHaveBeenCalledWith("3.0.0");
			expect(handlers.showPackageUpdates).toHaveBeenCalledWith(["extension-a"]);
			expect(handlers.showWarning).toHaveBeenCalledWith("tmux warning");
		});
	});
});
