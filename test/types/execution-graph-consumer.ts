import {
  compileStageExecutionGraph,
  deriveReviewContext,
  deriveRunnableFrontier,
  sealExecutionEdgeBinding,
  type ExecutionGraphV1,
  type RepositoryBinding,
} from "@homenshum/nodekit/execution-graph";
import type { NodeKitCaseflowSnapshot } from "@homenshum/nodekit/caseflow";

declare const snapshot: NodeKitCaseflowSnapshot;
declare const graph: ExecutionGraphV1;

const repositoryState: RepositoryBinding = {
  remote: "https://github.com/HomenShum/node-platform.git",
  commitSha: "a".repeat(40),
  treeHash: "b".repeat(64),
};

void compileStageExecutionGraph({
  snapshot,
  caseId: "case_123",
  taskArtifactIds: ["artifact:task"],
});

const binding = sealExecutionEdgeBinding({
  graphId: graph.graphId,
  graphHash: graph.graphHash,
  edgeId: graph.edges[0].edgeId,
  producer: { nodeId: graph.edges[0].from.nodeId, runId: "run_123" },
  artifact: {
    artifactId: "artifact:result",
    schemaVersion: graph.edges[0].requiredSchemaVersion,
    contentHash: "c".repeat(64),
  },
  repositoryBinding: repositoryState,
  authority: { kind: graph.edges[0].authorityRequirement },
  createdAt: "2026-07-29T12:00:00.000Z",
});

void deriveRunnableFrontier({
  graph,
  snapshot,
  bindings: [binding],
  repositoryState,
});

void deriveReviewContext({
  builder: {
    runId: "run:builder",
    sessionId: "session:builder",
    modelRef: "model:a",
    identityRef: "agent:builder",
  },
  reviewer: {
    runId: "run:reviewer",
    sessionId: "session:reviewer",
    modelRef: "model:b",
    identityRef: "agent:reviewer",
    evaluatorRef: "evaluator:protected",
  },
  protectedEvaluatorRefs: ["evaluator:protected"],
});
