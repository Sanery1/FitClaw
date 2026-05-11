import { getProviders } from "@fitclaw/ai";
import { defaultModelPerProvider } from "../../core/model-resolver.js";

export const BEDROCK_PROVIDER_ID = "amazon-bedrock";

const API_KEY_LOGIN_PROVIDERS: Record<string, string> = {
	anthropic: "Anthropic",
	[BEDROCK_PROVIDER_ID]: "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	openrouter: "OpenRouter",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
};

const BUILT_IN_API_KEY_LOGIN_PROVIDERS = new Set(Object.keys(API_KEY_LOGIN_PROVIDERS));
const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

export function isApiKeyLoginProvider(
	providerId: string,
	oauthProviderIds: ReadonlySet<string>,
	builtInProviderIds: ReadonlySet<string> = BUILT_IN_MODEL_PROVIDERS,
): boolean {
	if (BUILT_IN_API_KEY_LOGIN_PROVIDERS.has(providerId)) {
		return true;
	}
	if (builtInProviderIds.has(providerId)) {
		return false;
	}
	return !oauthProviderIds.has(providerId);
}

export function getApiKeyProviderDisplayName(providerId: string): string {
	return API_KEY_LOGIN_PROVIDERS[providerId] ?? providerId;
}

export function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}
