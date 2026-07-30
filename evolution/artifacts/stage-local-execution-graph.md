# Stage-local execution graph evidence

Candidate commit: `634e629e2661f8b5d5ec96a86a4a02bf1ce6d6d0`

## Decision

NodeKit compiles only the current Caseflow stage into a disposable execution graph. Existing
Caseflow state and `advanceStage` remain the sole lifecycle authority. The implementation does not
add a second task store, generated `design.md`, a new `ReviewFinding` authority object, or
persistent workspace/session identity.

ActiveGraph remains an offline, non-authoritative canary.

## Public surface

- `nodekit.stage-task/v1`
- `nodekit.execution-graph/v1`
- `nodekit.execution-edge-binding/v1`
- `nodekit.runnable-frontier/v1`
- `nodekit.review-context/v1`
- `nodekit graph compile`
- `nodekit graph bind-edge`
- `nodekit graph frontier`
- `@homenshum/nodekit/execution-graph`

## Scenario evidence

`node --test test/execution-graph.test.mjs test/public-api.test.mjs` passed 12/12:

- the same current-stage graph compiled 100 times to one hash;
- a future-stage task was rejected;
- 50 disjoint node pairs were admitted and zero of 50 overlapping pairs ran together;
- 20 independently mutated bindings were rejected and opened no downstream node;
- stale stage state produced an empty frontier and no stage authority;
- all six reviewer-separation cases were derived exactly;
- caller-supplied separation was rejected;
- the CLI compiled, bound, and derived a real frontier;
- malformed JSON, a mutated hash, stale input, and caller-asserted human authority failed closed;
- the graph carried no approval, verdict, or `advanceStage` field; and
- public package exports and types resolved.

`npm test` passed 536 repository tests and 8 component tests.

`npm run typecheck:public`, `npm run reference:schemas:check`, and `git diff --check` passed.

## Reliability audit

- **BOUND:** schemas cap nodes, edges, task inputs/outputs, scopes, frontier rows, and consumed
  bindings; CLI input is capped at 4 MiB and 1,024 bindings.
- **HONEST_STATUS:** command failures exit non-zero; invalid bindings are explicitly blocked.
- **HONEST_SCORES:** the graph contains no score.
- **TIMEOUT:** this slice performs no network or long-running provider operation.
- **SSRF:** this slice performs no network fetch and accepts no fetch URL.
- **BOUND_READ:** repository-local CLI JSON is size-checked before parsing.
- **ERROR_BOUNDARY:** command failures reach the existing CLI error boundary; frontier validation
  converts bad bindings into explicit blocked reasons.
- **DETERMINISTIC:** canonical hashes use sorted sets and stable content hashing; the 100-run test
  verifies byte-stable compilation.

## Known limitations

- Human-attested and NodeProof-verified edge bindings require a protected verifier supplied by an
  embedding runtime; the file-only CLI refuses them.
- The graph compiler and frontier are pure. The runner that performs real work must append the
  documented event vocabulary to its ordered NodeTrace trajectory.
- NodeBench and NodeRoom integration, the 48-render evidence chain, and three paired scheduler
  trials are not evidence of this platform commit and remain separate work.
- Persistent native-agent workspace/session identity remains unimplemented and is documented as a
  separate authority problem.
- Promotion of this agent-authored interpretation into the canonical Evolution Ledger requires a
  verified human approval; no approval is invented here.
