# Changelog — stage-local execution graph contracts

> **Surface**: Public schemas and package exports for compiling and verifying a bounded execution projection of the current Caseflow stage.
>
> **Append rule**: New entries go at the TOP. Date format: `YYYY-MM-DD`. Use the entry template at the bottom of this file. Never delete old entries — they are the audit trail.

## 2026-07-29 — Define stage-local execution graph contracts
Introduce `nodekit.stage-task/v1`, `nodekit.execution-graph/v1`, `nodekit.execution-edge-binding/v1`, `nodekit.runnable-frontier/v1`, and `nodekit.review-context/v1`, exported from the package root and the public `nodekit/execution-graph` subpath. Keep the projection subordinate to Caseflow: this increment does not generate `design.md` or add `ReviewFinding`, and ActiveGraph remains an offline experiment rather than execution, approval, or verification authority.
**Commit**: `634e629`. **Author**: homen.
**Touches**: `CHANGELOG/server/execution-graph.md`, `CHANGELOG/server/cli-main.md`

---

## Entry template

```md
## YYYY-MM-DD — Short imperative title
What and why in 1-3 sentences. Note user-visible effects.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: <other CHANGELOG files affected>
```
