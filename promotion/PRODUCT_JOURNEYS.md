# Canonical journeys — NodeKit

Three to five real workflows. Not feature tours: a journey is one person, one
goal, and the artifact they hold when it worked. These are the promotion loop's
work queue, exercised in order of importance.

**A journey with no browser evidence is unfinished**, regardless of test status.

NodeKit is judged on the `reduced` gate, so these journeys are the surface a
stranger meets: the README quickstart, the application that quickstart produces,
the receipt page, and the CLI's own help.

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J1 — "I have an empty folder and a demo on Friday"

- **Persona and situation:** A builder who has promised to show, by Friday, a
  small tool that does a real piece of work for someone and keeps a human in
  charge of it. They have never used NodeKit. They copy the block at the top of
  the README and paste it into a terminal.
- **Goal:** A running application they can open, without signing up for
  anything and without an API key.
- **Steps:**
  1. `git clone https://github.com/HomenShum/NodeKit`
  2. `cd NodeKit && npm install`
  3. `node src/cli.mjs create ../my-app --name my-app --brief "triage inbound support tickets"`
  4. `cd ../my-app && npm install && npm run demo`
- **Done when:** the demo's own JSON output ends `"passed": true` and the
  command exits 0, and `my-app/` contains `apps/web/server.mjs` to run next.
- **Evidence:** PROMOTION_LOG.md baseline command table (create exit 0, install
  exit 0, demo exit 0 with `"passed": true`).

## J2 — "Watch it work, then decide whether to keep it"

- **Persona and situation:** The same builder, now with `my-app` created. They
  run the dev server and open the page — this is the thing they will actually
  put in front of a judge.
- **Goal:** Carry one job from a blank input to a finished, approved result, and
  see the proof at the end.
- **Steps:**
  1. `npm run dev` (drives `apps/web/server.mjs`), open the page.
  2. Type the outcome into "Outcome for this case" and submit.
  3. Press "Prepare proposal" when the case hands over to the agent.
  4. Read the proposed change in the review panel and press "Approve".
- **Done when:** the stage banner reads `COMPLETE — Completion verified`, the
  primary artifact advances to v2 with a new canonical hash, and the footer
  shows a receipt hash where it previously said "No receipt yet".
- **Evidence:** `evidence/desktop-1-orientation.png`,
  `evidence/desktop-2-agent-running.png`,
  `evidence/desktop-3-review-decision.png`,
  `evidence/desktop-5-completion-receipt.png`,
  `evidence/mobile-1-completion.png`, `evidence/capture-report.json`.
  Canonical hash moved `1077e34cc8ffae57 → 5cbf8cdb4ab5ba5d`; receipt
  `6ef3a89f7a456f76`; `GET /api/export` returned 200 with the artifact and its
  versions.

## J3 — "That is not what I asked for" (steering)

- **Persona and situation:** The same builder, mid-run, looking at a proposal
  that is wrong. The whole promise of the product is that nothing becomes final
  until they say so — so this is the moment that promise is either kept or not.
- **Goal:** Reject the proposal, see unambiguously that it was not applied, and
  get the agent to try again.
- **Steps:**
  1. Reach the review stage (J2 steps 1-3).
  2. Press "Reject".
  3. Read the page to find out what state the case is now in.
- **Done when:** every status region on the page agrees that there is no
  proposal waiting, and the next action offered is to prepare a new one.
- **Evidence:** **PASSES as of iteration 1.**
  `evidence/reject-steering/reject-steering.json` (`"passed": true`,
  `staleRegionsAfterReject: []`, `regionsStillDemandingADecision: []`, zero
  console errors), `evidence/reject-steering/j3-2-after-reject.png`,
  `evidence/reject-steering/j3-3-revised-proposal-approved.png`. Regenerate with
  `npm run promotion:reject-steering`. After Reject all three regions agree —
  `DECISION / Proposal rejected`, `CURRENT ACTION / Prepare a revised proposal`,
  `DECISION RECORDED / Prepare a revised proposal` — the stage rail moves to
  `Prepare a proposal`, next owner is `agent`, the only visible control is
  "Prepare proposal", and the artifact stays v1 at `1077e34cc8ffae57`. The
  retry then completes: `Completion verified`, artifact `v2`, `Receipt
  7f91d691956b6e78`.
  Previously **FAILED** as defect D1 —
  `evidence/defect-1-stale-review-copy-after-reject.png`,
  `evidence/reject-detail.json`: the right-hand panel updated correctly, but the
  stage banner still read `REVIEW — Proposal ready for review`, the primary
  artifact panel still read `CURRENT ACTION — Approve or reject the proposed
  change`, and the stage rail still highlighted Review. Three regions instructed
  the user to decide on a proposal that no longer existed.

## J4 — "Prove to someone else that this actually ran"

- **Persona and situation:** The builder is asked, after the fact, what the
  agent did. They need something to send that is not a screenshot of a chat.
- **Goal:** A page showing exactly what command ran, what it returned, and when.
- **Steps:**
  1. `node src/cli.mjs agent run --agent codex --goal "Inspect the repository" -- node --version`
  2. Open the `report.html` path the command prints.
- **Done when:** the page names the agent, the goal, the outcome, the duration,
  the exit code and the run id, and `receipt.json` sits beside it.
- **Evidence:** `evidence/report-desktop-1280.png`,
  `evidence/report-mobile-375.png`, `evidence/report-surface.json`,
  `evidence/agent-run/e6ca7f66-33f6-4abd-a84a-add55a42c39d/`. Renders
  "NodeKit Agent Flight Recorder / codex / Inspect the repository / Completed /
  Duration 311 ms / Exit code 0 / Run ID e6ca7f66-…"; 0 axe violations and no
  overflow at 1280 and 375.

## J5 — "Which command do I even want?" (the CLI's own surface)

- **Persona and situation:** A coding agent — or a returning human — that meets
  this repository through `nodekit --help`, not the README. NodeKit has 25+
  command groups; showing all of them is the same as showing none.
- **Goal:** Find the verb for the job in one screen, and know where the rest are
  if the job is not a common one.
- **Steps:**
  1. `node src/cli.mjs --help`
  2. `node src/cli.mjs help --all` when the first screen does not cover it.
  3. `node src/cli.mjs explain --for node` to see which surfaces apply.
- **Done when:** tier one fits on one screen and names the build path
  (create / adopt / explain / demo / check / proof / compile / inspect / doctor
  / agent run) and says where the rest are; tier two lists every command; both
  exit 0.
- **Evidence:** `evidence/cli-help-tier1.txt` (14 lines, exit 0),
  `evidence/cli-help-tier2.txt` (128 lines, exit 0). `explain --for node` exit 0,
  "36 surface(s) apply, 5 do not".

---

## Journeys every agent surface owes

- **Recovery** — **not drivable, and that is a finding, not a decision.** The
  created app ships the controls (`#resume` "Resume from preserved state",
  `#resolve-conflict` "Continue from canonical version") and the endpoints
  (`POST /api/recover`, `POST /api/resolve-conflict`), but both computed
  `display:none` in every state reached across the full journey, and nothing in
  the UI can put the case into the interrupted or conflicted state that would
  reveal them. The one failure a user can actually cause — losing the network
  mid-confirm — produces the raw string `Failed to fetch` and no route back.
  See defect D2. Evidence: `evidence/capture-report.json` (`recoveryControls`),
  `evidence/error-state.json`.
- **Steering** — J3. Exercised; passes as of iteration 1. The reject path is
  still not addressable as a `?scenario=` id, so the protected browser matrix
  cannot screenshot it across viewports and themes — which is why D1 shipped at
  all. Recorded as the next iteration's target, not as a passing condition.
- **Receipt** — J2 (footer receipt hash and `GET /api/export`) and J4
  (`report.html` + `receipt.json`). Both pass.
