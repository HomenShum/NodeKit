# Changelog — `templates/base/apps/web/public/styles.css`

> **Surface**: `templates/base/apps/web/public/styles.css`.
>
> **Append rule**: New entries go at the top. Never delete prior entries.

## 2026-10-04 — Respect hidden alerts on healthy screens

Apply the existing flex layout only when the alert is not hidden. Three before views show a blank red warning on healthy screens; genuine error feedback remains visible through the existing handler. Source review cannot establish after pixels.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/library/evolution-ledger.md`, `CHANGELOG/harness/evolution-immutability-fixtures.md`, `CHANGELOG/harness/evolution-ledger-fixtures.md`, `CHANGELOG/harness/browser-certify.md`
