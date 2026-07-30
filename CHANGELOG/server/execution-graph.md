# Changelog — src/lib/execution-graph.mjs

> **Surface**: Deterministic, fail-closed scheduling primitives for work inside the current Caseflow stage.
>
> **Append rule**: New entries go at the TOP. Date format: `YYYY-MM-DD`. Use the entry template at the bottom of this file. Never delete old entries — they are the audit trail.

## 2026-07-29 — Add stage-local execution scheduling
Compile only the current stage's canonical task artifacts into a deterministic graph, bind edges to exact artifact and authority evidence, and derive a conflict-free runnable frontier so eligible work can run safely in parallel. Derive reviewer separation from verified context while deliberately granting the graph no approval, verdict, stage-advance, or other Caseflow lifecycle authority.
**Commit**: `634e629`. **Author**: homen.
**Touches**: `CHANGELOG/server/cli-main.md`, `CHANGELOG/contracts/stage-local-execution-graph.md`

---

## Entry template

```md
## YYYY-MM-DD — Short imperative title
What and why in 1-3 sentences. Note user-visible effects.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: <other CHANGELOG files affected>
```
