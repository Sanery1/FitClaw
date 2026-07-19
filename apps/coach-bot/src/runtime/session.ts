import { Agent, type AgentTool } from "@fitclaw/agent-core";
import type { ImageContent } from "@fitclaw/ai";
import {
	AuthStorage,
	convertToLlm,
	ManagedAgentSession,
	type ManagedAgentSessionEvent,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@fitclaw/runtime";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type CoachSessionEvent = ManagedAgentSessionEvent;

type CoachSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

class WorkspaceSettingsStorage implements CoachSettingsStorage {
	private readonly settingsPath: string;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
	}

	read(scope: "global" | "project"): string | undefined {
		if (scope === "project") {
			return undefined;
		}

		return existsSync(this.settingsPath) ? readFileSync(this.settingsPath, "utf-8") : undefined;
	}

	update(scope: "global" | "project", fn: (current: string | undefined) => string): void {
		if (scope === "project") {
			return;
		}

		const dir = dirname(this.settingsPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(this.settingsPath, fn(this.read(scope)), "utf-8");
	}
}

export interface CreateCoachSessionOptions {
	channelDir: string;
	systemPrompt: string;
	tools: AgentTool[];
}

export function createCoachSession(options: CreateCoachSessionOptions) {
	const authStorage = AuthStorage.create(join(homedir(), ".fitclaw", "agent", "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage);
	const provider = process.env.MOM_LLM_PROVIDER || "deepseek";
	const modelId = process.env.MOM_LLM_MODEL || "deepseek-v4-pro";
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
						"Set the provider API key via auth.json or its supported environment variable.",
				);
			}
			return auth.apiKey;
		},
	});

	const sessionManager = SessionManager.open(join(options.channelDir, "context.jsonl"), options.channelDir);
	const settingsManager = SettingsManager.fromStorage(new WorkspaceSettingsStorage(join(options.channelDir, "..")));
	const session = new ManagedAgentSession({
		agent,
		sessionManager,
		settingsManager,
		modelRegistry,
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
			return session.prompt(text, images);
		},
		abort() {
			return session.abort();
		},
		updateRuntime(systemPrompt: string, tools: AgentTool[]) {
			session.updateRuntime(systemPrompt, tools);
		},
	};
}
