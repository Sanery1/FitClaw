import { posix, win32 } from "node:path";
import type { Executor } from "../sandbox.js";

function isAbsolutePath(path: string): boolean {
	return posix.isAbsolute(path) || win32.isAbsolute(path);
}

function isWindowsPath(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
	const pathApi = isWindowsPath(rootPath) ? win32 : posix;
	const relativePath = pathApi.relative(pathApi.normalize(rootPath), pathApi.normalize(candidatePath));
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relativePath))
	);
}

export function createSkillFileResolver(
	executor: Executor,
	allowedRoots: readonly string[],
): (path: string, signal?: AbortSignal) => Promise<string> {
	let canonicalRootsPromise: Promise<string[]> | undefined;
	const getCanonicalRoots = (): Promise<string[]> => {
		canonicalRootsPromise ??= Promise.all(allowedRoots.map((root) => executor.resolvePath(root)));
		return canonicalRootsPromise;
	};

	return async (path: string, signal?: AbortSignal): Promise<string> => {
		if (!isAbsolutePath(path) || !allowedRoots.some((root) => isPathInside(path, root))) {
			throw new Error(`SECURITY_BLOCKED: File is outside the available Skill directories: ${path}`);
		}

		const [resolvedPath, canonicalRoots] = await Promise.all([
			executor.resolvePath(path, { signal }),
			getCanonicalRoots(),
		]);
		if (!canonicalRoots.some((root) => isPathInside(resolvedPath, root))) {
			throw new Error(`SECURITY_BLOCKED: File resolves outside the available Skill directories: ${path}`);
		}

		return resolvedPath;
	};
}
