import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  compileExecutionGraph,
  createExecutionTrace,
  deriveRunnableFrontier,
  evaluateExecutionStrategyExperiment,
  recordExecutionResult,
  renderExecutionDesignMarkdown,
  verifyExecutionProof,
} from "../src/lib/execution-graph.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const ref = (kind, value) => `${kind}:sha256:${sha(value)}`;
const timestamp = (sequence) => `2026-07-30T10:${String(sequence).padStart(2, "0")}:00.000Z`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};

function contract(schemaVersion, kind, authority = "deterministic") {
  return { schemaVersion, kind, authority, completeness: "complete", limitations: [] };
}

function designContext() {
  return {
    primaryUser: "NodeKit builder",
    primaryArtifact: "verified brownfield change",
    primaryAction: "approve the proof-valid delivery",
    requiredFlows: ["inspect → build → verify → deliver"],
    requiredStates: ["running", "waiting-on-you", "complete"],
    approvedProductTopology: ["Caseflow lifecycle with disposable execution projection"],
    designRules: ["Progressive disclosure for internal graph detail"],
    tokenRoles: ["trust=verified", "attention=human-gate"],
    trustSurfaces: ["NodeProof verdict", "human approval"],
    responsiveBehavior: ["Current runnable frontier remains primary"],
    motionRules: ["No motion required for proof state"],
    copyRules: ["Use plain-language status"],
    antiPatterns: ["Graph canvas as default UI"],
    knownNovelDecisions: ["Graph nodes are bounded loops"],
    proofRequirements: ["Every active edge verifies"],
  };
}

function brownfieldGraph(overrides = {}) {
  const buildArtifact = contract("nodekit.build-output/v1", "build-output", "agent-produced");
  const graph = {
    projectRef: "caseflow:case-brownfield-ui",
    projectRevision: "abc1234",
    approvedJourneyRef: ref("approved-journey", "approved-journey"),
    approvedJourneyDigest: sha("approved-journey"),
    designContext: designContext(),
    nodes: [
      {
        id: "context",
        type: "CONTEXT",
        title: "Load canonical Caseflow context",
        authority: "runtime",
        expectedArtifact: contract("nodekit.context-pack/v1", "context-pack", "deterministic"),
        readSet: ["caseflow/case", "caseflow/artifacts"],
      },
      {
        id: "build",
        type: "BUILD",
        title: "Implement the bounded brownfield change",
        authority: "builder",
        maximumAttempts: 2,
        expectedArtifact: buildArtifact,
        readSet: ["src/existing.ts"],
        writeSet: ["src/changed.ts"],
      },
      {
        id: "check",
        type: "CHECK",
        title: "Run scenario and type checks",
        authority: "runtime",
        parallelGroup: "verification",
        expectedArtifact: contract("nodekit.check-receipt/v1", "check-receipt", "deterministic"),
        readSet: ["src/changed.ts", "test/scenarios.ts"],
      },
      {
        id: "browser",
        type: "BROWSER",
        title: "Verify the embedded browser surface",
        authority: "reviewer",
        parallelGroup: "verification",
        browserMode: "headless-embedded",
        expectedArtifact: contract("nodekit.browser-receipt/v1", "browser-receipt", "externally-observed"),
        readSet: ["dist/app.js"],
      },
      {
        id: "agent-eval",
        type: "AGENT_EVAL",
        title: "Run a qualified independent evaluation",
        authority: "evaluator",
        parallelGroup: "verification",
        verifierQualificationRef: ref("verifier-qualification", "qualified-evaluator"),
        expectedArtifact: contract("nodekit.agent-eval-receipt/v1", "agent-eval-receipt", "deterministic"),
        readSet: ["proof/candidate.json"],
      },
      {
        id: "aggregate",
        type: "AGGREGATE",
        title: "Aggregate typed findings without deciding",
        authority: "runtime",
        expectedArtifact: contract("nodekit.aggregate-receipt/v1", "aggregate-receipt", "deterministic"),
        readSet: ["proof/check.json", "proof/browser.json", "proof/eval.json"],
      },
      {
        id: "deliver",
        type: "DELIVER",
        title: "Deliver the NodeProof-verified change",
        authority: "reviewer",
        expectedArtifact: contract("nodekit.delivery-receipt/v1", "delivery-receipt", "agent-produced"),
        readSet: ["proof/aggregate.json"],
      },
    ],
    edges: [
      { from: "context", to: "build", artifact: contract("nodekit.context-pack/v1", "context-pack", "deterministic") },
      { from: "build", to: "check", artifact: buildArtifact },
      { from: "build", to: "browser", artifact: buildArtifact },
      { from: "build", to: "agent-eval", artifact: buildArtifact },
      { from: "check", to: "aggregate", artifact: contract("nodekit.check-receipt/v1", "check-receipt", "deterministic") },
      { from: "browser", to: "aggregate", artifact: contract("nodekit.browser-receipt/v1", "browser-receipt", "externally-observed") },
      { from: "agent-eval", to: "aggregate", artifact: contract("nodekit.agent-eval-receipt/v1", "agent-eval-receipt", "deterministic") },
      { from: "aggregate", to: "deliver", artifact: contract("nodekit.aggregate-receipt/v1", "aggregate-receipt", "deterministic") },
    ],
    ...overrides,
  };
  return compileExecutionGraph(graph);
}

function artifactFor(edge, value) {
  const hash = sha(value);
  return {
    edgeId: edge.edgeId,
    artifactRefs: [`edge-artifact:sha256:${hash}`],
    artifactDigests: [hash],
    requiredSchema: edge.requiredSchema,
    repositoryCommit: "abc1234",
    deploymentRevision: null,
    authority: edge.authority,
    completeness: "complete",
    limitations: edge.limitations,
  };
}

function resultFor(graph, nodeId, sequence, actorClass, actorRef, status = "passed") {
  const edges = graph.edges.filter((edge) => edge.fromNodeId === nodeId
    && (edge.on === "always" || (edge.on === "success" && status === "passed") || (edge.on === "failure" && status === "failed")));
  return {
    nodeId,
    status,
    actorClass,
    actorRef: ref("actor", actorRef),
    startedAt: timestamp(sequence),
    completedAt: timestamp(sequence + 1),
    handoffs: edges.map((edge) => artifactFor(edge, `${nodeId}-${edge.edgeId}-${sequence}`)),
  };
}

test("brownfield architect compiles a disposable graph with the fixed vocabulary and generated design projection", async () => {
  const graph = brownfieldGraph();
  assert.equal(graph.policy.canonicalState, "caseflow");
  assert.equal(graph.policy.projection, "disposable");
  assert.equal(graph.policy.automaticPromotion, false);
  assert.match(graph.graphId, /^execution-graph:sha256:/);
  assert.equal(new Set(graph.nodes.map((node) => node.taskHandle)).size, graph.nodes.length);
  assert.equal(graph.nodes.find((node) => node.id === "browser").browserMode, "headless-embedded");

  const design = renderExecutionDesignMarkdown(graph);
  assert.match(design, /Generated from canonical Caseflow-approved records/);
  assert.match(design, /disposable projection, not authority/);
  assert.match(design, /current runnable frontier/);
  assert.match(design, /Primary user: NodeKit builder/);
  assert.match(design, /Reference-backed design rules/);
  assert.match(design, /Trust surfaces/);
  assert.match(design, /Responsive behavior/);
  assert.match(design, /Proof requirements/);
  assert.deepEqual(await validateSchema("nodekit.execution-graph.v1.schema.json", graph, "execution graph"), []);
});

test("founder change flows through isolated verification, waits for every typed edge, and is certified by NodeProof", async () => {
  const graph = brownfieldGraph();
  let trace = createExecutionTrace(graph);
  assert.deepEqual(deriveRunnableFrontier(graph, trace).map((entry) => entry.nodeId), ["context"]);

  trace = recordExecutionResult(graph, trace, resultFor(graph, "context", 0, "runtime", "caseflow-loader"));
  assert.deepEqual(deriveRunnableFrontier(graph, trace).map((entry) => entry.nodeId), ["build"]);

  trace = recordExecutionResult(graph, trace, resultFor(graph, "build", 2, "builder", "builder-agent-1"));
  assert.deepEqual(
    deriveRunnableFrontier(graph, trace).map((entry) => entry.nodeId),
    ["agent-eval", "browser", "check"],
    "only declared disjoint work fans out",
  );

  trace = recordExecutionResult(graph, trace, resultFor(graph, "check", 4, "runtime", "test-runner"));
  assert.equal(
    deriveRunnableFrontier(graph, trace).some((entry) => entry.nodeId === "aggregate"),
    false,
    "aggregator must wait for all active incoming handoffs",
  );
  trace = recordExecutionResult(graph, trace, resultFor(graph, "browser", 6, "reviewer", "browser-reviewer-1"));
  assert.equal(deriveRunnableFrontier(graph, trace).some((entry) => entry.nodeId === "aggregate"), false);
  trace = recordExecutionResult(graph, trace, resultFor(graph, "agent-eval", 8, "evaluator", "qualified-evaluator-2"));
  assert.deepEqual(deriveRunnableFrontier(graph, trace).map((entry) => entry.nodeId), ["aggregate"]);

  trace = recordExecutionResult(graph, trace, resultFor(graph, "aggregate", 10, "runtime", "receipt-aggregator"));
  assert.deepEqual(deriveRunnableFrontier(graph, trace).map((entry) => entry.nodeId), ["deliver"]);
  trace = recordExecutionResult(graph, trace, resultFor(graph, "deliver", 12, "reviewer", "release-reviewer-3"));

  const proof = verifyExecutionProof(graph, trace);
  assert.equal(proof.passed, true);
  assert.deepEqual(proof.runnableFrontier, []);
  assert.deepEqual(await validateSchema("nodekit.execution-trace.v1.schema.json", trace, "execution trace"), []);
  assert.deepEqual(await validateSchema("nodekit.execution-nodeproof.v1.schema.json", proof, "NodeProof"), []);
});

test("fresh context is rejected as fake independence when an evaluator reuses the producing actor", () => {
  const graph = brownfieldGraph();
  let trace = createExecutionTrace(graph);
  trace = recordExecutionResult(graph, trace, resultFor(graph, "context", 0, "runtime", "caseflow-loader"));
  trace = recordExecutionResult(graph, trace, resultFor(graph, "build", 2, "builder", "same-agent"));
  trace = recordExecutionResult(graph, trace, resultFor(graph, "agent-eval", 4, "evaluator", "same-agent"));
  const proof = verifyExecutionProof(graph, trace);
  assert.equal(proof.passed, false);
  assert.ok(proof.findings.some((finding) => finding.code === "SELF_VERIFICATION"));
});

test("architect fails closed on unsafe fan-out, unqualified evaluators, and external writes without a human gate", () => {
  const input = {
    projectRef: "caseflow:unsafe",
    projectRevision: "deadbeef",
    approvedJourneyRef: ref("approved-journey", "approved"),
    approvedJourneyDigest: sha("approved"),
    designContext: designContext(),
    nodes: [
      {
        id: "left",
        type: "BUILD",
        title: "Left writer",
        authority: "builder",
        parallelGroup: "unsafe",
        writeSet: ["src/shared.ts"],
        expectedArtifact: contract("x/v1", "x", "agent-produced"),
      },
      {
        id: "right",
        type: "CHECK",
        title: "Right reader",
        authority: "runtime",
        parallelGroup: "unsafe",
        readSet: ["src/shared.ts"],
        expectedArtifact: contract("y/v1", "y", "deterministic"),
      },
      {
        id: "deliver",
        type: "DELIVER",
        title: "Deliver",
        authority: "reviewer",
        expectedArtifact: contract("z/v1", "z", "agent-produced"),
      },
    ],
    edges: [
      { from: "left", to: "deliver", artifact: contract("x/v1", "x", "agent-produced") },
      { from: "right", to: "deliver", artifact: contract("y/v1", "y", "deterministic") },
    ],
  };
  assert.throws(() => compileExecutionGraph(input), /overlapping read\/write sets/);

  const unqualified = structuredClone(input);
  unqualified.nodes[1] = {
    ...unqualified.nodes[1],
    type: "AGENT_EVAL",
    authority: "evaluator",
    readSet: [],
  };
  delete unqualified.nodes[1].parallelGroup;
  delete unqualified.nodes[0].parallelGroup;
  assert.throws(() => compileExecutionGraph(unqualified), /verifierQualificationRef/);

  const external = structuredClone(input);
  delete external.nodes[0].parallelGroup;
  delete external.nodes[1].parallelGroup;
  external.nodes[1].readSet = [];
  external.nodes[0].externalSystems = [{ system: "github", access: "write" }];
  assert.throws(() => compileExecutionGraph(external), /upstream HUMAN_GATE barrier/);
});

test("bounded repair attempts stop a failing agent loop instead of growing trace state forever", () => {
  const buildContract = contract("nodekit.patch/v1", "patch", "agent-produced");
  const graph = compileExecutionGraph({
    projectRef: "caseflow:bounded-repair",
    projectRevision: "abc",
    approvedJourneyRef: ref("approved-journey", "approved"),
    approvedJourneyDigest: sha("approved"),
    designContext: designContext(),
    nodes: [
      {
        id: "repair",
        type: "REPAIR",
        title: "Bounded repair",
        authority: "builder",
        maximumAttempts: 2,
        expectedArtifact: buildContract,
      },
      {
        id: "deliver",
        type: "DELIVER",
        title: "Deliver",
        authority: "reviewer",
        expectedArtifact: contract("nodekit.delivery/v1", "delivery", "agent-produced"),
      },
    ],
    edges: [{ from: "repair", to: "deliver", on: "success", artifact: buildContract }],
  });
  let trace = createExecutionTrace(graph);
  trace = recordExecutionResult(graph, trace, resultFor(graph, "repair", 0, "builder", "repair-agent", "failed"));
  assert.equal(deriveRunnableFrontier(graph, trace)[0].attempt, 2);
  trace = recordExecutionResult(graph, trace, resultFor(graph, "repair", 2, "builder", "repair-agent", "failed"));
  assert.deepEqual(deriveRunnableFrontier(graph, trace), []);
  assert.throws(
    () => recordExecutionResult(graph, trace, resultFor(graph, "repair", 4, "builder", "repair-agent", "failed")),
    /not in the current runnable frontier/,
  );
});

test("tampered graph or trace identities fail closed instead of returning optimistic status", () => {
  const graph = brownfieldGraph();
  const trace = createExecutionTrace(graph);
  const forgedEvents = [{ forged: true }];
  const tamperedTrace = { ...trace, events: forgedEvents, traceDigest: sha(canonical(forgedEvents)) };
  const proof = verifyExecutionProof(graph, tamperedTrace);
  assert.equal(proof.passed, false);
  assert.equal(proof.findings[0].code, "INVALID_EVENT");

  assert.throws(() => createExecutionTrace({ ...graph, source: { ...graph.source, projectRevision: "forged" } }), /identity mismatch/);
});

test("brownfield sequential-versus-graph experiment uses measured thresholds without score floors", async () => {
  const taskDigest = sha("brownfield-task");
  const binding = (kind) => {
    const artifactDigest = sha(kind);
    return { artifactRef: `${kind}:sha256:${artifactDigest}`, artifactDigest };
  };
  const controls = {
    startingCommit: "a".repeat(40),
    codingAgentHarness: binding("coding-agent-harness"),
    modelRoutes: binding("model-routes"),
    approvalPolicy: binding("approval-policy"),
    testFixtures: binding("test-fixtures"),
    deliveryTarget: binding("delivery-target"),
  };
  const run = (runId, overrides = {}) => ({
    runId,
    succeeded: true,
    durationMs: 100,
    costUsd: 1,
    artifactCompleteness: 0.7,
    humanReprompts: 2,
    findingCount: 4,
    writeConflicts: 0,
    validEdgeArtifactRate: 1,
    hiddenTaskDrops: 0,
    falseStageAdvancements: 0,
    criticalDefectsMissed: 0,
    proofValid: true,
    confirmedDefects: 1,
    falseFindings: 0,
    ...overrides,
  });
  const result = evaluateExecutionStrategyExperiment({
    taskRef: `brownfield-task:sha256:${taskDigest}`,
    taskDigest,
    controls,
    thresholds: {
      minimumRunsPerArm: 3,
      maximumSuccessRateRegression: 0,
      maximumMedianDurationRatio: 1.2,
      maximumMedianCostRatio: 1.25,
      minimumCompletenessLift: 0.1,
      minimumWallClockReduction: 0.2,
      minimumConfirmedDefectLift: 0.3,
      maximumFalseFindingIncrease: 0,
    },
    sequentialRuns: [
      run("sequential-1", { durationMs: 100 }),
      run("sequential-2", { succeeded: false, proofValid: false, durationMs: 120, costUsd: 1.2, artifactCompleteness: 0.6, humanReprompts: 3, findingCount: 6 }),
      run("sequential-3", { durationMs: 110, costUsd: 1.1, findingCount: 5 }),
    ],
    graphRuns: [
      run("graph-1", { durationMs: 115, costUsd: 1.2, artifactCompleteness: 0.9, humanReprompts: 0, findingCount: 1, confirmedDefects: 2 }),
      run("graph-2", { durationMs: 120, costUsd: 1.3, artifactCompleteness: 0.9, humanReprompts: 1, findingCount: 2, confirmedDefects: 2 }),
      run("graph-3", { durationMs: 118, costUsd: 1.25, artifactCompleteness: 0.85, humanReprompts: 0, findingCount: 1, confirmedDefects: 2 }),
    ],
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.gates, {
    sampleSize: true,
    successRate: true,
    duration: true,
    cost: true,
    completeness: true,
    writeConflicts: true,
    validEdgeArtifacts: true,
    hiddenTaskDrops: true,
    falseStageAdvancement: true,
    criticalDefectsMissed: true,
    proofValidCompletion: true,
    advantage: true,
  });
  assert.equal(result.arms.sequential.successRate, 2 / 3, "raw measured rate must not receive a hardcoded floor");
  assert.deepEqual(
    await validateSchema("nodekit.execution-strategy-experiment.v1.schema.json", result, "execution strategy experiment"),
    [],
  );

  const undersampled = evaluateExecutionStrategyExperiment({
    taskRef: `brownfield-task:sha256:${taskDigest}`,
    taskDigest,
    controls,
    thresholds: {
      minimumRunsPerArm: 3,
      maximumSuccessRateRegression: 0,
      maximumMedianDurationRatio: 1.2,
        maximumMedianCostRatio: 1.25,
        minimumCompletenessLift: 0.1,
        minimumWallClockReduction: 0.2,
        minimumConfirmedDefectLift: 0.3,
        maximumFalseFindingIncrease: 0,
      },
    sequentialRuns: [run("sequential-only-one")],
    graphRuns: [run("graph-only-one", { artifactCompleteness: 0.9, confirmedDefects: 2 })],
  });
  assert.equal(undersampled.passed, false);
  assert.equal(undersampled.gates.sampleSize, false);
});
