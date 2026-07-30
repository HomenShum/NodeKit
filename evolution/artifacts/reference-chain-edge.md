# Reference chain edge evidence

Candidate commit: `851ce7cf0d57c9e11ba2a136c351c1cc5a812891`

## Decision

NodeKit owns one content-addressed `nodekit.reference-chain-edge/v1`
contract for exact cross-application reference handoffs. The edge binds
canonical record endpoints, the current Caseflow state, repository identity,
and typed authority evidence. It does not own the records, store workflow
state, derive a verdict, or advance a stage.

Direct canonical record consumption remains the current design. No generated
`design.md`, graph database, feed authority, or new persistent store was added.

## Public surface

- `nodekit.reference-chain-edge/v1`
- `ReferenceChainEdgeV1`
- `ReferenceChainRecordRefV1`
- `buildReferenceChainEdge`
- `verifyReferenceChainEdge`
- `@homenshum/nodekit/reference-loop`

## Scenario evidence

`node --test test/reference-chain-edge.test.mjs` passed 5/5:

- a NodeRoom-shaped external-run-to-observation edge closed to one
  deterministic ID and digest regardless of authority-reference order;
- caller-supplied `pass`, `approved`, `verified`, and `verdict` fields were
  rejected at top-level and nested locations;
- source, target, Caseflow, repository, and authority-evidence drift each
  failed closed;
- tampered derived identity, missing authority evidence, and a 33-item
  evidence array were rejected; and
- 250 concurrent verifications produced one digest with no retained state.

`npm test` passed 534/534 repository tests and 8/8 component tests.

`npm run typecheck:public`, `npm run reference:schemas:check`,
`npm run registry:check`, `npm run audit:prod`, and `git diff --check`
passed. The workspace-wide ecosystem command verified this repository but
remained red for pre-existing absent or non-conforming sibling checkouts; it
is not evidence against this candidate and is not reported as green.

## Reliability audit

- **BOUND:** each attestation, receipt, and limitation array is capped at 32;
  record strings are capped; the verifier retains no collection.
- **HONEST_STATUS:** invalid or missing bindings throw typed, non-success
  errors; no status field exists on the edge.
- **HONEST_SCORES:** the edge contains no score or score floor.
- **TIMEOUT:** the builder and verifier perform bounded in-process work and no
  provider or network operation.
- **SSRF:** the contract performs no fetch; repository remote is identity
  metadata only.
- **BOUND_READ:** the verifier accepts already-resolved bounded references and
  reads no external body or file.
- **ERROR_BOUNDARY:** schema, digest, endpoint, Caseflow, repository, and
  authority failures are explicit `ReferenceLoopError` cases.
- **DETERMINISTIC:** canonical sorted-key hashing and sorted evidence sets
  produce stable IDs; burst verification checks determinism.

## Known limitations

- The contract is implemented and locally verified, but no downstream
  consumer is registered until its own integration lands.
- The edge compares exact references supplied by endpoint-specific verifiers;
  it does not replace those schema, signature, receipt, or NodeProof
  verifiers.
- NodeRoom integration and the 48-render cross-application proof remain
  separate consumer work.
- The stage-local graph and native workspace/session identity changes remain
  on separate human-gated pull requests.
- Canonical Evolution Ledger promotion requires a real signed human approval;
  this agent does not fabricate one.
