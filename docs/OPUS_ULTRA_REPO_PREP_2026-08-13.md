# Opus ultra workflow: prepping every repo for product promotion

Date: 2026-08-13. Source of doctrine: the "Ultimate Agentic App Goal" thread
(chatgpt.com/c/6a7d1876-c2a8-83e8-bf58-8f2326390714, harvested at 4 turns).
Source of portfolio state: [PORTFOLIO_AUDIT_2026-08-12.md](PORTFOLIO_AUDIT_2026-08-12.md)
and the integration/clip campaign of 2026-08-10..12.

> **Execution status, 2026-08-13.** Wave 0 shipped (`b1c7932`, amended `e7a0302`).
> Wave 1 ran across 17 repos with 34 agents — results and the four findings it
> produced are in [PROMOTION_WAVE1_RESULTS_2026-08-13.md](PROMOTION_WAVE1_RESULTS_2026-08-13.md).
> Wave 2 entry conditions are listed at the end of that document and supersede the
> wave description below where they conflict.

## The human situation first

A person opens one of these repos for the first time, runs the app, and tries
to finish one real job — ask a question, watch the agent work, correct it,
and walk away with a result they trust. Today most of the portfolio proves its
*mechanisms* (tests green, clips recorded, receipts enforced) but has never
been judged as a *running product* a stranger drives end to end. The failure
this plan prevents: an agent workspace where the user cannot tell what the
agent is doing, whether it needs them, or how to undo what it did — perfectly
tested, unusable (the "agentic UX legibility" gap). The deliverable is a
single reusable promotion machine, installed per repo, that loops a real
browser over real user journeys until a fixed 12-condition gate passes.

## Decision

Build the machinery ONCE in NodeKit as the **product-promotion kit**, then fan
it out per repo in bounded Opus-led waves. Do not write a giant custom
product-readiness constitution per repo; compose four maintained specialist
authorities plus a thin local gate, exactly as the thread concluded:

> "The gate should be tiny — expertise belongs in maintained skills."
> "Don't install fifty design skills. That gives the agent conflicting taste."
> One implementation authority, one UX authority, one engineering-quality
> authority, one browser verifier: **Anthropic frontend-design → Vercel Web
> Interface Guidelines → Addy Osmani web-quality-skills → Playwright → Ralph
> loop.**

The unit of evaluation is the running product — not source code, not static
screenshots. This is the same discipline as our capture gates ("an
integration without a capture is a plan, not a feature"), extended from *does
the feature exist* to *can a stranger finish the job*.

## Why

- The thread's verdict standardizes across the portfolio by construction:
  "The domain workflow changes; the product-quality machinery doesn't."
  NodeKit is already the taste bible and already ships plugins/skills — it is
  the natural carrier.
- We already have most of the raw material: per-repo audits with verdicts,
  SHOWN captures for six graph hosts, deterministic gate grammar
  (CODEX_SELFRUN rules R1–R9/G1–G6), and a proven bounded-loop pattern that
  Codex followed to CLOSED with visual evidence.
- deepswe leaderboard (2026-08-12): claude-opus-5[max] is #1 at 74% — deep
  per-repo passes route there via codex-rescue; Fable orchestrates and
  adversarially verifies (fable-judge stance: a report is a set of claims,
  not evidence).
- Evidence-backed increments beat aesthetic rewrites: the thread's draft
  prompt forbids redesigning from scratch "unless evidence shows the
  architecture prevents a good experience," which matches our
  proportional-engineering rule.

## The kit (built once, in NodeKit)

Four files per consuming repo, all templated here:

1. **`PRODUCT_GOAL.md`** — thin gate file. One paragraph naming the product's
   first-time user and their job, then the 12-condition promotion gate
   verbatim (below). No style advice — that lives in the skills.
2. **`PRODUCT_JOURNEYS.md`** — 3–5 real user workflows, each written as
   persona → goal → steps → the artifact that proves completion. Journeys are
   the loop's work queue; a journey without browser evidence is unfinished.
3. **`.skills/`** — pinned references (not forks) to the four authorities:
   Anthropic `frontend-design` (implementation), Vercel Web Interface
   Guidelines agent skill (UX review), Addy Osmani `web-quality-skills`
   (accessibility, performance, Core Web Vitals), Playwright/DevTools browser
   verification. One authority per axis; adding a fifth requires deleting one.
4. **`PROMOTION_LOG.md`** — the Ralph-loop state artifact: per iteration, the
   journey exercised, the defect fixed, the browser evidence path, gate
   conditions newly passing. Loop state persists in git, never in the agent's
   memory.

### The loop (verbatim shape from the thread)

Run the real app → pick the most important unfinished journey → exercise it
end-to-end in a real browser → inspect desktop and mobile widths, interaction
states, keyboard, console, network, loading/streaming, failure recovery →
Vercel WIG review → web-quality audits → fix the **highest-impact reproducible
defect using existing components** → re-prove in the browser that it is gone →
run affected tests → commit → continue. No aesthetic churn while measurable
defects remain.

### The promotion gate (12 conditions, fixed)

A repo is PROMOTED only when all twelve hold, verified in the rendered app:

1. Each canonical journey succeeds end-to-end in a real browser.
2. No known critical or major usability defect.
3. Mobile and desktop are both intentional, not accidental.
4. No horizontal overflow at supported widths.
5. Loading, empty, success, error, and agent-running states are designed.
6. Keyboard navigation and basic accessibility pass.
7. WIG review: no major unresolved finding.
8. Web-quality audit: no major unresolved finding.
9. No unexplained console errors or failed network requests.
10. Performance does not obstruct interaction.
11. Tests and build are green.
12. Every improvement was verified in the rendered app, not inferred from code.

### Agentic-UX legibility (applies to every agent surface)

The user can always tell: what the agent is doing, whether it needs input,
what changed, whether it succeeded, what happens next, and how to recover.
Operational state and evidence only — no hidden chain-of-thought. Actions
carry risk-proportional visibility: confirmation before, diff during, receipt
and undo after, scaled to blast radius.

## Plan (waves, deterministic)

**Wave 0 — build the kit (NodeKit, this repo).**
Templates for the four files; a `nodekit` verb or script that installs them
into a target repo; the gate text frozen in one place so no repo paraphrases
it. Exit: a stranger test — install into a scratch repo, confirm the loop
prompt + skills resolve with zero manual edits.

**Wave 1 — per-repo baseline (fan-out, one Opus agent per repo).**
For each target: install the kit, write its 3–5 journeys from the product's
actual value (the audit verdicts name them), run ONE full loop iteration to
produce a baseline defect ledger with browser evidence. No fixes yet beyond
the single highest-impact defect. Exit per repo: journeys committed, baseline
gate scorecard (n/12) with evidence paths.

**Wave 2 — promotion loops (bounded).**
Ralph-style: at most N iterations per repo (default 10) or until gate PASS,
whichever first. Each iteration is one defect, one commit, one re-proof.
Opus[max] via codex-rescue for deep multi-file fixes; mechanical iterations
may run on the Codex self-run pattern with the same rules (never `git add
-A`; explicit paths; measure before and after and quote both).

**Wave 3 — adversarial verify + promote.**
An independent fable-judge pass per repo re-runs the gate cold: fresh clone,
fresh server, re-drive the journeys. Verdict VERIFIED / VERIFIED WITH CAVEATS
/ REFUTED. Only VERIFIED flips the repo's README status to promoted and
re-records its hero clip from the post-loop build. A REFUTED verdict reopens
Wave 2 — suppressing it to look finished is the failure the gate exists to
catch.

### Targets and order

Full gate (user-facing running products, in priority order):
**NodeRoom, NodeBenchAI, NodeAgent, TrialScope web, NodeSlide, NodeVoice.**

Reduced gate (libraries/CLIs — journeys are their demo pages and quickstarts;
conditions 3–6 apply to the demo surface): **NodeGraph, NodeKit itself,
NodeProof, NodeTrace, NodeMem, FeatureClipStudio, agentic-ui-qa.**

Deferred pending owner decisions: NodeRL (merge-or-retire), NodeSEO,
BetterPRHandoff/NodeAgentSpec (marketplace consolidation).

## Risks and mitigations

- **Conflicting taste from too many skills** — hard cap of four authorities;
  adding one means removing one (thread's explicit warning).
- **Loop churns aesthetics instead of defects** — every iteration must name a
  reproducible defect and its browser re-proof; a commit without both is
  reverted by the Wave 3 judge.
- **Gate gamed by weakened checks** — the gate text is frozen in NodeKit;
  repos reference it, never restate it. Any local paraphrase is a Wave 3
  finding.
- **Evidence from a stale process** — restart the server before every
  capture; a process older than the change produces evidence about a tree
  that no longer exists (standing rule, already bitten us).
- **Known blockers in flight** — NodeBenchAI's `tsc` api→never cascade
  (bisect running; gate condition 11 blocks its promotion until exit 0) and
  the OTP-gated npm publishes (blocks NodeKit's registry quickstart journey;
  user-only action).
- **Convex-backed repos need live deployments for journeys** — reuse the
  isolated dev-deployment pattern proven on NodeRoom/NodeBench; never point
  loops at production.

## Definition of done

Wave 0 kit merged in NodeKit and stranger-tested; all six full-gate repos
carry journeys + baseline scorecards; each reaches gate PASS or a documented
stop (iteration cap hit, with the remaining defect ledger committed); Wave 3
verdicts recorded per repo; README hero clips re-recorded from promoted
builds. The parent goal closes only when every full-gate repo is either
PROMOTED or has a named, owner-visible blocker.
