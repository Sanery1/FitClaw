import { Agent, type AgentTool } from "@fitclaw/agent-core";
import type { ImageContent } from "@fitclaw/ai";
import {
	AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	convertToLlm,
	createExtensionRuntime,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
} from "@fitclaw/claw";
import type { Skill } from "@fitclaw/runtime";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type CoachSessionEvent = AgentSessionEvent;

type CoachSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

class WorkspaceSettingsStorage implements CoachSettingsStorage {
	private readonly settingsPath: string;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
	}

	withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void {
		if (scope === "project") {
			fn(undefined);
			return;
		}

		const current = existsSync(this.settingsPath) ? readFileSync(this.settingsPath, "utf-8") : undefined;
		const next = fn(current);
		if (next === undefined) return;

		const dir = dirname(this.settingsPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(this.settingsPath, next, "utf-8");
	}
}

export interface CoachResourceState {
	readonly resourceLoader: ResourceLoader;
	update(systemPrompt: string, skills: Skill[]): void;
}

export function createCoachResourceState(systemPrompt: string, skills: Skill[]): CoachResourceState {
	let currentSystemPrompt = systemPrompt;
	let currentSkills = skills.slice();

	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: currentSkills.slice(), diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => currentSystemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};

	return {
		resourceLoader,
		update(nextSystemPrompt, nextSkills) {
			currentSystemPrompt = nextSystemPrompt;
			currentSkills = nextSkills.slice();
		},
	};
}

export interface CreateCoachSessionOptions {
	channelDir: string;
	cwd: string;
	systemPrompt: string;
	skills: Skill[];
	tools: AgentTool[];
}

export function createCoachSession(options: CreateCoachSessionOptions) {
	const authStorage = AuthStorage.create(join(homedir(), ".fitclaw", "agent", "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage);
	const provider = process.env.MOM_LLM_PROVIDER || "minimax";
	const modelId = process.env.MOM_LLM_MODEL || "MiniMax-M2.7-highspeed";
	const model = modelRegistry.find(provider, modelId);

	if (!model) {
		throw new Error(
			`Model not found: "${provider}/${modelId}".\n` +
				"Configure models.json or set MOM_LLM_PROVIDER / MOM_LLM_MODEL env vars.",
		);
	}

	const agent = new Agent({
		initialState: {
			systemPrompt: options.systemPrompt,
			model,
			thinkingLevel: "off",
			tools: options.tools,
		},
		convertToLlm,
		getApiKey: async () => {
			const auth = await modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				throw new Error(
					`No API key found for "${model.provider}".\n\n` +
						"Set API key via auth.json or environment variable (e.g., MINIMAX_API_KEY).",
				);
			}
			return auth.apiKey;
		},
	});

	const sessionManager = SessionManager.open(join(options.channelDir, "context.jsonl"), options.channelDir);
	const settingsManager = SettingsManager.fromStorage(new WorkspaceSettingsStorage(join(options.channelDir, "..")));
	const resources = createCoachResourceState(options.systemPrompt, options.skills);
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: options.cwd,
		modelRegistry,
		resourceLoader: resources.resourceLoader,
		baseToolsOverride: Object.fromEntries(options.tools.map((tool) => [tool.name, tool])),
	});

	return {
		agent: session.agent,
		model,
		sessionManager,
		get messages() {
			return session.messages;
		},
		subscribe: session.subscribe.bind(session),
		prompt(text: string, images?: ImageContent[]) {
			return session.prompt(text, images && images.length > 0 ? { images } : undefined);
		},
		abort() {
			return session.abort();
		},
		updateRuntime(systemPrompt: string, skills: Skill[], tools: AgentTool[]) {
			resources.update(systemPrompt, skills);
			session.setActiveToolsByName(session.getActiveToolNames());
			session.agent.state.tools = tools;
		},
	};
}
