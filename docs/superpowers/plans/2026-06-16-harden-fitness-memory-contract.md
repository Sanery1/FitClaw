---
change: harden-fitness-memory-contract
design-doc: docs/superpowers/specs/2026-06-16-harden-fitness-memory-contract-design.md
base-ref: 484ccd9df5f22d9e2502e783fe7f7e2562fd32a8
archived-with: 2026-06-16-harden-fitness-memory-contract
---

# Harden Fitness Memory Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the spec-only fitness memory contract change and verify that the OpenSpec artifacts are valid.

**Architecture:** This change does not modify runtime code. It defines the first-stage fitness memory contract in OpenSpec and records the technical design in a Superpowers design document.

**Tech Stack:** OpenSpec, Comet workflow metadata, Markdown documentation.

### Task 1: Finalize OpenSpec Task State

**Files:**
- Modify: `openspec/changes/harden-fitness-memory-contract/tasks.md`
- Verify: `openspec/changes/harden-fitness-memory-contract/proposal.md`
- Verify: `openspec/changes/harden-fitness-memory-contract/design.md`
- Verify: `openspec/changes/harden-fitness-memory-contract/specs/fitness-memory-contract/spec.md`
- Verify: `openspec/changes/harden-fitness-memory-contract/specs/feishu-fitness-user-loop/spec.md`
- Verify: `openspec/changes/harden-fitness-memory-contract/specs/product-direction/spec.md`

- [ ] **Step 1: Review artifact completeness**

Run:

```bash
npx openspec status --change harden-fitness-memory-contract
```

Expected: all required artifacts are complete.

- [ ] **Step 2: Mark OpenSpec tasks complete**

Update every checkbox in `openspec/changes/harden-fitness-memory-contract/tasks.md` from `- [ ]` to `- [x]`, because the artifacts, user review, design handoff, and design document have been completed.

- [ ] **Step 3: Validate the change**

Run:

```bash
npx openspec validate harden-fitness-memory-contract
```

Expected: validation passes.

### Task 2: Configure Lightweight Build Verification

**Files:**
- Modify: `openspec/changes/harden-fitness-memory-contract/.comet.yaml`

- [ ] **Step 1: Record plan path**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set harden-fitness-memory-contract plan docs/superpowers/plans/2026-06-16-harden-fitness-memory-contract.md
```

Expected: `.comet.yaml` records the plan path.

- [ ] **Step 2: Record selected build configuration**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set harden-fitness-memory-contract isolation branch
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set harden-fitness-memory-contract build_mode executing-plans
```

Expected: `.comet.yaml` records `isolation: branch` and `build_mode: executing-plans`.

- [ ] **Step 3: Configure build and verify commands**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set harden-fitness-memory-contract build_command "cmd.exe /c npx openspec validate harden-fitness-memory-contract"
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-state.sh set harden-fitness-memory-contract verify_command "cmd.exe /c npx openspec validate harden-fitness-memory-contract"
```

Expected: build and verify commands use OpenSpec validation, because this is a spec-only change.

- [ ] **Step 4: Run build guard**

Run:

```bash
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-guard.sh harden-fitness-memory-contract build --apply
```

Expected: build guard passes and transitions the change to `phase: verify`.
