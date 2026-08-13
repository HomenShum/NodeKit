# Product goal — {{REPO}}

## Who opens this, and what they are trying to finish

<!-- One paragraph. Name a real person's situation, not a market segment. What
job did they arrive with? What do they walk away holding when it worked? Write it
so a reader who has never heard of {{REPO}} understands the job before any
technical term appears. -->

TODO: replace with the actual first-time user and their job.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `full` | `reduced` <!-- reduced = library/CLI judged on its demo
surface and quickstart; see the GATE's reduced-gate section -->

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | not yet run |
| 2 | No critical or major usability defect open | UNVERIFIED | not yet run |
| 3 | Mobile and desktop both intentional | UNVERIFIED | not yet run |
| 4 | No horizontal overflow at supported widths | UNVERIFIED | not yet run |
| 5 | Loading/empty/success/error/agent-running designed | UNVERIFIED | not yet run |
| 6 | Keyboard and basic accessibility pass | UNVERIFIED | not yet run |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | not yet run |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | not yet run |
| 9 | No unexplained console errors or failed requests | UNVERIFIED | not yet run |
| 10 | Performance does not obstruct interaction | UNVERIFIED | not yet run |
| 11 | Tests and build green | UNVERIFIED | not yet run |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | not yet run |

**Status: NOT PROMOTED** — 0/12 PASS.
