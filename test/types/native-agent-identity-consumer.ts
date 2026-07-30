import {
  createNativeAgentIdentitySnapshot,
  issueNativeAgentContinuationGrant,
  resolveNativeAgentSessionIdentity,
  type NativeAgentIdentityCandidate,
  type NativeAgentIdentitySnapshotV1,
} from "@homenshum/nodekit/native-agent-identity";
import {
  verifyNativeAgentIdentitySnapshot,
} from "@homenshum/nodekit";

const candidate: NativeAgentIdentityCandidate = {
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
  },
};

const initial: NativeAgentIdentitySnapshotV1 =
  await createNativeAgentIdentitySnapshot(candidate);
await verifyNativeAgentIdentitySnapshot(initial);

const next = {
  ...candidate,
  nativeSessionId: "session:2",
  nativeSessionGeneration: 2,
};
const continuation = await issueNativeAgentContinuationGrant({
  currentSnapshot: initial,
  candidate: next,
  issuedAt: "2026-07-30T00:00:00.000Z",
  expiresAt: "2026-07-30T00:05:00.000Z",
});

const resolved = await resolveNativeAgentSessionIdentity({
  providerAvailable: true,
  currentSnapshot: initial,
  candidate: next,
  continuation,
  consumeContinuationToken: async () => true,
  now: "2026-07-30T00:01:00.000Z",
});

if (resolved.status === "ready") {
  resolved.snapshot.authority.canAssertReviewIndependence satisfies false;
  resolved.snapshot.authority.canIssueNodeProofVerdict satisfies false;
}
