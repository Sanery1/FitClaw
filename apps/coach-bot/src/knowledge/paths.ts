import { resolve } from "node:path";
import type { KnowledgePaths } from "./types.js";

export function createKnowledgePaths(workspacePath: string): KnowledgePaths {
	const root = resolve(workspacePath, "knowledge");
	return {
		root,
		library: resolve(root, "library.yaml"),
		database: resolve(root, "books.sqlite"),
		pageCache: resolve(root, "page-cache"),
		reports: resolve(root, "reports"),
	};
}
