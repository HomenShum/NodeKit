export const EXECUTION_GRAPH_SCHEMA_VERSION: "nodekit.execution-graph/v1";
export const EXECUTION_TRACE_SCHEMA_VERSION: "nodekit.execution-trace/v1";
export const NODEPROOF_SCHEMA_VERSION: "nodekit.execution-nodeproof/v1";
export const EXECUTION_EXPERIMENT_SCHEMA_VERSION: "nodekit.execution-strategy-experiment/v1";
export const EXECUTION_NODE_TYPES: readonly [
  "CONTEXT", "DECISION", "BUILD", "CHECK", "REVIEW", "BROWSER",
  "AGENT_EVAL", "AGGREGATE", "REPAIR", "DELIVER", "HUMAN_GATE",
];

export type ExecutionNodeType = typeof EXECUTION_NODE_TYPES[number];
export type ArtifactAuthority = "canonical" | "proposal" | "evidence" | "verification" | "human-approval";
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
  nodes: ExecutionNodeInput[];
  edges: ExecutionEdgeInput[];
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
  edges: Array<Required<ExecutionEdgeInput> & { edgeId: string }>;
}

export interface MaterializedArtifact extends Required<ArtifactContract> {
  artifactRef: string;
  digest: string;
  revision: string;
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
    findings: Array<{ code: string; severity: "P0" | "P1" | "P2" | "P3"; message: string }>;
    handoffs: Array<{ edgeId: string; artifact: MaterializedArtifact }>;
  }>;
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
    findings?: Array<{ code: string; severity: "P0" | "P1" | "P2" | "P3"; message: string }>;
    handoffs?: Array<{ edgeId: string; artifact: MaterializedArtifact }>;
  },
): ExecutionTrace;
export function verifyExecutionProof(graph: CompiledExecutionGraph, trace: ExecutionTrace): {
  schemaVersion: "nodekit.execution-nodeproof/v1";
  passed: boolean;
  graphId: string | null;
  traceDigest: string | null;
  findings: Array<{ code: string; severity: "P0" | "P1" | "P2" | "P3"; message: string }>;
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
}
export function evaluateExecutionStrategyExperiment(input: {
  taskRef: string;
  taskDigest: string;
  thresholds: {
    minimumRunsPerArm: number;
    maximumSuccessRateRegression: number;
    maximumMedianDurationRatio: number;
    maximumMedianCostRatio: number;
    minimumCompletenessLift: number;
  };
  sequentialRuns: ExecutionExperimentRun[];
  graphRuns: ExecutionExperimentRun[];
}): {
  schemaVersion: "nodekit.execution-strategy-experiment/v1";
  taskRef: string;
  taskDigest: string;
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
  }>;
  gates: Record<"sampleSize" | "successRate" | "duration" | "cost" | "completeness", boolean>;
  passed: boolean;
  experimentDigest: string;
};
