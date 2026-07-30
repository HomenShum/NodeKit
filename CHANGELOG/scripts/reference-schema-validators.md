# Changelog — scripts/generate-reference-schema-validators.mjs

> **Surface**: Generates the committed AJV validators used by the packaged reference runtime.
>
> **Append rule**: Add entries at the top. Never rewrite historical entries.

## 2026-07-30 — Generate the reference-chain edge validator
Include the new edge schema in the committed standalone validator bundle so packaged consumers fail closed with the same schema as the source repository.
**Commit**: `PENDING`. **Author**: Codex.
**Touches**: `CHANGELOG/contracts/reference-chain-edge.md`, `CHANGELOG/server/reference-loop.md`

---

## Entry template

```md
## YYYY-MM-DD — Imperative title
State what changed, why it changed, and any user-visible effect.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: `<related lane>`
```
