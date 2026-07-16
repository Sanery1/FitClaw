import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageSourceResolver } from "../src/core/package-source-resolver.js";

function parseGitSource(sourceResolver: PackageSourceResolver, source: string) {
	const parsed = sourceResolver.parse(source);
	if (parsed.type !== "git") {
		throw new Error(`Expected a git source, received ${parsed.type}`);
	}
	return parsed;
}

describe("Package Manager git source parsing", () => {
	let tempDir: string;
	let agentDir: string;
	let sourceResolver: PackageSourceResolver;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pm-ssh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });

		sourceResolver = new PackageSourceResolver({
			cwd: tempDir,
			agentDir,
		});
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("protocol URLs without git: prefix", () => {
		it("should parse https:// URL", () => {
			const parsed = parseGitSource(sourceResolver, "https://github.com/user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
		});

		it("should parse ssh:// URL", () => {
			const parsed = parseGitSource(sourceResolver, "ssh://git@github.com/user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("ssh://git@github.com/user/repo");
		});
	});

	describe("shorthand URLs with git: prefix", () => {
		it("should parse git@host:path format", () => {
			const parsed = parseGitSource(sourceResolver, "git:git@github.com:user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("git@github.com:user/repo");
			expect(parsed.pinned).toBe(false);
		});

		it("should parse host/path shorthand", () => {
			const parsed = parseGitSource(sourceResolver, "git:github.com/user/repo");
			expect(parsed.type).toBe("git");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
		});

		it("should parse shorthand with ref", () => {
			const parsed = parseGitSource(sourceResolver, "git:git@github.com:user/repo@v1.0.0");
			expect(parsed.type).toBe("git");
			expect(parsed.ref).toBe("v1.0.0");
			expect(parsed.pinned).toBe(true);
		});
	});

	describe("unsupported without git: prefix", () => {
		it("should treat git@host:path as local without git: prefix", () => {
			const parsed = sourceResolver.parse("git@github.com:user/repo");
			expect(parsed.type).toBe("local");
		});

		it("should treat host/path shorthand as local without git: prefix", () => {
			const parsed = sourceResolver.parse("github.com/user/repo");
			expect(parsed.type).toBe("local");
		});
	});

	describe("identity normalization", () => {
		it("should normalize protocol and shorthand-prefixed URLs to same identity", () => {
			const prefixed = sourceResolver.getIdentity("git:git@github.com:user/repo");
			const https = sourceResolver.getIdentity("https://github.com/user/repo");
			const ssh = sourceResolver.getIdentity("ssh://git@github.com/user/repo");

			expect(prefixed).toBe("git:github.com/user/repo");
			expect(prefixed).toBe(https);
			expect(prefixed).toBe(ssh);
		});
	});
});
