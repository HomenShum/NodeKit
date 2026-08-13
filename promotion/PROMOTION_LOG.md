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
| D1 | major | J3 | **CLOSED in iteration 1.** Chromium 1280x900 on `PORT=4187 npm run dev` in the quickstart-created app. `POST /api/reset`, reload, type any outcome, submit, press "Prepare proposal", wait for `Proposal ready for review`, press **Reject**, wait 1.2s. The right panel correctly becomes `DECISION RECORDED — Prepare a revised proposal — The rejected change was not applied. The canonical artifact remains intact.` The stage banner is byte-identical to before the click: `REVIEW — Proposal ready for review — Compare the bounded change with the canonical artifact before deciding.` The primary artifact panel likewise still reads `CURRENT ACTION — Approve or reject the proposed change`, and the stage rail still highlights step 3. The only visible control is "Prepare proposal". Two of three status regions instruct the user to act on a proposal that does not exist. `evidence/defect-1-stale-review-copy-after-reject.png`, `evidence/reject-detail.json` | closed |
| D2 | major | recovery | Same app, 1280x900. Reach the orientation state, then block the confirm call (`page.route("**/api/confirm", r => r.abort("failed"))`), enter an outcome and submit. The error slot renders the browser's own exception text, verbatim: **`Failed to fetch`**. The stage banner stays on `ORIENTATION — Ready for your direction — Confirm the outcome before the run begins`, so the page shows no sign that anything went wrong, and offers no retry. The app's two recovery controls (`#resume`, `#resolve-conflict`) stay `display:none`. Contrast the form-validation path, which is designed properly (`role=alert`, `aria-invalid=true`, "Add a concrete outcome before continuing."). `evidence/error-state.json`, `evidence/desktop-7-transport-failure.png` | open |
| D3 | minor | J2 | `npm run dev` in the created app when port 4173 is taken: the process dies on an unhandled `'error'` event and prints a Node stack trace with `EADDRINUSE`, with no message telling the user to set `PORT`. `apps/web/server.mjs` line 208 calls `server.listen(...)` with no `error` handler. Reproduced by starting any other listener on 4173 first | open |
| D4 | minor | J1 | The README headline promises "40 seconds to a running, proof-carrying app (measured from a cold clone)". On this machine `npm install` alone reported `added 82 packages, and audited 83 packages in 1m` — the budget is spent before `create` starts. The claim is environment-bound and the README does not say on what. Not a functional break; recorded so the number is not quoted as universal | open |
| D5 | major | J3 / conflict | **CLOSED in iteration 2.** Sibling of D1, found by the adversarial verifier of iteration 1's fix, and worse than D1: a false completion claim rather than a stale one. Same app on `PORT=4401`. `POST /api/scenario {"id":"conflict"}` (or open `?scenario=conflict`), then `POST /api/decide {"decision":"accepted"}`. Answers **HTTP 200** with the stage banner `COMPLETE — Completion verified — The canonical artifact and content-addressed receipt are ready` while `proposal.status = "conflicted"`, `receipt = null`, `run.status = "active"`, `run.currentStageId = "review"`, `run.nextAction = "Resolve the version conflict"`. The same page simultaneously reads `CONFLICT CONTAINED / Resolve version conflict` in the review panel and `No receipt yet` in the footer. Not click-reachable — `app.js` sets `elements.approve.hidden = !pending` — but reachable by direct POST and through the `?scenario=` debug surface. `evidence/defect-5-false-completion-on-contained-conflict.png`, `evidence/decide-outcome/decide-outcome.json` | closed |

## Iterations

### Iteration 1 — 2026-08-13 — D1, the page that argues with itself after Reject

- **Journey exercised:** J3 "That is not what I asked for" (steering), with J2's
  done-when re-driven in the same run.
- **Observed:** reproduced exactly as D1 records it, on Windows 11 / Node
  v22.22.2, Chromium 149.0.7827.55, 1280x900, against a `nodekit create` app on
  port 4309. After Reject the review panel updated but the stage banner still
  read `REVIEW — Proposal ready for review — Compare the bounded change with the
  canonical artifact before deciding` and the primary artifact panel still read
  `CURRENT ACTION — Approve or reject the proposed change`. The run also produced
  a **fourth** stale region the baseline described only in prose and did not
  count: the stage rail still highlighted `Review the proposed change`. Pre-fix
  producer output: `staleRegionsAfterReject: ["stageBanner", "primaryArtifact",
  "activeStage"]`, `regionsStillDemandingADecision: ["stageBanner",
  "primaryArtifact"]`, exit 1.
- **Root cause:** three regions, two writers, one branch. "What do I do next?" is
  written in two independent places — the server's own `presentation` object and
  the runtime's `run.nextAction` / stage rail — and the client derives the review
  panel from a third source, `proposal.status`. Only the third was updated on a
  rejection. `templates/base/apps/web/server.mjs:185` set a presentation for
  `accepted` with no `else`, and `templates/base/agent/workflow.mjs:46` entered a
  new stage for `accepted` only, leaving the run parked on `review` with
  `nextAction: "Approve or reject the proposed change"`. Approval was treated as
  the only decision that ends a review. Nothing caught it because the scenario
  matrix that screenshots this app (`REQUIRED_STATES` in
  `scripts/run-protected-browser-lane.mjs`, and `loadScenario` in the generated
  server) has no rejected state: rejection is reachable only by clicking, so no
  capture ever rendered it.
- **Fixed:** made both writers symmetric, at the two shared functions every
  caller routes through rather than at the one route the defect was reported on.
  `templates/base/agent/workflow.mjs` — `decide()` now enters the `working` stage
  with `nextAction: "Prepare a revised proposal"`, owner `agent`, when a
  rejection takes effect, guarded the same way the accepted branch is
  (`result.proposal.status === "rejected"`), so a stale-write `conflicted`
  outcome is untouched. `templates/base/apps/web/server.mjs` — `/api/decide` now
  has an `else setPresentation("proposal_rejected", "decision", "Proposal
  rejected", …)`. No new component, no new dependency; the banner kind falls
  through to the neutral `.state-banner` base style, which is correct for a
  recorded decision that must not be styled as success or failure.
- **Re-proved:** in the rendered app, not inferred.
  `promotion/evidence/reject-steering/reject-steering.json` — `"passed": true`,
  `staleRegionsAfterReject: []`, `regionsStillDemandingADecision: []`, zero
  console errors. Screenshots
  `promotion/evidence/reject-steering/j3-1-review-pending.png`,
  `j3-2-after-reject.png`, `j3-3-revised-proposal-approved.png`. After Reject all
  three regions agree — `DECISION / Proposal rejected`, `CURRENT ACTION / Prepare
  a revised proposal`, `DECISION RECORDED / Prepare a revised proposal` — the
  rail highlights `Prepare a proposal`, next owner is `agent`, the only visible
  control is "Prepare proposal", and the artifact stays v1 at hash
  `1077e34cc8ffae57` **[corrected in iteration 2: run-specific, and this field is
  not in the committed JSON at all]**. The same run then completes J3's actual
  goal (get the agent to try again): propose → approve → `Completion verified`,
  artifact `v2`, `Receipt 7f91d691956b6e78` **[corrected in iteration 2:
  run-specific; only the shape `/^Receipt [a-f0-9]{16}$/` is a property of the
  tree]**.
- **Producer:** `scripts/capture-reject-steering.mjs`, wired as
  `npm run promotion:reject-steering`. With no arguments it runs `nodekit create`
  into a temp directory, starts the generated server on port 4309, drives it with
  the repo's own Playwright, writes the JSON and the three PNGs, and exits 1 when
  the regions disagree. Re-runnable from a fresh clone after `npm install`; the
  in-app browser pane was unusable in this session, exactly as Wave 1 recorded.
- **Tests:** `npm test` exit 0 — **843/843** repository tests (841 + the two
  added below), 8/8 component, 0 failed, 0 skipped. `npm run build:component`
  exit 0, `npm run typecheck:public` exit 0, `npm run audit:prod` 0
  vulnerabilities. In the generated app: `node scripts/demo.mjs` exit 0
  (`"passed": true`), its own `node --test test/**/*.test.mjs` exit 0,
  `node scripts/browser-proof.mjs` exit 0.
- **Regression check, confirmed failing before the fix.** Two tests added to
  `test/generated-project-gates.test.mjs`, which already binds template source so
  it runs in milliseconds: one imports the generated workflow with its
  substitution tokens replaced and asserts that after a rejection
  `run.nextAction` no longer says "approve or reject" and `currentStageId` is
  `working`; one asserts `/api/decide` still branches to a rejected
  presentation. Stashing only the two template edits and re-running produced
  `not ok 4` and `not ok 5` (3 pass / 2 fail); restoring them gave 5/5. The
  browser producer was confirmed the same way: exit 1 on the stashed tree, exit 0
  after. The producer's "still demanding a decision" regex was narrowed once —
  from a bare `/reject/` that fired on the honest word in "The rejected change
  was not applied" — to phrases describing a *waiting* proposal. Both pre-fix
  strings still match it, which is why the narrowing is not a weakened check; the
  old pattern is named in a comment beside it.
- **Conditions newly PASS:** 1 and 12. Condition 2 stays FAIL — D2 (raw
  `Failed to fetch` shown to the user, no retry) is still open and still major.
- **Not done, recorded rather than silently skipped:** the rejected state is
  still not addressable as a `?scenario=` id, so the protected browser matrix
  still cannot screenshot it across its 6 viewports x 2 themes. Adding it means
  editing `REQUIRED_STATES` in `scripts/run-protected-browser-lane.mjs`, which is
  an evaluator contract with `wx` writes; out of scope for one iteration. This is
  the mechanism-level root cause and the next iteration's best target.

### Iteration 2 — 2026-08-13 — D5, the page that announces a completion that did not happen

- **Journey exercised:** J3 "That is not what I asked for" (steering), on its
  conflict branch — the stale write the runtime blocks.
- **Observed:** reproduced exactly as D5 records it, on Windows 11 / Node
  v22.22.2, Chromium 149.0.7827.55, 1280x900, against a `nodekit create` app on
  port 4401. `POST /api/scenario {"id":"conflict"}` then `POST /api/decide
  {"decision":"accepted"}` returned HTTP 200 with
  `presentation = {id: "completed_receipt", kind: "complete", title: "Completion
  verified"}` while `proposal.status = "conflicted"`, `receipt = null`,
  `run.status = "active"`, `run.currentStageId = "review"`, `run.nextAction =
  "Resolve the version conflict"`. The rendered page put a green COMPLETE banner
  reading "The canonical artifact and content-addressed receipt are ready"
  directly above a footer reading "No receipt yet" and a review panel reading
  "CONFLICT CONTAINED". Pre-fix producer output: `falseCompletionClaim: true`,
  `renderedFalseClaim: true`, `regionsAgree: false`, exit 1.
- **Root cause, one level below iteration 1's:** presentation was derived from the
  decision **requested** rather than the outcome **achieved**. Iteration 1 fixed
  the rejected half of `/api/decide` and claimed the two writers were now
  symmetric. They were not. `templates/base/agent/workflow.mjs` guards on the
  achieved result (`result.proposal.status === "rejected"`), but
  `templates/base/apps/web/server.mjs` discarded `demo.decide()`'s return value
  entirely and branched on `input.decision === "accepted"`. `decideProposal`
  contains a stale accept by setting `status = "conflicted"` and returning without
  a receipt, so the one input the route trusted was the one thing that could not
  tell it what happened. This is strictly worse than D1: D1 left stale copy on the
  page, D5 asserted a completion that never occurred — the exact claim this
  product exists to make trustworthy.
- **Fixed:** at the seam, not with a third branch. `templates/base/apps/web/
  server.mjs` gained `applyDecision(decision, proposalId)`, which calls
  `demo.decide(...)`, reads the returned `proposal.status`, and maps that — and
  only that — to a presentation: `accepted` → `Completion verified`, `rejected` →
  `Proposal rejected`, `conflicted` → `Conflict contained` with the canonical
  version read from the artifact instead of hardcoded. The three statuses a
  decided proposal can hold are total, so there is no fallback branch. Every
  decision in the file now routes through it: `/api/decide`, and `loadScenario`'s
  `conflict` and `completed_receipt`/`receipt_inspection`/`export_share` branches,
  which had the same "assume the accept landed" shape and each carried a duplicate
  copy of the completion or conflict sentence. Net effect on the file is fewer
  lines, one writer, no new component and no new dependency.
- **HTTP status deliberately left at 200, stated rather than assumed.** A
  contained conflict is a normal outcome in this runtime, not a transport or
  validation failure: `?scenario=conflict` serves it at 200, `POST
  /api/resolve-conflict` expects it, and the client renders it as a trust surface
  with its own control. The response body carries `proposal.status =
  "conflicted"` and `receipt: null`, so the state is inspectable. The defect was
  the success *claim*, and that is what was removed. A 4xx here would push the
  outcome into the client's raw-error slot, which is defect D2's failure mode.
- **Re-proved:** in the rendered app, not inferred.
  `promotion/evidence/decide-outcome/decide-outcome.json` — `"passed": true`,
  `conflict.falseCompletionClaim: false`, `browser.renderedFalseClaim: false`,
  `browser.regionsAgree: true`, `honestAccept.completionClaimIsBacked: true`,
  zero console errors. Screenshots
  `promotion/evidence/decide-outcome/d5-1-conflict-contained.png` and
  `d5-2-after-direct-accept.png` are byte-identical, which is the point: the
  direct accept changes nothing a user can see, because it changed nothing. The
  pre-fix capture is committed beside them as
  `promotion/evidence/defect-5-false-completion-on-contained-conflict.png`.
- **Producer:** `scripts/capture-decide-outcome.mjs`, wired as
  `npm run promotion:decide-outcome`. With no arguments it runs `nodekit create`
  into a temp directory, starts the generated server on port 4401, issues the
  verifier's probe over HTTP, drives the page with the repo's own Playwright, and
  exits 1 when a status region claims a completion the state does not support.
  The check is the general invariant, not a string match: a completion claim is
  only allowed when `run.status === "completed"` **and** a receipt exists **and**
  the proposal was accepted. It also asserts the honest accept still completes,
  so a "fix" that stopped claiming completion at all would fail it.
- **Tests:** `npm test` exit 0 — 843/843 repository tests, 8/8 component, 0
  failed, 0 skipped. `npm run build:component` exit 0, `npm run typecheck:public`
  exit 0, `npm run audit:prod` 0 vulnerabilities. In the generated app built from
  the fixed template: `node scripts/demo.mjs` exit 0 (`"passed": true`), its own
  `node --test test/**/*.test.mjs` exit 0, `node scripts/browser-proof.mjs` exit
  0. Iteration 1's producer was re-run against this tree and still passes
  (`staleRegionsAfterReject: []`, `regionsStillDemandingADecision: []`, retry
  completed). Two committed generated indexes went stale and were regenerated,
  not hand-edited: `behavior-index.json` (`npm run behavior:index`, one line
  number moved by the test edit) and `repo-map.json` (`npm run repo:map`, the new
  npm script). Both regenerations are one-line diffs; the suite refuses to pass
  while either is stale, which is how they were found.
- **Regression check, confirmed failing before the fix.** Stashing only
  `templates/base/apps/web/server.mjs` and re-running produced `not ok 5 - the
  generated server presents the outcome achieved, not the decision requested`
  (4 pass / 1 fail); restoring it gave 5/5. The browser producer was confirmed
  the same way: exit 1 on the stashed tree, exit 0 after.
- **Two tests changed, both replaced by stronger checks rather than loosened.**
  (1) `test/generated-project-gates.test.mjs` previously asserted by regex that
  `/api/decide` still contained `input.decision === "accepted"` followed by an
  `else setPresentation(`. That assertion could only hold while the defect did —
  it named the broken shape. It is replaced by a test that lays the generated
  workflow and server out the way `nodekit create` does, starts the server on an
  OS-assigned port and asserts all three outcomes over real HTTP, including the
  rejected presentation the old test existed to protect. (2)
  `test/ease-proof.test.mjs` asserted the conflict scenario called
  `decideProposal({ proposalId: stale.proposalId, decision: "accepted" })`; that
  call moved behind `applyDecision`, so it now asserts both
  `applyDecision("accepted", stale.proposalId)` and that `applyDecision` really
  routes to `demo.decide`. Both old patterns are preserved verbatim in comments
  beside the new ones, and both new assertions were confirmed to fail on the
  stashed pre-fix tree.
- **Also verified, because a refactor of scenario staging is exactly where a
  silent change hides:** all 15 states in `REQUIRED_STATES` were dumped from a
  pre-fix and a post-fix generated app (`presentation`, `proposal.status`,
  `run.currentStageId`, `run.status`, `artifact.canonicalVersion`, `hasReceipt`,
  HTTP status) and diffed. Identical. The protected browser lane sees no change.
- **Evidence hygiene, corrected here rather than quietly.**
  - Iteration 1 quoted `Receipt 7f91d691956b6e78` and artifact hash
    `1077e34cc8ffae57` in PRODUCT_GOAL.md, PRODUCT_JOURNEYS.md and above, as if
    they were properties of the tree. They are per-run. Five independent runs of
    the same producer have now produced `7f91d691956b6e78` (iteration 1),
    `7000cabe31c439ca` and `db6fba731d6418b7` (the verifier),
    `1676fed5a66b572e` and `7717d4151d3e9ab1` (iteration 2). The artifact hash
    was never a field in the committed JSON at all. The only stable property is
    the shape the producer asserts, `/^Receipt [a-f0-9]{16}$/`; the scorecard and
    the journey now quote that shape and the JSON field name, and the two
    iteration-1 sentences above are annotated in place rather than rewritten.
  - `promotion/evidence/reject-steering/` was regenerated against this tree, so
    condition 1's "re-driven here" is backed by a file this tree produced. The
    iteration-1 run's file is in git history at `816adf2`; its receipt differs
    from the new one, which is the measurement that killed the stable-hash
    belief.
  - Condition 1 said all five journeys succeed "in a real browser". Only J2 and
    J3 have browser evidence against this tree. J1 and J5 have no browser step to
    evidence — their done-whens are exit codes and file contents. J4's browser
    evidence is inherited from Wave 1 at `b1c7932`. The row keeps PASS, because
    every journey does reach its stated done-when and the two browser journeys
    were re-driven here, but the wording now names which evidence is which and
    from which tree. Judged as UNVERIFIED-if-in-doubt: the doubt was about the
    wording, not about whether the journeys pass, so the honest fix was the
    wording.
- **Conditions newly PASS:** none. Conditions 1, 11 and 12 were re-evidenced
  against this tree and stay PASS. Condition 2 stays FAIL — D2 (raw `Failed to
  fetch` shown to the user, no retry) is still open and still major. 7 and 8 stay
  UNVERIFIED; no audit was run this iteration.
- **Not done, recorded rather than silently skipped:** the rejected state still
  has no `?scenario=` id, so the protected browser matrix still cannot screenshot
  it across 6 viewports x 2 themes — unchanged from iteration 1, and still the
  mechanism-level root cause of both D1 and D5 shipping. `?scenario=conflict`
  exists, which is why D5 was screenshot-able at all; the reject path is not.
  Adding it means editing `REQUIRED_STATES` in
  `scripts/run-protected-browser-lane.mjs`, an evaluator contract with `wx`
  writes. Still the next iteration's best target.

_Wave 1 was the baseline: measurement only, nothing fixed, by design._
