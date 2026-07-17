import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
	resolve: {
		alias: [
			{ find: /^@fitclaw\/ai$/, replacement: aiSrcIndex },
			{ find: /^@fitclaw\/ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@fitclaw\/agent-core$/, replacement: agentSrcIndex },
		],
	},
});
