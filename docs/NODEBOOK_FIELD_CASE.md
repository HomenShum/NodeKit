# NodeBook field case: understand, preserve, consolidate, prove

NodeBook is the brownfield field case behind NodeKit's in-place product lane. The work began as a
rename and database migration from Mew/Ideaflow to NodeBook on Convex. It became a stronger lesson:
a replacement can be technically coherent and still fail because it replaces the product before
understanding the behavior and interface people already use.

This is evidence for the existing [idea-to-reality principles](IDEA_TO_REALITY_PRINCIPLES.md), not
a second doctrine or a NodeBook-specific template.

## Outcome

The final product preserved the original notebook interaction model while moving authenticated,
owner-scoped durable state to Convex and consolidating the agent into one NodeAgent engine. Safe
reversible work follows checkpoint -> automatic execution -> receipt -> whole-run Undo. Plan is an
optional preview. Destructive, external, identity, spend, and authority-changing effects retain a
human gate.

The production proof covered locked Notion-authored cases, signed runs, hybrid retrieval, reload,
conflict, Undo, phone and tablet journeys, honest provider failure, raw live identity, and a final
NodeRoom comparison. The last audit still found a stale parity ledger and one attribution gap,
which is why documentation drift became an executable test rather than another checklist.

## The sequence that actually happened

1. A new NodeBook/NodeAgent surface was built before the real Mew notebook was fully understood.
2. Visual comparison exposed that the result no longer looked or behaved like the original app.
3. Work restarted inside the existing application instead of continuing the replacement shell.
4. Two legacy agent generations, repository history, Notion cases, tools, events, commands,
   workflows, memory behavior, and inline interactions were inventoried.
5. Convex replaced the storage substrate without becoming a second product runtime.
6. Inline, sidebar, API, persistence, streaming, and evaluation paths converged on one engine.
7. Mandatory proposal UX was reduced to consequence-based authority: reversible work can continue;
   high-impact effects pause.
8. The original search -> graph traversal -> specialized workflow was restored with bounded hybrid
   lexical, semantic, and graph retrieval.
9. Typed bounded memory records replaced magic JSON memory nodes; visible graph projections remained
   reversible work products rather than canonical memory.
10. Maintained React Flow rendering replaced the temptation to hand-build a synapse graph in SVG.
11. Live evaluation and responsive recordings exposed failures that unit and build gates could not.
12. A final source-to-manifest audit corrected stale completion prose after runtime proof was green.

## Portable rules extracted from the work

| Encounter with reality | Rule carried into NodeKit | Existing owner |
| --- | --- | --- |
| The replacement shell was easier to build but no longer felt like the notebook | Migrate before rebuilding; the current product is the first reference | OpportunityContract and Builder Case |
| Legacy behavior was scattered across two engines, client actions, comments, and Notion cases | Inventory every active behavior before declaring replacement | Behavior Index plus source-derived capability manifest |
| Renaming happened before parity | Treat naming as the end of a behavior migration, not evidence that it happened | BuildEvidencePack and parity gate |
| Mandatory proposals made routine agent work cumbersome | Gate consequence and blast radius, not every operation | Governance risk assessment and authority tiers |
| Optimistic writes created false success and fragile recovery | Canonical writes require typed operations, exact versions, deterministic digests, receipts, conflicts, and Undo | Caseflow, ChangeEvidencePack, RollbackReceipt |
| Inline and sidebar implementations drifted | One engine may have many surfaces; tools, authority, events, and persistence remain shared | NodeAgent contract and Behavior Index |
| A graph visualization risked becoming another architecture | Graphs explain product and execution state; they do not own canonical state | Caseflow plus disposable projections |
| A custom neural-looking graph was visually tempting | Integrate maintained UI primitives before inventing infrastructure | ReferenceObservation -> DesignRule -> ScoreReceipt |
| A model leaderboard could not predict notebook workflow quality | Route models using locked application cases, failure canaries, latency, cost, and fallback honesty | Model-routing evidence and Evolution Ledger |
| A green suite missed stale completion prose | Documentation must be generated from or checked against executable truth | Capability drift verifier |

## Minimal UI/UX decisions

The interface became simpler by preserving its center rather than redesigning everything:

- The notebook remained the primary artifact.
- NodeAgent stayed adjacent and shared between inline and sidebar entry points.
- Empty, loading, populated, degraded, overflow, recovery, and completion states were defined
  before changing pixels.
- Every visible change received a stable labeled boundary over the real prior interface; neighboring
  regions were explicitly out of scope.
- Safe work displayed progress, evidence, receipt, and Undo instead of an approval form.
- Advanced model, trace, memory, and proof details stayed behind progressive disclosure.
- Anonymous entry reduced evaluation friction without weakening signed owner isolation.
- Phone and tablet were tested as exact independent viewports, not inferred from desktop CSS.
- React Flow owned interactive graph nodes and edges. Layout or analysis libraries remain optional
  until measured graph scale requires them.

This is the Minimalist Entrepreneur constraint translated into interface work: spend complexity
only when it removes an observed failure in the primary job.

## The repeatable brownfield lane

```text
1. Name one existing user job and one parity proof.
2. Capture the real current interface and repository state.
3. Generate the active capability inventory from source, history, tests, and real cases.
4. Label inactive stubs separately; never count them as working behavior.
5. Freeze product, state, agent, interface, authority, and proof boundaries.
6. Migrate one vertical slice inside the real application.
7. Converge duplicate surfaces on one canonical engine and store.
8. Auto-execute only typed, bounded, reversible operations after checkpoint.
9. Replay locked baseline cases plus degraded, concurrent, sustained, responsive, reload, and Undo paths.
10. Verify the exact deployed revision through the real route and identity.
11. Retire duplicate paths only after parity is observable.
12. Convert the surviving lesson into one scoped Evolution Ledger proposal.
```

The compact operational version is bundled with the NodeKit launch skill as
[existing-product adoption](../plugins/nodekit/skills/nodekit-launch/references/existing-product-adoption.md).

## Evidence ladder used

| Claim | Required observation |
| --- | --- |
| Legacy parity | Source-derived capability closure plus locked Notion cases |
| One engine | Source scan of all active entry points and durable writers |
| Durable migration | Signed owner-scoped Convex reads/writes and no fallback writer |
| Safe autonomy | Checkpoint, apply, reload, Undo, reload, and honest conflict paths |
| Retrieval parity | Lexical, semantic, and graph evidence in the same specialized journey |
| Responsive usability | Exact phone and tablet pixels, DOM, overflow, console, and interaction |
| Production identity | Ready deployment, exact revision, real URL, and raw live content signal |
| Completion | Independent diff/artifact audit plus documentation drift gate |

## Failure modes to interrupt

| Failure mode | Observable symptom | Default correction |
| --- | --- | --- |
| Replacement before understanding | The new app is coherent but no longer feels like the existing product | Stop; return to the real app and build the inventory |
| Scope gravity | Auth, storage, agent, UI, graphs, memory, and benchmarking become parallel products | Pick one parity journey and one integration owner |
| Proposal-heavy UX | The user repeatedly approves reversible local work | Move the gate to the first consequential effect |
| Debug-theater proof | A fixture route or internal dashboard is polished while the real route is unproven | Replay the signed production journey |
| Architecture from aesthetics | A graph or neural metaphor creates a second runtime | Keep it a maintained visual projection |
| Documentation outruns evidence | “Complete” and “pending” coexist after shipment | Derive a manifest and make drift fail the suite |
| False legacy parity | Commented stubs are counted as production capabilities | Classify active, inactive, stub, and deprecated separately |
| Model blame | Provider/model is blamed from the final bad artifact | Trace raw output through adapter, schema, execution, render, and live state |

## What stays application-specific

NodeKit should not absorb NodeBook's React Flow layouts, Convex note schema, Notion fixtures, model
catalog, notebook navigation, or visual style. It should preserve the portable behavior:

- brownfield-first inspection;
- capability closure;
- state and authority contracts;
- one-engine convergence;
- typed reversible effects;
- consequence-based gates;
- locked real-workflow evaluations;
- proof bound to the exact artifact and deployment;
- narrow learning promotion.

## Next external validation

The named adoption benchmark is **Fresh Builder In-Place Wedge Proof**. Give a fresh builder a frozen
pre-migration notebook, the NodeKit launch skill, and one journey: capture a note, reload, retrieve
it, traverse one relationship, invoke one specialized operation, Undo, and reload. Compare against
the same agent with no NodeKit.

The doctrine earns a productivity claim only after fresh builders show zero unapproved behavior
loss, zero false completion, complete capability ownership, complete required-state coverage, and
either fewer corrective prompts or lower active implementation-and-repair time. Provider and
network waiting must be reported separately. This benchmark is specified here; it has not yet been
run and is not claimed as proof.

## Repository evidence

- In-place parity architecture: [NodeBook `bb9d2a8`](https://github.com/HomenShum/NodeBook/commit/bb9d2a8c)
- Legacy workflow restoration: [NodeBook `e393865`](https://github.com/HomenShum/NodeBook/commit/e3938653)
- Sole durable agent writer: [NodeBook `0419f81`](https://github.com/HomenShum/NodeBook/commit/0419f815)
- Shared UI mutation boundary: [NodeBook `cd533b7`](https://github.com/HomenShum/NodeBook/commit/cd533b73)
- Maintained graph-renderer boundary: [NodeBook `c61e3d4`](https://github.com/HomenShum/NodeBook/commit/c61e3d47)
- Final responsive proof: [NodeBook `946270c`](https://github.com/HomenShum/NodeBook/commit/946270c5)
- Source-derived parity manifest and drift test: [NodeBook `05f4658`](https://github.com/HomenShum/NodeBook/commit/05f4658a)

External framing remains grounded in the official [Principles](https://www.principles.com/principles/)
and [The Minimalist Entrepreneur](https://www.penguinrandomhouse.com/books/652764/the-minimalist-entrepreneur-by-sahil--lavingia/)
pages. The field rules above come from the NodeBook work and executable repository evidence, not
from treating either book as a software specification.
