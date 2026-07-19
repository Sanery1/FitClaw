import { createDeploymentModelsConfig, parseDeploymentApi } from "./runtime/deployment-model-config.js";

function requireEnvironmentVariable(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing ${name}`);
	}
	return value;
}

const config = createDeploymentModelsConfig({
	provider: requireEnvironmentVariable("MOM_LLM_PROVIDER"),
	modelId: requireEnvironmentVariable("MOM_LLM_MODEL"),
	baseUrl: requireEnvironmentVariable("MOM_LLM_BASE_URL"),
	api: parseDeploymentApi(requireEnvironmentVariable("MOM_LLM_API_TYPE")),
	apiKeyEnvName: "MOM_LLM_API_KEY",
});

process.stdout.write(JSON.stringify(config, null, 2));
