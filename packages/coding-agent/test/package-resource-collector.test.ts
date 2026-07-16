import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageResourceCollector, type PathMetadata } from "../src/core/package-resource-collector.js";
import { PackageSourceResolver } from "../src/core/package-source-resolver.js";

describe("PackageResourceCollector", () => {
	let cwd: string;
	let resourceCollector: PackageResourceCollector;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "fitclaw-resource-collector-"));
		const sourceResolver = new PackageSourceResolver({ cwd, agentDir: join(cwd, "agent") });
		resourceCollector = new PackageResourceCollector({ cwd, sourceResolver });
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	it("collects enabled resources declared by a FitClaw manifest", () => {
		const packageRoot = join(cwd, "manifest-package");
		const extensionsDir = join(packageRoot, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(join(extensionsDir, "keep.ts"), "export default function() {}");
		writeFileSync(join(extensionsDir, "skip.ts"), "export default function() {}");
		writeFileSync(
			join(packageRoot, "package.json"),
			JSON.stringify({ fitclaw: { extensions: ["extensions", "!**/skip.ts"] } }),
		);

		const accumulator = resourceCollector.createAccumulator();
		const metadata: PathMetadata = { source: packageRoot, scope: "project", origin: "package" };

		expect(resourceCollector.collectPackageResources(packageRoot, accumulator, undefined, metadata)).toBe(true);
		expect(resourceCollector.toResolvedPaths(accumulator).extensions).toEqual([
			{
				path: join(extensionsDir, "keep.ts"),
				enabled: true,
				metadata,
			},
		]);
	});
});
