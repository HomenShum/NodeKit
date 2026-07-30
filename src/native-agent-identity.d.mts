export type NativeWriteScope =
  | "read-only"
  | "direct-worktree"
  | "isolated-worktree";

export interface NativeRepositorySnapshot {
  canonicalRemote: string;
  commit: string;
  treeHash: string;
  dirty: boolean;
  dirtyWorkingTreeHash?: string;
}

export interface TrustedReceipt {
  ref: string;
  digest: string;
  operationNonceHash: string;
  verified: true;
}

export interface NativeCheckpointAdapterOutput {
  resumeCursorHash: string;
  repository: NativeRepositorySnapshot;
  traceDigest: string;
  artifactDigests: string[];
  receipt: TrustedReceipt;
  runHandle?: string;
  paused?: boolean;
}

export interface NativeWorkspaceV1 {
  schemaVersion: "nodekit.native-workspace/v1";
  workspaceId: string;
  ownerRef: string;
  caseId: string;
  repository: NativeRepositorySnapshot;
  writeMode: NativeWriteScope;
  authorityReceiptRef: string;
  createdAt: string;
  artifactRef: string;
  artifactDigest: string;
}

export interface NativeAgentSessionV1 {
  schemaVersion: "nodekit.native-agent-session/v1";
  sessionId: string;
  workspaceArtifactRef: string;
  workspaceArtifactDigest: string;
  adapter: {
    adapterId: string;
    adapterVersion: string;
    harnessVersion: string;
  };
  providerSessionIdHash: string;
  writeScope: NativeWriteScope;
  creationReceiptRef: string;
  creationReceiptDigest: string;
  createdAt: string;
  artifactRef: string;
  artifactDigest: string;
}

export interface NativeSessionCheckpointV1 {
  schemaVersion: "nodekit.native-session-checkpoint/v1";
  sessionArtifactRef: string;
  sessionArtifactDigest: string;
  sequence: number;
  previousCheckpointRef?: string;
  previousCheckpointDigest?: string;
  resumeCursorHash: string;
  repository: NativeRepositorySnapshot;
  traceDigest: string;
  artifactDigests: string[];
  adapterReceiptRef: string;
  adapterReceiptDigest: string;
  operationNonceHash: string;
  createdAt: string;
  artifactRef: string;
  artifactDigest: string;
}

export interface NativeProviderAdapter {
  start(
    input: {
      workspace: NativeWorkspaceV1;
      writeScope: NativeWriteScope;
      operationNonce: string;
    },
    signal: AbortSignal,
  ): Promise<{
    providerSessionIdHash: string;
    adapterVersion: string;
    harnessVersion: string;
    creationReceipt: TrustedReceipt;
    initialCheckpoint: NativeCheckpointAdapterOutput;
    runHandle: string;
  }>;
  checkpoint(
    input: {
      workspace: NativeWorkspaceV1;
      session: NativeAgentSessionV1;
      previousCheckpoint: NativeSessionCheckpointV1;
      operationNonce: string;
    },
    signal: AbortSignal,
  ): Promise<NativeCheckpointAdapterOutput>;
  resume(
    input: {
      workspace: NativeWorkspaceV1;
      session: NativeAgentSessionV1;
      checkpoint: NativeSessionCheckpointV1;
      operationNonce: string;
    },
    signal: AbortSignal,
  ): Promise<{
    providerSessionIdHash: string;
    resumeCursorHash: string;
    resumeReceipt: TrustedReceipt;
    newCheckpoint: NativeCheckpointAdapterOutput;
    runHandle: string;
  }>;
}

export interface NativeAgentSessionContext {
  caseflow: {
    ownerId: string;
    snapshot(): {
      cases: unknown[];
      runs: unknown[];
      artifacts: unknown[];
    };
    createArtifact(input: unknown): unknown;
    getCase?(caseId: string): {
      currentRunId: string | null;
      [key: string]: unknown;
    };
    getRun?(runId: string): {
      status: string;
      [key: string]: unknown;
    };
    listCanonicalArtifactContents?(input?: {
      caseId?: string;
      kind?: string;
      runId?: string;
      schemaVersion?: string;
      limit?: number;
    }): unknown[];
  };
  repository: {
    measure(input: unknown, signal: AbortSignal): Promise<{
      repository: NativeRepositorySnapshot;
      receipt: TrustedReceipt;
    }>;
    measureCurrent(input: unknown, signal: AbortSignal): Promise<{
      repository: NativeRepositorySnapshot;
      receipt: TrustedReceipt;
    }>;
  };
  adapters: {
    get(adapterId: string): NativeProviderAdapter | undefined;
  };
  leases: {
    acquire(
      input: { keys: string[]; owner: string; ttlMs: number },
      signal: AbortSignal,
    ): Promise<{ acquired: boolean; [key: string]: unknown }>;
    release(lease: unknown): Promise<void>;
    isBusy(key: string): boolean | Promise<boolean>;
  };
  trace: {
    record(event: Record<string, unknown>, signal: AbortSignal): Promise<void>;
    list(sessionId: string): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
  };
  clock?: () => string;
  timeoutMs?: number;
}

export class NativeAgentSessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function workspace_bind(
  context: NativeAgentSessionContext,
  input: {
    caseId: string;
    canonicalRemote: string;
    writeMode: NativeWriteScope;
  },
): Promise<{
  disposition: "created" | "deduplicated";
  workspaceId: string;
  workspaceArtifactRef: string;
  workspaceArtifactDigest: string;
}>;

export function session_start(
  context: NativeAgentSessionContext,
  input: {
    workspaceId: string;
    adapterId: string;
    writeScope: NativeWriteScope;
  },
): Promise<{
  disposition: "created" | "deduplicated";
  sessionId: string;
  sessionArtifactRef: string;
  initialCheckpointRef: string;
  runHandle: string;
}>;

export function session_checkpoint(
  context: NativeAgentSessionContext,
  input: {
    sessionId: string;
    expectedPreviousCheckpointDigest: string;
  },
): Promise<{
  checkpointRef: string;
  checkpointDigest: string;
  sequence: number;
}>;

export type NativeSessionResumeResult =
  | {
      state: "RESUMED";
      runHandle: string;
      adapterReceiptRef: string;
      newCheckpointRef: string;
    }
  | {
      state:
        | "SESSION_BUSY"
        | "HISTORY_ONLY"
        | "AUTH_REQUIRED"
        | "REPOSITORY_MISMATCH"
        | "CHECKPOINT_INVALID"
        | "BLOCKED_EXTERNAL";
      reasonCode: string;
    };

export function session_resume(
  context: NativeAgentSessionContext,
  input: {
    sessionId: string;
    expectedCheckpointDigest: string;
  },
): Promise<NativeSessionResumeResult>;

export function session_status(
  context: NativeAgentSessionContext,
  input: { sessionId: string },
): Promise<{
  derivedState:
    | "CREATED"
    | "CHECKPOINTED"
    | "BUSY"
    | "PAUSED"
    | "RESUMED"
    | "COMPLETED"
    | "HISTORY_ONLY"
    | "INVALID";
  latestVerifiedCheckpointRef?: string;
  limitations: string[];
}>;
