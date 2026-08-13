# The PROMOTION gate

**This file is the single source. Consuming repos link to it; they never restate
it.** A local paraphrase is how a gate gets quietly weakened, so a repo that
copies these conditions instead of linking them has already failed condition 12
in spirit.

Raw source of truth:
`https://raw.githubusercontent.com/HomenShum/NodeKit/main/templates/promotion/GATE.md`

## The human situation this protects

Someone opens the product for the first time and tries to finish one real job.
They ask for something, the agent starts working, and they need to know — without
reading the code — what it is doing, whether it needs them, what changed, and how
to undo it. The failure this prevents is a workspace that passes every test and
still leaves that person stuck, because nothing on screen tells them where they
are. **A product is promoted when a stranger can finish a real job in a real
browser, not when its tests are green.**

This gate is a different axis from [the PRODUCTION-AGENT gate](../../docs/PRODUCTION_AGENT_GATE.md),
which governs what the agent loop owes its operator (risk tiers, suspension
points, budgets). That one asks *is the agent responsible*. This one asks *can a
human use it*. Both must hold; neither substitutes for the other.

## The twelve conditions

A repo is PROMOTED only when all twelve hold, each verified in the rendered
application:

1. Each canonical journey in `PRODUCT_JOURNEYS.md` succeeds end-to-end in a real
   browser.
2. No known critical or major usability defect remains open.
3. Mobile and desktop are both intentional, not accidental.
4. No horizontal overflow at any supported width.
5. Loading, empty, success, error, and agent-running states are all designed —
   not left as whatever the framework does by default.
6. Keyboard navigation and basic accessibility pass.
7. Web Interface Guidelines review: no major unresolved finding.
8. Web-quality audit (accessibility, performance, Core Web Vitals): no major
   unresolved finding.
9. No unexplained console errors and no failed network requests during a journey.
10. Performance does not obstruct interaction.
11. Tests and build are green.
12. Every improvement was verified in the rendered app, not inferred from code.

## Scoring vocabulary — three values, no fourth

Each condition is recorded as exactly one of:

- **PASS** — observed to hold, with an evidence path naming the artifact that
  shows it.
- **FAIL** — observed not to hold, with the reproduction.
- **UNVERIFIED** — not observed. The app would not start, the journey could not
  be driven, the audit was not run. **UNVERIFIED is never PASS.** A scorecard
  that shows 12/12 because nothing was checked is the exact failure this
  vocabulary exists to make impossible.

Write the reason next to every UNVERIFIED. "Not run" is a state; "no reason
given" is a defect in the scorecard.

## Reduced gate (libraries, CLIs, renderers)

A package with no application of its own is judged on the surface a stranger
actually meets: its demo page, its quickstart, its example app. Conditions 3–6
apply to that surface. Conditions 1–2 apply to the quickstart itself as a
journey: a stranger clones, runs one command, and reaches a working result.
Conditions 7–12 apply unchanged. Nothing is waived — the surface is just smaller.

## The loop that closes it

Run the real app → pick the most important unfinished journey → exercise it
end-to-end in a real browser → inspect desktop and mobile widths, interaction
states, keyboard, console, network, loading and streaming, failure recovery →
Web Interface Guidelines review → web-quality audits → fix the **highest-impact
reproducible defect using existing components** → re-prove in the browser that it
is gone → run affected tests → commit → continue.

No aesthetic churn while measurable defects remain. Do not redesign from scratch
unless evidence shows the architecture prevents a good experience.

## Agentic-UX legibility (applies to every agent surface)

The user can always tell: what the agent is doing, whether it needs input, what
changed, whether it succeeded, what happens next, and how to recover. Operational
state and evidence only — never hidden chain-of-thought presented as progress.
Actions carry visibility proportional to their blast radius: confirmation before,
diff during, receipt and undo after.

## Stop rule

The loop ends when the gate passes, or when the iteration cap is reached with the
remaining defect ledger committed. It does not end because the agent ran out of
ideas, and it does not end by lowering a condition.
