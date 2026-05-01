import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { isAbsolute, resolve as resolvePath, sep } from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";
function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
	// macOS stores filenames in NFD (decomposed) form, try converting user input to NFD
	return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
	// macOS uses U+2019 (right single quotation mark) in screenshot names like "Capture d'écran"
	// Users typically type U+0027 (straight apostrophe)
	return filePath.replace(/'/g, "\u2019");
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function normalizeAtPrefix(filePath: string): string {
	return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath));
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

/**
 * Check whether a path contains parent-directory traversal segments.
 */
function containsParentTraversal(filePath: string): boolean {
	const parts = filePath.split(/[/\\]/);
	return parts.some((part) => part === "..");
}

/**
 * Validate that a resolved path does not escape the allowed base directories.
 * Rejects paths with ".." segments and absolute paths outside cwd or home.
 */
function validatePathBoundary(resolvedPath: string, cwd: string): void {
	if (containsParentTraversal(resolvedPath)) {
		throw new Error(`SECURITY_BLOCKED: Path contains parent directory traversal (".."): ${resolvedPath}`);
	}

	const homeDir = os.homedir();
	const normalizedResolved = resolvePath(resolvedPath);
	const normalizedCwd = resolvePath(cwd);
	const normalizedHome = resolvePath(homeDir);

	const withinCwd = normalizedResolved === normalizedCwd || normalizedResolved.startsWith(normalizedCwd + sep);
	const withinHome = normalizedResolved === normalizedHome || normalizedResolved.startsWith(normalizedHome + sep);

	if (!withinCwd && !withinHome) {
		throw new Error(
			`SECURITY_BLOCKED: Path is outside the allowed directories (cwd: ${cwd}, home: ${homeDir}): ${resolvedPath}`,
		);
	}
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 * Throws if the resolved path escapes cwd or the home directory.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (containsParentTraversal(expanded)) {
		throw new Error(`SECURITY_BLOCKED: Path contains parent directory traversal (".."): ${filePath}`);
	}
	const resolved = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
	validatePathBoundary(resolved, cwd);
	return resolved;
}

export function resolveReadPath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);

	if (fileExists(resolved)) {
		return resolved;
	}

	// Try macOS AM/PM variant (narrow no-break space before AM/PM)
	const amPmVariant = tryMacOSScreenshotPath(resolved);
	if (amPmVariant !== resolved && fileExists(amPmVariant)) {
		return amPmVariant;
	}

	// Try NFD variant (macOS stores filenames in NFD form)
	const nfdVariant = tryNFDVariant(resolved);
	if (nfdVariant !== resolved && fileExists(nfdVariant)) {
		return nfdVariant;
	}

	// Try curly quote variant (macOS uses U+2019 in screenshot names)
	const curlyVariant = tryCurlyQuoteVariant(resolved);
	if (curlyVariant !== resolved && fileExists(curlyVariant)) {
		return curlyVariant;
	}

	// Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
	const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
	if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
		return nfdCurlyVariant;
	}

	return resolved;
}
