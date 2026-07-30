export const EXECUTION_GRAPH_SCHEMA_VERSION: "nodekit.execution-graph/v1";
export const EXECUTION_TRACE_SCHEMA_VERSION: "nodekit.execution-trace/v1";
export const NODEPROOF_SCHEMA_VERSION: "nodekit.execution-nodeproof/v1";
export const EXECUTION_EXPERIMENT_SCHEMA_VERSION: "nodekit.execution-strategy-experiment/v1";
export const EXECUTION_EDGE_AUTHORITIES: readonly [
  "agent-produced", "deterministic", "human-approved", "externally-observed",
];
export const REVIEW_FINDING_SEVERITIES: readonly ["critical", "major", "minor", "informational"];
export const REVIEW_FINDING_RESULTS: readonly ["confirmed", "not-observed", "unsupported"];
export const EXECUTION_NODE_TYPES: readonly [
  "CONTEXT", "DECISION", "BUILD", "CHECK", "REVIEW", "BROWSER",
  "AGENT_EVAL", "AGGREGATE", "REPAIR", "DELIVER", "HUMAN_GATE",
];

export type ExecutionNodeType = typeof EXECUTION_NODE_TYPES[number];
export type ArtifactAuthority = typeof EXECUTION_EDGE_AUTHORITIES[number];
export type ArtifactCompleteness = "complete" | "partial";

export interface ArtifactContract {
  schemaVersion: string;
  kind: string;
  authority: ArtifactAuthority;
  completeness: ArtifactCompleteness;
  limitations?: string[];
}

export interface ExecutionNodeInput {
  id: string;
  type: ExecutionNodeType;
  title: string;
  authority: "runtime" | "builder" | "reviewer" | "evaluator" | "human";
  maximumAttempts?: number;
  readSet?: string[];
  writeSet?: string[];
  externalSystems?: Array<{ system: string; access: "read" | "write" }>;
  expectedArtifact: ArtifactContract;
  parallelGroup?: string;
  browserMode?: "headless-embedded" | "headful-operational";
  verifierQualificationRef?: string;
}

export interface ExecutionEdgeInput {
  from: string;
  to: string;
  on?: "success" | "failure" | "always";
  artifact: ArtifactContract;
}

export interface ExecutionGraphInput {
  projectRef: string;
  projectRevision: string;
  approvedJourneyRef: string;
  approvedJourneyDigest: string;
  designContext: ExecutionDesignContext;
  nodes: ExecutionNodeInput[];
  edges: ExecutionEdgeInput[];
}

export interface ExecutionDesignContext {
  primaryUser: string;
  primaryArtifact: string;
  primaryAction: string;
  requiredFlows?: string[];
  requiredStates?: string[];
  approvedProductTopology?: string[];
  designRules?: string[];
  tokenRoles?: string[];
  trustSurfaces?: string[];
  responsiveBehavior?: string[];
  motionRules?: string[];
  copyRules?: string[];
  antiPatterns?: string[];
  knownNovelDecisions?: string[];
  proofRequirements?: string[];
}

export interface CompiledExecutionGraph {
  schemaVersion: "nodekit.execution-graph/v1";
  graphId: string;
  graphDigest: string;
  source: {
    projectRef: string;
    projectRevision: string;
    approvedJourneyRef: string;
    approvedJourneyDigest: string;
    designContext: Required<ExecutionDesignContext>;
  };
  policy: {
    canonicalState: "caseflow";
    projection: "disposable";
    automaticPromotion: false;
    maximumNodes: number;
    maximumEdges: number;
    maximumEvents: number;
  };
  nodes: Array<ExecutionNodeInput & {
    taskHandle: string;
    maximumAttempts: number;
    readSet: string[];
    writeSet: string[];
    externalSystems: Array<{ system: string; access: "read" | "write" }>;
    parallelGroup: string | null;
    browserMode: "headless-embedded" | "headful-operational" | null;
    verifierQualificationRef: string | null;
  }>;
  edges: Array<{
    edgeId: string;
    fromNodeId: string;
    toNodeId: string;
    on: "success" | "failure" | "always";
    artifactRefs: string[];
    artifactDigests: string[];
    requiredSchema: string;
    repositoryCommit: string | null;
    deploymentRevision: string | null;
    authority: ArtifactAuthority;
    completeness: "missing";
    limitations: string[];
  }>;
}

export interface MaterializedExecutionEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  artifactRefs: string[];
  artifactDigests: string[];
  requiredSchema: string;
  repositoryCommit: string | null;
  deploymentRevision: string | null;
  authority: ArtifactAuthority;
  completeness: ArtifactCompleteness;
  limitations: string[];
}

export interface ExecutionTrace {
  schemaVersion: "nodekit.execution-trace/v1";
  graphId: string;
  graphDigest: string;
  traceDigest: string;
  events: Array<{
    sequence: number;
    nodeId: string;
    taskHandle: string;
    attempt: number;
    status: "passed" | "failed" | "blocked";
    actorClass: "builder" | "reviewer" | "evaluator" | "human" | "runtime";
    actorRef: string;
    startedAt: string;
    completedAt: string;
    findings: ReviewFinding[];
    handoffs: MaterializedExecutionEdge[];
  }>;
}

export interface ReviewFinding {
  findingId: string;
  lens: string;
  severity: typeof REVIEW_FINDING_SEVERITIES[number];
  behaviorId: string | null;
  evidenceRefs: string[];
  result: typeof REVIEW_FINDING_RESULTS[number];
}

export function compileExecutionGraph(input: ExecutionGraphInput): CompiledExecutionGraph;
export function createExecutionTrace(graph: CompiledExecutionGraph): ExecutionTrace;
export function deriveRunnableFrontier(graph: CompiledExecutionGraph, trace: ExecutionTrace): Array<{
  nodeId: string;
  type: ExecutionNodeType;
  title: string;
  taskHandle: string;
  requiresHuman: boolean;
  attempt: number;
}>;
export function recordExecutionResult(
  graph: CompiledExecutionGraph,
  trace: ExecutionTrace,
  result: {
    nodeId: string;
    status: "passed" | "failed" | "blocked";
    actorClass: "builder" | "reviewer" | "evaluator" | "human" | "runtime";
    actorRef: string;
    startedAt: string;
    completedAt: string;
    findings?: Array<Omit<ReviewFinding, "behaviorId"> & { behaviorId?: string }>;
    handoffs?: Array<Omit<MaterializedExecutionEdge, "fromNodeId" | "toNodeId">>;
  },
): ExecutionTrace;
export function verifyExecutionProof(graph: CompiledExecutionGraph, trace: ExecutionTrace): {
  schemaVersion: "nodekit.execution-nodeproof/v1";
  passed: boolean;
  graphId: string | null;
  traceDigest: string | null;
  findings: Array<
    | { code: string; severity: typeof REVIEW_FINDING_SEVERITIES[number]; message: string }
    | ReviewFinding
  >;
  runnableFrontier: ReturnType<typeof deriveRunnableFrontier>;
};
export function renderExecutionDesignMarkdown(graph: CompiledExecutionGraph): string;
export interface ExecutionExperimentRun {
  runId: string;
  succeeded: boolean;
  durationMs: number;
  costUsd: number;
  artifactCompleteness: number;
  humanReprompts: number;
  findingCount: number;
  writeConflicts: number;
  validEdgeArtifactRate: number;
  hiddenTaskDrops: number;
  falseStageAdvancements: number;
  criticalDefectsMissed: number;
  proofValid: boolean;
  confirmedDefects: number;
  falseFindings: number;
}
export function evaluateExecutionStrategyExperiment(input: {
  taskRef: string;
  taskDigest: string;
  controls: {
    startingCommit: string;
    codingAgentHarness: { artifactRef: string; artifactDigest: string };
    modelRoutes: { artifactRef: string; artifactDigest: string };
    approvalPolicy: { artifactRef: string; artifactDigest: string };
    testFixtures: { artifactRef: string; artifactDigest: string };
    deliveryTarget: { artifactRef: string; artifactDigest: string };
  };
  thresholds: {
    minimumRunsPerArm: number;
    maximumSuccessRateRegression: number;
    maximumMedianDurationRatio: number;
    maximumMedianCostRatio: number;
    minimumCompletenessLift: number;
    minimumWallClockReduction: number;
    minimumConfirmedDefectLift: number;
    maximumFalseFindingIncrease: number;
  };
  sequentialRuns: ExecutionExperimentRun[];
  graphRuns: ExecutionExperimentRun[];
}): {
  schemaVersion: "nodekit.execution-strategy-experiment/v1";
  taskRef: string;
  taskDigest: string;
  controls: {
    startingCommit: string;
    codingAgentHarness: { artifactRef: string; artifactDigest: string };
    modelRoutes: { artifactRef: string; artifactDigest: string };
    approvalPolicy: { artifactRef: string; artifactDigest: string };
    testFixtures: { artifactRef: string; artifactDigest: string };
    deliveryTarget: { artifactRef: string; artifactDigest: string };
  };
  thresholds: {
    minimumRunsPerArm: number;
    maximumSuccessRateRegression: number;
    maximumMedianDurationRatio: number;
    maximumMedianCostRatio: number;
    minimumCompletenessLift: number;
  };
  arms: Record<"sequential" | "graph", {
    runs: number;
    successRate: number;
    medianDurationMs: number;
    medianCostUsd: number;
    medianArtifactCompleteness: number;
    medianHumanReprompts: number;
    medianFindingCount: number;
    writeConflicts: number;
    minimumValidEdgeArtifactRate: number;
    hiddenTaskDrops: number;
    falseStageAdvancements: number;
    criticalDefectsMissed: number;
    proofValidCompletionRate: number;
    confirmedDefects: number;
    falseFindings: number;
  }>;
  gates: Record<
    | "sampleSize" | "successRate" | "duration" | "cost" | "completeness"
    | "writeConflicts" | "validEdgeArtifacts" | "hiddenTaskDrops"
    | "falseStageAdvancement" | "criticalDefectsMissed" | "proofValidCompletion" | "advantage",
    boolean
  >;
  passed: boolean;
  experimentDigest: string;
};
