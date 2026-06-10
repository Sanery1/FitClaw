import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const clawSrcIndex = fileURLToPath(new URL("../coding-agent/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 10000,
	},
	resolve: {
		alias: [
			{ find: /^@fitclaw\/claw$/, replacement: clawSrcIndex },
		],
	},
});
