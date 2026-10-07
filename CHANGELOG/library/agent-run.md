# Changelog - src/lib/agent-run.mjs

> **Surface**: Bounded local agent-process recording, durable receipts, and inspectable static reports.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-07 - Record operating-system launch failures durably

A developer running an agent command can now inspect a failed receipt even when
the operating system throws before creating a child process. Catch that failure
at the existing execution seam and use the same bounded error, output, event,
digest and receipt path. Keep normal completion, async errors and timeout handling.

The existing missing-command scenario uses valid path components; a separate
oversized-component scenario checks the durable failure and completed directory.
Source is retained from PR #40; exact-revision combined CI is pending at publication.
No provider, deployment, latency or all-portfolio acceptance is claimed.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `src/lib/agent-run.mjs`, `test/agent-run.test.mjs`

## 2026-07-30 - Harden agent run receipts and reports

Bound metadata and exact I/O, add a deterministic receipt digest and observed run graph, publish the
report before the receipt completeness marker, and retain only the newest completed runs. The graph
render now comes from receipt data and all untrusted report content remains escaped.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/agent-run.md`
