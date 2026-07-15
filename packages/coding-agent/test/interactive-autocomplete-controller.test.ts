import type { AutocompleteProvider, EditorComponent } from "@fitclaw/tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { AutocompleteProviderFactory, ExtensionRunner, ResolvedCommand } from "../src/core/extensions/index.js";
import type { PromptTemplate } from "../src/core/prompt-templates.js";
import type { SourceInfo } from "../src/core/source-info.js";
import { InteractiveAutocompleteController } from "../src/modes/interactive/interactive-autocomplete-controller.js";

const PROJECT_SOURCE: SourceInfo = {
	path: "/project/resource.ts",
	source: "npm:fitclaw-tools",
	scope: "project",
	origin: "package",
};

interface AutocompleteFixtureOptions {
	commands?: ResolvedCommand[];
	promptTemplates?: PromptTemplate[];
}

function createAutocompleteFixture(options: AutocompleteFixtureOptions = {}) {
	const getRegisteredCommands = vi.fn(() => options.commands ?? []);
	const session = {
		extensionRunner: { getRegisteredCommands },
		modelRegistry: { getAvailable: () => [] },
		promptTemplates: options.promptTemplates ?? [],
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		scopedModels: [],
		sessionManager: { getCwd: () => "/project" },
		settingsManager: { getEnableSkillCommands: () => false },
	} as unknown as AgentSession;
	const setDefaultProvider = vi.fn<(provider: AutocompleteProvider) => void>();
	const setCustomProvider = vi.fn<(provider: AutocompleteProvider) => void>();
	const defaultEditor = { setAutocompleteProvider: setDefaultProvider } as unknown as EditorComponent;
	const customEditor = { setAutocompleteProvider: setCustomProvider } as unknown as EditorComponent;
	const controller = new InteractiveAutocompleteController({
		getSession: () => session,
		getEditor: () => customEditor,
		defaultEditor,
		getFdPath: () => undefined,
	});

	return {
		controller,
		getRegisteredCommands,
		setCustomProvider,
		setDefaultProvider,
	};
}

function createCommand(overrides: Partial<ResolvedCommand> = {}): ResolvedCommand {
	return {
		name: "extension-command",
		invocationName: "extension-command",
		sourceInfo: PROJECT_SOURCE,
		handler: async () => {},
		...overrides,
	};
}

describe("InteractiveAutocompleteController", () => {
	it("stacks extension providers over a fresh base provider", () => {
		const fixture = createAutocompleteFixture();
		const calls: string[] = [];
		const wrap =
			(name: string): AutocompleteProviderFactory =>
			(current) => ({
				getSuggestions: (lines, cursorLine, cursorCol, options) =>
					current.getSuggestions(lines, cursorLine, cursorCol, options),
				applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
					current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
				shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => {
					calls.push(name);
					return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
				},
			});

		fixture.controller.addProvider(wrap("first"));
		fixture.controller.addProvider(wrap("second"));

		const provider = fixture.setDefaultProvider.mock.calls.at(-1)?.[0];
		expect(provider).toBe(fixture.setCustomProvider.mock.calls.at(-1)?.[0]);
		expect(provider?.shouldTriggerFileCompletion?.(["foo"], 0, 3)).toBe(true);
		expect(calls).toEqual(["second", "first"]);
	});

	it("preserves source labels in prompt and extension suggestions", async () => {
		const command = createCommand({ description: "Extension description" });
		const promptTemplate: PromptTemplate = {
			name: "review",
			description: "Review changes",
			content: "Review $1",
			filePath: "/project/review.md",
			sourceInfo: PROJECT_SOURCE,
		};
		const fixture = createAutocompleteFixture({ commands: [command], promptTemplates: [promptTemplate] });

		fixture.controller.setup();
		const provider = fixture.setDefaultProvider.mock.calls.at(-1)?.[0];
		const suggestions = await provider?.getSuggestions(["/"], 0, 1, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items.find((item) => item.value === "review")?.description).toBe(
			"[p:npm:fitclaw-tools] Review changes",
		);
		expect(suggestions?.items.find((item) => item.value === "extension-command")?.description).toBe(
			"[p:npm:fitclaw-tools] Extension description",
		);
	});

	it("reports built-in command conflicts using resolved invocation names", () => {
		const command = createCommand({ name: "model", invocationName: "model:2" });
		const fixture = createAutocompleteFixture({ commands: [command] });
		const runner = { getRegisteredCommands: fixture.getRegisteredCommands } as unknown as ExtensionRunner;

		expect(fixture.controller.getBuiltInCommandConflictDiagnostics(runner)).toEqual([
			{
				type: "warning",
				message: "Extension command '/model' conflicts with built-in interactive command. Available as '/model:2'.",
				path: PROJECT_SOURCE.path,
			},
		]);
	});
});
