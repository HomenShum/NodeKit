# The onboarding revamp: time-to-first-win is a gate, not a vibe

Recorded 2026-08-12, from the owner's report: "I tried using
nodegraph-render and nodekit, but they did not feel as intuitive to
bootstrap or onboard like ponytail, fable-method, mobbin ui, or
assistant-ui."

## The human situation first

A newcomer gives a tool one chance. They run the first command the README
shows them. If it fails — or if they must read three thousand words to find
it — they leave, and everything downstream of the front door (the gates,
the receipts, the discipline) never gets seen. The most rigorous platform
in the world is invisible behind a broken first command.

**Paper note: a project's real front door is the first command a stranger
runs, and it must be measured like everything else.**

## The metric

**TTFW — time to first win.** Clock from "stranger has the repo URL" to "a
running thing they can see," following the README verbatim, on a machine
that has never seen the project. Companion counts: commands-to-first-win
and words-before-first-command.

## What was measured (2026-08-12)

| Tool | First win | Commands | Words before it | TTFW |
|---|---|---|---|---|
| ponytail / fable-method (references) | behavior changes | 0 (`/skill`) | 0 | seconds |
| Mobbin (reference) | see the pattern | 0 (browse) | 0 | seconds |
| assistant-ui (reference) | running chat app | 1 (`npx assistant-ui create`) | one screen | ~2 min |
| **nodegraph-render, before** | none — `npm run demo` missing on the pushed tree; README installed an npm name that 404s | ∞ | ~400 | **∞ (broken)** |
| **nodegraph-render, after** | running visual demo | 3 | ~40 | **11 s** |
| **NodeKit, before** | buried: `create` existed but sat behind 3,069 front-door words leading with `EASE_NOT_CERTIFIED — DO NOT SUBMIT` | 5 (undiscovered) | ~3,000 | unmeasured (nobody got there) |
| **NodeKit, after** | scaffolded app, demo `"passed": true` | 5 | ~120 | **40 s** |

Three root causes, all now on record:

1. **Finished work sitting unpushed** (nodegraph-render's demo existed
   locally for a day while the public repo 404'd). An unpushed win is an
   unwired mechanism — the tenancy.py failure at repo scale.
2. **Repo mitosis**: one component, two GitHub repos (nodegraph-render and
   NodeGraph-Live), four names (nodegraph, nodegraph-render,
   @homenshum/nodegraph-live, NodeGraph Live). A stranger cannot tell which
   door is real. Canonical is `nodegraph-render` (the owner's chosen name);
   NodeGraph-Live is a duplicate pending the owner's archive decision.
3. **Governance as the greeting.** NodeKit's front door led with
   certification verdicts and open external gates — the platform's honesty
   apparatus, which matters enormously and belongs one scroll down, after
   the first win.

## The rules going forward

1. **The first screen of every README is a copy-paste block ending in a
   running thing**, with the measured TTFW beside it. Reference docs live
   below the fold.
2. **TTFW is re-measured on release** — the factory acceptance already does
   this for NodeKit (phases are timed); nodegraph-render's `verify:demo`
   plays the same role. A README claiming an unmeasured time violates
   measure-then-claim.
3. **One canonical repo per component, one install story per repo.** A new
   repo for the same component requires an owner decision recorded in the
   old repo's README, or it is mitosis.
4. **Never let the front door reference an interface that does not exist
   yet** (an unpublished npm name) without saying so in the same block.
5. **Agent users get the zero-command path stated first-class**: "open this
   repo in a coding agent and describe the pain point" — NodeKit's skill
   entry is already ponytail-grade for agents; the human path must not hide
   it and vice versa.

## The ladder (remaining rungs, in order)

1. DONE — push the wins, consolidate the repos, front doors rewritten with
   measured TTFW (this document's table).
2. **npm publish** `@homenshum/nodegraph-live` and `@homenshum/nodekit`
   (owner action: needs npm login). This unlocks `npx nodekit create` and
   `npm i @homenshum/nodegraph-live` — assistant-ui's exact shape. Until
   then the READMEs say so honestly.
3. **Hosted demo page** for nodegraph-render (GitHub Pages from the demo
   build) — the Mobbin/morpho shape: see it before cloning anything.
4. **`nodekit explain --for <stack>` as the second command** in the
   quickstart output, so the capability catalog reveals itself
   progressively instead of all at once.
5. Re-run the stranger test quarterly or on any front-door edit; record the
   number in this file's table.
