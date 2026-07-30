# Stage-local execution graph

NodeKit compiles the current Caseflow stage into a disposable graph of bounded loops. The graph is
an execution projection, not a second workflow database:

```text
Caseflow case/run/current stage + stage-task artifacts
  -> deterministic compile
  -> verified execution edges
  -> conflict-free runnable frontier
  -> ordinary Caseflow artifacts, receipts, and stage advancement
```

`stages[]`, `currentStageId`, and `advanceStage` remain authoritative. A graph cannot approve a
proposal, derive a final verdict, or advance a Caseflow stage.

## Public contracts

| Contract | Role |
|---|---|
| `nodekit.stage-task/v1` | Canonical task description stored as a current-run Caseflow artifact with `kind: "stage-task"` |
| `nodekit.execution-graph/v1` | Deterministic projection of only those current-stage task artifacts |
| `nodekit.execution-edge-binding/v1` | Immutable binding from one graph edge to exact canonical artifact bytes and authority |
| `nodekit.runnable-frontier/v1` | Generated set of currently runnable, non-conflicting nodes and explicit blocked reasons |
| `nodekit.review-context/v1` | Verifier-derived reviewer separation; callers cannot assert independence |

The graph vocabulary is deliberately smaller than the general graph-of-loops proposal. A node is a
task, a read-only review, or a derived all-required barrier. Skills and application-specific work
execute inside tasks; they do not create new lifecycle authority.

## Commands

All three commands accept one repository-local JSON file. Inputs are capped at 4 MiB, and a
frontier accepts at most 1,024 bindings.

### Compile

```bash
nodekit graph compile --input graph-compile.json --json
```

```json
{
  "snapshot": {},
  "caseId": "case:current",
  "taskArtifactIds": ["artifact:inspect", "artifact:build"],
  "compilerVersion": "stage-local-v1"
}
```

The compiler rejects task artifacts from another case, run, or stage; noncanonical set ordering;
schema mismatches; duplicate task or edge identities; and cycles. Repeating the same compile
produces the same `graphHash`.

### Bind one edge

```bash
nodekit graph bind-edge --input edge-binding.json --json
```

```json
{
  "draft": {
    "graphId": "execution-graph:sha256:...",
    "graphHash": "...",
    "edgeId": "edge:...",
    "producer": {
      "nodeId": "node:inspect",
      "runId": "run:current"
    },
    "artifact": {
      "artifactId": "artifact:inspection-output",
      "schemaVersion": "candidate/inspection/v1",
      "contentHash": "..."
    },
    "repositoryBinding": {
      "remote": "https://github.com/example/repository.git",
      "commitSha": "0000000000000000000000000000000000000000",
      "treeHash": "..."
    },
    "authority": {
      "kind": "agent-produced"
    },
    "createdAt": "2026-07-29T12:00:00.000Z"
  },
  "graph": {},
  "snapshot": {},
  "repositoryState": {}
}
```

The command seals and verifies before returning the binding. Deterministic authority must cite a
Caseflow receipt that binds the exact artifact. Human-attested and NodeProof-verified bindings
require protected verifier callbacks in an embedding application; the file-only CLI refuses them
instead of accepting a caller-supplied claim.

### Derive the frontier

```bash
nodekit graph frontier --input frontier.json --json
```

```json
{
  "graph": {},
  "snapshot": {},
  "bindings": [],
  "repositoryState": {}
}
```

The frontier is empty when the graph's stage or case content hash is stale. Invalid bindings never
open an edge or barrier. Candidate nodes are sorted deterministically, then admitted only when
their declared write scopes do not overlap already selected nodes. Blocked nodes report
`MISSING_EDGE`, `INVALID_EDGE`, `AUTHORITY_REQUIRED`, `WRITE_CONFLICT`, `BARRIER_CLOSED`, or
`STAGE_NOT_CURRENT`.

## Review and trace boundaries

Review separation is derived from the builder/reviewer run, session, model, identity, protected
evaluator, and verified human-attestation boundaries:

- `same-context`
- `fresh-context`
- `independent-model`
- `independent-human`

A fresh process or browser thread is not automatically independent. Review tasks have an empty
write set, so the reviewer cannot modify the candidate it reviews. Existing review receipts carry
the `reviewContext`; NodeKit does not add a second `ReviewFinding` authority object.

NodeTrace uses these event names when a runner executes the projection:

- `node.started`
- `edge.consumed`
- `artifact.produced`
- `node.completed`
- `node.failed`
- `barrier.opened`
- `barrier.blocked`

The compiler and frontier remain pure. The runner that owns the real execution records these events
against its existing ordered NodeTrace trajectory; a compile command never fabricates runtime
progress.

## Explicit non-goals

- No graph canvas replaces the Builder Journey.
- No second task store or graph database is introduced.
- No graph node can approve, judge, or advance a stage.
- No generated `design.md` is introduced in this increment. Applications retrieve canonical
  `ReferenceObservation`, `DesignRule`, and `ScoreReceipt` records directly.
- No caller-controlled field can declare review independence.
- No headless browser result is promoted to signed-in operational truth.

## ActiveGraph boundary

ActiveGraph may be used as an offline canary for fork, diff, replay, relation, and counterfactual
policy experiments over immutable exported trajectories. It is not the production event log,
Caseflow store, execution authority, approval authority, or NodeProof verifier. Promotion beyond
that boundary requires a separate measured experiment and an Evolution Ledger event.

## Workspace and session identity boundary

Persistent native-agent workspace/session identity remains an open product capability, not a field
silently added to this graph. Today, graph validity binds a current Caseflow case/run/stage,
canonical artifact hashes, optional exact repository state, and verifier-derived review context.
It does not prove continuity across a desktop restart, scheduled/headless run, inbox handoff, or a
different native-agent host.

A future identity contract must independently prove:

1. owner-scoped workspace identity;
2. durable session lineage across restarts and handoffs;
3. explicit host and credential authority;
4. replay-resistant continuation tokens;
5. reviewer separation that cannot be upgraded by continuity metadata; and
6. degraded behavior when the native identity provider is unavailable.

Until that contract and its cross-host tests exist, NodeKit reports the limitation rather than
claiming persistent native-agent continuity.

## First falsifiable experiment

Run three paired trials of the same note-surface task:

- Arm A: current sequential NodeKit execution.
- Arm B: this stage-local graph with declared non-conflicting scopes, isolated worktrees, and one
  integration owner.

Keep the starting commit, models, agent harness, rules, fixtures, browser evaluator, and delivery
target fixed. Exclude provider, network, and human waiting from active wall-clock comparison.

Kill graph scheduling immediately on any write conflict, false stage advancement, or accepted
invalid edge binding. Also kill it when median active wall-clock reduction is below 20%. Retain the
edge verifier even if scheduling is killed.
