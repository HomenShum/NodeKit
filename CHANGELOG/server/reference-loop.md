# Changelog — src/lib/reference-loop.mjs

> **Surface**: Provider-neutral reference ingestion, scoring, immutable bindings, and verification.
>
> **Append rule**: Add entries at the top. Never rewrite historical entries.

## 2026-07-30 — Verify reference-chain bindings without granting authority
Add deterministic edge construction and exact-context verification for endpoint, Caseflow, repository, attestation, and receipt bindings. Verification is stateless and fail-closed; projections cannot turn the edge into a verdict.
**Commit**: `PENDING`. **Author**: Codex.
**Touches**: `CHANGELOG/contracts/reference-chain-edge.md`, `CHANGELOG/scripts/reference-schema-validators.md`

---

## Entry template

```md
## YYYY-MM-DD — Imperative title
State what changed, why it changed, and any user-visible effect.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: `<related lane>`
```
