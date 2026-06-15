---
change: design-feishu-fitness-user-loop
design-doc: docs/superpowers/specs/2026-06-16-design-feishu-fitness-user-loop-design.md
base-ref: ac063eac6c453f3febb139bb662e051fc32954b9
archived-with: 2026-06-16-design-feishu-fitness-user-loop
---

# Feishu Fitness User Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the spec-only Feishu fitness user loop change and verify that the OpenSpec artifacts are valid.

**Architecture:** This change does not modify runtime code. It defines the Feishu first-stage user loop in OpenSpec and records the technical design in a Superpowers design document.

**Tech Stack:** OpenSpec, Comet workflow metadata, Markdown documentation.

### Task 1: Finalize OpenSpec Task State

**Files:**
- Modify: `openspec/changes/design-feishu-fitness-user-loop/tasks.md`
- Verify: `openspec/changes/design-feishu-fitness-user-loop/proposal.md`
- Verify: `openspec/changes/design-feishu-fitness-user-loop/design.md`
- Verify: `openspec/changes/design-feishu-fitness-user-loop/specs/feishu-fitness-user-loop/spec.md`
- Verify: `openspec/changes/design-feishu-fitness-user-loop/specs/product-direction/spec.md`

- [ ] **Step 1: Review artifact completeness**

Run:

```bash
npx openspec status --change design-feishu-fitness-user-loop
```

Expected: all required artifacts are complete.

- [ ] **Step 2: Mark OpenSpec tasks complete**

Update every checkbox in `openspec/changes/design-feishu-fitness-user-loop/tasks.md` from `- [ ]` to `- [x]`, because the artifacts, user review, design handoff, and design document have been completed.

- [ ] **Step 3: Validate the change**

Run:

```bash
npx openspec validate design-feishu-fitness-user-loop
```

Expected: validation passes.

### Task 2: Configure Lightweight Build Verification

**Files:**
- Modify: `openspec/changes/design-feishu-fitness-user-loop/.comet.yaml`

- [ ] **Step 1: Record plan path**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set design-feishu-fitness-user-loop plan docs/superpowers/plans/2026-06-16-design-feishu-fitness-user-loop.md
```

Expected: `.comet.yaml` records the plan path.

- [ ] **Step 2: Record selected build configuration**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set design-feishu-fitness-user-loop isolation branch
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set design-feishu-fitness-user-loop build_mode executing-plans
```

Expected: `.comet.yaml` records `isolation: branch` and `build_mode: executing-plans`.

- [ ] **Step 3: Configure build and verify commands**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set design-feishu-fitness-user-loop build_command "cmd.exe /c npx openspec validate design-feishu-fitness-user-loop"
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set design-feishu-fitness-user-loop verify_command "cmd.exe /c npx openspec validate design-feishu-fitness-user-loop"
```

Expected: build and verify commands use OpenSpec validation, because this is a spec-only change.

- [ ] **Step 4: Run build guard**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-guard.sh design-feishu-fitness-user-loop build --apply
```

Expected: build guard passes and transitions the change to `phase: verify`.
