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
  designContext: {
    primaryUser: "builder",
    primaryArtifact: "verified change",
    primaryAction: "approve delivery",
  },
  nodes: [{
    id: "deliver",
    type: "DELIVER",
    title: "Deliver",
    authority: "reviewer",
    expectedArtifact: {
      schemaVersion: "nodekit.delivery/v1",
      kind: "delivery",
      authority: "agent-produced",
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
  controls: {
    startingCommit: "c".repeat(40),
    codingAgentHarness: { artifactRef: `harness:sha256:${"d".repeat(64)}`, artifactDigest: "d".repeat(64) },
    modelRoutes: { artifactRef: `routes:sha256:${"e".repeat(64)}`, artifactDigest: "e".repeat(64) },
    approvalPolicy: { artifactRef: `policy:sha256:${"f".repeat(64)}`, artifactDigest: "f".repeat(64) },
    testFixtures: { artifactRef: `fixtures:sha256:${"a".repeat(64)}`, artifactDigest: "a".repeat(64) },
    deliveryTarget: { artifactRef: `delivery:sha256:${"b".repeat(64)}`, artifactDigest: "b".repeat(64) },
  },
  thresholds: {
    minimumRunsPerArm: 2,
    maximumSuccessRateRegression: 0,
    maximumMedianDurationRatio: 1,
    maximumMedianCostRatio: 1,
    minimumCompletenessLift: 0,
    minimumWallClockReduction: 0.2,
    minimumConfirmedDefectLift: 0.3,
    maximumFalseFindingIncrease: 0,
  },
  sequentialRuns: [],
  graphRuns: [],
});
