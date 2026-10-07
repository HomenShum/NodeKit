# Changelog - historical evidence scenarios

> **Surface**: Preserved submission and agent-ease evidence contract tests.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-07 - Keep the behavior index bound to the shifted test annotations

The clock repair moved two existing submission scenario annotations by five
lines. Update only their committed behavior-index pointers from 142/234 to
147/239; preserve all scenarios, verdicts, counts and generation metadata.

At head `91f0b28e`, automatic Quality run37625374589/job112805662074
reported **898 tests, 897 pass, 1 fail, 0 skipped**. All ten previous failure
scenarios and the new oversized-launch scenario passed. The only test failure
was the index freshness assertion. After this pointer repair, exact-head CI is
pending. Evolution still fails; later audit, registry and package stages did
not run. These are contract results, not matched architecture or live-provider
measurements.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `behavior-index.json`

## 2026-10-07 - Replay preserved evidence at a test-owned historical time

A maintainer can reach the real trust and tampering assertions without old
pricing fixtures expiring against today's clock. Derive a simulated time one
day after the unchanged snapshot. Scope Date-only mocks to each parent test
and the matrix evaluator child; leave production clocks, pricing bytes/hashes,
timestamps, the 31-day gate and the 5,723-reference assertion unchanged.

Advance the same parent evidence and a separate child beyond expiry. Require
the parent rejection and failed child with no verdict output. Test-process
reset and child isolation are explicit; these are contract scenarios, not live
provider, adoption, latency or production measurements.

**Before**: head `89303076`, Quality run37616184729/job112774957236:897 tests,
887 pass,10 fail. Eight failures traced to stale pricing and its downstream
missing-verdict/closure consequences; the other two concern process launch and
Chromium. **After**: new exact-head automatic CI pending at publication.
No snapshot freshness metadata is restamped; retained local execution holds remain.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `test/submission-fixtures.mjs`, `test/submission-gate.test.mjs`,
`test/submission-preparation.test.mjs`, `test/submission-evidence-finalizer.test.mjs`,
`test/agent-ease-matrix.test.mjs`
