# Promotion log — NodeKit

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Wave 1. Measurement only: **nothing was fixed in this wave, deliberately.** A
baseline that quietly repairs things is a baseline nobody can compare against.

- Environment: Windows 11, Node v22.22.2, npm, fresh `git clone --depth 50` at
  commit `b1c7932`. No secrets, no cloud deployment, no publish.
- App started: **yes.** `npm run dev` in the app produced by the README
  quickstart (`apps/web/server.mjs`). Note the default port 4173 was already
  occupied on this machine and the server exits with an unhandled
  `EADDRINUSE` rather than a message; re-run with `PORT=4187` succeeded. See
  defect D3.
- Journeys drivable: **4 of 5 reach their stated "done when"** (J1, J2, J4, J5).
  J3 (steering) is drivable but does not succeed — see D1.
- Scorecard at baseline: see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — 6/12 PASS,
  3 FAIL, 3 UNVERIFIED.
- This repo was **not** marked DEFERRED in the rollout note.

### Commands run, with real exit codes

| Command | Exit | Note |
|---|---|---|
| `git clone --depth 50 https://github.com/HomenShum/NodeKit` | 0 | 2065 files |
| `npm install` (NodeKit) | 0 | 82 packages in 1m; npm reported 2 vulnerabilities across dev+prod |
| `node src/cli.mjs --help` | 0 | tier one, 14 lines → `evidence/cli-help-tier1.txt` |
| `node src/cli.mjs help --all` | 0 | tier two, 128 lines → `evidence/cli-help-tier2.txt` |
| `node src/cli.mjs explain --for node` | 0 | "36 surface(s) apply, 5 do not" |
| `node src/cli.mjs create ../my-app --name my-app --brief "triage inbound support tickets"` | 0 | vendored runtime + initial commit `1fd08bdb7cd9` |
| `npm install` (my-app) | 0 | 16 packages, 0 vulnerabilities |
| `npm run demo` (my-app) | 0 | output ends `"passed": true` |
| `npm run dev` (my-app, default port) | 1 | `EADDRINUSE 127.0.0.1:4173`, unhandled — see D3 |
| `PORT=4187 npm run dev` (my-app) | running | "My App running at http://127.0.0.1:4187" |
| `npm test` (NodeKit) | 0 | 841/841 repository tests, 8/8 component tests, 0 failed, 0 skipped |
| `npm run build:component` | 0 | tsc project build, clean |
| `npm run typecheck:public` | 0 | clean |
| `npm run audit:prod` | 0 | 0 vulnerabilities |
| `npm run gate:trust-surface` | 0 | passes, but against its own fixtures only — see note below |
| `node src/cli.mjs agent run --agent codex --goal "Inspect the repository" -- node --version` | 0 | wrote `report.html` + `receipt.json` |

### How the browser evidence was produced

Playwright (already a devDependency of the created app) drove the running dev
server with real clicks and real key presses, screenshotting each state and
recording console messages, response codes, overflow measurements, axe-core
results and click-to-DOM latency. Capture scripts live in the throwaway
`my-app` working tree, not in this repo; their output is `evidence/*.json` and
`evidence/*.png`.

One environment limitation worth recording so the next agent does not repeat it:
in this session the in-app browser pane never composited, so
`computer{action:"screenshot"}` and pixel clicks both failed. DOM reads,
`javascript_tool` and network/console reads worked. All screenshots and all real
input events in `evidence/` therefore came from Playwright, not from the pane.

### A gate that exists but is not pointed at anything

`npm run gate:trust-surface` passes and — to its credit — probes itself in both
directions (it proves it can PASS, FAIL and abstain). But it only runs against
its own inline fixtures. Nothing runs it against the review surface of the
application `nodekit create` actually produces, which is the surface where a
user decides whether to trust the agent. D1 is exactly the class of defect a
trust-surface gate should have caught, and it shipped. Recorded here as loop
context, not scored as a condition.

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D1 | major | J3 | Chromium 1280x900 on `PORT=4187 npm run dev` in the quickstart-created app. `POST /api/reset`, reload, type any outcome, submit, press "Prepare proposal", wait for `Proposal ready for review`, press **Reject**, wait 1.2s. The right panel correctly becomes `DECISION RECORDED — Prepare a revised proposal — The rejected change was not applied. The canonical artifact remains intact.` The stage banner is byte-identical to before the click: `REVIEW — Proposal ready for review — Compare the bounded change with the canonical artifact before deciding.` The primary artifact panel likewise still reads `CURRENT ACTION — Approve or reject the proposed change`, and the stage rail still highlights step 3. The only visible control is "Prepare proposal". Two of three status regions instruct the user to act on a proposal that does not exist. `evidence/defect-1-stale-review-copy-after-reject.png`, `evidence/reject-detail.json` | open |
| D2 | major | recovery | Same app, 1280x900. Reach the orientation state, then block the confirm call (`page.route("**/api/confirm", r => r.abort("failed"))`), enter an outcome and submit. The error slot renders the browser's own exception text, verbatim: **`Failed to fetch`**. The stage banner stays on `ORIENTATION — Ready for your direction — Confirm the outcome before the run begins`, so the page shows no sign that anything went wrong, and offers no retry. The app's two recovery controls (`#resume`, `#resolve-conflict`) stay `display:none`. Contrast the form-validation path, which is designed properly (`role=alert`, `aria-invalid=true`, "Add a concrete outcome before continuing."). `evidence/error-state.json`, `evidence/desktop-7-transport-failure.png` | open |
| D3 | minor | J2 | `npm run dev` in the created app when port 4173 is taken: the process dies on an unhandled `'error'` event and prints a Node stack trace with `EADDRINUSE`, with no message telling the user to set `PORT`. `apps/web/server.mjs` line 208 calls `server.listen(...)` with no `error` handler. Reproduced by starting any other listener on 4173 first | open |
| D4 | minor | J1 | The README headline promises "40 seconds to a running, proof-carrying app (measured from a cold clone)". On this machine `npm install` alone reported `added 82 packages, and audited 83 packages in 1m` — the budget is spent before `create` starts. The claim is environment-bound and the README does not say on what. Not a functional break; recorded so the number is not quoted as universal | open |

## Iterations

_none yet — Wave 1 is the baseline._
