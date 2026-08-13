# Promotion Wave 1 — the starting line, measured

Date: 2026-08-13. Plan: [OPUS_ULTRA_REPO_PREP_2026-08-13.md](OPUS_ULTRA_REPO_PREP_2026-08-13.md).
Gate: [templates/promotion/GATE.md](../templates/promotion/GATE.md).
Run: 34 agents (17 baselines, each followed by its own adversarial judge), 0 errors,
59 minutes wall clock.

## What Wave 1 was for

Not to improve anything. To find out, honestly, where seventeen repositories stand
against a fixed twelve-condition gate, so that later work can be compared against a
number instead of a memory. Most of this board is UNVERIFIED, and that is the
correct result — a baseline that scored well would have meant the scoring was
broken.

## The board

Claimed is what the baseline agent wrote. Confirmed is what its adversarial judge
could independently reproduce from committed artifacts.

| repo | gate | claimed | confirmed | journeys | defects | verdict |
|------|------|--------:|----------:|---------:|--------:|---------|
| NodeRoom | full | 4 | 4 | 5 | 7 | caveats |
| NodeBenchAI | full | 0 | 0 | 5 | 4 | caveats |
| NodeAgent | full | 3 | 3 | 5 | 3 | caveats |
| trialscope | full | 3 | 1 | 4 | 5 | caveats |
| NodeSlide | full | 0 | 0 | 6 | 6 | caveats · in PR #181 |
| NodeVoice | full | 5 | 5 | 5 | 4 | caveats |
| NodeGraph | reduced | 2 | 2 | 5 | 7 | caveats |
| NodeKit | reduced | 6 | 6 | 5 | 4 | caveats |
| NodeProof | reduced | 6 | 1 | 5 | 3 | caveats |
| NodeTrace | reduced | 3 | 0 | 4 | 8 | **REFUTED** |
| NodeMem | reduced | 4 | 3 | 5 | 6 | caveats |
| FeatureClipStudio | reduced | 3 | 2 | 5 | 4 | caveats |
| agentic-ui-qa | reduced | 4 | 4 | 5 | 5 | caveats |
| NodeSEO | reduced | 4 | 3 | 5 | 4 | caveats |
| NodeRL | reduced | 1 | 1 | 5 | 7 | caveats · provisional |
| NodeAgentSpec | reduced | 1 | 0 | 5 | 2 | caveats · provisional |
| BetterPRHandoff | reduced | 5 | 5 | 5 | 6 | caveats · provisional |

**54 claimed, 40 confirmed, out of 204.** 85 defects with reproductions. Every repo
linked the gate rather than restating it, and every repo's journeys were judged
specific to that repo rather than generic filler.

## Finding 1 — the evidence mechanism, missing from the kit

Fourteen PASS rows across seven repos could not be confirmed. Not one was
fabricated. In every case the agent really drove a browser and really read a true
number, then wrote the number into the row while the tool that produced it was a
scratch script it deleted, or an in-session screenshot handle like `ss_5046tck1a`
that no other reader can ever open.

Tracing it back: the gate demanded "an evidence path naming the artifact" but never
said where artifacts live or that the producer must survive the session. **A
standard without a mechanism gets satisfied by prose.**

Fixed at `e7a0302`, before any correction was applied: evidence lives in
`promotion/evidence/`, an artifact requires *both* a committed output and a
committed re-runnable producer, and a measurement whose tool was not retained is
UNVERIFIED by name — "the measurement was real; the evidence is not."

This is the highest-value output of Wave 1. One kit fix closes the same hole in
seventeen repos and every repo added later.

## Finding 2 — the shared browser pane cannot serve a parallel wave

Nearly every agent reported the same thing: `computer{action:screenshot}` failing
with "the Browser pane is not displayed, so the page is not compositing frames",
tab caps exhausted by sibling agents, and in two cases a parallel agent navigating
a tab out from under a running capture. NodeGraph read `window.innerWidth` as 0 and
Sigma logged "Container has no width".

The agents that produced real captures did so with **the repo's own installed
Playwright**, which is per-process, isolated, and committed. That is not a
workaround; it is the correct mechanism, and it composes with Finding 1 — a
Playwright script in the repo *is* a committed producer, while the shared pane
produces handles that die with the session.

Wave 2 requirement: capture through the repo's own Playwright. Reserve the in-app
pane for single-agent interactive work.

## Finding 3 — parallel agents collided in a shared scratchpad

FeatureClipStudio and NodeKit both reported foreign files appearing in their
scratch directories mid-run — a capture script overwritten with another repo's
selectors, four screenshots from an unrelated wave. Port collisions were endemic
(4173, 4187, 5173, 8787 all contested), and NodeBenchAI found two servers bound to
the same port on different address families, which `--strictPort` did not detect.

Wave 2 requirement: per-agent scratch directories and per-agent ports.

## Finding 4 — the verification method has a blind spot for private repos

My own deterministic sweep fetched every repo's pushed files from
`raw.githubusercontent.com` and reported trialscope 404 on all four. That was the
sweep being wrong, not the push: **trialscope is private**, and raw URLs need auth.
The GitHub API confirms all four files at `a2f8080`. NodeSlide's 404 was real but
also correct behavior — its `main` is branch-protected, so its baseline is in
[PR #181](https://github.com/HomenShum/NodeSlide/pull/181) awaiting review.

Two judges nonetheless reported `files_live_on_github: true` for repos whose raw
URLs 404. Use the API, authenticated, for existence checks; raw URLs only for
public repos.

## What each product actually is, in one sentence

Written by the agent that read the repo, not from memory. These are worth keeping —
several are better than the repos' own README openers.

- **NodeRoom** — a shared web room where people and an AI assistant edit the same spreadsheet, notes and sticky-note wall without silently overwriting each other, and every change keeps a visible record of who made it and where it came from.
- **NodeBenchAI** — one text box where a person with an hour to form a defensible view on a company gets back a written answer with its sources attached, plus a permanent link that replays that exact answer instead of generating a new one.
- **NodeAgent** — you type a messy question from a shared work room and get back a cited memo, a corrected spreadsheet at a new version, and a visible trail of which source fed which conclusion, with no keys and no account.
- **trialscope** — you ask a plain-English question about clinical trials and get a chart where every number carries the literal web address that produced it, so the colleague who doubts your figure can re-check it without trusting you.
- **NodeSlide** — turns a brief and your data into a presentation you can still edit and defend afterwards; every AI change arrives as a reviewable proposal with a receipt instead of a silent overwrite.
- **NodeVoice** — a local-first demo of why several talking assistants in one conversation congratulate each other instead of finishing a task, and a room where every device reads and writes one shared record to prove the fix.
- **NodeGraph** — a drawing surface for graphs that fill in while an assistant works, built so a measured count, someone else's published claim, and a step the assistant merely walked through can never be mistaken for one another.
- **NodeKit** — turns an empty folder into a running web application that does real work, shows the work while it happens, refuses to finalize anything without human approval, and hands over a checkable record — one command, no account, no key.
- **NodeProof** — a command-line referee for coding agents: runs your repo's real build and tests, records the verdict to a file, and refuses to let an assistant call the work done while that verdict says FAILED.
- **NodeTrace** — click a thing an application drew and be told, on the spot and with sources, what produced it; a portable React Trace Lens over a local SQLite trace schema, no key, no cloud.
- **NodeMem** — watches the chatter in a shared work app, notices company and person names going past, and turns them into suggestions a human must click, so noticing never becomes a hundred background jobs.
- **FeatureClipStudio** — turns a live app into a short captioned walkthrough video so a builder can drop proof into a README instead of re-explaining the software on a call.
- **agentic-ui-qa** — a checklist plus five runnable scripts that force an evidence-backed answer to "can a person, or another program, actually trust and operate this screen?"
- **NodeSEO** — run one command against your own static site and get a plain report of every check that passed or failed, plus a real-browser screenshot and paint timing you can hand to a developer.
- **NodeRL** — records what an agent actually did, scores the run with deterministic checks instead of vibes, and returns a repair prompt plus training data; it wraps the agent you already run.
- **NodeAgentSpec** — fill-in-the-blank documents pinning down what an agent system must remember, must show the person using it, and must refuse to do without asking.
- **BetterPRHandoff** — a protocol plus a zero-dependency CLI that scaffolds one dated append-only changelog per surface, so the next person reads history surface by surface instead of reconstructing it from forty commit messages.

## Blockers that are not defects

These recur across the portfolio and none is a bug in the product:

- **No secrets, by design.** This wave created and rotated nothing. Every live path
  (Convex deployments, OPENROUTER/OPENAI keys, GEMINI judging, Search Console) stayed
  on its keyless fallback. Conditions that need a live model or backend are
  UNVERIFIED for that reason, stated per row.
- **Conditions 7 and 8 are unmeasured almost everywhere.** The Web Interface
  Guidelines reviewer and the web-quality/Lighthouse toolchain named in `SKILLS.md`
  are not installed in this environment. Every repo declined to launder ad-hoc
  observation into a review it did not run — NodeTrace's row 7 says so explicitly.
  That refusal is the gate working.
- **Two repos have no browser surface at all.** NodeRL ships zero HTML/TSX/CSS and
  no `bin`; NodeAgentSpec is 31 markdown files. The reduced gate's browser-shaped
  conditions are structurally UNVERIFIED there, which is a fact about the repo, not
  a gap in the work. Both are already flagged for the merge-or-retire decision.

## Real defects worth naming now

- **NodeBenchAI D1 (critical):** every product route renders "Convex backend not
  configured" from a clean clone — `apps/web/src/main.tsx` builds the client
  conditionally on `convexUrl`. A stranger cloning the repo meets an error card, not
  the product. This outranks the known typecheck blocker for user impact.
- **NodeSlide D1:** the create action fails, and conditions 3, 4, 5, 9 and 10 all sit
  behind the deck editor that action opens. One fix unblocks five conditions.
- **NodeTrace D2:** the installer ships a Next target that cannot build — `bin/nodetrace.mjs`
  copies `src/trace` but never `vendor/nodegraph-live`, which `LiveGraphRail.tsx`
  imports. The repo's own build stays green because the vendor directory exists
  locally; the installed target resolves a path that was never written.
- **NodeMem D2:** with `esm.sh` blocked the demo renders a blank frame with confident
  prose, no error text and no recovery path — the exact agentic-UX legibility failure
  the gate exists to catch.

## Wave 2 entry conditions

1. Capture through the repo's own Playwright; commit the driver and its output under
   `promotion/evidence/`.
2. Per-agent scratch directory and port.
3. Fix the highest-impact reproducible defect per iteration, re-prove in the browser,
   commit. No aesthetic churn while measurable defects remain.
4. Do not start Wave 2 on NodeRL, NodeAgentSpec or BetterPRHandoff until the
   merge-or-retire and marketplace-consolidation decisions are made — their baselines
   are recorded provisional.
5. NodeSlide needs PR #181 merged before its loop can commit to main.
