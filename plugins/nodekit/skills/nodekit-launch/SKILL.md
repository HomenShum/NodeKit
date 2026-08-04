---
name: nodekit-launch
description: Turn a business pain point, product purpose, hackathon idea, judging rubric, or required sponsor stack into a researched, scaffolded, evaluated, live-tested, browser-proven agent application. Use for empty-directory builds or safely adopting NodeKit into an existing project.
---

# NodeKit Launch

Build the smallest undeniable vertical slice. Keep an honest launch clock from intake through proof, aiming for 30 minutes and preserving remaining 2-hour and 4-hour hackathon runway.

Read the 90-second field card in the [idea-to-reality principles](../../../../docs/IDEA_TO_REALITY_PRINCIPLES.md), then read [the launch contract](references/launch-contract.md) before acting. Use the deeper principles only when their trigger matches the current decision; do not turn the manual into ceremony.

## Workflow

1. Start the launch timer. Capture the raw brief, deadline, judging rubric, sponsor requirements, and current directory state.
2. Research the audience before any design choice, and **ask for the primary document before inferring anything**. Who reviews this, what will they read it as, and what stack do they actually use? Ask the user directly for the job description, rubric, RFP, brief, or recruiter email — that document is usually already in their possession, and searching the web instead of asking is the failure this step exists to prevent. Record the result as a `nodekit.audience-research/v1` record (see [the AUDIENCE gate](../../../../docs/AUDIENCE_GATE.md)); mark any technology you could not source as `evidenceTier: inferred, assumed: true` rather than stating it. Research that lands after the design is decided can only justify the build, not shape it.
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

## The surfaces this repository already has, and when each one is due

Read this section before step 1. It exists because of a measured failure: on a real build, NodeKit
carried 116 schemas and this skill mentioned two of the concepts behind them, so every contract
needed a human who already knew it existed to ask for it. That is what "a lot of manual prompting"
means, and it is a routing failure rather than a coverage one. Nothing below is new work; it is a
map to work already shipped.

Run `nodekit explain --for <your stack>` first. It answers which surfaces apply to this project and
which do not, and it exists because reading the package manifest instead led to the conclusion
"Convex-shaped, skip it" and missed the entire design-contract surface for three hours.

**Before any work starts**

| Gate | Command | What it prevents |
|---|---|---|
| Workspace map | `nodekit workspace index` then `check` | Orientation by archaeology. Six frozen branches file every governance artifact under the question it answers (see [the WORKSPACE surface](../../../../docs/WORKSPACE_GATE.md)); the generated `WORKSPACE.md` is the first read in any repository, the way `nodekit explain` is the first command. On `adopt`, generate it alongside the collision receipt. A map that no longer matches the repository refuses. |
| Harness liveness | `nodekit preflight` | A plugin installed mid-session that needs a restart is inert for the whole run, and nobody finds out until hour six. Declare it in `harness.yaml`. |
| Open threads | `nodekit deferrals check` | A deliberate deferral that lives only in chat scrollback becomes a surprise three weeks later. `deferred.yaml`, status `open` blocks. |

**Before building any capability — the measurement gate**

`nodekit capability declare --capability <slug> --out <path>`, filled in, committed, BEFORE the
build. Then `nodekit capability settle` afterwards. The single highest-leverage question in a build
is *what will we measure that this helps with, and what result would make us delete it?* — and it is
only a bet if it is written down first. `settle` refuses a contract that postdates its own
measurement, because a kill condition authored once the number is known always passes.

Every `killCondition` clause is a structured threshold — `metric`, `comparator`, `value` — never
prose. Prose kill conditions get argued with; `below 4` gets evaluated. A clause naming a metric
nobody measured returns `insufficient`, so measuring only the flattering metric cannot report a pass.

A capability that beats every threshold and is called only by itself is **decorative**, which is a
verdict, not a warning. The middle state — it exists, it costs latency, it answers no question a
user asked — is the worst outcome to ship and is invisible to a purely numeric check.

**Before claiming any external capability** (continued): record it with the axis you tested named
explicitly — `dimensionTested: concurrent` next to a claim measured concurrently. A claim must not
travel to an axis nobody probed.

**Before shipping any agent loop — the production-agent gate**

`nodekit production-agent declare --application <slug> --out <production-agent.json>`, filled in before
the loop is built; `nodekit production-agent check --contract <file>` before deploy. This is the
senior-agent-engineer contract (see [the PRODUCTION-AGENT gate](../../../../docs/PRODUCTION_AGENT_GATE.md)):
the quantified business target, the HITL tier for every action (high-risk suspends for approval and
resumes after it), the fault-tolerance trio (interception, exponential backoff, a NAMED fallback),
a context strategy with a token budget, the three golden metrics by name (task-completion-rate,
tool-call-error-rate, p99-latency-ms), loop breaker, circuit breaker, cost fuse, judge-backed
regression, an automatic-rollback canary, a pinned model with a migration eval, and a propagated
trace id. The check refuses an unfilled template, a high-risk action that runs alone, and a golden
metric swapped for a flattering substitute. The demo-to-production gap is exactly this list, and a
responsibility living in chat scrollback is one the driven agent will not carry.

**Before making any library load-bearing**

Write `integrations/<lib>.yaml`: resolved version, docs fetched today, deprecations found, and what
introspecting the installed package showed. Never write integration code from memory — that is how a
primitive deprecated two versions ago ships. Docs describe the API; introspection describes *your*
installed copy; do both, in that order.

Answer `frameworkVsProtocol` explicitly. The default is to adopt the advertised framework, and
asking the question is what avoids it: three separate builds found the protocol underneath was ~40
lines, or that they would use a tenth of a framework and inherit its costs whole.

**Before claiming any external capability**

State which axis you measured. A concurrency claim backed by a sequential probe is how eight clean
sequential calls became "no meaningful rate limiting" and then a 429 at twelve concurrent. The claim
must not travel to an axis nobody tested.

**Before running concurrent sessions**

`nodekit sessions check --contract <session-contract.json>`, and it must pass before you launch
anything. It enumerates the contended manifests that actually exist in the repository and rejects a
plan leaving any of them unclassified — `sharedWrite` with an `arbiter`, or owned by exactly one
session. `defaults.outsideOwnedPaths` must be `read-only`, and `handback.required` must include
`discoveredFacts`.

The failure this catches is not sloppy ownership. It is ownership that is careful about the files
the work is about and silent about the files the work incidentally touches: two sessions launched
with genuinely clean, non-overlapping paths, both about to add dependencies, and `pyproject.toml`
and `uv.lock` belonging to neither. The plan looked complete because every file anybody had thought
about was assigned.

`discoveredFacts` is the field that compounds. A session that returns only files makes the next
session pay again for every discovery this one made.

**Before calling anything verified**

A green suite is *unfalsified by the author*, not verified. Adversarial review is a separate
instrument and finds a different class: on one build it returned seven P0s against a fully green
suite. `nodekit journey verify` requires adversarial evidence or a declared absence.

When a review finds a P0, the fix ships a test **and** that test must fail against the pre-fix
commit — `nodekit regression prove --baseline <pre-fix commit> --test <file> --name <pattern>`.
Tests written alongside a bug become its guardians: three tests once failed after a fix because
they had pinned the buggy behaviour. From HEAD, a test that guards a bug and one that guards
against it are both green, and only the baseline run tells them apart. A test that passes on both
sides is UNPROVEN, which is not a failure of the fix and is never a pass.

**When the tools themselves look wrong**

`nodekit preflight` reports whether this project's projected skills still match the installed
NodeKit, and how far its commit-pinned code graph has drifted from HEAD. Both are copies that
freeze: the skills are what an agent actually loads, and a stale call edge is indistinguishable
from a live one at the point of use. `nodekit skills sync` refreshes the skill copies —
`nodekit create` will not, because it refuses a non-empty directory.

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
