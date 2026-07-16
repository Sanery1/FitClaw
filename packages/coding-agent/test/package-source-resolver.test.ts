import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageSourceResolver } from "../src/core/package-source-resolver.js";

describe("PackageSourceResolver", () => {
	let cwd: string;
	let agentDir: string;
	let sourceResolver: PackageSourceResolver;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "fitclaw-source-resolver-"));
		agentDir = join(cwd, "agent");
		mkdirSync(agentDir);
		sourceResolver = new PackageSourceResolver({ cwd, agentDir });
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	it("parses pinned and unpinned npm sources", () => {
		expect(sourceResolver.parse("npm:@scope/pkg@1.2.3")).toEqual({
			type: "npm",
			spec: "@scope/pkg@1.2.3",
			name: "@scope/pkg",
			pinned: true,
		});
		expect(sourceResolver.parse("npm:pkg")).toEqual({
			type: "npm",
			spec: "pkg",
			name: "pkg",
			pinned: false,
		});
	});

	it("normalizes local settings paths relative to their scope", () => {
		const projectPackage = join(cwd, ".fitclaw", "packages", "local-package");
		const userPackage = join(agentDir, "packages", "local-package");

		expect(sourceResolver.normalizeForSettings(projectPackage, "project")).toBe(join("packages", "local-package"));
		expect(sourceResolver.normalizeForSettings(userPackage, "user")).toBe(join("packages", "local-package"));
	});

	it("matches equivalent configured and absolute local sources", () => {
		const absolutePath = join(cwd, ".fitclaw", "packages", "local-package");

		expect(sourceResolver.matches(join("packages", "local-package"), absolutePath, "project")).toBe(true);
	});

	it("deduplicates package identities with project scope taking precedence", () => {
		const packages = sourceResolver.dedupe([
			{ pkg: "npm:example@1.0.0", scope: "user" },
			{ pkg: "npm:example", scope: "project" },
			{ pkg: "npm:other", scope: "user" },
		]);

		expect(packages).toEqual([
			{ pkg: "npm:example", scope: "project" },
			{ pkg: "npm:other", scope: "user" },
		]);
	});

	it("suggests configured prefixes for ambiguous package input", () => {
		expect(sourceResolver.buildNoMatchingPackageMessage("example", ["npm:example"])).toBe(
			"No matching package found for example. Did you mean npm:example?",
		);
		expect(sourceResolver.buildNoMatchingPackageMessage("github.com/user/repo", ["git:github.com/user/repo"])).toBe(
			"No matching package found for github.com/user/repo. Did you mean git:github.com/user/repo?",
		);
	});
});
