# Changelog - src/lib/agent-run.mjs

> **Surface**: Bounded local agent-process recording, durable receipts, and inspectable static reports.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-07-30 - Harden agent run receipts and reports

Bound metadata and exact I/O, add a deterministic receipt digest and observed run graph, publish the
report before the receipt completeness marker, and retain only the newest completed runs. The graph
render now comes from receipt data and all untrusted report content remains escaped.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/agent-run.md`
