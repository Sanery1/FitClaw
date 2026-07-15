import { homedir } from "os";
import { join } from "path";

export const CONFIG_DIR_NAME = ".fitclaw";
export const ENV_AGENT_DIR = "FITCLAW_CODING_AGENT_DIR";

export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir === "~") return homedir();
	if (envDir?.startsWith("~/")) return homedir() + envDir.slice(1);
	return envDir || join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}
