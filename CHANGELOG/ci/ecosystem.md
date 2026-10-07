# Changelog - ecosystem conformance workflow

> **Surface**: Repository checkouts used by scheduled ecosystem conformance.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-07 - Derive external checkouts from the repository catalog

The fixed nine-repository list omits four currently tracked repositories. Derive
the external checkout list from the catalog, excluding untracked repositories and
the platform already checked out by this workflow; retain the existing clone and
conformance commands.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/dashboard.md`, `CHANGELOG/ci/ecosystem.md`
**Verification**: `NODEKIT-40-RETENTION-01`; source candidate only. The pinned
catalog selects thirteen external repositories, including parity-studio,
NodeTasks, BetterPRHandoff and FeatureClipStudio. Actual scheduled cloning and
ecosystem conformance are NOT_RUN; ordinary PR Quality does not run this workflow.
No manual dispatch, provider request, deployment or acceptance of every repository
is claimed.
