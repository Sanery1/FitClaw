import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleSkillCommand, syncSkills } from "../src/cli/skill-sync.js";

describe("skill sync", () => {
	let tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	function createProject(): string {
		const dir = mkdtempSync(join(tmpdir(), "fitclaw-skill-sync-"));
		tempDirs = [...tempDirs, dir];
		return dir;
	}

	it("copies project skills into the bot workspace by default", async () => {
		const projectDir = createProject();
		const skillDir = join(projectDir, ".fitclaw", "skills", "bodybuilding");
		await mkdir(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bodybuilding\ndescription: Fitness\n---\n", "utf-8");
		writeFileSync(join(skillDir, "helper.py"), "print('ok')\n", "utf-8");

		const result = await syncSkills({ cwd: projectDir });

		const targetSkill = join(projectDir, "feishu-workspace", "skills", "bodybuilding");
		expect(result.copied).toEqual(["bodybuilding"]);
		expect(readFileSync(join(targetSkill, "SKILL.md"), "utf-8")).toContain("bodybuilding");
		expect(readFileSync(join(targetSkill, "helper.py"), "utf-8")).toContain("ok");
	});

	it("reports dry-run changes without writing files", async () => {
		const projectDir = createProject();
		const skillDir = join(projectDir, ".fitclaw", "skills", "swimming-coach");
		await mkdir(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: swimming-coach\ndescription: Swim\n---\n", "utf-8");

		const result = await syncSkills({ cwd: projectDir, dryRun: true });

		expect(result.copied).toEqual(["swimming-coach"]);
		expect(existsSync(join(projectDir, "feishu-workspace", "skills", "swimming-coach"))).toBe(false);
	});

	it("prints sync help without touching the target workspace", async () => {
		const projectDir = createProject();
		const skillDir = join(projectDir, ".fitclaw", "skills", "bodybuilding");
		await mkdir(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bodybuilding\ndescription: Fitness\n---\n", "utf-8");

		const originalLog = console.log;
		let lines: string[] = [];
		console.log = (message?: unknown) => {
			lines = [...lines, String(message ?? "")];
		};
		try {
			const handled = await handleSkillCommand(["skill", "sync", "--help"], projectDir);
			expect(handled).toBe(true);
		} finally {
			console.log = originalLog;
		}

		expect(lines.join("\n")).toContain("fitclaw skill sync");
		expect(existsSync(join(projectDir, "feishu-workspace", "skills", "bodybuilding"))).toBe(false);
	});
});
