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

There is deliberately no asynchronous generic close helper. A durable adapter must verify the
current case/run and artifact versions and close within one transaction or equivalent conditional
operation. A `snapshot -> await -> completeRun` wrapper can race a newer source or review.
Process success still means process success; this recipe does not redefine global Caseflow closure.

Resource routing must select only already authorized execution resources. An agent's research
claim or feedback can inform a candidate improvement; it does not grant permission or promote a
skill. Reuse the existing [execution graph](EXECUTION_GRAPH_OF_LOOPS.md),
[native session continuity](NATIVE_AGENT_SESSION_IDENTITY.md), and protected skill-evaluation
contracts before adding host-specific integrations. Preserve research, approved procedures and
operational evidence as distinct kinds of information.
