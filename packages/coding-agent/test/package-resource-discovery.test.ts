import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyPatterns,
	collectAutoExtensionEntries,
	collectResourceFiles,
	isEnabledByOverrides,
} from "../src/core/package-resource-discovery.js";

describe("package resource discovery", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "fitclaw-resource-discovery-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("resolves explicit extensions from a fitclaw manifest", () => {
		const mainExtension = join(root, "main.ts");
		writeFileSync(mainExtension, "export default {};");
		writeFileSync(join(root, "helper.ts"), "export const helper = true;");
		writeFileSync(join(root, "package.json"), JSON.stringify({ fitclaw: { extensions: ["main.ts"] } }));

		expect(collectAutoExtensionEntries(root)).toEqual([mainExtension]);
	});

	it("discovers top-level extensions and subdirectory entry points", () => {
		const topLevelExtension = join(root, "top-level.ts");
		const nestedDir = join(root, "nested");
		const nestedEntry = join(nestedDir, "index.js");
		writeFileSync(topLevelExtension, "export default {};");
		mkdirSync(nestedDir);
		writeFileSync(nestedEntry, "export default {};");
		writeFileSync(join(nestedDir, "helper.js"), "export const helper = true;");

		expect(new Set(collectAutoExtensionEntries(root))).toEqual(new Set([nestedEntry, topLevelExtension]));
	});

	it("stops descending after finding a skill entry point", () => {
		const skillDir = join(root, "review");
		const skillEntry = join(skillDir, "SKILL.md");
		mkdirSync(join(skillDir, "nested"), { recursive: true });
		writeFileSync(skillEntry, "# Review");
		writeFileSync(join(skillDir, "nested", "SKILL.md"), "# Nested");

		expect(collectResourceFiles(root, "skills")).toEqual([skillEntry]);
	});

	it("respects ignore files during extension discovery", () => {
		const included = join(root, "included.ts");
		writeFileSync(included, "export default {};");
		writeFileSync(join(root, "ignored.ts"), "export default {};");
		writeFileSync(join(root, ".gitignore"), "ignored.ts\n");

		expect(collectAutoExtensionEntries(root)).toEqual([included]);
	});

	it("applies include, exclude, force-include, and force-exclude patterns in order", () => {
		const included = join(root, "included.ts");
		const restored = join(root, "restored.ts");
		const removed = join(root, "nested", "removed.ts");
		const paths = [included, restored, removed];

		const enabled = applyPatterns(paths, ["**/*.ts", "!restored.ts", "+restored.ts", "-nested/removed.ts"], root);

		expect(enabled).toEqual(new Set([included, restored]));
	});

	it("matches skill override patterns against their directory", () => {
		const skillEntry = join(root, "disabled-skill", "SKILL.md");

		expect(isEnabledByOverrides(skillEntry, ["!disabled-skill"], root)).toBe(false);
		expect(isEnabledByOverrides(skillEntry, ["!disabled-skill", "+disabled-skill"], root)).toBe(true);
	});
});
