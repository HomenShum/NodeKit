# NodeKit idea-to-reality principles

This is the compact operating doctrine for turning a real problem into a small, useful, improving
product with NodeKit. It is not another framework layered over NodeKit. It explains how to use the
existing Builder Journey without letting the product, interface, agent, or proof system become the
work instead of serving the work.

The format is deliberately operational. Every principle has a trigger, a decision rule, an action,
proof, and an exception. A principle that cannot change a decision is decoration.

## The whole method in 90 seconds

1. Find one person with one recurring, consequential job.
2. Observe how they do it now, including workarounds and failure costs.
3. Freeze the smallest useful outcome and everything that is not part of it.
4. Build one complete path from real input to an inspectable artifact.
5. Make the artifact primary; reveal agent machinery only when it helps the next decision.
6. Let agents perform reversible work automatically through the same typed operations people use.
7. Require explicit human authority at consequence boundaries.
8. Test the real journey across failure, recovery, concurrency, mobile, and sustained use.
9. Diagnose failures at their first bad boundary and rerun the exact failed case.
10. Launch the exact proved revision, observe real use, and promote one bounded learning.

The loop is:

```text
DECIDE -> BUILD -> EXPLAIN -> LAUNCH -> LEARN
   ^         |                              |
   +---------+------------------------------+
```

Proof crosses every stage. It is an exit condition, not the product.

For each working session, use the same compact execution contract:

1. Inspect repository instructions, current state, ownership, and uncommitted work before editing.
2. Name one user outcome and the observation that will prove it.
3. Trace the symptom upstream before choosing a fix.
4. Keep a short sequenced plan; parallelize only independent evidence gathering.
5. Make the smallest change that fixes the governing mechanism.
6. Replay the named proof and one realistic counterexample.
7. Have a fresh judge inspect the diff, raw artifacts, and claimed verification.
8. Record the decision, limitation, rollback, and next highest-impact action.

## Where this doctrine came from

NodeVideo was the field test. It started with strong editing, pose, model-routing, proof, and agent
capabilities, but the product became harder to use as those capabilities accumulated. Productivity
improved when the work moved back toward one creator job, one canonical artifact, a smaller mobile
surface, shared human/agent operations, durable recovery, honest model routing, and observable
before/after proof.

The economic constraint comes from Sahil Lavingia's *The Minimalist Entrepreneur*: start and learn,
solve a problem for a community, keep the operation tight, and protect finite money and energy.
NodeKit translates that founder discipline into a product-and-agent discipline: **build only the
smallest behavior that can earn the next piece of evidence.**

## 1. Start with a person and a job, not a product category

**Trigger:** someone proposes a product, platform, agent, dashboard, or integration.

**Decision rule:** no build is authorized until the team can name one reachable user, the job they
already attempt, the current workflow, the painful residual gap, and an observable better outcome.

**Action:** research in this order:

```text
user problem -> current workflow -> current tools -> adoption trigger -> integration point
             -> product shape -> deployment path -> distribution path -> technical composition
```

**Proof:** a real person, source, workflow artifact, or observed behavior supports each load-bearing
claim. An incumbent is neither a veto nor automatic validation; measure what remains unsolved.

**Exception:** a deterministic internal maintenance task may begin from a verified defect instead
of a market job.

## 2. Freeze the opportunity before writing product code

**Trigger:** the brief can reasonably produce two materially different applications.

**Decision rule:** the agent must not make product strategy implicitly while implementing.

**Action:** write an `OpportunityContract` containing:

- user and job;
- current pain and evidence;
- primary artifact;
- one success metric;
- explicit non-goals;
- authority and data boundaries;
- the observation that would stop or redirect the build.

Ask only questions whose answers alter this contract, security, cost, or an irreversible action.

**Proof:** implementation decisions trace back to the accepted boundary. Defaults are disclosed;
contradictions fail closed.

**Exception:** exploration may branch into disposable spikes, but no spike becomes the product
without an accepted boundary.

## 3. Build the smallest undeniable vertical slice

**Trigger:** scope expands into multiple personas, surfaces, workflows, or “future-proof” systems.

**Decision rule:** choose one path shaped as:

```text
real input -> agent decision -> tool-backed action -> measurable artifact -> visible proof
```

The slice must finish a user job. A polished shell, isolated model call, schema, or dashboard is not
a slice.

**Action:** at the midpoint of the timebox, freeze the workflow. Defer aesthetic expansion and
secondary integrations before they consume the proof window.

**Proof:** a first-time user can complete the job and reopen the result outside the agent chat.

**Exception:** a safety or data-integrity dependency may precede the slice when the slice cannot be
run responsibly without it.

## 4. Make one canonical artifact the center of the product

**Trigger:** chat, steps, traces, files, configuration, and dashboards compete for attention.

**Decision rule:** one accepted artifact is truth; every other surface is a projection, proposal,
control, or receipt.

**Action:** keep the artifact above chat, tools, and traces in the information hierarchy. Show:

- current accepted state;
- proposed delta on the same object;
- who or what produced the delta;
- evidence and failure disclosure;
- the next available action.

Do not create a separate “current step” area if status and progress belong naturally in the agent
conversation. Keep chat history visible. Show project files when they explain or recover the work,
not as a permanent competing workspace.

**Proof:** rendered artifact, exported artifact, receipt, and reopened artifact bind the same ID,
version, content hash, and content.

**Exception:** a specialist inspection mode may temporarily lead when the user explicitly enters
diagnosis or review.

## 5. Share primitives between people and agents

**Trigger:** an agent has a hidden mutation path, or the UI simulates changes that the runtime
cannot represent.

**Decision rule:** people and agents operate through the same small typed command set against the
same versioned artifact.

**Action:** represent edits as bounded proposals with base version, exact operation, affected
object, predicted result, evidence, and recovery. Reject stale proposals. Keep undo and rollback
real.

**Proof:** the same scenario succeeds through human interaction and agent invocation, produces the
same canonical state transition, and survives reload.

**Exception:** a read-only agent may use additional inspection tools that cannot mutate state.

## 6. Default to autonomy inside a consequence budget

**Trigger:** repeated confirmations create friction, or “auto mode” is proposed as blanket
permission.

**Decision rule:** auto-approve reversible, bounded, local actions. Stop at consequence boundaries,
not arbitrary tool boundaries.

**Usually automatic:** local analysis, deterministic transforms, reversible edits, tests, bounded
retrieval, drafts, and proof capture.

**Always explicit unless a standing grant exists:** paid activation, media or sensitive-data
egress, production writes, deployment, publication, account/identity choices, rights assertions,
destructive actions, and promotion of persistent rules.

**Proof:** the receipt states the authority source, scope, exact effect, rollback target, and what
was not authorized. “Automatic” must never be rendered as “human approved.”

**Exception:** a pre-existing standing policy may automate a higher-risk action only when the exact
rollback and observation gates are independently verified.

## 7. Spend complexity only where the user can feel it

**Trigger:** a new panel, mode, setting, service, schema, dependency, or agent role is proposed.

**Decision rule:** complexity must remove a measured failure or shorten the primary job. If the
benefit is merely architectural neatness or future possibility, defer it.

**Interface budget:**

- one dominant artifact or task per screen;
- one primary action per state;
- at most three top-level mobile destinations without measured need;
- advanced routing, model, scope, and transcript controls behind one disclosure;
- compact status in the workflow, not a dashboard about the workflow;
- empty, loading, degraded, populated, overflow, and recovery states designed together.

**System budget:**

- one owner for canonical state;
- one core service with several transports, never separate logic per transport;
- reuse existing packages when they cover the measured job;
- add a platform abstraction only after repeated consumers expose the same seam;
- delete or demote surfaces that users do not open.

**Proof:** compare time to first correct action, completion time, wrong turns, reprompts, help
requests, and successful recovery before and after the change.

**Exception:** hidden reliability complexity is justified when it prevents data loss, false claims,
security failures, or unrecoverable work.

## 8. Use references as evidence, not decoration

**Trigger:** a team says “make it like” another product or uses adjectives such as clean, modern,
premium, or intuitive.

**Decision rule:** a reference earns influence only through atomic observations tied to the same
user problem.

**Action:** record facts such as control count, hierarchy, dimensions, disclosure behavior,
interaction order, and recovery state. Convert them into a rule with `appliesWhen`,
`doesNotApplyWhen`, mechanism hypothesis, confidence, and source locator.

Use Mobbin and similar libraries to learn hierarchy and interaction patterns. Keep the generated
application's own visual language and trust rules.

**Proof:** before/after evidence shows that the borrowed rule improved the named task without
copying brand assets or importing irrelevant flows.

**Exception:** explicit visual imitation work may study appearance, but rights and provenance must
remain visible.

## 9. Test jobs and state accumulation, not isolated functions

**Trigger:** a test proves one function or one happy path and is being used to claim product
readiness.

**Decision rule:** verification must match the claim's evidence layer.

**Action:** exercise real personas and inputs across:

- happy path;
- malformed, missing, and unauthorized input;
- cancellation and recovery;
- stale and concurrent proposals;
- reload and cross-session resume;
- degraded providers and offline/local fallback;
- mobile layout and real device boundaries;
- burst/spike use;
- sustained use, bounded history, and state accumulation;
- export, reopen, and independent hash verification.

Use the proof ladder: schema/unit -> integration -> browser DOM -> rendered pixels -> real device ->
deployment identity -> live content signal -> observed user outcome. A lower rung cannot certify a
higher claim.

**Proof:** preserve raw inputs, artifacts, receipts, screenshots when visual, and exact commands.

**Exception:** a narrow library primitive can stop at its contract boundary if no higher-layer
claim is made.

## 10. Diagnose the first bad boundary

**Trigger:** a model, provider, agent, browser, deployment, or test fails.

**Decision rule:** a failure count and provider label are reports, not explanations.

**Action:** trace:

```text
symptom -> first good/bad boundary -> mechanism -> upstream cause -> missing guard -> root cause
```

For model work, separately inspect raw provider output, returned model identity, adapter/parser,
schema coercion, repair/fallback, compiler input, artifact, render, export, deployment, and live
state. Change one variable at a time.

**Proof:** rerun the exact failed scenario. Call it resolved only when that knockout case passes and
the surrounding system remains green.

**Exception:** an external outage may remain unresolved, but the product must expose the degraded
state honestly and preserve recovery.

## 11. Route models by the product's workload

**Trigger:** a model degrades, a free route disappears, a new model appears, or someone proposes a
generic leaderboard winner.

**Decision rule:** models are replaceable executors. Promote them using the application's own
scenarios, schema, latency, cost, safety, and evidence requirements.

**Action:** discover the full eligible catalog, record exclusion reasons, run bounded canaries,
benchmark realistic personas with repetitions, cap concurrency/time/body size, attempt one shared
repair policy, and keep fallback visible. Re-run automatically after catalog changes or canary
failure.

**Proof:** selected models complete the full required operation set without unsupported claims.
Persist the causal deep dive for every failed case; do not promote aggregate scores alone.

**Exception:** a fixed model may be required by regulation, customer contract, or a deliberately
frozen benchmark. Record that constraint.

## 12. Treat continuity as a verified state transition

**Trigger:** work continues after reload, device change, scheduled execution, compaction, or agent
handoff.

**Decision rule:** “resume” is not reloading chat text. It requires durable identity, bounded
working state, repository remeasurement, conflict detection, and a new checkpoint.

**Action:** persist decisions, active artifact and version, attempted approaches, blockers,
evidence requirements, pending approvals, and next action. Keep provider-private reasoning opaque.
Bound every collection, use eviction, cap external reads, time out calls, and hash canonical data
with sorted keys.

**Proof:** a fresh session restores the same case, detects stale state, recovers missing local-only
media or files honestly, and never invents successful work.

**Exception:** an intentionally ephemeral task should say that no resume contract exists.

## 13. Launch to learn, not to declare victory

**Trigger:** the artifact passes local checks or the team wants to add more capability before real
exposure.

**Decision rule:** after one credible slice, the next missing system is usually distribution and
observation, not more product intelligence.

**Action:** bind the chain:

```text
BuildEvidencePack -> StoryPack -> LaunchManifest -> platform receipt
                  -> ObservationPack -> one proposed learning rule
```

Lead communication with the human problem and visible transformation. Explain the mechanism after
the proof earns attention. Keep truth, identity, privacy, rights, final cut, publication, and
persistent-rule promotion human-gated.

**Proof:** observe a real outcome tied to the release and account for what was not observed. Use a
metric close to the user or business result, not only impressions or internal scores.

**Exception:** security and infrastructure products may begin with controlled consumers, but still
need an external user and consequence before claiming product learning.

## 14. Improve the harness, not the model

**Trigger:** a user repeatedly corrects the agent, the same friction returns across sessions, or a
team asks the agent to “get better.”

**Decision rule:** do not ask a model to improve itself. Improve the versioned harness around it:
instructions, context acquisition, tools, interaction states, recovery, tests, and proof.

**Action:** run one controlled loop:

```text
observe -> classify friction -> propose one repair -> isolate candidate
        -> replay same task/model/budget -> compare -> independently approve -> record
```

Compare time to first correct action, completion, interventions, reprompts, wrong turns, recovery,
and proof quality. Keep the baseline. The builder may propose a harness change; it may not approve
its own superiority claim.

**Proof:** the candidate improves or holds the protected task set and succeeds on a fresh-user or
fresh-agent canary without weakening the evaluator.

**Exception:** a provider regression may require model replacement first, but the incident still
becomes a harness test and routing rule.

## 15. Promote patterns only after repetition

**Trigger:** one application discovers a useful convention and someone wants it in NodeKit core.

**Decision rule:** application facts stay with the application. NodeKit receives only repeated,
portable behavior with a clear owner and conformance proof.

**Action:** preserve the first instance as evidence, test the second as comparison, and extract on
the third when the shared seam is visible. Prefer vocabulary, adapters, and conformance contracts
over vendoring an application's library or domain logic.

**Proof:** at least two consumers can swap implementations while preserving the same observable
contract; the extracted layer reduces duplication without creating dual truth.

**Exception:** a security or trust invariant may be centralized before three consumers when
divergence itself creates unacceptable risk.

## The anti-complexity gate

Before adding anything, answer these in order:

| Question | Default when unknown or no |
| --- | --- |
| Which exact user failure does this remove? | Do not build |
| Is it on the primary job path? | Defer or hide |
| Can an existing component own it? | Compose existing |
| Can we test it with a real scenario this session? | Timebox a spike; do not integrate |
| Can the user recover when it fails? | Add recovery before capability |
| Does it create another source of truth? | Redesign around the canonical artifact |
| Does it require a permanent new surface? | Try progressive disclosure first |
| What observation would cause removal? | Define the kill condition before shipping |

## Reusable records

### Opportunity card

```yaml
user: "one reachable person or role"
job: "what they are trying to finish"
current_workflow: "tools and sequence used today"
pain_evidence: "observed failure, cost, or workaround"
primary_artifact: "one inspectable result"
success_metric: "one outcome measure"
not_in_scope: []
authority_boundaries: []
kill_condition: "evidence that stops or redirects the build"
```

### Failure deep dive

```yaml
scenario: "exact persona, input, state, and goal"
symptom: "observable failure"
first_bad_boundary: "where good state became bad"
mechanism: "direct causal behavior"
upstream_cause: "changeable condition that allowed it"
missing_guard: "test or invariant that should have caught it"
repair: "smallest causal correction"
knockout: "exact failed scenario rerun and observed result"
residual_risk: "what remains unverified"
```

### Learning rule

```yaml
observation: "source-bound outcome"
applies_when: []
does_not_apply_when: []
proposed_rule: "one bounded change to future behavior"
confidence: "low | medium | high"
counterevidence: []
promotion_authority: "named human or independent gate"
stale_after: "fact that invalidates this rule"
```

## NodeVideo evidence map

These principles are grounded in shipped or replayed NodeVideo work, not reconstructed as a neat
story afterward:

| Field lesson | Evidence |
| --- | --- |
| One NodeAgent runtime and creator workspace beat parallel agent surfaces | [`48fa86d`](https://github.com/HomenShum/NodeVideo/commit/48fa86dc375a3347047c232b430a977dceb2fb92) |
| Mobile became usable after configuration moved behind disclosure and chat/files recovery stayed contextual | [`7c2fcc7`](https://github.com/HomenShum/NodeVideo/commit/7c2fcc7bcc6f8fb9935bfb32c4cc5e356dd1f65a) |
| Device QA needed durable, resume-safe state rather than a desktop viewport pretending to be Android | [`bb1b93a`](https://github.com/HomenShum/NodeVideo/commit/bb1b93ada28099ab730e0e2cd10b428597f7ce28) |
| Free-model routing became maintainable only after automatic workload-specific benchmarking | [`0bc0386`](https://github.com/HomenShum/NodeVideo/commit/0bc0386304d543da9b36d55491984f03d70602d0) |
| Model failures required boundary-level causal diagnosis and exact-case repair | [`d3ebe73`](https://github.com/HomenShum/NodeVideo/commit/d3ebe73bbfc8dac5b12458bb743a11118dc06efe) |
| A proposal summary could not safely authorize exact edits | [`62a99b3`](https://github.com/HomenShum/NodeVideo/commit/62a99b3ea8c6fbca9908dc86860df7428f3acf08) |
| Human and agent edits became legible when current, proposed, accepted, causal proof, and undo shared one timeline | [`3f9b5a6`](https://github.com/HomenShum/NodeVideo/commit/3f9b5a681dbd5a1e6ab1d8f39d2b0333d13aef5e) |

Copy the process, not NodeVideo's domain. A new NodeKit application does not inherit video editing,
pose tracking, OpenRouter, a three-tab mobile shell, or any NodeVideo visual style unless its own
user job earns them.

## Source note

- Sahil Lavingia, [*The Minimalist Entrepreneur*](https://www.penguinrandomhouse.com/books/652764/the-minimalist-entrepreneur-by-sahil--lavingia/). The publisher describes the book's operating direction as starting and learning, building a community before solving its problem, running a tight ship, and protecting money and energy.
- NodeKit's typed stage chain remains defined by [the Builder Journey inter-stage contract](JOURNEY_INTERSTAGE_CONTRACT.md).
- NodeKit's authority and proof behavior remains normative in [Platform Decisions](DECISIONS.md), [Evolution Ledger](EVOLUTION_LEDGER.md), and the source schemas. This document guides choices; it does not override those contracts.
