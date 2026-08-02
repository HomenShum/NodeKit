# NodeKit idea-to-reality principles

This is the operating doctrine for turning a real problem into a small, useful, improving product
with NodeKit. It is not another framework layered over NodeKit. It explains how to use the existing
Builder Journey without letting the product, interface, agent, or proof system become the work
instead of serving the work.

The first two sections are the field card. Start there and build. The remaining sections explain
the decisions when a case becomes ambiguous. Every principle has a trigger, decision rule, action,
proof, and exception. A principle that cannot change a decision is decoration.

Use progressive disclosure; do not turn all 16 principles into a ceremony:

- **Starting an idea:** read the 90-second method, then fill the Opportunity card.
- **Making a product or interface decision:** open only the principle whose trigger matches the
  current problem.
- **Adding a surface, service, setting, or agent:** run the anti-complexity gate first.
- **Something failed:** use the Failure deep dive before adding a workaround.
- **Something worked repeatedly:** write one Learning rule and apply the promotion rule.

This is a decision index, not a checklist. If a principle does not change the next action, stop
reading and build the smallest proof.

## The whole method in 90 seconds

1. Find one person with one recurring, consequential job.
2. Observe how they do it now, including workarounds and failure costs.
3. Freeze the smallest useful outcome, the working behavior that must survive, and everything that
   is not part of it.
4. Build or migrate one complete path from real input to an inspectable artifact.
5. Make the artifact primary; keep proof and debug machinery in an explicit inspection surface.
6. Let agents orchestrate reversible work through shared typed operations; let deterministic or
   specialist tools execute the work they own.
7. Require explicit human authority at consequence boundaries.
8. Test the real journey across failure, recovery, concurrency, mobile, and sustained use.
9. Diagnose failures at their first bad boundary and rerun the exact failed case.
10. Launch the exact proved revision, observe real use, and promote one bounded learning.

The stop rule is as important as the sequence: if the primary job works, the proof matches the
claim, and the next change does not remove an observed failure, stop building and expose the slice
to a real user.

The loop is:

```text
DECIDE -> BUILD -> EXPLAIN -> LAUNCH -> LEARN
   ^         |                              |
   +---------+------------------------------+
```

Proof crosses every stage. It is an exit condition, not the product.

When a working product already exists, use the brownfield lane instead of generating a replacement
shell:

```text
INSPECT -> INVENTORY -> BOUND -> MIGRATE IN PLACE -> PROVE PARITY -> RETIRE DUPLICATES
```

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

NodeSlide, NodeVideo, NodeVision, and NodeBook were the field tests. NodeSlide exposed the sharpest gap
between system-green and user-good: exact slide counts, valid schemas, broad component inventories,
and successful exports could still produce repetitive, semantically weak, or visually broken
decks. NodeVideo showed how capability accumulation can bury the creator's job. NodeVision showed
the value of completing one phone-sized path, including the handoff into the real device. NodeBook
showed that a technically cleaner replacement can still be the wrong product when it discards a
working interface or legacy behavior before understanding it.

Across them, productivity improved when the work returned to one user job, one canonical artifact,
a small surface, shared human/agent operations, durable recovery, causal diagnosis, and direct
inspection of the result a person actually receives.

Ray Dalio's useful pattern is to turn recurring encounters with reality into explicit decision
rules that others can inspect, test, and improve. The economic constraint comes from Sahil
Lavingia's *The Minimalist Entrepreneur*: start and learn, solve a problem for a community, keep the
operation tight, and protect finite money and energy. NodeKit translates both ideas into product
and agent discipline: **build only the smallest behavior that can earn the next piece of
evidence, then preserve what the evidence taught.**

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

**Trigger:** scope expands into multiple personas, surfaces, workflows, or "future-proof" systems.

**Decision rule:** choose one path shaped as:

```text
real input -> agent decision -> tool-backed action -> measurable artifact -> visible proof
```

The slice must finish a user job. A polished shell, isolated model call, schema, or dashboard is not
a slice. Define the terminal condition at the user boundary: a command that writes an intermediate
file but fails to validate, export, publish, or reopen the requested result has not finished the
job.

For an existing product, the slice must begin inside the real application. Inventory active
behaviors, tools, events, commands, data paths, journeys, failure states, and inactive stubs before
replacing any engine, store, or surface. Preserve behavior first; rename or retire only after parity
is observable.

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

Do not create a separate "current step" area if status and progress belong naturally in the agent
conversation. Keep chat history visible. Show project files when they explain or recover the work,
not as a permanent competing workspace.

Keep the primary product workflow separate from the proof and debugging workflow. Put raw traces,
provider diagnostics, detailed settings, and receipts in an explicit inspector reached from the
artifact; do not make users operate the inspector to finish the primary job.

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
real. The agent owns selection, sequencing, and recovery; a deterministic or specialist tool owns
execution whenever truth, precision, rendering, compilation, or domain safety depends on it. Do
not ask the model to imitate a tool the system can call and verify.

**Proof:** the same scenario succeeds through human interaction and agent invocation, produces the
same canonical state transition, and survives reload.

**Exception:** a read-only agent may use additional inspection tools that cannot mutate state.

## 6. Default to autonomy inside a consequence budget

**Trigger:** repeated confirmations create friction, or “auto mode” is proposed as blanket
permission.

**Decision rule:** auto-approve reversible, bounded, local actions. Stop at consequence boundaries,
not arbitrary tool boundaries.

**Action:** classify the exact effect before execution and route it by consequence:

**Usually automatic:** local analysis, deterministic transforms, reversible edits, tests, bounded
retrieval, drafts, and proof capture.

**Always explicit unless a standing grant exists:** paid activation, media or sensitive-data
egress, production writes, deployment, publication, account/identity choices, rights assertions,
destructive actions, and promotion of persistent rules.

**Proof:** the receipt states the authority source, scope, exact effect, rollback target, and what
was not authorized. "Automatic" must never be rendered as "human approved."

**Exception:** a pre-existing standing policy may automate a higher-risk action only when the exact
rollback and observation gates are independently verified.

## 7. Spend complexity only where the user can feel it

**Trigger:** a new panel, mode, setting, service, schema, dependency, or agent role is proposed.

**Decision rule:** complexity must remove a measured failure or shorten the primary job. If the
benefit is merely architectural neatness or future possibility, defer it.

**Action:** spend from two explicit budgets:

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
- integrate a validated package, service, or product primitive when it covers the measured job;
- prefer a maintained renderer, component, or protocol over bespoke infrastructure when it fits
  the interaction and authority boundary;
- rebuild only when evidence identifies a material gap, control boundary, or measurable advantage;
- add a platform abstraction only after repeated consumers expose the same seam;
- delete or demote surfaces that users do not open.

**Proof:** compare time to first correct action, completion time, wrong turns, reprompts, help
requests, and successful recovery before and after the change.

**Exception:** hidden reliability complexity is justified when it prevents data loss, false claims,
security failures, or unrecoverable work.

## 8. Use references as evidence, not decoration

**Trigger:** a team says "make it like" another product or uses adjectives such as clean, modern,
premium, or intuitive.

**Decision rule:** a reference earns influence only through atomic observations tied to the same
user problem.

**Action:** record facts such as control count, hierarchy, dimensions, disclosure behavior,
interaction order, and recovery state. Convert them into a rule with `appliesWhen`,
`doesNotApplyWhen`, mechanism hypothesis, confidence, and source locator.

Use Mobbin and similar libraries to learn hierarchy and interaction patterns. Keep the generated
application's own visual language and trust rules.

Acquire patterns, not pixels. Treat a validated incumbent as a candidate integration or reference
before rebuilding its primitive; preserve NodeKit ownership only where the product needs a distinct
contract, trust boundary, or measured advantage.

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

For generated artifacts, verify semantics and presentation separately. Check exact requested
counts, source-grounded claims, internal continuity, and required fields; then render every page or
state and inspect composition, hierarchy, overflow, repetition, and the artifact as a whole. A
component inventory does not prove meaningful utilization. A digest does not prove human visual
inspection. A regex does not prove unpredictability. When regression risk is material, temporarily
restore the old defect and prove the new scenario test turns red before returning to the repair.

For long-form-to-short-form work, treat compression as a conservation ledger rather than a summary
prompt. Freeze canonical claim IDs and decision questions first; assign each retained claim to an
explicit destination; require every claim to appear in rendered elements; and reconcile the final
artifact against the original questions. Measure layout diversity from rendered geometry while
allowing an explicitly named series to repeat on purpose. Validate each output in every renderer a
user will receive, because browser-clean does not imply PowerPoint-clean.

**Proof:** preserve raw inputs, artifacts, receipts, screenshots when visual, exact commands, and
the observed counterfactual for knockout tests.

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

**Decision rule:** "resume" is not reloading chat text. It requires durable identity, bounded
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
team asks the agent to "get better."

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

## 16. Bind completion to the exact artifact a human inspected

**Trigger:** a job produces rendered, exported, published, or otherwise human-consumed artifacts
and an automated validator reports success.

**Decision rule:** the builder cannot self-certify its own output. A finalizer may consume an
independent assessment, but it may not invent inspection receipts. Bind that assessment to the
exact render receipt and every page/image digest; any subsequent rebuild invalidates approval.

**Action:** clean generated output directories before rendering, render every required surface,
open every required page, and record page-indexed findings. Let pixel review veto a green build.
Keep canonical evidence text separate from concise display text, and make every reconciliation
gate understand both. When deterministic composition intent crosses a model/provider boundary,
validate and preserve it explicitly rather than silently dropping it during coercion.

```text
canonical inputs -> deterministic build -> validation -> clean dual render
                 -> independent pixel assessment -> digest-bound ledger
                 -> finalizer rechecks current bytes -> production receipt
```

**Proof:** the finalizer fails when an image, render receipt, assessment, evidence mapping, or
compression decision changes after inspection. A regression replay proves that the old semantic or
visual defect is rejected.

**Exception:** a non-visual backend artifact may replace page inspection with an independent raw
state/log audit, but the same digest binding and no-self-certification rule still applies.

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

### Existing behavior inventory

Use this before changing a working application, agent, database, or interaction model. Generate it
from source and tests where possible; do not rely on a manually remembered feature list.

```yaml
baseline_revision: "immutable existing-product revision"
primary_journey: "one real job that must continue to work"
active_behaviors: []
active_tools: []
stream_events: []
inline_commands: []
data_paths: []
failure_and_recovery_states: []
inactive_stubs: []
owners: {}
test_bindings: {}
proof_bindings: {}
unmapped_active_capabilities: []
retirement_gate: "parity proof required before a duplicate path is removed"
```

The inventory fails closed while `unmapped_active_capabilities` is non-empty. An inactive stub is
recorded as provenance, not promoted into a product promise.

### Minimal interface contract

Write this before changing a visible surface. Draw or capture the exact boundary being changed;
leave the rest of the screen out of scope.

```yaml
user_job: "the one action this surface helps finish"
change_boundary: "route, viewport, and stable CHANGE A/B region labels"
primary_artifact: "what deserves most visual weight"
primary_action: "one next action in this state"
states:
  empty: "invitation and safe first action"
  loading: "honest progress and cancellation"
  populated: "accepted artifact, evidence, and next action"
  degraded: "what failed, what remains safe, and recovery"
  overflow: "long content, narrow viewport, and truncation behavior"
removed_or_hidden: []
before_proof: "DOM + pixels + console at one named viewport"
after_proof: "same evidence set after the change"
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

### Completion receipt

```yaml
requested_outcome: "the user's words, paraphrased without expanding authority"
candidate_revision: "immutable commit or artifact identity"
observed_result: "what a person or external system actually received"
proof_rungs_run: []
knockout_or_counterexample: "the test that would fail if the old defect returned"
not_proven: []
rollback: "exact safe recovery target"
next_learning: "one observation, not another feature list"
```

## Field evidence map

These principles are grounded in shipped or replayed product work, not reconstructed as a neat
story afterward:

| Field lesson | Evidence |
| --- | --- |
| A broad visual component catalog did not prevent generic output; composition needed an executable grammar | [NodeSlide `9314e02`](https://github.com/HomenShum/NodeSlide/commit/9314e02) |
| Requested quantity and scene evolution required explicit invariants rather than prompt wording | [NodeSlide `c4fa486`](https://github.com/HomenShum/NodeSlide/commit/c4fa486) |
| Deck-level repetition had to fail closed on measured geometry | [NodeSlide `3e5594d`](https://github.com/HomenShum/NodeSlide/commit/3e5594d) |
| Dense source material needed an enforceable compression benchmark, not a generic summarize instruction | [NodeSlide `1c10be3`](https://github.com/HomenShum/NodeSlide/commit/1c10be3) |
| A rendered visual claim could not be accepted merely because the artifact schema was valid | [NodeSlide `1ccb51b`](https://github.com/HomenShum/NodeSlide/commit/1ccb51b) |
| A 72 -> 12 -> 4 transaction deck required canonical claims, decision-question reconciliation, exact counts, rendered-claim coverage, dual-render inspection, and a hash-bound production receipt | [NodeSlide `c39861a`](https://github.com/HomenShum/NodeSlide/commit/c39861a) |
| One NodeAgent runtime and creator workspace beat parallel agent surfaces | [NodeVideo `48fa86d`](https://github.com/HomenShum/NodeVideo/commit/48fa86dc375a3347047c232b430a977dceb2fb92) |
| Mobile became usable after configuration moved behind disclosure and recovery stayed contextual | [NodeVideo `7c2fcc7`](https://github.com/HomenShum/NodeVideo/commit/7c2fcc7bcc6f8fb9935bfb32c4cc5e356dd1f65a) |
| Model failures required boundary-level causal diagnosis and exact-case repair | [NodeVideo `d3ebe73`](https://github.com/HomenShum/NodeVideo/commit/d3ebe73bbfc8dac5b12458bb743a11118dc06efe) |
| A generic replacement shell lost the real notebook product; the successful path inventoried legacy behavior and migrated the existing application in place | [NodeBook `bb9d2a8`](https://github.com/HomenShum/NodeBook/commit/bb9d2a8c) |
| Inline, sidebar, API, durable execution, and evaluation surfaces converged on one engine before the duplicate writer was retired | [NodeBook `0419f81`](https://github.com/HomenShum/NodeBook/commit/0419f815) |
| Safe agent work became checkpoint -> automatic execution -> receipt -> whole-run Undo while destructive or external effects retained consequence gates | [NodeBook `cd533b7`](https://github.com/HomenShum/NodeBook/commit/cd533b73) |
| A prose parity ledger still drifted after green runtime tests; a source-derived capability manifest and drift test found and closed the mismatch | [NodeBook `05f4658`](https://github.com/HomenShum/NodeBook/commit/05f4658a) |

The complete NodeBook sequence, including the wrong turn, causal corrections, UI constraints,
production proof, and portable versus app-specific lessons, is recorded in
[the NodeBook in-place migration field case](NODEBOOK_FIELD_CASE.md).

Copy the process, not a product's domain. A new NodeKit application does not inherit slide
grammars, video editing, pose tracking, model providers, navigation count, or a visual style unless
its own user job earns them.

## Source note

- Ray Dalio, [*Principles*](https://www.principles.com/). The official site defines principles as reusable ways of dealing with reality and presents them as tools other people and organizations can inspect and apply.
- Sahil Lavingia, [*The Minimalist Entrepreneur*](https://www.penguinrandomhouse.com/books/652764/the-minimalist-entrepreneur-by-sahil--lavingia/). The publisher describes the book's operating direction as starting and learning, building a community before solving its problem, running a tight ship, and protecting money and energy.
- NodeKit's typed stage chain remains defined by [the Builder Journey inter-stage contract](JOURNEY_INTERSTAGE_CONTRACT.md).
- NodeKit's authority and proof behavior remains normative in [Platform Decisions](DECISIONS.md), [Evolution Ledger](EVOLUTION_LEDGER.md), and the source schemas. This document guides choices; it does not override those contracts.
