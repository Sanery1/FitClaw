## Design

Create a new manual test document at `docs/FEISHU_FITNESS_SMOKE_SCRIPT.md`.

The document should be practical enough to run by hand against a real Feishu Bot:

- state prerequisites and reset/setup assumptions;
- list a short ordered scenario script;
- describe expected user-visible behavior;
- describe expected data reads/writes by namespace;
- include pass/fail recording guidance;
- distinguish manual live validation from deterministic session evals.

Update `docs/FEISHU_FITNESS_LOOP_STATUS.md` only enough to point to the new smoke script as the recommended next validation step.

## Risk

Low. This is documentation-only. The main risk is creating a script that implies automation or production readiness, so the document should explicitly frame the script as manual smoke validation for live Feishu behavior.
