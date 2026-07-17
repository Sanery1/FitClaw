# @fitclaw/runtime

Shared runtime primitives used by FitClaw applications:

- API key/OAuth storage and model registry
- Settings and JSONL session persistence
- Shared Agent retry and automatic compaction controllers, plus managed lifecycle orchestration
- Skill discovery and prompt indexing
- `SKILL.md` frontmatter parsing
- Declared namespace persistence
- Agent tools for Skill data access

Product-specific coaching workflows do not belong in this package.

## Session module ownership

- `session-format.ts`: JSONL entry types, parsing, versions, and migrations
- `session-discovery.ts`: session file discovery and metadata
- `session-context.ts`: LLM context reconstruction for the active branch
- `session-tree.ts`: immutable tree read model for navigation
- `session-manager.ts`: persistence state, append operations, branching, and orchestration

Public session APIs are re-exported through `session-manager.ts` and the package entry point.
