# Portfolio product audit — 2026-08-12

Seventeen repos audited as a stranger experiences them, against the bar of
assistant-ui (one-command first win, product docs), ponytail (zero-ceremony
adoption), and Mobbin (see value before installing). Two deep audits
(NodeKit, NodeGraph) and four grouped sweeps (flagships, proof layer,
product tools, methods). Every finding cites a path, a command output, or a
live-registry probe; the full sweep reports live in the session that
produced this file — this page keeps the verdicts and the diseases.

## The verdict table

| Repo | One-line verdict | Sharpest finding |
|---|---|---|
| **NodeKit** | Great product buried under the factory floor — FIXED same day | 60% of root was process; help was a 103-line wall; skills door unmarked (no marketplace.json) |
| **NodeGraph** | View layer excellent, front door contradicted itself — FIXED same day | npm name `nodegraph` squatted since 2015; then the 142-node gallery capture exposed a real collinear-seeding bug (1.6e-15 spread), fixed with golden-angle seeding + regression test |
| **NodeAgent** | Ship as-is: the assistant-ui bar, met | 310 words to a no-key quickstart; every claimed script exists. **The portfolio's front door for a recruiter** |
| **NodeBenchAI** | Strong product, README written for the author | A committed file literally named `C:UsershshmAppDataLocalTempchat-diff.txt` at root; first command 2,500 words deep |
| **NodeRoom** | Deepest substance, worst first screen | Quickstart at line 1,543 of 2,507 (14,848 words deep); hero is 35 internal-doc links incl. "Interview notes"; keeps admittedly-stale benchmark prose with a "do not quote" banner |
| **NodeProof** | Strong tool, buried lede | Real npm package (`proofloop@0.3.0`) but quickstart at line ~229 behind five insider sections; zero committed receipts in a receipts product |
| **NodeTrace** | Strongest of the proof layer | All 16 proof-media links resolve; honest about npm-name squatting — but teaches `npx @homenshum/nodetrace`, which 404s |
| **NodeMem** | Best idea, broken packaging | README teaches `npm install nodemem` — **that name belongs to a stranger** (dead 2022 package); manifest declares a `bin/` that does not exist |
| **NodeRL** | A thesis wearing a repo's clothes | No runnable entry; its own honesty-debts ledger is a dead path; embeds `@noderl/nodetrace`/`nodemem` that shadow the standalone repos with different code |
| **NodeSlide** | Strongest tool product, weakest first screen | Quickstart links a `.env.example` that does not exist; 834 words of status prose first; ~225MB of generated artifacts in the clone |
| **NodeVoice** | Closest to stranger-usable this week | 40-word identity, no-key two-command win — but 15 README embeds hotlink FeatureClipStudio's main branch (undeclared CDN coupling) |
| **FeatureClipStudio** | Best proof, worst wayfinding | Published a judge-variance measurement against itself and retracted its own claim (exemplary); quickstart at line 239 under 43 loose root scripts |
| **NodeSEO** | Most honest, least demonstrated | A visual-QA tool with zero images anywhere in the repo; the no-key win (`npm run validate`) exists and the README never mentions it |
| **agentic-ui-qa** | Strong method, buried door | One-command install sits at line ~155; flagship "Haiku-validated" claim has no in-repo receipt — fails its own "no artifact, no claim" rule |
| **solo-founder-agent-builder** | Best adoption mechanic + most honest claims doc | Zero-install /goal prompt; `PUBLIC_CLAIM_PROOF.md` audits its own marketing — but receipts point at local `D:\` paths nobody can open |
| **NodeAgentSpec** | REFUTED as a method repo: a good book, nothing to adopt | 27-file copy is the unit of adoption; zero proof it was ever applied anywhere |
| **BetterPRHandoff** | Closest to the ponytail bar; VERIFIED | Live npm package, one-command installers, and externally verified proof (NodeBenchAI PR #240, merged) — the model the others should copy |

## The five diseases (every one appears in 3+ repos)

1. **The buried win.** The fast, honest, no-key first command exists in
   almost every repo — at line 155, 229, 239, 466, or 1,543. The work is
   done; the door is behind the warehouse. *Rule: first screen = one
   sentence, one committed medium, one no-credential command, within 25
   lines. (docs/ONBOARDING_REVAMP.md)*
2. **Dead or stranger-owned npm names in teaching position.** `nodemem`
   installs someone else's dead package; `@homenshum/nodetrace` 404s;
   NodeGraph's `nodegraph` is squatted. *Rule: never teach a command that
   fails; `npm view` the name in CI.*
3. **The lab notebook shipped as the product.** Session .txt files, oracle
   state, proof campaigns, 225MB artifact dirs, a mangled Windows temp-path
   filename at root. *Rule: `docs/internal/` exists everywhere; root is for
   consumers.*
4. **Rename rot.** `HomenShum/node-platform` survives in CI pins across
   NodeProof/NodeTrace/NodeMem/agentic-ui-qa and NodeSlide docs, alive only
   through GitHub's redirect. *Rule: a rename ships with a grep across the
   org, same day.*
5. **Undeclared coupling.** NodeVoice's proof media lives in
   FeatureClipStudio's main branch; NodeRL shadows NodeTrace/NodeMem names
   with different code. *Rule: one canonical owner per name and per asset;
   declared, or moved.*

## Priority actions (leverage order)

1. **First-screen pass across NodeRoom, NodeBenchAI, NodeProof,
   FeatureClipStudio, NodeSlide** — pure moves and deletions; every
   ingredient already exists. (One template: NodeAgent's README.)
2. **npm truth sweep**: publish or fence every taught install —
   `@homenshum/nodemem` (+ fix the phantom bin), `@homenshum/nodetrace`,
   `@homenshum/nodegraph`, `@homenshum/nodegraph-live`, `@homenshum/nodekit`
   (owner login required for publishes).
3. **Rename-rot grep** across all CI workflows and docs (node-platform →
   NodeKit; nodegraph-render / NodeGraph-Live → NodeGraph).
4. **Marketplace consolidation**: add agentic-ui-qa and BetterPRHandoff as
   entries in this repo's `.claude-plugin/marketplace.json`; fold
   solo-founder-agent-builder's skill into nodekit-launch (keep its public
   /goal prompt endpoint); NodeAgentSpec stays a spec, cross-linked, with
   one "implemented by" proof page.
5. **NodeRL decision** (owner): merge its packages onto the standalone
   NodeTrace/NodeMem, or move its genuinely good specs into NodeProof and
   retire the repo to a thesis doc until the exporter has a demo.
6. **Media ownership**: copy NodeVoice's ~10 proof assets into its own
   repo; declare FeatureClipStudio's CDN role or end it.
