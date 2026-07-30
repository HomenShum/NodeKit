# Changelog — src/cli-main.mjs

> **Surface**: NodeKit command routing, bounded file input, and user-facing CLI output.
>
> **Append rule**: New entries go at the TOP. Date format: `YYYY-MM-DD`. Use the entry template at the bottom of this file. Never delete old entries — they are the audit trail.

## 2026-07-29 — Add fail-closed stage-local graph commands
Add `nodekit graph compile`, `nodekit graph bind-edge`, and `nodekit graph frontier` so operators can compile the current Caseflow stage, verify an exact edge binding, and derive runnable work through deterministic JSON commands. Keep inputs inside the repository, cap execution-graph files at 4 MiB and frontier bindings at 1,024, and reject malformed, stale, or unverifiable evidence instead of producing optimistic output.
**Commit**: `634e629`. **Author**: homen.
**Touches**: `CHANGELOG/server/execution-graph.md`, `CHANGELOG/contracts/stage-local-execution-graph.md`

---

## Entry template

```md
## YYYY-MM-DD — Short imperative title
What and why in one to three sentences. Note observable effects and invariants.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: <other CHANGELOG files affected>
```
