import {
  compileExecutionGraph,
  createExecutionTrace,
  deriveRunnableFrontier,
  evaluateExecutionStrategyExperiment,
  renderExecutionDesignMarkdown,
  verifyExecutionProof,
} from "../../src/execution-graph.mjs";

const graph = compileExecutionGraph({
  projectRef: "caseflow:case-1",
  projectRevision: "abc123",
  approvedJourneyRef: `approved-journey:sha256:${"a".repeat(64)}`,
  approvedJourneyDigest: "a".repeat(64),
  nodes: [{
    id: "deliver",
    type: "DELIVER",
    title: "Deliver",
    authority: "reviewer",
    expectedArtifact: {
      schemaVersion: "nodekit.delivery/v1",
      kind: "delivery",
      authority: "canonical",
      completeness: "complete",
    },
  }],
  edges: [],
});

const trace = createExecutionTrace(graph);
deriveRunnableFrontier(graph, trace);
verifyExecutionProof(graph, trace);
renderExecutionDesignMarkdown(graph);

evaluateExecutionStrategyExperiment({
  taskRef: `brownfield-task:sha256:${"b".repeat(64)}`,
  taskDigest: "b".repeat(64),
  thresholds: {
    minimumRunsPerArm: 2,
    maximumSuccessRateRegression: 0,
    maximumMedianDurationRatio: 1,
    maximumMedianCostRatio: 1,
    minimumCompletenessLift: 0,
  },
  sequentialRuns: [],
  graphRuns: [],
});
