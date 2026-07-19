# Textbook Knowledge P1/P2 Verification

## Scope

- Audited aliases for real PDF text-extraction failures.
- Typed `exercise_search` over the existing bodybuilding catalog.
- Real SQLite retrieval evaluation with reviewed page sets.
- Eval Harness knowledge fixtures, citation/security graders, and explicit real-model mode.

## Evidence

- Real textbook retrieval suite: 15 queries, Recall@5 `1.0000`, MRR `0.8244`.
- Category Recall@5: exact term `1.0000`, concept `1.0000`, short `1.0000`, visual `1.0000`.
- PDF 73 and PDF 54 were rendered at 180 DPI and visually confirmed to contain the expected shoulder-plane and length-tension figures.
- Deterministic knowledge Agent suite: 3/3 passed for routing, fixed citation, no fabricated citation, and untrusted-reference handling.
- The production Bot configuration and project defaults now target `deepseek/deepseek-v4-pro`; the earlier MiniMax 403 was from a separate local eval configuration and is not the Bot runtime model.
- A non-private API smoke through the FitClaw adapter returned `OK` from `deepseek/deepseek-v4-pro` with 17 tokens and a recorded cost of `$0.00000783`.
- The full real knowledge suite was not sent externally because it contains private textbook fixtures. The sandboxed attempt failed before transmission with zero tokens and zero cost, and external execution requires explicit approval of that disclosure risk.

## Rollout Decision

`basic-kinesiology-3e` remains `candidate`. Retrieval quality and the DeepSeek API connection meet their local gates, but no successful real-model routing/citation/security evidence exists yet. Promotion to `enabled` requires an explicitly authorized external run of the private textbook suite, or an equivalent approved evaluation environment, to pass.

## Deferred Technology Decision

- Do not add Embedding, Reranker, Qdrant, or GraphRAG: reviewed lexical retrieval currently reaches Recall@5 `1.0000`; these components have no demonstrated quality benefit yet.
- Do not add Langfuse or OpenTelemetry: JSONL RunTrace and eval transcripts are sufficient for the current failure modes.
- Do not merge a new exercise dataset or build a multi-source `ExerciseStore`: the typed tool covers the existing catalog without a second production source.
- Do not add alias generation: every current alias corresponds to an observed extraction failure and remains administrator-reviewed.

## Commands

```text
fitclaw-coach knowledge eval --workspace feishu-workspace
npm run eval -- --suite knowledge --mode faux
npm run eval -- --suite knowledge --mode real --provider deepseek --model deepseek-v4-pro
```
