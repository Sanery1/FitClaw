#!/usr/bin/env node

import { pingSkillRunner } from "./runtime/skill-runner-client.js";
import { startSkillRunnerServer } from "./skill-runner.js";

const socketPath = process.env.FITCLAW_SKILL_RUNNER_SOCKET;
const workspacePath = process.env.FITCLAW_SKILL_RUNNER_WORKSPACE;

if (!socketPath) throw new Error("FITCLAW_SKILL_RUNNER_SOCKET is required");

if (process.argv.includes("--healthcheck")) {
	process.exit((await pingSkillRunner(socketPath)) ? 0 : 1);
}

if (!workspacePath) throw new Error("FITCLAW_SKILL_RUNNER_WORKSPACE is required");

const server = await startSkillRunnerServer({ socketPath, workspacePath });
console.log(`FitClaw Skill Runner listening on ${socketPath}`);

let isShuttingDown = false;
const shutdown = async () => {
	if (isShuttingDown) return;
	isShuttingDown = true;
	await server.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
