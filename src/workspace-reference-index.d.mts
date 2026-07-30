export type ContentHash = string;
export type WorkspaceId = `workspace:sha256:${string}`;
export type SessionId = `session:sha256:${string}`;

export interface WorkspaceReferenceIndexEntry {
  workspaceId: WorkspaceId;
  sessionId?: SessionId;
  workspaceArtifactRef: string;
  workspaceArtifactDigest: ContentHash;
  sessionArtifactRef?: string;
  sessionArtifactDigest?: ContentHash;
  latestCheckpointRef?: string;
  latestCheckpointDigest?: ContentHash;
}

export interface WorkspaceReferenceIndex {
  schemaVersion: "nodekit.workspace-reference-index/v1";
  builtFromCaseflowDigest: ContentHash;
  builtAt: string;
  entries: WorkspaceReferenceIndexEntry[];
  indexDigest: ContentHash;
}

export interface WorkspaceReferenceIndexInput {
  builtFromCaseflowDigest: ContentHash;
  builtAt: string;
  caseflowArtifacts: unknown[];
}

export const WORKSPACE_REFERENCE_INDEX_LIMITS: Readonly<{
  maxArtifacts: number;
  maxEntries: number;
  maxPendingWrites: number;
  maxRecordBytes: number;
}>;

export function verifyWorkspaceReferenceIndex(
  state: WorkspaceReferenceIndex,
): WorkspaceReferenceIndex;
export function buildWorkspaceReferenceIndex(
  repoRoot: string,
  input: WorkspaceReferenceIndexInput,
): Promise<WorkspaceReferenceIndex>;
export function readWorkspaceReferenceIndex(
  repoRoot: string,
): Promise<WorkspaceReferenceIndex>;
