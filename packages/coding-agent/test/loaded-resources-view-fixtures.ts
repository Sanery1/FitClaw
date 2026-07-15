import type { SourceInfo } from "../src/core/source-info.js";

export interface ExtensionFixture {
	path: string;
	sourceInfo?: SourceInfo;
}

export function createSourceInfo(
	filePath: string,
	options: {
		source: string;
		scope: "user" | "project" | "temporary";
		origin: "package" | "top-level";
		baseDir?: string;
	},
): SourceInfo {
	return {
		path: filePath,
		source: options.source,
		scope: options.scope,
		origin: options.origin,
		baseDir: options.baseDir,
	};
}

export function createExtensionFixtures(): ExtensionFixture[] {
	return [
		{
			path: "/tmp/project/.pi/extensions/answer.ts",
			sourceInfo: createSourceInfo("/tmp/project/.pi/extensions/answer.ts", {
				source: "local",
				scope: "project",
				origin: "top-level",
				baseDir: "/tmp/project/.pi/extensions",
			}),
		},
		{
			path: "/tmp/project/.pi/extensions/local-index/index.ts",
			sourceInfo: createSourceInfo("/tmp/project/.pi/extensions/local-index/index.ts", {
				source: "local",
				scope: "project",
				origin: "top-level",
				baseDir: "/tmp/project/.pi/extensions",
			}),
		},
		{
			path: "/tmp/agent/extensions/user-index/index.ts",
			sourceInfo: createSourceInfo("/tmp/agent/extensions/user-index/index.ts", {
				source: "local",
				scope: "user",
				origin: "top-level",
				baseDir: "/tmp/agent/extensions",
			}),
		},
		{
			path: "/tmp/project/.pi/npm/node_modules/pi-markdown-preview/extensions/index.ts",
			sourceInfo: createSourceInfo("/tmp/project/.pi/npm/node_modules/pi-markdown-preview/extensions/index.ts", {
				source: "npm:pi-markdown-preview",
				scope: "project",
				origin: "package",
				baseDir: "/tmp/project/.pi/npm/node_modules/pi-markdown-preview",
			}),
		},
		{
			path: "/tmp/project/.pi/npm/node_modules/@scope/pi-scoped/extensions/index.ts",
			sourceInfo: createSourceInfo("/tmp/project/.pi/npm/node_modules/@scope/pi-scoped/extensions/index.ts", {
				source: "npm:@scope/pi-scoped",
				scope: "project",
				origin: "package",
				baseDir: "/tmp/project/.pi/npm/node_modules/@scope/pi-scoped",
			}),
		},
		{
			path: "/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents/extensions/index.ts",
			sourceInfo: createSourceInfo(
				"/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents/extensions/index.ts",
				{
					source: "git:github.com/HazAT/pi-interactive-subagents",
					scope: "project",
					origin: "package",
					baseDir: "/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents",
				},
			),
		},
		{
			path: "/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents/extensions/subagents/index.ts",
			sourceInfo: createSourceInfo(
				"/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents/extensions/subagents/index.ts",
				{
					source: "git:github.com/HazAT/pi-interactive-subagents",
					scope: "project",
					origin: "package",
					baseDir: "/tmp/project/.pi/git/github.com/HazAT/pi-interactive-subagents",
				},
			),
		},
		{
			path: "/tmp/temp/cli-extension.ts",
			sourceInfo: createSourceInfo("/tmp/temp/cli-extension.ts", {
				source: "cli",
				scope: "temporary",
				origin: "top-level",
				baseDir: "/tmp/temp",
			}),
		},
	];
}
