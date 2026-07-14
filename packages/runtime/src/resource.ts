export type ResourceDiagnosticType = "warning" | "error" | "collision";

export interface ResourceCollision {
	resourceType: "extension" | "skill" | "prompt" | "theme";
	name: string;
	winnerPath: string;
	loserPath: string;
	winnerSource?: string;
	loserSource?: string;
}

export interface ResourceDiagnostic {
	type: ResourceDiagnosticType;
	message: string;
	path?: string;
	collision?: ResourceCollision;
}

export type SourceScope = "user" | "project" | "temporary";
export type SourceOrigin = "package" | "top-level";

export interface SourceInfo {
	path: string;
	source: string;
	scope: SourceScope;
	origin: SourceOrigin;
	baseDir?: string;
}

export function createSyntheticSourceInfo(
	path: string,
	options: {
		source: string;
		scope?: SourceScope;
		origin?: SourceOrigin;
		baseDir?: string;
	},
): SourceInfo {
	return {
		path,
		source: options.source,
		scope: options.scope ?? "temporary",
		origin: options.origin ?? "top-level",
		baseDir: options.baseDir,
	};
}
