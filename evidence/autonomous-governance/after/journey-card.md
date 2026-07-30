# PR #32 journey proof: finish a brownfield change without losing control

Intended larger goal: a maintainer wants NodeKit to turn an approved brownfield journey into work that can run in parallel, remain bounded, and end in inspectable proof.

| Human question | Before (`ab7c9e6`) | After (PR #32 candidate) |
|---|---|---|
| Can NodeKit compile the intended journey? | No. The exact package import returns `ERR_MODULE_NOT_FOUND`. | Yes. The exact request returns a deterministic execution graph and runnable `deliver` task. |
| What remains canonical? | No execution projection exists. | `canonicalState` is `caseflow`; the graph is disposable. |
| Can the agent silently promote its own result? | Not applicable because the capability is absent. | No. `automaticPromotion` is `false`. |
| Is work bounded? | No graph-level contract exists. | The live response reports `maximumAttempts: 1` for the proof task; the full contract also bounds nodes, edges, events, and per-node attempts. |
| What happens if the operator dislikes the result? | Remove or abandon ad hoc work manually. | Revert the exact range to `ab7c9e6`; the rollback verifier proves that baseline behavior is restored. |

## Exact evidence

- Before request/response: `evidence/autonomous-governance/before/live-io.json`
- After request/response: `evidence/autonomous-governance/after/live-io.json`
- Rollback verification: `evidence/autonomous-governance/after/rollback-verification.json`
- Hosted pre-change CI state: `evidence/autonomous-governance/before/pr-checks.json`

## UI media

Not applicable. PR #32 changes a package runtime, schemas, tests, and generated design Markdown; it does not add or change a deployed product UI route. The journey and exact runtime I/O are the at-a-glance human proof surface.
