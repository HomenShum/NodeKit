# Native-agent session identity evidence

Candidate commit: `cc49b80bc53aeaf90bfe23562701482fb28d5958`

## Decision

NodeKit now exposes an owner- and workspace-scoped continuity contract for native agents. The
contract binds a stable agent identity to an immutable session generation, exact host authority,
exact credential authority, and a content-addressed predecessor. Rotation requires a short-lived
grant whose random token is consumed atomically exactly once.

This contract is deliberately separate from Caseflow and the stage-local execution graph. It has
no field or API that can advance a lifecycle stage, declare a graph node runnable, assert review
independence, or issue a NodeProof verdict.

## Public surface

- `nodekit.native-agent-session-identity/v1`
- `nodekit.native-agent-continuation-grant/v1`
- `@homenshum/nodekit/native-agent-identity`
- `createNativeAgentIdentitySnapshot`
- `verifyNativeAgentIdentitySnapshot`
- `issueNativeAgentContinuationGrant`
- `verifyNativeAgentContinuationGrant`
- `resolveNativeAgentSessionIdentity`

## Scenario evidence

`node --test test/native-agent-identity.test.mjs test/public-api.test.mjs` passed 17/17:

- deterministic owner/workspace/agent identity creation;
- exact desktop reconnect;
- same-host scheduled rotation;
- authority-bound cross-host inbox handoff;
- stale, colliding, and skipped generation rejection;
- owner, workspace, agent, peer, host, and credential drift rejection;
- concurrent replay where only one atomic consume succeeds;
- bounded token-store timeout with downstream abort;
- grant expiry, token tampering, and credential rollback rejection;
- provider outage returning an explicit read-only degraded state;
- rejection of injected review-independence and NodeProof authority;
- 200 unique grants in one burst; and
- 249 sustained rotations with exact predecessor linkage.

`npm test` passed 541 repository tests and 8 component tests after regenerating the derived behavior
index and repository map.

`npm run typecheck:public`, `npm run reference:schemas:check`, `npm run registry:check`,
`npm run audit:prod`, and `git diff --check` passed.

## Reliability audit

- **BOUND:** no replay collection is retained in the package; grants expire within 24 hours; the
  external consume operation is capped at 30 seconds.
- **HONEST_STATUS:** unavailable providers return `degraded` and `writable: false`; invalid
  continuity throws a typed error rather than returning success.
- **HONEST_SCORES:** the identity contract contains no score.
- **TIMEOUT:** the atomic-consume callback receives an `AbortSignal` and is bounded by a caller
  budget no greater than 30 seconds.
- **SSRF:** the contract accepts no URL and performs no fetch.
- **BOUND_READ:** the contract accepts bounded schema fields and reads no external body.
- **ERROR_BOUNDARY:** consumer failures, timeouts, replays, and binding errors fail closed through
  typed `NativeAgentIdentityError` codes.
- **DETERMINISTIC:** identity and snapshot hashes use canonical sorted-key hashing; repeated and
  sustained scenarios verify exact lineage.

## Known limitations

- The embedding application owns the durable identity provider and the atomic consumed-token
  transaction. Its implementation must honor the supplied abort signal and bound retention.
- Host and credential authority references are exact bindings, not portable proof of an operating
  system attestation. Consumers must verify their own host and credential issuers.
- Provider degradation permits display of a previously verified snapshot but never writable
  continuity.
- This package-level proof does not claim that every NodeKit consumer has integrated the contract.
- Canonical promotion of this agent-authored interpretation requires a separately verified named
  human approval; no approval is invented here.
