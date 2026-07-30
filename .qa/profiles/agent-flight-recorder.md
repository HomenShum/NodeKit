# QA profile: NodeKit Agent Flight Recorder

## Environment

| Thing | Value |
|---|---|
| Prod URL | None; local static HTML only |
| Repo root | Current NodeKit repository |
| Dev command + port | `python -m http.server <port>` from the selected run store for browser QA; the artifact itself remains static HTML |
| Backend / deployments | Local child process plus filesystem artifacts; no deployment |
| Auth path | None |
| QA run mode / mutation boundary | Sandbox dogfood; run only explicit local Node fixtures and write only to the selected evidence store |
| Typecheck gate | `npm run typecheck:public` or direct local `tsc -p tsconfig.public.json` |
| Test gate | `node --test test/agent-run.test.mjs` |
| Playwright available in repo? | Declared as a dev dependency; browser plugin used when local install is absent |
| Evidence dir convention | `evidence/agent-flight-recorder/` |
| Memory dir | `.qa/memory/` |

## Provenance surface

| Question | Answer |
|---|---|
| Where does the app show what the process did? | Summary strip, execution path, lifecycle timeline, exact I/O disclosures, and `receipt.json` |
| LIVE run signals | `completed`, exit code 0, command/full-stream digests, receipt digest |
| DEGRADED/fallback signals | `timeout`, nonzero CLI 124, partial bounded output |
| FAILED signals | `failed`, original nonzero process exit, stderr retained |

## First-run behavior

Run the documented CLI command, then open the printed `report.html` path.

## Live signals

Local rendered-DOM signals: `agent-run-report`, `run-status`,
`execution-graph`, and `exact-io`.

## Journey mapping

- A0 Smoke: run a successful Node fixture; verify all four testids and UTF-8.
- A1 Core creation: run offline with no provider or network; verify receipt/report exist.
- A2 Live AI action: N/A; this slice wraps a user-supplied process and makes no provider claim.
- A3 Provenance audit: compare rendered IDs, exit status, exact output, and receipt digest.
- A4 Output & sharing: reopen the static report and JSON receipt from disk.
- A5 Themes & access: inspect desktop and narrow viewports; verify disclosure labels and no horizontal body overflow.
- A6 Adversarial: render metacharacters/HTML, timeout, failure, high-volume output, concurrency, and sustained retention.

## App-specific traps

- A report can appear successful while its receipt says failure; rendered and receipt status must match.
- Large receipts exceed 64 KiB, so retention must use a bounded limit large enough for both retained streams.
- Concurrent writers may alter this workspace; gates must run against current mtimes.

## Known product behaviors that are NOT bugs

- Stdout and stderr are retained but not streamed live to the terminal.
- Output beyond 256 KiB per stream is represented by total byte counts and full-stream digests.
- There is no network, provider, consent, or proposal UI in this local process recorder slice.

## Last Bar score

| B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 | date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| N/A | 2 | N/A | 2 | 2 | 2 | 2 | 2 | 2 | 2 | N/A | 2026-07-30 | Chrome desktop and 390x844 proof passed with keyboard disclosure, exact DOM signals, and no overflow |
