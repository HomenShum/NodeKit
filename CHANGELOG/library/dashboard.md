# Changelog - Dashboard summaries

> Surface: repository-check results projected into Markdown and JSON.

## 2026-10-07 - Keep checker failures visible in JSON

Keep the shared command/drift helpers and inherited P0 summary unchanged. JSON now includes the
checker-owned `passed` and `errors` per row plus an overall `passed` boolean, so schema/environment
or ownership failures remain visible even when every static summary criterion is met. This is a
static repository report; a complete summary is not proof that application tests ran.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/dashboard.md`, `CHANGELOG/docs/onboarding.md`
**Verification**: pending exact-head automatic CI; no measured pipeline improvement is claimed.
