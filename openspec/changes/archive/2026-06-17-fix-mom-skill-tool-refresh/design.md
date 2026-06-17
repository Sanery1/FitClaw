## Context

`getOrCreateRunner()` caches a Mom runner per Feishu channel. `createRunner()` loads Skills once, builds the initial system prompt, and registers `data_<skill>_read/write` tools for Skills with `data:` declarations. Later `run()` calls reload memory and Skills and replace `session.agent.state.systemPrompt`, but they do not refresh `session.agent.state.tools`.

This creates a mismatch after `fitclaw skill sync` or manual workspace Skill changes: the prompt can expose a newly loaded data namespace while the agent loop still cannot execute the matching data tool.

## Goals / Non-Goals

**Goals:**

- Keep Mom's active tools aligned with the Skills loaded for the current message.
- Reuse the same tool construction logic for initial runner creation and per-run refresh.
- Keep the fix scoped to Mom runtime behavior.

**Non-Goals:**

- Do not change Skill parsing, Skill data namespace semantics, or storage layout.
- Do not add public `AgentSession` APIs.
- Do not change Feishu message UX or model behavior beyond making declared tools callable.

## Decisions

- Extract Mom Skill data tool construction into a small helper in `packages/mom/src/agent.ts`.
  - Rationale: the behavior can be tested without constructing a full `AgentSession` or calling a model registry.
  - Alternative considered: test full runner execution. This would require model/auth setup and make the regression harder to isolate.
- Replace `session.agent.state.tools` before each prompt using freshly loaded Skills.
  - Rationale: Mom already updates `session.agent.state.systemPrompt` directly per run, and Mom does not expose interactive tool toggling that would be lost by replacing the full Mom tool set.
  - Alternative considered: mutate `AgentSession`'s private tool registry. That would require new public API or reaching into private state, increasing risk for a Mom-specific fix.

## Risks / Trade-offs

- Directly replacing `agent.state.tools` bypasses `AgentSession`'s private registry. Mitigation: only do this inside Mom, where the tool set is controlled by `createMomTools()` plus Skill data tools, and cover the helper with a regression test.
- If future Mom code adds per-run dynamic non-Skill tools, it must be included in the same refresh path. Mitigation: centralize Mom tool creation behind one helper.
