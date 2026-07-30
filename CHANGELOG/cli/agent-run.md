# Changelog - src/cli-main.mjs (`nodekit agent run`)

> **Surface**: CLI entrypoint for running one local process and locating its receipt and report.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-07-30 - Expose honest agent process results

Return structured JSON artifacts for automation and propagate failed or timed-out child process
statuses as nonzero CLI exits. Scenario coverage verifies completed, failed, timeout, adversarial,
concurrent, sustained-retention, and injection-resistant journeys.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/library/agent-run.md`
