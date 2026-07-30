import type { NodeKitCaseflowSnapshot } from "./caseflow.mjs";

export type ExecutionAuthorityRequirement =
  | "agent-produced"
  | "deterministic"
  | "human-attested"
  | "nodeproof-verified";

export interface StageTaskV1 {
  schemaVersion: "nodekit.stage-task/v1";
  taskId: string;
  stageId: string;
  kind: "task" | "review";
  readSet: string[];
  writeSet: string[];
  outputSlots: Array<{ slot: string; schemaVersion: string }>;
  inputs: Array<{
    fromTaskId: string;
    outputSlot: string;
    inputSlot: string;
    requiredSchemaVersion: string;
    authorityRequirement: ExecutionAuthorityRequirement;
    required: boolean;
  }>;
  reviewContextRef?: string;
}

export interface ExecutionGraphV1 {
  schemaVersion: "nodekit.execution-graph/v1";
  graphId: string;
  caseBinding: {
    caseId: string;
    stageId: string;
    caseContentHash: string;
  };
  compiler: {
    version: string;
    inputContentHash: string;
  };
  nodes: Array<{
    nodeId: string;
    kind: "task" | "review" | "barrier";
    taskRef: string;
    readSet: string[];
    writeSet: string[];
    requiredEdgeIds: string[];
    outputSlots: Array<{ slot: string; schemaVersion: string }>;
    reviewContextRef?: string;
  }>;
  edges: Array<{
    edgeId: string;
    from: { nodeId: string; outputSlot: string };
    to: { nodeId: string; inputSlot: string };
    requiredSchemaVersion: string;
    authorityRequirement: ExecutionAuthorityRequirement;
    required: boolean;
  }>;
  graphHash: string;
}

export interface RepositoryBinding {
  remote: string;
  commitSha: string;
  treeHash: string;
}

export interface ExecutionEdgeBindingV1 {
  schemaVersion: "nodekit.execution-edge-binding/v1";
  bindingId: string;
  graphId: string;
  graphHash: string;
  edgeId: string;
  producer: {
    nodeId: string;
    runId: string;
  };
  artifact: {
    artifactId: string;
    schemaVersion: string;
    contentHash: string;
  };
  repositoryBinding?: RepositoryBinding;
  authority: {
    kind: ExecutionAuthorityRequirement;
    attestationRef?: string;
    receiptRef?: string;
  };
  createdAt: string;
  bindingHash: string;
}

export type RunnableFrontierReason =
  | "MISSING_EDGE"
  | "INVALID_EDGE"
  | "AUTHORITY_REQUIRED"
  | "WRITE_CONFLICT"
  | "BARRIER_CLOSED"
  | "STAGE_NOT_CURRENT";

export interface RunnableFrontierV1 {
  schemaVersion: "nodekit.runnable-frontier/v1";
  graphId: string;
  graphHash: string;
  caseBinding: ExecutionGraphV1["caseBinding"];
  consumedBindingHashes: string[];
  runnableNodeIds: string[];
  blocked: Array<{
    nodeId: string;
    reasonCode: RunnableFrontierReason;
    blockingEdgeIds: string[];
    conflictingNodeIds: string[];
  }>;
  frontierHash: string;
}

export type ReviewSeparation =
  | "same-context"
  | "fresh-context"
  | "independent-model"
  | "independent-human";

export interface ReviewContextV1 {
  schemaVersion: "nodekit.review-context/v1";
  builderRunId: string;
  reviewerRunId: string;
  separation: ReviewSeparation;
  protectedEvaluator: boolean;
  reviewerModelRef?: string;
  reviewerIdentityRef?: string;
  humanAttestationRef?: string;
}

export interface ReviewRunIdentity {
  runId: string;
  sessionId: string;
  modelRef: string;
  identityRef: string;
  evaluatorRef?: string;
  humanAttestationRef?: string;
}

export const NODETRACE_GRAPH_EVENT_TYPES: readonly [
  "node.started",
  "edge.consumed",
  "artifact.produced",
  "node.completed",
  "node.failed",
  "barrier.opened",
  "barrier.blocked",
];

export function compileStageExecutionGraph(input: {
  snapshot: NodeKitCaseflowSnapshot;
  caseId: string;
  taskArtifactIds: string[];
  compilerVersion?: string;
}): Promise<ExecutionGraphV1>;

export function verifyExecutionGraph(graph: ExecutionGraphV1): Promise<{
  graph: ExecutionGraphV1;
  graphHash: string;
  verified: true;
}>;

export function sealExecutionEdgeBinding(
  input: Omit<ExecutionEdgeBindingV1, "schemaVersion" | "bindingId" | "bindingHash">,
): ExecutionEdgeBindingV1;

export function verifyExecutionEdgeBinding(input: {
  binding: ExecutionEdgeBindingV1;
  graph: ExecutionGraphV1;
  snapshot: NodeKitCaseflowSnapshot;
  repositoryState?: RepositoryBinding;
  verifyHumanAttestation?: (reference: string) => Promise<{
    verified: boolean;
    trustLevel?: string;
  }> | {
    verified: boolean;
    trustLevel?: string;
  };
  verifyNodeProofReceipt?: (reference: string) => Promise<{
    verified: boolean;
  }> | {
    verified: boolean;
  };
}): Promise<{
  binding: ExecutionEdgeBindingV1;
  bindingHash: string;
  edge: ExecutionGraphV1["edges"][number];
  verified: true;
}>;

export function deriveRunnableFrontier(input: {
  graph: ExecutionGraphV1;
  snapshot: NodeKitCaseflowSnapshot;
  bindings: ExecutionEdgeBindingV1[];
  repositoryState?: RepositoryBinding;
  verifyHumanAttestation?: (reference: string) => Promise<{
    verified: boolean;
    trustLevel?: string;
  }> | {
    verified: boolean;
    trustLevel?: string;
  };
  verifyNodeProofReceipt?: (reference: string) => Promise<{
    verified: boolean;
  }> | {
    verified: boolean;
  };
}): Promise<RunnableFrontierV1>;

export function verifyRunnableFrontier(frontier: RunnableFrontierV1): Promise<{
  frontier: RunnableFrontierV1;
  frontierHash: string;
  verified: true;
}>;

export function deriveReviewContext(input: {
  builder: ReviewRunIdentity;
  reviewer: ReviewRunIdentity;
  protectedEvaluatorRefs?: string[];
  verifyHumanAttestation?: (reference: string) => Promise<{
    verified: boolean;
    trustLevel?: string;
  }> | {
    verified: boolean;
    trustLevel?: string;
  };
}): Promise<ReviewContextV1>;

export function verifyReviewContext(context: ReviewContextV1): Promise<{
  context: ReviewContextV1;
  verified: true;
}>;
