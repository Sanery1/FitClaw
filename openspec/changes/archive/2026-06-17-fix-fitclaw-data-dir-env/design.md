## Context

`FileSportDataStore` treats its constructor argument as the session/channel data root and persists namespaces under `sport-data/<skill>/<namespace>.json`. Agent data tools correctly instantiate it with the session or channel root.

`fitclaw-data` also instantiates `FileSportDataStore` from `FITCLAW_DATA_DIR`. Current SDK and Mom setup set that environment variable to `<root>/sport-data`, causing CLI access to add another `sport-data` segment.

## Goals / Non-Goals

**Goals:**

- Make `FITCLAW_DATA_DIR` mean the root directory accepted by `FileSportDataStore`.
- Keep CLI/script access aligned with Agent data tool access.
- Keep the fix limited to the environment variable assignment sites.

**Non-Goals:**

- Do not change `FileSportDataStore` path layout.
- Do not migrate existing files.
- Do not add a new storage abstraction.

## Decisions

- Set `FITCLAW_DATA_DIR = sessionManager.getSessionDir()` in the SDK and `FITCLAW_DATA_DIR = channelDir` in Mom.
  - Rationale: those are already the roots passed to `FileSportDataStore`, so the CLI will resolve the same physical files.
  - Alternative considered: change `fitclaw-data` to special-case values ending in `sport-data`. That would preserve the ambiguous environment variable and add compatibility behavior not currently needed.

## Risks / Trade-offs

- Existing external scripts that manually treated `FITCLAW_DATA_DIR` as the literal `sport-data` folder would need to follow the clarified contract. Mitigation: repository code and CLI docs already describe the CLI as using `FileSportDataStore`, whose storage layout is `<dataDir>/sport-data/...`.
