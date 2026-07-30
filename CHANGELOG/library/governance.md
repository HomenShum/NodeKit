# Changelog — `src/lib/governance.mjs`

> **Surface**: Deterministic governance classification, evidence, rollback, feedback, and graph projection.
>
> **Append rule**: New entries go at the top. Never delete prior entries.

## 2026-07-30 — Derive promotion authority from risk and proof

Add four risk-derived modes, content-bound receipts, a timeout-bounded rollback adapter, and a
disposable graph projection. This prevents a builder from granting itself authority and keeps
Caseflow canonical while still allowing reversible changes to proceed without interruption.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/governance-visualize.md`, `CHANGELOG/schemas/governance-contracts.md`
