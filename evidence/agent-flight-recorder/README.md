# Agent Flight Recorder proof

CHANGE   Add one productized command that wraps a local agent process and emits a durable receipt plus visual run graph.

COMMAND  `node src/cli.mjs agent run --agent fixture-agent --goal "Ship a verified hello artifact" --out ".tmp\agent-flight-recorder" -- node -e "console.log('hello from agent')"`

| Before | After |
|---|---|
| `nodekit: unknown command: agent run` | `SUCCESS`, exit `0`, exact `hello from agent` stdout |
| No persistent workspace/session/run identity | Stable workspace/session IDs plus a unique run ID |
| No shareable run surface | `receipt.json` and responsive `report.html` |
| No visual execution proof | Four-node serialized run graph rendered from receipt data |

UNCHANGED

- NodeKit performs no network call or deployment for `agent run`.
- The wrapped child command remains the only executable authority.
- Exact output is bounded to 256 KiB per stream; total byte counts and full digests remain available.

EVIDENCE

- `before.txt`, `after.txt`, `diff.txt`
- `after-receipt-summary.json`
- `after-desktop.png`, `after-mobile.png`
- `browser-qa.json`
- `rollback-verification.txt`
