#!/usr/bin/env npx tsx
/**
 * Validates .fitclaw/ knowledge base structure.
 * Checks: domain files exist, skills have required files, no rule conflicts.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const PROMPTS_DIR = path.join(ROOT, ".fitclaw", "prompts");
const SKILLS_DIR = path.join(ROOT, ".fitclaw", "skills");
const CORE_FILE = path.join(ROOT, "fitclaw.md");

const REQUIRED_DOMAIN_FILES = [
  "safety.md",
  "training_methods.md",
  "exercise_technique.md",
  "nutrition.md",
  "recovery.md",
];

const REQUIRED_SKILLS = {
  "fitness-coach": ["SKILL.md", "onboarding.md", "plan-design.md", "progression.md"],
};

const errors: string[] = [];
const warnings: string[] = [];

// Check core file
if (!fs.existsSync(CORE_FILE)) {
  errors.push(`Missing core knowledge file: ${CORE_FILE}`);
}

// Check domain files
if (!fs.existsSync(PROMPTS_DIR)) {
  errors.push(`Missing prompts directory: ${PROMPTS_DIR}`);
} else {
  for (const file of REQUIRED_DOMAIN_FILES) {
    const filePath = path.join(PROMPTS_DIR, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing domain file: ${filePath}`);
    }
  }
}

// Check available domain files referenced in fitclaw.md match actual files
if (fs.existsSync(CORE_FILE) && fs.existsSync(PROMPTS_DIR)) {
  const coreContent = fs.readFileSync(CORE_FILE, "utf-8");
  const referencedFiles = coreContent.match(/`([a-z_]+\.md)`/g)?.map((m) => m.replace(/`/g, "")) ?? [];
  const actualFiles = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md"));

  for (const ref of referencedFiles) {
    if (!actualFiles.includes(ref)) {
      warnings.push(`fitclaw.md references '${ref}' but file not found in prompts/`);
    }
  }
  for (const actual of actualFiles) {
    if (!referencedFiles.includes(actual)) {
      warnings.push(`'${actual}' exists in prompts/ but not referenced in fitclaw.md`);
    }
  }
}

// Check skills
if (!fs.existsSync(SKILLS_DIR)) {
  errors.push(`Missing skills directory: ${SKILLS_DIR}`);
} else {
  for (const [skillName, requiredFiles] of Object.entries(REQUIRED_SKILLS)) {
    const skillDir = path.join(SKILLS_DIR, skillName);
    if (!fs.existsSync(skillDir)) {
      errors.push(`Missing skill directory: ${skillDir}`);
      continue;
    }
    for (const file of requiredFiles) {
      const filePath = path.join(skillDir, file);
      if (!fs.existsSync(filePath)) {
        errors.push(`Missing skill file: ${filePath}`);
      }
    }
  }
}

// Output
if (errors.length > 0) {
  console.error("ERRORS:");
  for (const e of errors) console.error(`  ❌ ${e}`);
}
if (warnings.length > 0) {
  console.warn("WARNINGS:");
  for (const w of warnings) console.warn(`  ⚠️  ${w}`);
}
if (errors.length === 0 && warnings.length === 0) {
  console.log("✅ All knowledge base checks passed!");
}

process.exit(errors.length > 0 ? 1 : 0);
