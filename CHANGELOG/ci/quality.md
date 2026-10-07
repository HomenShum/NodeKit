# Changelog - required Quality gates

> **Surface**: Required Quality gates and the repository dependency lock.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-07 - Retain the production audit and patch the repository URI dependency

The repository lock now resolves AJV's existing `fast-uri ^3.0.1` dependency
from 3.1.5 to 3.1.8. Change only the version, registry tarball URL and published
integrity in that one lock entry. Package declarations, all other locked packages,
the npm ci install and the required production audit are unchanged.

**Why**: the required audit was reached after all 898 Node tests and eight component
tests passed at head `86b0e967`, then failed on one high-severity package finding
with six advisory URLs. The upstream v3 fixes are 3.1.6, 3.1.7 and 3.1.8;
[3.1.8 is the common minimum](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
Use the exact URL and integrity from the primary npm registry metadata.

**Before**: automatic Quality run 37628784796/job 112817332066; registry and pack
were skipped after the audit failed. **After**: next exact-head automatic CI pending.
No local resolver, generator, install or held verification was executed. This
updates this repository's install, not every published-library consumer's lock.
No concrete outbound SSRF path, pipeline gain, deployment or visual grade is implied.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/dashboard.md`

## 2026-10-07 - Install Chromium before the required browser check

The Quality runner now installs the already-declared Playwright Chromium browser
and its operating-system dependencies before tests. The browser check remains
decisive; it is not skipped when its executable is missing. Retain current
typecheck, component, full-test, audit, registry and package stages, including
existing citation coverage within tests.

**Before**: head `89303076`, Quality job112774957236 failed the browser self-test
because Chromium was absent. **After**: combined exact-head automatic CI pending
at publication. Source retained from PR #40; no manual dispatch or local install,
deployment, rendered UI grade or production verification is implied.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `.github/workflows/quality.yml`
