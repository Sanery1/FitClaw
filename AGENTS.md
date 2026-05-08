# FitClaw — Agent Development Rules

> Universal rules for AI coding agents (Claude Code, Codex, Copilot, etc.) working on this codebase.
> Project context and architecture → [CLAUDE.md](./CLAUDE.md)

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode keybindings. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`).
- **Immutability (CRITICAL)**: Always create new objects, never mutate existing ones. Use immutable update patterns.
- **KISS / YAGNI / DRY**: Prefer simple solutions. Don't build for hypothetical futures. Extract repeated logic into shared utilities only when repetition is real.
- **Error handling**: Handle errors explicitly at every level. Never silently swallow errors.
- **Input validation**: Validate all user input at system boundaries. Never trust external data (API responses, user input, file content).

### File Organization

- MANY SMALL FILES > FEW LARGE FILES
- 200-400 lines typical, 800 max
- Organize by feature/domain, not by type
- Extract utilities from large modules

### Naming Conventions

- Variables and functions: `camelCase`
- Booleans: prefer `is`, `has`, `should`, `can` prefixes
- Interfaces, types, components: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Custom hooks: `camelCase` with `use` prefix

## Commands

```bash
# Type check + lint (run after all code changes)
npm run check

# Run all tests
npm run test

# Build all packages
npm run build

# Run specific test file (from package root, not repo root)
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

- After code changes (not docs): run `npm run check` and fix all errors, warnings, and infos before committing.
- If you create or modify a test file, run that file and iterate until it passes.
- For `packages/coding-agent/test/suite/`, use the faux provider. Do not use real provider APIs, real API keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` and name them `<issue-number>-<short-slug>.test.ts`.
- **NEVER commit unless user asks.**

## AI Agent Work Rules

1. **Pushing**: Push must be explicitly requested by user. When asked: `git push origin main`.
2. **Commits**: Bug fixes get independent commits following conventional commits format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`). No `--no-verify`, no `--amend` unless explicitly requested.
3. **Documentation**: Project docs go in `docs/` directory, not scattered in root.

## PR Workflow

- Analyze PRs without pulling locally first
- If approved: create feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- Work in feature branches until requirements are met, then merge into main and push
- When closing issues via commit, include `fixes #<number>` or `closes #<number>` in the commit message

## Testing FitClaw Interactive Mode with tmux

```bash
# Create tmux session
tmux new-session -d -s fitclaw-test -x 80 -y 24

# Start fitclaw from source
tmux send-keys -t fitclaw-test "cd packages/coding-agent && npx tsx src/cli.ts" Enter

# Wait for startup, then capture output
sleep 3 && tmux capture-pane -t fitclaw-test -p

# Send input
tmux send-keys -t fitclaw-test "your prompt here" Enter

# Send special keys
tmux send-keys -t fitclaw-test Escape
tmux send-keys -t fitclaw-test C-o  # ctrl+o

# Cleanup
tmux kill-session -t fitclaw-test
```

## **CRITICAL** Git Rules for Parallel Agents

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session

### Forbidden Git Operations

These commands can destroy other agents' work:

- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow

```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add packages/ai/src/providers/transform-messages.ts

# 3. Commit
git commit -m "fix(ai): description"

# 4. Push (pull --rebase if needed)
git pull --rebase && git push
```

### If Rebase Conflicts Occur

- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push

### User Override

If user instructions conflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.
