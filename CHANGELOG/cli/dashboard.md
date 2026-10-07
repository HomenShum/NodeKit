# Changelog - Dashboard CLI

> Surface: repository reports consumed by maintainers and coding agents.

## 2026-10-07 - Make JSON diagnostics and revision attribution explicit

Preserve `dashboard --json` and its nonzero exit on failed checks. Replace the prototype
`generatorCommit` with `registryCommit`; bounded Git metadata is accepted only for the registry's
own checkout, otherwise null. Preserve the early `--json --write` refusal. Original dashboard
scenarios now live with repository-orientation tests; burst/repeated snapshots and a downloaded
registry inside another application's Git checkout cover the handoff failures.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/library/dashboard.md`, `CHANGELOG/docs/onboarding.md`
**Verification**: pending exact-head automatic CI. No local run, matched architecture comparison,
consumer adoption or production certification is claimed. Existing authority gates remain.
