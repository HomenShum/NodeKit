# Changelog - Dashboard CLI

> Surface: repository reports consumed by maintainers and coding agents.

## 2026-10-07 - Check the platform at its registry checkout

A maintainer inspecting an empty sibling workspace gets the platform's static
checker result from the registry checkout, while missing external checkouts stay
failures. Resolve the platform by its catalog command profile; strengthen the
existing four-request burst and three repeated snapshots to distinguish the
platform from all thirteen absent external repositories in this retained catalog.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/dashboard.md`, `CHANGELOG/ci/ecosystem.md`
**Verification**: `NODEKIT-40-RETENTION-01`; source candidate only, exact-head
automatic CI pending. The checker resolves declarations and source; it does not
execute declared application commands. Scheduled checkout integration is NOT_RUN.
No provider, pricing-freshness, production or architecture improvement is claimed.

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
