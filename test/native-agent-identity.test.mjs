import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NativeAgentIdentityError,
  createNativeAgentIdentitySnapshot,
  issueNativeAgentContinuationGrant,
  resolveNativeAgentSessionIdentity,
  verifyNativeAgentContinuationGrant,
  verifyNativeAgentIdentitySnapshot,
} from "../src/lib/native-agent-identity.mjs";

const timestamp = (seconds) => `2026-07-30T00:00:${String(seconds).padStart(2, "0")}.000Z`;

function candidate(overrides = {}) {
  return {
    ownerRef: "owner:nodekit",
    workspaceId: "workspace:nodekit",
    agentId: "agent:codex",
    nativeSessionId: "session:1",
    nativeSessionGeneration: 1,
    host: {
      hostId: "host:desktop",
      instanceId: "host-instance:desktop:1",
      authorityRef: "authority:desktop-owner",
    },
    credential: {
      credentialRef: "credential:desktop",
      generation: 1,
      expiresAt: timestamp(59),
    },
    peerId: "peer:nodebench",
    ...overrides,
  };
}

async function rotate(currentSnapshot, overrides = {}, options = {}) {
  const nextCandidate = candidate({
    nativeSessionId: `session:${currentSnapshot.nativeSessionGeneration + 1}`,
    nativeSessionGeneration: currentSnapshot.nativeSessionGeneration + 1,
    credential: {
      ...currentSnapshot.credential,
      generation: currentSnapshot.credential.generation + 1,
    },
    ...overrides,
  });
  const issued = await issueNativeAgentContinuationGrant({
    currentSnapshot,
    candidate: nextCandidate,
    issuedAt: options.issuedAt ?? timestamp(10),
    expiresAt: options.expiresAt ?? timestamp(40),
  });
  const consumed = options.consumed ?? new Set();
  const result = await resolveNativeAgentSessionIdentity({
    providerAvailable: true,
    currentSnapshot,
    candidate: nextCandidate,
    continuation: {
      token: issued.token,
      grant: issued.grant,
    },
    consumeContinuationToken: async (tokenHash) => {
      if (consumed.has(tokenHash)) return false;
      consumed.add(tokenHash);
      return true;
    },
    now: options.now ?? timestamp(20),
  });
  return { ...result, issued, consumed, nextCandidate };
}

function assertCode(error, code) {
  assert.ok(error instanceof NativeAgentIdentityError);
  assert.equal(error.code, code);
  return true;
}

// @nodekit-verifies inv:native-agent-session-identity#deterministic-owner-scoped-snapshot
test("owner creates a deterministic identity snapshot that carries no review or verdict authority", async () => {
  const first = await createNativeAgentIdentitySnapshot(candidate());
  const second = await createNativeAgentIdentitySnapshot(candidate());

  assert.deepEqual(first, second);
  assert.match(first.identityRef, /^native-agent-identity:sha256:[a-f0-9]{64}$/);
  assert.match(first.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(first.authority.canAssertReviewIndependence, false);
  assert.equal(first.authority.canIssueNodeProofVerdict, false);
  assert.equal(first.previousSnapshotHash, undefined);

  const verified = await verifyNativeAgentIdentitySnapshot(first);
  assert.equal(verified.verified, true);
});

// @nodekit-verifies inv:native-agent-session-identity#reconnect-does-not-rotate
test("desktop agent reconnects only to the exact persisted session, host, peer, and credential", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const result = await resolveNativeAgentSessionIdentity({
    providerAvailable: true,
    currentSnapshot,
    candidate: candidate(),
    now: timestamp(20),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.continuity, "reconnect");
  assert.equal(result.hostChanged, false);
  assert.equal(result.writable, true);
  assert.deepEqual(result.snapshot, currentSnapshot);

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: candidate({ nativeSessionId: "session:collision" }),
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_session_collision"),
  );
});

// @nodekit-verifies inv:native-agent-session-identity#rotation-consumes-bound-token-once
test("scheduled agent rotates with an exact continuation grant and a consumed-once token", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const rotated = await rotate(currentSnapshot);

  assert.equal(rotated.status, "ready");
  assert.equal(rotated.continuity, "rotate");
  assert.equal(rotated.hostChanged, false);
  assert.equal(rotated.snapshot.identityRef, currentSnapshot.identityRef);
  assert.equal(rotated.snapshot.previousSnapshotHash, currentSnapshot.snapshotHash);
  assert.equal(rotated.snapshot.nativeSessionGeneration, 2);
  assert.match(rotated.snapshot.snapshotHash, /^[a-f0-9]{64}$/);

  const verifiedGrant = await verifyNativeAgentContinuationGrant(rotated.issued.grant);
  assert.equal(verifiedGrant.verified, true);
  assert.equal(verifiedGrant.grant.currentSnapshotHash, currentSnapshot.snapshotHash);
});

// @nodekit-verifies inv:native-agent-session-identity#cross-host-handoff-is-explicit
test("inbox handoff rotates across hosts only when host and credential authority are grant-bound", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const rotated = await rotate(currentSnapshot, {
    nativeSessionId: "session:headless:2",
    host: {
      hostId: "host:headless",
      instanceId: "host-instance:headless:7",
      authorityRef: "authority:scheduled-runner",
    },
    credential: {
      credentialRef: "credential:scheduled",
      generation: 2,
      expiresAt: timestamp(59),
    },
    peerId: "peer:nodekit-inbox",
  });

  assert.equal(rotated.continuity, "rotate");
  assert.equal(rotated.hostChanged, true);
  assert.equal(rotated.snapshot.host.hostId, "host:headless");
  assert.equal(rotated.snapshot.credential.credentialRef, "credential:scheduled");
  assert.equal(rotated.snapshot.previousSnapshotHash, currentSnapshot.snapshotHash);
});

// @nodekit-verifies inv:native-agent-session-identity#stale-collision-and-skip-fail-closed
test("adversarial generations cannot roll back, collide, or skip lineage", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate({
    nativeSessionGeneration: 4,
    nativeSessionId: "session:4",
    credential: {
      credentialRef: "credential:desktop",
      generation: 4,
      expiresAt: timestamp(59),
    },
  }));

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: candidate({
        nativeSessionGeneration: 3,
        nativeSessionId: "session:3",
      }),
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_session_stale"),
  );

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: candidate({
        nativeSessionGeneration: 4,
        nativeSessionId: "session:other",
      }),
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_session_collision"),
  );

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: candidate({
        nativeSessionGeneration: 6,
        nativeSessionId: "session:6",
      }),
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_session_generation_gap"),
  );
});

// @nodekit-verifies inv:native-agent-session-identity#authority-cannot-drift
test("owner, workspace, agent, peer, host, and credential authority cannot drift during reconnect", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const attacks = [
    ["ownerRef", candidate({ ownerRef: "owner:foreign" }), "native_identity_scope_mismatch"],
    ["workspaceId", candidate({ workspaceId: "workspace:foreign" }), "native_identity_scope_mismatch"],
    ["agentId", candidate({ agentId: "agent:foreign" }), "native_identity_scope_mismatch"],
    ["peerId", candidate({ peerId: "peer:foreign" }), "native_peer_mismatch"],
    [
      "host",
      candidate({
        host: {
          ...candidate().host,
          instanceId: "host-instance:desktop:other",
        },
      }),
      "native_host_mismatch",
    ],
    [
      "credential",
      candidate({
        credential: {
          ...candidate().credential,
          generation: 2,
        },
      }),
      "native_credential_mismatch",
    ],
  ];

  for (const [label, nextCandidate, code] of attacks) {
    await assert.rejects(
      resolveNativeAgentSessionIdentity({
        providerAvailable: true,
        currentSnapshot,
        candidate: nextCandidate,
        now: timestamp(20),
      }),
      (error) => {
        assertCode(error, code);
        return true;
      },
      label,
    );
  }
});

// @nodekit-verifies inv:native-agent-session-identity#continuation-is-replay-resistant
test("one continuation token authorizes at most one concurrent rotation", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const nextCandidate = candidate({
    nativeSessionGeneration: 2,
    nativeSessionId: "session:2",
    credential: {
      ...candidate().credential,
      generation: 2,
    },
  });
  const issued = await issueNativeAgentContinuationGrant({
    currentSnapshot,
    candidate: nextCandidate,
    issuedAt: timestamp(10),
    expiresAt: timestamp(40),
  });
  let consumed = false;
  const consumeContinuationToken = async () => {
    await Promise.resolve();
    if (consumed) return false;
    consumed = true;
    return true;
  };
  const attempt = () =>
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: nextCandidate,
      continuation: issued,
      consumeContinuationToken,
      now: timestamp(20),
    });

  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assertCode(rejected.reason, "native_continuation_replayed");
});

test("a stalled continuation store times out instead of hanging an agent run", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const nextCandidate = candidate({
    nativeSessionGeneration: 2,
    nativeSessionId: "session:2",
    credential: {
      ...candidate().credential,
      generation: 2,
    },
  });
  const continuation = await issueNativeAgentContinuationGrant({
    currentSnapshot,
    candidate: nextCandidate,
    issuedAt: timestamp(10),
    expiresAt: timestamp(40),
  });
  let consumeSignal;

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: nextCandidate,
      continuation,
      consumeContinuationToken: async (_tokenHash, _grant, signal) => {
        consumeSignal = signal;
        return new Promise(() => {});
      },
      consumeTimeoutMs: 10,
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_continuation_consume_timeout"),
  );
  assert.equal(consumeSignal.aborted, true);
});

// @nodekit-verifies inv:native-agent-session-identity#continuation-expiry-and-binding
test("expired, mismatched, and credential-rollback continuation attempts fail before consumption", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  const nextCandidate = candidate({
    nativeSessionGeneration: 2,
    nativeSessionId: "session:2",
    credential: {
      ...candidate().credential,
      generation: 2,
    },
  });
  const issued = await issueNativeAgentContinuationGrant({
    currentSnapshot,
    candidate: nextCandidate,
    issuedAt: timestamp(10),
    expiresAt: timestamp(30),
  });
  let calls = 0;
  const consumeContinuationToken = async () => {
    calls += 1;
    return true;
  };

  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: nextCandidate,
      continuation: issued,
      consumeContinuationToken,
      now: timestamp(31),
    }),
    (error) => assertCode(error, "native_continuation_expired"),
  );
  await assert.rejects(
    resolveNativeAgentSessionIdentity({
      providerAvailable: true,
      currentSnapshot,
      candidate: nextCandidate,
      continuation: {
        token: `${issued.token}tampered`,
        grant: issued.grant,
      },
      consumeContinuationToken,
      now: timestamp(20),
    }),
    (error) => assertCode(error, "native_continuation_token_mismatch"),
  );
  assert.equal(calls, 0);

  await assert.rejects(
    issueNativeAgentContinuationGrant({
      currentSnapshot,
      candidate: {
        ...nextCandidate,
        credential: {
          ...nextCandidate.credential,
          generation: 0,
        },
      },
      issuedAt: timestamp(10),
      expiresAt: timestamp(30),
    }),
    (error) => assertCode(error, "native_credential_stale"),
  );
});

// @nodekit-verifies inv:native-agent-session-identity#provider-outage-is-read-only
test("provider outage preserves verified identity for display but refuses writable continuity", async () => {
  const currentSnapshot = await createNativeAgentIdentitySnapshot(candidate());
  let consumed = false;
  const result = await resolveNativeAgentSessionIdentity({
    providerAvailable: false,
    currentSnapshot,
    candidate: candidate(),
    consumeContinuationToken: async () => {
      consumed = true;
      return true;
    },
    now: timestamp(20),
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.reasonCode, "IDENTITY_PROVIDER_UNAVAILABLE");
  assert.equal(result.writable, false);
  assert.equal(result.continuity, undefined);
  assert.deepEqual(result.snapshot, currentSnapshot);
  assert.equal(consumed, false);
});

// @nodekit-verifies inv:native-agent-session-identity#identity-cannot-assert-review-authority
test("identity snapshots reject injected review independence or NodeProof authority", async () => {
  const snapshot = await createNativeAgentIdentitySnapshot(candidate());
  await assert.rejects(
    verifyNativeAgentIdentitySnapshot({
      ...snapshot,
      reviewSeparation: "independent-model",
    }),
    /must NOT have additional properties/,
  );
  await assert.rejects(
    verifyNativeAgentIdentitySnapshot({
      ...snapshot,
      authority: {
        canAssertReviewIndependence: true,
        canIssueNodeProofVerdict: false,
      },
    }),
    (error) => assertCode(error, "native_identity_authority_invalid"),
  );
});

// @nodekit-verifies inv:native-agent-session-identity#burst-and-sustained-lineage
test("burst grants remain unique and sustained rotations retain exact single-step lineage", async () => {
  const initial = await createNativeAgentIdentitySnapshot(candidate());
  const burst = await Promise.all(
    Array.from({ length: 200 }, (_, index) =>
      issueNativeAgentContinuationGrant({
        currentSnapshot: initial,
        candidate: candidate({
          nativeSessionGeneration: 2,
          nativeSessionId: `session:burst:${index}`,
          credential: {
            ...candidate().credential,
            generation: 2,
          },
        }),
        issuedAt: timestamp(10),
        expiresAt: timestamp(40),
      }),
    ),
  );
  assert.equal(new Set(burst.map((entry) => entry.grant.tokenHash)).size, 200);

  let currentSnapshot = initial;
  for (let generation = 2; generation <= 250; generation += 1) {
    const result = await rotate(currentSnapshot, {
      nativeSessionGeneration: generation,
      nativeSessionId: `session:sustained:${generation}`,
      credential: {
        ...currentSnapshot.credential,
        generation,
      },
    });
    assert.equal(result.snapshot.previousSnapshotHash, currentSnapshot.snapshotHash);
    assert.equal(result.snapshot.nativeSessionGeneration, generation);
    currentSnapshot = result.snapshot;
  }
  assert.equal(currentSnapshot.nativeSessionGeneration, 250);
});
