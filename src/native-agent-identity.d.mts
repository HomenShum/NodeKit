export interface NativeAgentHostAuthority {
  hostId: string;
  instanceId: string;
  authorityRef: string;
}

export interface NativeAgentCredentialAuthority {
  credentialRef: string;
  generation: number;
  expiresAt?: string;
}

export interface NativeAgentIdentityCandidate {
  ownerRef: string;
  workspaceId: string;
  agentId: string;
  nativeSessionId: string;
  nativeSessionGeneration: number;
  host: NativeAgentHostAuthority;
  credential: NativeAgentCredentialAuthority;
  peerId?: string;
}

export interface NativeAgentIdentitySnapshotV1
  extends NativeAgentIdentityCandidate {
  schemaVersion: "nodekit.native-agent-session-identity/v1";
  identityRef: string;
  previousSnapshotHash?: string;
  authority: {
    canAssertReviewIndependence: false;
    canIssueNodeProofVerdict: false;
  };
  snapshotHash: string;
}

export interface NativeAgentContinuationGrantV1 {
  schemaVersion: "nodekit.native-agent-continuation-grant/v1";
  grantId: string;
  identityRef: string;
  currentSnapshotHash: string;
  target: {
    nativeSessionId: string;
    nativeSessionGeneration: number;
    host: NativeAgentHostAuthority;
    credential: NativeAgentCredentialAuthority;
    peerId?: string;
  };
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  grantHash: string;
}

export class NativeAgentIdentityError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function createNativeAgentIdentitySnapshot(
  input: NativeAgentIdentityCandidate,
): Promise<Readonly<NativeAgentIdentitySnapshotV1>>;

export function verifyNativeAgentIdentitySnapshot(
  snapshot: NativeAgentIdentitySnapshotV1,
): Promise<{
  snapshot: NativeAgentIdentitySnapshotV1;
  snapshotHash: string;
  verified: true;
}>;

export function issueNativeAgentContinuationGrant(input: {
  currentSnapshot: NativeAgentIdentitySnapshotV1;
  candidate: NativeAgentIdentityCandidate;
  issuedAt: string;
  expiresAt: string;
}): Promise<
  Readonly<{
    token: string;
    grant: Readonly<NativeAgentContinuationGrantV1>;
  }>
>;

export function verifyNativeAgentContinuationGrant(
  grant: NativeAgentContinuationGrantV1,
): Promise<{
  grant: NativeAgentContinuationGrantV1;
  grantHash: string;
  verified: true;
}>;

export type NativeAgentIdentityResolution =
  | Readonly<{
      status: "ready";
      continuity: "created" | "reconnect" | "rotate";
      hostChanged: boolean;
      writable: true;
      snapshot: Readonly<NativeAgentIdentitySnapshotV1>;
    }>
  | Readonly<{
      status: "degraded";
      reasonCode: "IDENTITY_PROVIDER_UNAVAILABLE";
      writable: false;
      snapshot?: NativeAgentIdentitySnapshotV1;
    }>;

export function resolveNativeAgentSessionIdentity(input: {
  providerAvailable: boolean;
  currentSnapshot?: NativeAgentIdentitySnapshotV1;
  candidate: NativeAgentIdentityCandidate;
  continuation?: {
    token: string;
    grant: NativeAgentContinuationGrantV1;
  };
  consumeContinuationToken?: (
    tokenHash: string,
    grant: NativeAgentContinuationGrantV1,
    signal: AbortSignal,
  ) => boolean | Promise<boolean>;
  consumeTimeoutMs?: number;
  now: string;
}): Promise<NativeAgentIdentityResolution>;
