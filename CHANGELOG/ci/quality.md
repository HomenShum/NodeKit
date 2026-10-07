# Changelog - required Quality browser setup

> **Surface**: .github/workflows/quality.yml.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

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
