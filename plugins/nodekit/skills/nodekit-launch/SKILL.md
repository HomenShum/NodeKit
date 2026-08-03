---
name: nodekit-launch
description: Turn a business pain point, product purpose, hackathon idea, judging rubric, or required sponsor stack into a researched, scaffolded, evaluated, live-tested, browser-proven agent application. Use for empty-directory builds or safely adopting NodeKit into an existing project.
---

# NodeKit Launch

Build the smallest undeniable vertical slice. Keep an honest launch clock from intake through proof, aiming for 30 minutes and preserving remaining 2-hour and 4-hour hackathon runway.

Read the 90-second field card in the [idea-to-reality principles](../../../../docs/IDEA_TO_REALITY_PRINCIPLES.md), then read [the launch contract](references/launch-contract.md) before acting. Use the deeper principles only when their trigger matches the current decision; do not turn the manual into ceremony.

## Workflow

1. Start the launch timer. Capture the raw brief, deadline, judging rubric, sponsor requirements, and current directory state.
2. Research the audience before any design choice, and **ask for the primary document before inferring anything**. Who reviews this, what will they read it as, and what stack do they actually use? Ask the user directly for the job description, rubric, RFP, brief, or recruiter email — that document is usually already in their possession, and searching the web instead of asking is the failure this step exists to prevent. Record the result in `audience.yaml`; mark any technology you could not source as `evidenceTier: inferred, assumed: true` rather than stating it. Research that lands after the design is decided can only justify the build, not shape it.
3. Research current official sources for the user problem and every sponsor. Record links, package versions, authentication, pricing/limits, and one visible contribution to the demo.
4. Select one workflow shaped as `input -> agent decision -> tool-backed action -> measurable artifact -> visible proof`. Prefer a real metric and a reversible experiment.
5. Compile the prose into `hackathon.yaml`. Ask only questions whose answers materially change the product, security model, or irreversible action.
6. For an empty target, run `nodekit create --local-proof`; add `--package-manager pnpm` when pnpm is available and appropriate. For an existing target, run `nodekit adopt` and inspect its collision receipt before accepting changes.
7. Run `nodekit compile` and `nodekit inspect`. Confirm the filesystem-discovered tools, skills, integrations, fixtures, evals, provider, secret references, and config hash.
8. Implement one end-to-end surface. Preserve one execution path for the no-key demo, live provider, browser, and evals.
9. Read and run the sibling `nodekit-qa` skill. Establish the deterministic floor, strict live-provider smoke, and the critical browser journey; test missing secrets, malformed input, reload/resume, repeated actions, narrow/mobile layout, and export/reopen.
10. Deploy only the exact tested revision and only with user authorization. Record URL, revision, environment identity, health, and a fresh-user journey.
11. Emit the release proof and launch timeline. Do not call the run production-proven if live, browser, deployment, or receipt evidence is absent.
12. Read and run the sibling `nodekit-present` skill. Bind the problem, product workflow, sponsor use, architecture, screenshots, and proof to one Change Story; produce the presentation tier required by the audience without upgrading unsupported claims.

## Audience rule

The reviewer's stack is a fact to be sourced, not inferred. A document the user already holds beats
a direct statement, which beats public web, which beats a guess. If it is still a guess, say so in
those words; do not state it. And a late reframe is not evidence: seeing what a reviewer builds and
reaching for a matching technology feels responsive, but a switch must cite evidence at least as
strong as whatever established the original choice. `nodekit audience check` enforces both.

## Sponsor rule

A dependency in `package.json` is not sponsor usage. Each sponsor needs an official-source research note, deterministic fixture, bounded live smoke, visible role in the main workflow, and sanitized receipt.

## Time policy

- Measure research, scaffold, install, compile, implementation, deterministic gates, live model, browser QA, deployment, and final proof independently.
- Treat 30 minutes as a target gate, not a reason to falsify evidence or skip safety.
- At 15 minutes, freeze the core workflow and defer side quests.
- At 22 minutes, stop aesthetic expansion and run the full proof ladder.
- If the run exceeds 30 minutes, preserve the actual duration and top friction causes; never rewrite timestamps.

## Secret and approval policy

Read credentials from environment references only. Never print values. Remove temporary process variables after the bounded call. Pause for paid activation, destructive changes, production migrations, public posting, or deployment unless explicitly authorized.
