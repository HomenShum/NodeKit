# NodeKit execution graph of bounded loops

## Decision

NodeKit compiles an approved project journey into a disposable execution graph. Caseflow remains
the only canonical lifecycle authority. The graph schedules work; it does not replace Cases, Tasks,
Artifacts, Proposals, Approvals, Receipts, or Evolution events.

The fixed node vocabulary is:

`CONTEXT`, `DECISION`, `BUILD`, `CHECK`, `REVIEW`, `BROWSER`, `AGENT_EVAL`, `AGGREGATE`,
`REPAIR`, `DELIVER`, and `HUMAN_GATE`.

Each node is one bounded loop with a maximum attempt count. The graph is acyclic. Repair is modeled
as an explicit bounded `REPAIR` node, not an unbounded orchestration cycle.

## Public surface

```js
import {
  compileExecutionGraph,
  createExecutionTrace,
  deriveRunnableFrontier,
  recordExecutionResult,
  verifyExecutionProof,
  renderExecutionDesignMarkdown,
  evaluateExecutionStrategyExperiment,
} from "@homenshum/nodekit/execution-graph";
```

`compileExecutionGraph` requires:

- an exact approved-journey artifact ref and digest;
- declared read sets, write sets, external systems, and authority;
- one expected artifact contract per node;
- typed success, failure, or always edges;
- qualification evidence for every `AGENT_EVAL`;
- explicit `HUMAN_GATE` presence before any external write;
- only disjoint nodes in a parallel group.

It returns deterministic graph identity and durable task handles. A stateless MCP server can return
those handles to a caller while Caseflow owns the durable project state.

## Runtime

1. Create an empty NodeTrace bound to the compiled graph.
2. Ask `deriveRunnableFrontier` for the current tasks.
3. Execute only those tasks.
4. Record exact content-addressed handoffs with artifact-ref and digest arrays, required schema,
   repository/deployment revision, authority, completeness, and limitations.
5. Repeat until a delivery or human gate is terminal.
6. Run `verifyExecutionProof`.

The current runnable frontier is the current task. The orchestrator does not invent a second status
model. Product surfaces should reduce the projection to plain-language states such as **working**,
**needs you**, **checking**, and **ready**.

## Verification boundary

- Production nodes produce artifacts.
- `CHECK`, `REVIEW`, `BROWSER`, and `AGENT_EVAL` consume exact artifacts on separate nodes.
- A fresh context window is not evaluator independence. NodeProof rejects a verifier that reuses a
  producing actor.
- `AGENT_EVAL` requires content-addressed qualification evidence.
- `AGGREGATE` may combine typed findings but cannot be terminal or decide release.
- `HUMAN_GATE` requires a human actor.
- NodeProof replays the full trace against the frontier rules before it can pass.

Verification runs in three scopes:

- **Embedded:** cheap deterministic checks inside a build loop.
- **Standalone:** narrow read-only semantic or runtime reviews after a coherent artifact exists.
- **Orchestrated:** required review lanes fanned out before a Caseflow stage-exit barrier.

## Browser lanes

- `headless-embedded`: deterministic product and artifact checks in an embedded browser.
- `headful-operational`: signed-in operational Chrome where existing session state is required.

The mode is part of the compiled node declaration; a run cannot silently substitute one for the
other.

## Generated `design.md`

`renderExecutionDesignMarkdown(graph)` produces the human-readable execution design. It is generated
from the compiled graph and begins with a non-authority warning. Never edit it as a second source of
truth; regenerate it after the canonical journey changes.

## First brownfield experiment

Run the same frozen brownfield task through:

1. a sequential single-agent workflow; and
2. the compiled graph workflow.

Record at least the predeclared minimum samples for both arms. Pass the raw runs to
`evaluateExecutionStrategyExperiment`. The evaluator reports unmodified success rate, median
duration, median cost, artifact completeness, human reprompts, and finding count. It fails closed on
insufficient samples and applies no score floors.

Graph execution is eligible for broader rollout only when every predeclared gate passes:

- zero write conflicts;
- 100% valid edge-artifact hashes;
- zero hidden task drops;
- zero false stage advancement;
- zero critical defects missed;
- proof-valid completion no lower than the sequential arm; and
- either median active wall-clock at least 20% lower, or at least 30% more confirmed defects with
  no increase in false findings.

The experiment verdict is evidence; it is not automatic promotion authority.

## Deliberate exclusions

- No graph-canvas product replacement.
- No Neo4j authority.
- No “parallel everything.”
- No reviewer self-approval.
- No fresh-context claim of independence.
- No unqualified cheap-model routing.
- No orchestrator edits to canonical records.
- No automatic promotion.
