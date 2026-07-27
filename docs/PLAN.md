# NodeKit — the plan, product side up

Rewritten 2026-07-27, superseding the engineering-led version of the same date. That version
ordered work by subsystem readiness. This one orders it by the only question that matters:
**does NodeKit measurably reduce the founding pain, for a named user, on a real case?**
Everything engineering serves that question or waits.

**Status claims rot.** Checkable claims name their checking command; trust the command.

---

## 1. The user, decided

The record held three users at once — the builder, the hypothetical external builder, the
portfolio audience — and that ambiguity stalled prioritization. Decided now:

- **The customer** is a builder with a coding agent. Near-term that is one person: the owner,
  building with Claude Code / Codex.
- **The operator** is the coding agent itself. NodeKit's entry model has always said so: the user
  opens their coding agent and asks it to use NodeKit. NodeKit's direct user interface is the
  agent, not the human. This has a consequence the project under-used: **an agent can run the
  user journey for real, not as simulation** — provided it is a FRESH agent with no author
  context, holding only what a real user's agent would hold.
- **The beneficiary** is the person the built product serves — concretely, a real salon owner
  receiving a weekly brief. She never sees NodeKit and does not care about attestation. She cares
  that the numbers are right and traceable.
- **The acknowledged byproduct**: NodeKit is also proof-of-craft for the owner's FDE pipeline.
  That purpose is real, currently the best-served of the three, and is a byproduct — not the
  design target. Naming it stops it from silently steering scope.

External builders (user #2 of the old ambiguity) are **not a target** until the loop has closed
twice for user #1. NodeCase, the UI Design Graph, and the retrieval core remain parked behind
that same gate.

## 2. The product, as the user experiences it

The human writes one messy paragraph to their coding agent — the kind a real client sends:

> "My client runs a salon. She never knows if she's actually making money each week. Build her
> something simple she can look at Monday morning."

Without NodeKit, the agent improvises: it invents scope, makes product decisions mid-code, and
returns something plausible whose claims nobody can check. That improvisation loop is the
founding pain, and it is the owner's documented, felt pain — the reprompt loop.

With NodeKit, the agent is supposed to: surface an **OpportunityContract** (the decided boundary —
user, problem, primary artifact, rejected alternatives) *before* building; build against it; and
return work whose claims carry evidence. The human's "aha" is the moment the agent **asks for a
decision instead of quietly making it** — and the moment a claim in the output can be traced to a
source instead of taken on faith.

That is the product. Not the 85 schemas — the changed behavior of the agent the user already has.

## 3. The founding claim, made falsifiable

**Hypothesis:** given an underspecified real brief, a coding agent operating through NodeKit makes
measurably fewer unapproved product decisions, invents less scope, and asserts fewer unevidenced
claims than the same class of agent without it — without an unacceptable cost in time.

Until this is measured, NodeKit fails its own G input (measured residual gap) and its own research
procedure returns do-not-build-more. So this experiment precedes all new platform work.

### The closed-loop test (agent-operated, runnable now)

Two arms, same brief, fresh agents with no author context — the cwc fresh-context evaluator
pattern applied at product level, and the Builder Gym's baseline-vs-candidate shape applied to
NodeKit itself:

- **Arm A (control):** fresh agent, empty directory, the salon brief, no NodeKit.
- **Arm B (candidate):** identical, plus the packed NodeKit tarball and the one sentence a real
  user would add: "I heard NodeKit helps coding agents build products properly — use it."
  This is literally the `agent-process-packed-cli-from-empty` bootstrap mode the ease matrix
  already defines, run as a product experiment instead of a conformance test.
- **Judge:** a third fresh agent scores both directories against a rubric neither arm saw:
  (a) product decisions made without being surfaced for approval, (b) scope invented beyond the
  brief, (c) claims in the output with no evidence path, (d) whether a decided boundary exists as
  an artifact, (e) time/step cost. Verdict shape follows the gym: comparison, never promotion.

**What this closes and what it does not.** It closes the **operator loop** — can a user's agent
actually drive NodeKit from a bare directory to a decided, evidenced first slice, and does NodeKit
change the agent's behavior in the claimed direction? It does **not** close the **beneficiary
loop** — whether a real salon owner acts on the brief. One trial per arm is an anecdote; the
existing 15-trial no-cherry-pick campaign shape is the scale-up path if trial 1 is promising.

### Kill criteria (Reset template, applied to our own product)

- If Arm B shows **no reduction** in unapproved decisions / invented scope / unevidenced claims —
  or the agent cannot complete the NodeKit path without author coaching — the platform pitch
  fails its first real test. Response: fix the specific frictions the trial recorded and rerun
  once. A second failure kills "NodeKit as a product for others" and reclassifies the repo as
  internal tooling + portfolio, which are its currently-proven uses.
- If Arm B wins on discipline but costs >3x the steps, the finding is "right product, wrong
  weight" — the fix is subtraction, not features.

## 4. The loop, in order

### P0 — Unblock (owner, ~15 min)
Approve + record the `quality.yml` materiality event (commands in PROGRESS.md); merge PR #22.
Unchanged from the prior plan.

### P1 — Run the closed-loop experiment (agent-operated; no renderer dependency)
The prior plan put the tournament renderer first. **Product-side, that was wrong**: the user's
agent builds the app itself; the tournament is NodeKit-internal machinery. The renderer moves to
engineering debt (P3). The experiment above is runnable today and measures G directly.
**Exit:** a judged A/B verdict artifact with per-arm trajectories, and a friction list from Arm B
in the ledger's friction taxonomy. First run launched 2026-07-27.

### P2 — Close the beneficiary loop (one real human)
Take Arm B's slice (or its post-friction-fix rerun) to one real salon owner through the Mom's-Biz
network. She receives the Monday brief; we record whether she acts on it and what she distrusts.
**Exit:** one ObservationPack from a real human, one friction→gym→ledger repair cycle run on it,
all five journey stage receipts on one real `builder-case`.

### P3 — Engineering in service of what P1/P2 exposed
Only items that the trials or the sweep proved matter: the three indicted gates (artifact bytes,
`suite.green`, ease-proof greps), the tournament renderer + receipt producer (needed by EXPLAIN
once a real case exists), copy-gate wiring, the 233s fast-lane test. Each lands as a small PR with
its own before/after evidence.

### Found 2026-07-27: the ecosystem dashboard measures an unnamed checkout (folds into P3)

Reported by a peer session, verified here before acceptance. Three claims, all reproduced:
`nodekit dashboard` resolves NodeSlide to `nodebench_ai4/NodeSlide`, on branch
`codex/injectable-core` at `0669be4`, **130 commits behind its own origin/main**; that copy has
`nodekit.yaml:42 receiptSchema: null` while the live product repo has
`receiptSchema: nodeslide.conformance/v1` at the same line. The row's `MISSING` proof-schema verdict
and `6/8` score are therefore correct about the bytes they read and wrong about NodeSlide.
(One correction to the report: the live repo is currently on `feat/deck-data-rights` at `3d89185`,
not `main a8ae541`. The receiptSchema difference holds.)

Propagation matters more than the row: a downstream ranker reads ECOSYSTEM_STATUS.md as measured
signal and promotes that `6/8` above every P1, so the top work-queue item derives from a
130-commit-old branch.

**The defect is not the stale clone — it is that the report cannot say what it measured.**
`repositories.yaml` identifies a repository by `name` and `github` only. ECOSYSTEM_STATUS.md
contains **zero** occurrences of commit, sha, ref or branch in the whole file. This is the project's
own recurring bug class at ecosystem scale: a word's presence is not its role; an exit code's value
is not its cause; a turn count is not an identity; **a repository name is not a version.** A
dashboard printing eight columns of verdict without naming the bytes behind them is unfalsifiable
by construction — the one property this project refuses everywhere else.

Fix: every dashboard row records the resolved path, branch and commit it measured, and `repo check`
fails when a resolved checkout is behind its own tracking ref. `src/` is a material path, so this
needs an evolution event; deliberately NOT added to the already-blocked PR #22.

### P4 — Widen (second builder), only after P2
The retrieval core (`searchContext()`, SQLite+FTS first), the UI Design Graph as a generated
projection, NodeCase composition. Each requires: the loop closed twice, and a failing benchmark or
named demand justifying it — per the thread's own doctrine.

## 5. Owner decision queue

| # | decision | default if silent |
|---|---|---|
| 1 | Approve+record the quality.yml event; merge #22 | PR stays red |
| 2 | Name the real salon contact for P2 | P2 blocks after P1 |
| 3 | Legacy 22 events unattested vs re-approve | leave; the warning is the record |
| 4 | If Arm B loses twice: accept reclassification | plan says yes |
| 5 | H2 credential or stay H1-dev | stay H1; receipts say so |
| 6 | Should the workspace resolve NodeSlide to `D:/VSCode Projects/nodeslide`, or is `nodebench_ai4/NodeSlide` a deliberate second worktree? | dashboard keeps measuring the stale clone |
| 7 | parity-studio row reads `Commands FAIL · 0/8` — registered 2026-07-25, unexamined | stays failing |
