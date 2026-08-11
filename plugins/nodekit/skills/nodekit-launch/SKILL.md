---
name: nodekit-launch
description: Turn a business pain point, product purpose, hackathon idea, judging rubric, or required sponsor stack into a researched, scaffolded, evaluated, live-tested, browser-proven agent application. Use for empty-directory builds, safely adopting NodeKit into an existing project, or implementing and reviewing changes in a NodeKit-generated project.
---

# NodeKit Launch

Build the smallest undeniable vertical slice. Keep an honest launch clock from intake through proof, aiming for 30 minutes and preserving remaining 2-hour and 4-hour hackathon runway.

For a launch or adoption, read [the launch contract](references/launch-contract.md) before acting. For an ordinary implementation or review, start with the proportional-engineering rules and load the launch contract only if the task becomes a launch. This skill is the coding-agent authority; entrypoint files route here instead of copying its rules.

## Proportional engineering and convergence

1. Classify the work as a patch, feature, or system change. Match the architecture to the demonstrated scope.
2. Every new abstraction, dependency, configuration option, compatibility layer, or defensive branch must map to a current requirement, an observed failure, or a real trust-boundary risk. Name the consumer or reachable state.
3. Enforce each rule once at the earliest layer that owns it. Validate external input at trust boundaries; do not repeat validation downstream for states a typed contract makes impossible.
4. If a change needs three or more new exception branches, stop and revisit the seam or root approach before adding another branch.
5. Measure complexity by concepts, dependencies, public APIs, configuration, indirection, and files as well as lines of code. Prefer existing language, platform, and repository primitives.
6. Once implementation starts, the agreed plan is closed except for correctness, security, data integrity, or failure of the named proof. Record unrelated improvements as deferred work.
7. After compaction, handoff, or long exploration, reread the request, plan, and current diff. Stop when the named user-visible proof passes.

These rules limit accidental architecture growth; they never weaken safety, authority, evidence, or production-proof requirements.

## Response discipline

How to write anything a person will read — reports, docs, commit messages, answers, labels.

1. Explain the human situation before the technical rule, in this order: normal human language, then a concrete example, then the technical term in parentheses, then one sentence usable as a paper note. A new reader must be able to answer: who is doing the work, what are they trying to accomplish, what can go wrong, what should the system do, why it matters.
2. Trace the completed work back to the request: quote or paraphrase the part of the ask each deliverable fulfils, so a long or bursty request can be audited against what was done.
3. Never state a number you did not just produce, and never label an artifact with more than the system actually did — a title must describe the exact search the system actually ran (`docs/TITLE_SCOPE_IDENTITY.md`; run that gate at any stage exit that renders a labeled artifact).
4. When work introduces a second kind of truth — curated claims beside measured numbers — apply `docs/ASSERTION_DISCIPLINE.md`: versioned source, replayable receipt, loud failure, and a rendering grammar in which a claim can never pass as a measurement.

## Closure rule

Sub-issue completion is not parent completion. A parent goal — a handoff queue, a feature broken into forward-chained issues, a plan document — closes only when every sub-issue passed its own acceptance test AND the parent's named proof is re-run after the last one lands. Record that parent proof command in the plan or handoff document itself, with an explicit OPEN/CLOSED status line, so the next reader can tell a finished queue from a verified goal.

## Launch/adoption workflow

Run this section only when the task is a launch or adoption. For an ordinary implementation or review, apply the proportional-engineering rules, execute the smallest relevant proof, and do not scaffold, deploy, or create presentation work unless the request independently requires it.

1. Start the launch timer. Capture the raw brief, deadline, judging rubric, sponsor requirements, and current directory state.
2. Research the audience before any design choice, and ask for the primary document before inferring anything. Ask for the job description, rubric, RFP, brief, or recruiter email when the user is likely to hold it. Record uncertainty explicitly; late research cannot retroactively justify an earlier design.
3. Research current official sources for the user problem and every sponsor. Record links, package versions, authentication, pricing or limits, and one visible contribution to the demo.
4. Select one workflow shaped as `input -> agent decision -> tool-backed action -> measurable artifact -> visible proof`. Prefer a real metric and a reversible experiment.
5. Compile the prose into `hackathon.yaml`. Ask only questions whose answers materially change the product, security model, or irreversible action.
6. For an empty target, run `nodekit create --local-proof`; add `--package-manager pnpm` when pnpm is available and appropriate. For an existing target, run `nodekit adopt` and inspect its collision receipt before accepting changes.
7. Run `nodekit compile` and `nodekit inspect`. Confirm the filesystem-discovered tools, skills, integrations, fixtures, evals, provider, secret references, and config hash.
8. Implement one end-to-end surface. Preserve one execution path for the no-key demo, live provider, browser, and evals.
9. Read and run the sibling `nodekit-qa` skill. Establish the deterministic floor, strict live-provider smoke, and the critical browser journey; test missing secrets, malformed input, reload or resume, repeated actions, narrow or mobile layout, and export or reopen.
10. Deploy only the exact tested revision and only with user authorization. Record URL, revision, environment identity, health, and a fresh-user journey.
11. Emit the release proof and launch timeline. Do not call the run production-proven if live, browser, deployment, or receipt evidence is absent.
12. Read and run the sibling `nodekit-present` skill. Bind the problem, product workflow, sponsor use, architecture, screenshots, and proof to one Change Story; produce the presentation tier required by the audience without upgrading unsupported claims.

## Progressive surface routing

NodeKit's commands, contracts, and skills are an available capability catalog, not a default checklist.

- Start from the current user outcome and named proof. Load another surface only when its described trigger matches a current requirement, observed failure, or trust-boundary risk.
- Use `nodekit explain --for <stack>` when a named need exists and you do not know whether NodeKit already owns it. In that output, `applies` means available for the stack, not required for the change.
- Check the active skill manifest before invoking a sibling skill. If an optional skill is absent, continue through the core workflow; do not recreate it as prompt prose.
- Run a gate only at the stage exit it protects. Do not front-load production, presentation, concurrency, or migration ceremony into an unrelated patch.
- Prefer one existing owner over a parallel contract, registry, prompt, or compatibility path.

## Audience rule

The reviewer's stack is a fact to be sourced, not inferred. A document the user already holds beats a direct statement, which beats public web, which beats a guess. If it remains a guess, label it as such. A technology switch must cite evidence at least as strong as the evidence that established the original choice.

## Sponsor rule

A dependency in `package.json` is not sponsor usage. Each sponsor needs an official-source research note, deterministic fixture, bounded live smoke, visible role in the main workflow, and sanitized receipt.

## Time policy

- Measure research, scaffold, install, compile, implementation, deterministic gates, live model, browser QA, deployment, and final proof independently.
- Treat 30 minutes as a target gate, not a reason to falsify evidence or skip safety.
- At 15 minutes, freeze the core workflow and defer side quests.
- At 22 minutes, stop aesthetic expansion and run the full proof ladder.
- If the run exceeds 30 minutes, preserve the actual duration and top friction causes; never rewrite timestamps.

## Secret and approval policy

Read credentials from environment references only. Never print values or persist secrets in source, manifests, YAML, browser bundles, logs, or receipts. Remove temporary process variables after the bounded call. Never weaken an evaluator or substitute a different implementation in benchmark mode. Pause for paid activation, destructive changes, production migrations, public posting, or deployment unless explicitly authorized.
