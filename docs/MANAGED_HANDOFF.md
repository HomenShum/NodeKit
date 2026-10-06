# Verify a source note before closing its task

A reviewer wants an assistant to quote a supplied document revision. A host can finish its
response while citing the wrong revision, inventing a quote, or leaving review undone.
This local recipe keeps that response open until a different reviewer checks the exact source
and answer (a proof-gated handoff).

**A finished agent response is an artifact to verify, not evidence that the user's task is complete.**

## Run the recipe

From this source checkout, without credentials:

```bash
node reference-apps/managed-handoff.mjs
node --test test/managed-handoff.test.mjs test/caseflow.test.mjs test/execution-graph.test.mjs
```

The output first shows an active run at `verify` with no receipt, then a completed run with
one content-addressed receipt. The named proof is `MANAGED-HANDOFF-VERIFY-BEFORE-CLOSE-01`.
The tests also quote the actual checked-out execution-graph document.

## How a product can reuse the pattern

1. Create one Caseflow case/run and preserve the source text, revision and task criterion as
   canonical artifacts. Intake and execution authorization belong to the host application.
2. Accept one final host event. Store its quote and exact source binding, then enter the existing
   `verify` stage. Replaying the identical event changes nothing; a conflicting delivery fails.
3. Give a distinct reviewer the canonical note and source bindings. This recipe deterministically
   checks a literal quote against the exact source text; it does not judge the meaning of a summary.
4. Record `BUILD -> REVIEW -> DELIVER` with the existing execution graph. The writer's artifact
   flows directly to review, allowing NodeProof to reject a writer reused as reviewer.
5. Derive the verdict with `verifyExecutionProof`. Recheck case, current run, canonical artifact
   versions, content hashes and bytes before invoking Caseflow's existing `completeRun`.

The final receipt binds source, journey, graph, note, review and proof artifacts. An owner-approved
canonical edit invalidates the previous review even when it restores identical bytes: the reviewed
version changed. An unavailable reviewer uses the existing blocked exception. Missing review stays
at `verify`. A failed task is retained for inspection; create a corrected task rather than silently
relabel its failed evidence. There is no second queue, lifecycle, permission policy or status model.

## Scope and trust boundary

This is a repository recipe, not a new npm export or production adapter. It owns one synchronous
memory Caseflow instance per task. Source text, quote, event identity and actor identity are bounded;
each accepted step occupies one fixed slot, and duplicate bursts do not add artifacts or events.
Dispose of the instance after exporting its snapshot/receipt. A long-running host must supply its
own durable storage, retention and reconciliation. The repeated-delivery tests are bounded local
accumulation evidence, not production longevity or process-restart evidence.

The exposed `runtime` supports inspection and the existing owner proposal/edit workflow. All
callers in this process are trusted; it is not a security sandbox. Actor IDs represent identities
already authenticated by the host. Different caller-supplied strings do not prove different people.
No remote agent, browser, model, deployment, external send or publication is exercised.

## Conditional completion for asynchronous callers

A reviewer may finish after the owner has changed the task or its source. Pass the exact reviewed
state to the existing `completeRun` operation so its comparison and completion share the adapter's
transaction/mutation boundary:

```js
await runtime.completeRun({
  runId: reviewedRunId,
  actor: authenticatedReviewer,
  expected: {
    caseId: reviewedCaseId,
    caseInputHash: contentHash({ title: reviewedTitle, primaryJob: reviewedPrimaryJob }),
    artifactBindings: reviewedArtifactBindings,
  },
});
```

Each binding contains exactly `{ artifactId, canonicalVersion, contentHash }`. Supply the complete
reviewed canonical artifact set, including review/proof artifacts where the host uses them. The
adapter checks the owning case, its current run, current title/criteria hash and the exact artifact
IDs, versions and hashes before creating a completion receipt. An artifact edit then restoration
of identical bytes still changes its version and invalidates the review. The criteria hash compares
current values only; it is not a historical case-input revision certificate.

Only omitted/undefined `expected` preserves unguarded completion. A supplied null, unknown/missing
field, malformed binding, duplicate normalized ID or nonportable value rejects. IDs are trimmed;
hashes must already be lowercase SHA-256; versions must be positive safe integers. The guard is
copied, normalized, sorted and fingerprinted before asynchronous work, with the existing 8,192-item
and 768 KiB portable limits. Actual guarded artifact reads reject an 8,193rd artifact at acquisition,
instead of collecting everything and truncating it into a match.

An identical guarded retry reuses its original receipt without adding events or artifacts, even
after another run becomes current. A changed guard, changed effective actor or guarded/unguarded
retry mismatch rejects. The guard fingerprint is bound in the existing terminal event and receipt
event bindings. Existing unresolved-exception, pending-proposal and active-run checks still apply.
There is no new receipt schema or completion method. Older third-party adapters may ignore unknown
arguments: require matching guarded-completion conformance before relying on this optional field.

The memory adapter prepares the complete receipt and returned values before changing the task or
appending either terminal event. A long history can exceed the receipt's portable-size limit even
when the reviewed guard is small; that refusal leaves the case, run, history and receipts unchanged.
This prevents a serialization failure from leaving a completed task without its receipt. It does
not add history eviction or make the memory adapter durable.

The guard compares state; it does not authenticate the reviewer or decide whether the review passed.
Host authorization, independent review quality, durable session leases and external-effect recovery
remain separate responsibilities. There is no asynchronous generic `snapshot -> await -> completeRun`
wrapper that claims atomicity outside the adapter. Process success still means process success, and
the disposable synchronous recipe above remains unchanged.

The named contract proof is `MANAGED-HANDOFF-ATOMIC-CLOSE-01`. Memory tests, component emulator tests
and mocked PostgreSQL transaction checks are local contract evidence only. Actual isolated
PostgreSQL forced-order races, deadlines, rollback and lost-acknowledgment recovery remain a separate
required gate before claiming durable concurrency closure. The existing live conformance command
does not already establish those new scenarios. Existing memory Maps and event/idempotency history
remain unbounded; finite burst/sustained retry checks do not certify production longevity or retention.

Resource routing must select only already authorized execution resources. An agent's research
claim or feedback can inform a candidate improvement; it does not grant permission or promote a
skill. Reuse the existing [execution graph](EXECUTION_GRAPH_OF_LOOPS.md),
[native session continuity](NATIVE_AGENT_SESSION_IDENTITY.md), and protected skill-evaluation
contracts before adding host-specific integrations. Preserve research, approved procedures and
operational evidence as distinct kinds of information.

## Carry the handoff into an existing product

A developer connecting an assistant to a real product needs every screen and reviewer to use the
same saved task state. A chat can show an old proposal while a comparison card shows the new one,
or an operations badge can report a limit that never stops a request (host integration).
Keep one authoritative project record and require observations at the boundary that enforces it.

These are host acceptance requirements, not capabilities exercised by this local recipe:

- Bind each turn to the current case/run, confirmed requirements, unresolved questions, selected
  objects, exact source revisions and pending decisions. Re-read that record when resuming;
  browser recovery state and a graph view are projections, not cross-device authority.
- Use the existing guarded completion and proposal workflow for stale decisions and repeated
  deliveries. A proposed correction does not mark a failed check as passed; attach a retest of
  the exact corrected revision and retain the original failure.
- Keep three telemetry audiences distinct. Users need current work, waiting owner, partial
  results, changed output and the next decision. Developers need tool failures, latency,
  source coverage and model/prompt/tool versions. Product owners need completed user milestones.
  Missing cost or usage is unknown, not zero. Redact private inputs, message bodies and secrets;
  explanations are decision summaries, not private model reasoning.
- Trace a run to its project revision, input references, source observations, output artifacts
  and terminal status. A telemetry store does not become the business record. Where a backend
  owns a schema, generated client types still need runtime validation at the trust boundary.
- Verify context collection, domain constraints, evidence/calculations, authorization/durability,
  agreement between views, and the correction/retest loop separately. Deterministic checks own
  arithmetic, IDs and transitions; qualified reviewers assess whether evidence supports meaning.
  A model judge cannot replace those checks or supply a missing human grade.
- Same-client replay checks drift and remains dependent on the producing implementation. Reserve
  independent verification for a separate implementation with a meaningful negative control.
  Prove a timeout, budget or circuit breaker on the request path;
  a recorded metric or open-breaker badge alone does not establish enforcement.
- Name what was actually exercised: source recipe, packaged interface, deployed endpoint or
  production journey. Pin the tested revision and comparison range. A passing fixture does not
  prove an external integration, an accessible interaction or a deployed user outcome.

### Verify how evidence was read

A sourcing analyst comparing two supplier quotes needs the warranty exclusions before choosing.
A keyword hit can miss a restriction on the next page (retrieval acceptance).
The host must show which authorized evidence it read, omitted and used before grading the answer.

These are host acceptance requirements. **Own-data benchmark: NOT_RUN**; no model or architecture is selected.

- Bind the run to an immutable authorized corpus revision, document/source hashes, authority and
  scope. Maintain the source registry when revisions or permissions change.
- Test connector auth, response shapes, errors and acquisition coverage separately from source
  selection, queries/filters, reading depth and stopping quality; connector success cannot grade an answer.
- Declare the required read scope before processing content: filters, candidate document/chunk
  IDs and counts, source revisions, pagination status and limits. An exhaustive task requires the
  full declared scope; a smaller context-expansion baseline does not satisfy it. Budget exhaustion,
  missing pages or truncation leave the task partial or held, naming known unread IDs and an unknown remainder.
- Choose task-needed keyword, page, section, chapter or document depth within both global and
  per-document budgets, while preserving the declared coverage requirement.
- Verify processing coverage against actual tool returns and processing records bound to the
  task, scope and source/chunk revisions; a model's reading claim or tally is insufficient.
  Processing every listed item establishes listed-set coverage only. Evaluate whether the set
  includes the required evidence against a separately reviewed must-read reference.
- Record the exact evidence delivered to the decision stage: passage content, locations,
  relevant conditions and contradictions, and source bindings. Retrieval receipts or IDs alone
  do not prove delivery or interpretation. Check citation membership and identity deterministically;
  assess whether the passage supports the claim and applies to this task separately.
- Use existing action/evidence/decision summaries with exact locations and depth/stop choices; never require private chain-of-thought.
- Compare flat lexical, hybrid and optional hierarchical candidates on the same frozen cases,
  authorized corpus and budget, including unanswerable tasks, wrong revisions, misleading nearby hits
  and failed context expansion. Separate retrieval relevance/coverage from answer correctness;
  also test the decision stage with fixed supplied evidence to locate the first failing boundary.
  Record evidence locations, latency, cost, failures and omissions.
- Keep per-stage expected outputs and answer keys outside the agent-visible prompts and context.
  Include varied document density, a decisive clause outside the initial hit, a complete case
  paired with one required fact removed, and a draft/retired or wrong-scope source. Label synthetic
  data and distinguish supplied facts from inferred facts.
- Public evidence used within its license and expert-authored held-out cases are proxies, not
  customer-corpus completeness or production certification.
- Calibrate the rubric with domain experts and freeze rubric/judge versions within each epoch.
  Choose domain-specific under-reading/over-reading costs before the run, not universal weights.
- Route grading disagreements into reviewed candidates through the existing protected promotion
  contracts; disagreement alone never changes a canonical rule or passes a failed check.
- Use the existing exception/recovery workflow for incomplete reading or unsupported conclusions.
  Bound repair attempts and name the responsible owner, missing input and safe resume action.
  Human clarification and approval of an external tool action are different decisions; recheck
  current task/source bindings before either resume or completion.

Public proxy examples: [BEIR](https://github.com/beir-cellar/beir) for heterogeneous retrieval,
[Qasper](https://allenai.org/open-data) for full-paper evidence QA, and
[BRIGHT](https://github.com/xlang-ai/BRIGHT) for reasoning-intensive retrieval.

Preserve the working lockfile and existing product primitives when adapting this recipe. Add a
provider, transport, UI library or storage adapter only for a current requirement. External sends
need an authorized recipient and approved content; received material remains untrusted source data.
Host authentication, permissions, retention, durable recovery and real browser proof remain the
host's responsibility, as described above.
