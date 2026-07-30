# Native agent workspace and session identity

NodeKit now carries persistent native-agent continuity as an authority contract separate from
Caseflow and the stage-local execution graph.

```text
owner + workspace + agent
          |
          v
stable identityRef
          |
          v
session generation + host authority + credential authority
          |
      continuation grant
          |
  atomic consumed-once token
          |
          v
next immutable snapshot
```

The identity contract answers **which owner-scoped native agent may continue a session**. It does
not answer which Caseflow stage is current, which graph node is runnable, whether a review is
independent, or whether NodeProof accepts a result.

## Public contracts

| Contract | Purpose |
|---|---|
| `nodekit.native-agent-session-identity/v1` | Immutable current identity snapshot for one owner/workspace/agent lineage |
| `nodekit.native-agent-continuation-grant/v1` | Short-lived, exact-current-snapshot and exact-next-session authorization |

The package exposes both contracts at `@homenshum/nodekit/native-agent-identity` and the root
entrypoint.

## Identity snapshot

Each snapshot binds:

- owner, workspace, and agent scope;
- stable derived `identityRef`;
- native session ID and exactly monotonic generation;
- host ID, host instance, and host authority reference;
- credential reference, credential generation, and optional expiry;
- optional peer identity;
- previous snapshot hash for rotations; and
- a recomputable canonical snapshot hash.

The schema requires:

```json
{
  "authority": {
    "canAssertReviewIndependence": false,
    "canIssueNodeProofVerdict": false
  }
}
```

Continuity metadata cannot upgrade a fresh-context review to an independent review and cannot issue
a NodeProof verdict.

## Reconnect

A reconnect reuses the exact generation. It succeeds only when the session, peer, host authority,
and credential authority still match the persisted snapshot.

Changing a session ID inside one generation is a collision. Changing a host or credential inside a
reconnect is an authority mismatch. Both fail closed.

## Rotation and cross-host handoff

A rotation advances exactly one generation. Skipped or stale generations are rejected.

Before rotation, the current authority issues a continuation grant that binds:

- the exact current snapshot hash;
- the stable identity reference;
- the exact next session generation and ID;
- the exact next host and credential authority;
- a random token hash;
- canonical issue and expiry times; and
- a recomputable grant hash.

The plaintext token is returned once and is not stored in the grant. The embedding application must
provide an atomic consumed-once token store. NodeKit verifies every binding and then calls that store
under a bounded execution timeout with an `AbortSignal`. The consumer must stop pending work and
roll back its transaction when that signal aborts. A token that was already consumed, cannot be consumed
atomically, or times out cannot rotate the session.

Cross-host handoff is therefore an explicit rotation whose grant names the next host and
credential. Host continuity is never inferred from a shared agent label.

## Provider degradation

When the identity provider is unavailable, `resolveNativeAgentSessionIdentity` returns:

```json
{
  "status": "degraded",
  "reasonCode": "IDENTITY_PROVIDER_UNAVAILABLE",
  "writable": false
}
```

An already verified snapshot may still be displayed. NodeKit does not mint a new identity,
reconnect, rotate, or consume a continuation token while degraded.

## Storage boundary

The package does not introduce another workflow store or retain an in-memory replay set. The
embedding application owns durable snapshots and the atomic consumed-token index. That index must
be bounded and retained at least through the maximum 24-hour continuation lifetime.

Caseflow remains canonical for lifecycle state. The execution graph remains a disposable
current-stage projection. Native identity remains a separate continuity and access boundary.

## Scenario coverage

`test/native-agent-identity.test.mjs` covers:

- deterministic owner-scoped creation;
- exact reconnect;
- same-host rotation;
- cross-host handoff;
- stale, colliding, and skipped generations;
- owner/workspace/agent/peer/host/credential drift;
- concurrent replay;
- token expiry and tampering;
- credential rollback;
- consumed-store timeout;
- provider degradation;
- review and NodeProof authority injection;
- a 200-grant burst; and
- 249 sustained rotations with exact previous-snapshot linkage.

These tests validate the portable contract. A consumer must still prove that its durable identity
provider, token-consumption transaction, credential system, and host attestations enforce the same
boundary.
