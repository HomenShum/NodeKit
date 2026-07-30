# Problem -> Change -> Proof

## Problem

NodeKit had durable identity and graph primitives, but researchers could not
wrap one real local agent run and receive a single inspectable proof package.

## Change

`node src/cli.mjs agent run ... -- <program>` now records stable workspace and
session identity, a unique run, bounded stdout/stderr and lifecycle evidence,
an execution graph, `receipt.json`, and a responsive `report.html`.

## Proof

- `evidence/agent-flight-recorder/before.txt`: command was unknown.
- `evidence/agent-flight-recorder/after.txt`: command completed and printed
  report/receipt paths.
- `evidence/agent-flight-recorder/after-receipt-summary.json`: exact live
  status, output, graph size, and receipt digest.
- `evidence/agent-flight-recorder/after-desktop.png` and `after-mobile.png`:
  Chrome-rendered desktop and 390x844 proof.
- `test/agent-run.test.mjs`: all eight production scenarios pass.
