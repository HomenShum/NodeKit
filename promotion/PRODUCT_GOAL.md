# Product goal — NodeKit

## Who opens this, and what they are trying to finish

Someone has been asked to show, by a date, that a piece of software can do a
real piece of work on a person's behalf — sort the support tickets, draft the
reply, produce the summary — and that a human stayed in charge of it. They have
an empty folder, a terminal, and the strong suspicion that the demo will fall
apart the moment anyone asks "wait, how do I know it actually did that?" What
they need is not another chat window. They need a working page they can put in
front of a judge, a hiring manager, or their own team lead, where the work is
visible while it happens, nothing becomes final until a person says yes, and
there is a file at the end that says what changed and can be checked afterwards
by someone who does not trust them. NodeKit is the thing they clone to get
there: one command turns the empty folder into that running application, with
the review step, the record of what happened, and a demo that runs without any
account or API key. When it worked, they hold a page they can open in a browser,
a run they can walk someone through end to end, and a receipt with a hash in it
that anyone can re-check. (In the repo's own vocabulary that chain is
`Case → Run → Stage → Artifact → Proposal → Approval → Receipt`, and the
receipt is content-addressed — but nobody needs those words to use it.)

The second person who opens this is the coding agent working on that person's
behalf, which meets the repository through `nodekit --help` rather than the
README, and needs to find the right verb among 25+ command groups without
reading all of them.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `reduced` <!-- reduced = library/CLI judged on its demo
surface and quickstart; see the GATE's reduced-gate section -->

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

For this repo the judged surface is what a stranger actually meets: the README
quickstart, the application that quickstart produces (`npm run dev`), the
receipt page `nodekit agent run` writes, and the two-tier CLI help.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline measured 2026-08-13 against commit `b1c7932`, on Windows 11 / Node
v22.22.2, from a fresh `git clone --depth 50`. Every PASS below names a file in
[`evidence/`](evidence/) produced by driving the running application; no PASS is
inferred from source.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | FAIL | J1, J2, J4, J5 all reached their stated "done when". J3 (steering) does not: after Reject, two of the three status regions still say a proposal is waiting. `evidence/defect-1-stale-review-copy-after-reject.png`, `evidence/reject-detail.json` |
| 2 | No critical or major usability defect open | FAIL | D1 (major, contradictory state after Reject) and D2 (major, raw `Failed to fetch` shown to the user) are open. See the defect ledger in PROMOTION_LOG.md |
| 3 | Mobile and desktop both intentional | PASS | `.mobile-action` computes `display:none` at 1280 and `display:flex` at 375, with 42px-high Approve/Reject; the desktop `#approve`/`#reject` measure 0x0 at 375, so controls are not duplicated. `evidence/reject-detail.json`, `evidence/mobile-4-decision-actionbar.png`, `evidence/desktop-3-review-decision.png` |
| 4 | No horizontal overflow at supported widths | PASS | `scrollWidth == innerWidth` and zero elements extending past the viewport at 1280, 375 and 320 on the app, and at 1280/375 on the receipt page. `evidence/capture-report.json` (`overflow`), `evidence/report-surface.json` |
| 5 | Loading/empty/success/error/agent-running designed | FAIL | Empty (`ORIENTATION`), agent-running (`RUNNING`), success (`COMPLETE` + receipt hash) and form-validation error (`role=alert`, `aria-invalid=true`, "Add a concrete outcome before continuing.") are designed. A transport failure is not: the app prints the browser's own `Failed to fetch` string. No loading state was observed at all. `evidence/error-state.json`, `evidence/desktop-7-transport-failure.png` |
| 6 | Keyboard and basic accessibility pass | PASS | First Tab lands on "Skip to primary artifact" with a `solid 3px` focus ring; the confirm step was completed with keyboard only (typed, then Enter); axe-core reports 0 violations at 1280 and 375 on the app and 0 at both widths on the receipt page. `evidence/capture-report.json` (`keyboard`, `axe`), `evidence/report-surface.json` |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | No Web Interface Guidelines review was run against this surface. `npm run gate:trust-surface` exits 0, but it self-tests its own fixtures — nothing points it at the created app's review surface, so it says nothing about this page |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | Only the accessibility half ran (axe-core, 0 violations, both surfaces, both widths). No performance or Core Web Vitals audit was run — no Lighthouse, no field or lab metrics. Half an audit is not the audit |
| 9 | No unexplained console errors or failed requests | PASS | Zero console errors or warnings and zero failed requests across the full journey; all 8 requests returned 200 (`GET /`, `styles.css`, `responsive-refinements.css`, `app.js`, `/api/state`, `POST /api/confirm`, `/api/propose`, `/api/decide`). `evidence/capture-report.json` (`consoleMsgs`, `failedRequests`), `evidence/report-surface.json` |
| 10 | Performance does not obstruct interaction | PASS | Wall-clock from click/keypress to the asserted DOM text: confirm 28 ms, propose 77 ms, approve 56 ms. `evidence/capture-report.json` (`timing`) |
| 11 | Tests and build green | PASS | `npm test` exit 0 — 841/841 repository tests, 8/8 component tests, 0 failed, 0 skipped; `npm run build:component` exit 0; `npm run typecheck:public` exit 0; `npm run audit:prod` reports 0 vulnerabilities. Commands and exit codes in PROMOTION_LOG.md |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | This wave made no improvement, so the condition has no subject yet. Wave 1 is a baseline: it measures, it does not fix |

**Status: NOT PROMOTED** — 6/12 PASS, 3 FAIL, 3 UNVERIFIED.
