import { type Api, getApiProvider, getModels, getProviders, type KnownProvider, type Model } from "@fitclaw/ai";

export interface DeploymentModelConfigInput {
	provider: string;
	modelId: string;
	baseUrl: string;
	api: Api;
	apiKeyEnvName: string;
}

interface DeploymentProviderConfig {
	baseUrl: string;
	api: Api;
	apiKey?: string;
	models?: Array<{ id: string }>;
}

export interface DeploymentModelsConfig {
	providers: Record<string, DeploymentProviderConfig>;
}

export function parseDeploymentApi(value: string): Api {
	const api = value as Api;
	if (!getApiProvider(api)) {
		throw new Error(`Unsupported model API transport: "${value}"`);
	}
	return api;
}

function findBuiltInModel(provider: string, modelId: string): Model<Api> | undefined {
	if (!getProviders().some((candidate) => candidate === provider)) {
		return undefined;
	}

	return (getModels(provider as KnownProvider) as Model<Api>[]).find((model) => model.id === modelId);
}

export function createDeploymentModelsConfig(input: DeploymentModelConfigInput): DeploymentModelsConfig {
	const isBuiltInProvider = getProviders().some((provider) => provider === input.provider);
	const isBuiltInModel = findBuiltInModel(input.provider, input.modelId) !== undefined;
	const providerConfig: DeploymentProviderConfig = {
		baseUrl: input.baseUrl,
		api: input.api,
		...(isBuiltInProvider ? {} : { apiKey: input.apiKeyEnvName }),
		...(isBuiltInModel ? {} : { models: [{ id: input.modelId }] }),
	};

	return {
		providers: {
			[input.provider]: providerConfig,
		},
	};
}
