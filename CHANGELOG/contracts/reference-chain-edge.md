# Changelog — reference chain edge contract

> **Surface**: Public schema and types for immutable, authority-bound reference evidence handoffs.
>
> **Append rule**: Add entries at the top. Never rewrite historical entries.

## 2026-07-30 — Bind exact cross-application reference handoffs
Define `nodekit.reference-chain-edge/v1` with exact source and target record digests, current Caseflow state, repository revision, typed authority evidence, deterministic identity, and explicit limits. The contract has no verdict or stage authority and rejects caller-supplied pass, approval, or verification fields.
**Commit**: `PENDING`. **Author**: Codex.
**Touches**: `CHANGELOG/server/reference-loop.md`, `CHANGELOG/scripts/reference-schema-validators.md`

---

## Entry template

```md
## YYYY-MM-DD — Imperative title
State what changed, why it changed, and any user-visible effect.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: `<related lane>`
```
