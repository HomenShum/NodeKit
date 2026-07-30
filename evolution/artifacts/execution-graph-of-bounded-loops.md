# Execution graph of bounded loops evidence

## Decision

NodeKit now compiles an approved project journey into a disposable execution graph while Caseflow
remains the only canonical lifecycle authority.

The fixed node vocabulary is:

- `CONTEXT`
- `DECISION`
- `BUILD`
- `CHECK`
- `REVIEW`
- `BROWSER`
- `AGENT_EVAL`
- `AGGREGATE`
- `REPAIR`
- `DELIVER`
- `HUMAN_GATE`

Each node is a bounded loop. The graph is acyclic. Repair is explicit and attempt-bounded.

## Decision evidence

Source discussion:
`https://chatgpt.com/c/6a571625-3b68-83e8-ad1b-2ebe297528cc`

Implementation source commit:
`05a2c66`

The decision preserves these boundaries:

- Caseflow owns Cases, Tasks, Artifacts, Proposals, Approvals, Receipts, and Evolution events.
- Compiled graph, durable task handles, generated `design.md`, and runnable frontier are projections.
- Every edge handoff carries exact artifact-ref and digest arrays, schema, revision, authority,
  completeness, and limitations.
- Parallel groups are admitted only when read/write sets and external-system authority are disjoint.
- NodeTrace records execution events and NodeProof replays the full edge chain.
- Qualified evaluators are separate nodes; a fresh context window is not independence.
- Aggregators combine typed findings but cannot decide release.
- Browser nodes distinguish headless embedded checks from signed-in headful operational work.
- External writes require an upstream human gate.
- Automatic promotion remains disabled.

## Scenario evidence

The execution-graph suite covers:

- a frozen brownfield journey from canonical context through build, three isolated verification
  lanes, aggregation, and delivery;
- the current runnable frontier as the durable next-task surface;
- aggregation blocked until every active incoming handoff exists;
- exact content-addressed artifact handoffs;
- generated design documentation marked as non-authoritative;
- self-verification rejection even with a nominally fresh evaluator context;
- unqualified evaluator rejection;
- unsafe parallel read/write overlap rejection;
- external writes without an upstream human gate rejection;
- bounded repair exhaustion;
- recomputed but forged trace rejection by deterministic replay;
- schema validation for graph, trace, NodeProof, and experiment verdicts;
- a measured sequential-versus-graph evaluator with raw success rates, medians, zero-tolerance seam
  gates, the 20%-wall-clock/30%-defect advantage rule, and fail-closed sample-size gating.

Repository regression evidence:

- 536 repository tests passed.
- 8 Convex component tests passed.
- Public and component TypeScript checks passed.
- Schema generation and registry checks passed.
- Production dependency audit reported zero vulnerabilities.
- Existing canonical Evolution ledger verification passed: 25 events, 24 invariants, 3 adoptions.

## Agentic reliability audit

- **BOUND:** nodes, edges, attempts, events, findings, artifact limitations, read/write sets,
  external systems, and experiment runs have explicit maxima.
- **HONEST_STATUS:** invalid events and incomplete terminals fail NodeProof; experiment success is a
  strict boolean.
- **HONEST_SCORES:** experiment rates and medians are computed from raw runs without score floors.
- **TIMEOUT:** the module performs no network or provider operation; executable nodes retain their
  own declared budgets.
- **SSRF:** the module performs no fetch.
- **BOUND_READ:** the module reads no external bodies and accepts only bounded in-memory contracts.
- **ERROR_BOUNDARY:** malformed graphs, traces, artifacts, authority, and measurements fail closed.
- **DETERMINISTIC:** graph IDs, edge IDs, task handles, trace digests, and experiment digests use
  sorted-key canonical hashing.

## Known limitations

- A real coding-agent sequential-versus-graph campaign on the same frozen brownfield task remains a
  separate evidence run; this change ships the bounded evaluator and contract, not fabricated
  performance evidence.
- Consumer-specific model qualification receipts and signed-in Chrome proofs remain consumer
  evidence, not portable package claims.
- Canonical Evolution promotion requires separately verified named-human approval.
