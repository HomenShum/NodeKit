import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { contentHash, createMemoryCaseflow } from "../src/lib/caseflow.mjs";
import {
  NODETRACE_GRAPH_EVENT_TYPES,
  compileStageExecutionGraph,
  deriveReviewContext,
  deriveRunnableFrontier,
  sealExecutionEdgeBinding,
  verifyExecutionEdgeBinding,
  verifyExecutionGraph,
  verifyReviewContext,
} from "../src/lib/execution-graph.mjs";

const ACTOR = { id: "agent:stage-graph-test", type: "agent" };
const NOW = "2026-07-29T12:00:00.000Z";
const REPOSITORY = {
  remote: "https://github.com/HomenShum/node-platform.git",
  commitSha: "a".repeat(40),
  treeHash: "b".repeat(64),
};
const execFileAsync = promisify(execFile);

function stageTask({
  taskId,
  stageId = "build",
  kind = "task",
  readSet = [],
  writeSet = [],
  outputSlots = [{ slot: "result", schemaVersion: `candidate/${taskId}/v1` }],
  inputs = [],
  reviewContextRef,
}) {
  return {
    schemaVersion: "nodekit.stage-task/v1",
    taskId,
    stageId,
    kind,
    readSet,
    writeSet,
    outputSlots,
    inputs,
    ...(reviewContextRef === undefined ? {} : { reviewContextRef }),
  };
}

function scenario(tasks) {
  const caseflow = createMemoryCaseflow({
    clock: () => NOW,
    ownerId: "owner:stage-graph-test",
  });
  const caseRecord = caseflow.createCase({
    title: "Stage-local graph",
    primaryJob: "Run only safe work inside the current Caseflow stage.",
    actor: ACTOR,
  });
  const run = caseflow.startRun({
    caseId: caseRecord.caseId,
    stages: [
      { id: "build", label: "Build", owner: "agent" },
      { id: "prove", label: "Prove", owner: "reviewer" },
    ],
    actor: ACTOR,
  });
  const taskArtifacts = tasks.map((task) => caseflow.createArtifact({
    caseId: caseRecord.caseId,
    runId: run.runId,
    kind: "stage-task",
    title: task.taskId,
    content: task,
    actor: ACTOR,
  }));
  return { caseflow, caseRecord, run, taskArtifacts };
}

function compile(input) {
  return compileStageExecutionGraph({
    snapshot: input.caseflow.snapshot(),
    caseId: input.caseRecord.caseId,
    taskArtifactIds: input.taskArtifacts.map((artifact) => artifact.artifactId),
  });
}

// @nodekit-verifies runtime.stage-graph#deterministic-current-stage-only
// @nodekit-verifies inv:stage-local-execution-graph#deterministic-current-stage-only
test("the stage-local compiler is deterministic across 100 runs and never imports another stage", async () => {
  const input = scenario([
    stageTask({ taskId: "inspect.repository", writeSet: [] }),
    stageTask({
      taskId: "build.ui",
      writeSet: ["src/ui"],
      inputs: [{
        fromTaskId: "inspect.repository",
        outputSlot: "result",
        inputSlot: "repository",
        requiredSchemaVersion: "candidate/inspect.repository/v1",
        authorityRequirement: "agent-produced",
        required: true,
      }],
    }),
    stageTask({ taskId: "future.proof", stageId: "prove" }),
  ]);

  await assert.rejects(
    () => compile(input),
    /does not belong to current Caseflow stage build/,
  );

  input.taskArtifacts = input.taskArtifacts.slice(0, 2);
  const hashes = [];
  for (let index = 0; index < 100; index += 1) {
    const graph = await compile(input);
    hashes.push(graph.graphHash);
    assert.equal(graph.caseBinding.stageId, "build");
    assert.equal(graph.nodes.every((node) => !node.taskRef.includes("future.proof")), true);
  }
  assert.equal(new Set(hashes).size, 1);
  assert.equal(hashes.length, 100);
  const verifiedGraph = await compile(input);
  await assert.doesNotReject(() => verifyExecutionGraph(verifiedGraph));
});

// @nodekit-verifies runtime.stage-graph#overlapping-writes-excluded
// @nodekit-verifies inv:stage-local-execution-graph#overlapping-writes-excluded
test("the runnable frontier admits every disjoint pair and never admits an overlapping pair", async () => {
  const tasks = [];
  for (let index = 0; index < 50; index += 1) {
    tasks.push(stageTask({
      taskId: `disjoint.${index}.a`,
      writeSet: [`src/disjoint/${index}/a`],
    }));
    tasks.push(stageTask({
      taskId: `disjoint.${index}.b`,
      writeSet: [`src/disjoint/${index}/b`],
    }));
    tasks.push(stageTask({
      taskId: `overlap.${index}.parent`,
      writeSet: [`src/overlap/${index}`],
    }));
    tasks.push(stageTask({
      taskId: `overlap.${index}.child`,
      writeSet: [`src/overlap/${index}/child`],
    }));
  }
  const input = scenario(tasks);
  const graph = await compile(input);
  const frontier = await deriveRunnableFrontier({
    graph,
    snapshot: input.caseflow.snapshot(),
    bindings: [],
    repositoryState: REPOSITORY,
  });

  const runnable = new Set(frontier.runnableNodeIds);
  for (let index = 0; index < 50; index += 1) {
    assert.equal(runnable.has(`node:disjoint.${index}.a`), true);
    assert.equal(runnable.has(`node:disjoint.${index}.b`), true);
    assert.equal(
      runnable.has(`node:overlap.${index}.parent`)
        && runnable.has(`node:overlap.${index}.child`),
      false,
    );
  }
  assert.equal(
    frontier.blocked.filter((entry) => entry.reasonCode === "WRITE_CONFLICT").length,
    50,
  );
});

// @nodekit-verifies runtime.stage-graph#mutated-bindings-rejected
// @nodekit-verifies inv:stage-local-execution-graph#mutated-bindings-rejected
test("20 independently mutated edge bindings all fail closed and unlock no downstream node", async () => {
  const input = scenario([
    stageTask({ taskId: "source" }),
    stageTask({
      taskId: "target",
      inputs: [{
        fromTaskId: "source",
        outputSlot: "result",
        inputSlot: "source",
        requiredSchemaVersion: "candidate/source/v1",
        authorityRequirement: "agent-produced",
        required: true,
      }],
    }),
  ]);
  const graph = await compile(input);
  const edge = graph.edges[0];
  const output = input.caseflow.createArtifact({
    caseId: input.caseRecord.caseId,
    runId: input.run.runId,
    kind: "task-output",
    title: "Source output",
    content: { schemaVersion: "candidate/source/v1", value: "bound" },
    actor: ACTOR,
  });
  const valid = sealExecutionEdgeBinding({
    graphId: graph.graphId,
    graphHash: graph.graphHash,
    edgeId: edge.edgeId,
    producer: { nodeId: edge.from.nodeId, runId: input.run.runId },
    artifact: {
      artifactId: output.artifactId,
      schemaVersion: "candidate/source/v1",
      contentHash: output.versions[0].contentHash,
    },
    repositoryBinding: REPOSITORY,
    authority: { kind: "agent-produced" },
    createdAt: NOW,
  });
  await assert.doesNotReject(() => verifyExecutionEdgeBinding({
    binding: valid,
    graph,
    snapshot: input.caseflow.snapshot(),
    repositoryState: REPOSITORY,
  }));

  const mutations = Array.from({ length: 20 }, (_, index) => {
    const variant = index % 8;
    if (variant === 0) return { ...valid, graphHash: `${index % 10}`.repeat(64) };
    if (variant === 1) return { ...valid, edgeId: `edge:missing.${index}` };
    if (variant === 2) return { ...valid, producer: { ...valid.producer, nodeId: "node:target" } };
    if (variant === 3) return { ...valid, artifact: { ...valid.artifact, contentHash: `${index % 10}`.repeat(64) } };
    if (variant === 4) return { ...valid, artifact: { ...valid.artifact, schemaVersion: "candidate/wrong/v1" } };
    if (variant === 5) return {
      ...valid,
      repositoryBinding: { ...valid.repositoryBinding, commitSha: `${index % 10}`.repeat(40) },
    };
    if (variant === 6) return { ...valid, authority: { kind: "deterministic" } };
    return { ...valid, bindingHash: `${index % 10}`.repeat(64) };
  });

  for (const mutation of mutations) {
    await assert.rejects(() => verifyExecutionEdgeBinding({
      binding: mutation,
      graph,
      snapshot: input.caseflow.snapshot(),
      repositoryState: REPOSITORY,
    }));
    const frontier = await deriveRunnableFrontier({
      graph,
      snapshot: input.caseflow.snapshot(),
      bindings: [mutation],
      repositoryState: REPOSITORY,
    });
    assert.equal(frontier.runnableNodeIds.includes("node:target"), false);
  }
});

// @nodekit-verifies runtime.stage-graph#stale-stage-blocked
// @nodekit-verifies inv:stage-local-execution-graph#stale-stage-blocked
test("a stale Caseflow stage blocks every projected node and cannot advance Caseflow", async () => {
  const input = scenario([stageTask({ taskId: "build.ui", writeSet: ["src/ui"] })]);
  const graph = await compile(input);
  const snapshot = input.caseflow.snapshot();
  snapshot.runs[0].currentStageId = "prove";
  const frontier = await deriveRunnableFrontier({
    graph,
    snapshot,
    bindings: [],
    repositoryState: REPOSITORY,
  });

  assert.deepEqual(frontier.runnableNodeIds, []);
  assert.deepEqual(frontier.blocked, [{
    nodeId: "node:build.ui",
    reasonCode: "STAGE_NOT_CURRENT",
    blockingEdgeIds: [],
    conflictingNodeIds: [],
  }]);
  assert.equal(typeof graph.advanceStage, "undefined");
  assert.equal(typeof frontier.advanceStage, "undefined");
});

test("review separation is derived for all six required cases and never caller supplied", async () => {
  const baseBuilder = {
    runId: "run:builder",
    sessionId: "session:builder",
    modelRef: "model:a",
    identityRef: "agent:builder",
  };
  const cases = [
    {
      reviewer: { ...baseBuilder, runId: "run:self" },
      expected: "same-context",
    },
    {
      reviewer: { ...baseBuilder, runId: "run:prompt" },
      expected: "same-context",
    },
    {
      reviewer: {
        runId: "run:fresh-cli",
        sessionId: "session:fresh-cli",
        modelRef: "model:a",
        identityRef: "agent:builder",
      },
      expected: "fresh-context",
    },
    {
      reviewer: {
        runId: "run:fresh-thread",
        sessionId: "session:fresh-thread",
        modelRef: "model:a",
        identityRef: "agent:reviewer",
      },
      expected: "fresh-context",
    },
    {
      reviewer: {
        runId: "run:protected",
        sessionId: "session:protected",
        modelRef: "model:b",
        identityRef: "agent:protected-reviewer",
        evaluatorRef: "evaluator:protected",
      },
      protectedEvaluatorRefs: ["evaluator:protected"],
      expected: "independent-model",
    },
    {
      reviewer: {
        runId: "run:human",
        sessionId: "session:human",
        modelRef: "human",
        identityRef: "human:reviewer",
        humanAttestationRef: "attestation:h2",
      },
      verifyHumanAttestation: async () => ({ verified: true, trustLevel: "H2" }),
      expected: "independent-human",
    },
  ];

  for (const entry of cases) {
    const context = await deriveReviewContext({
      builder: baseBuilder,
      reviewer: entry.reviewer,
      protectedEvaluatorRefs: entry.protectedEvaluatorRefs ?? [],
      verifyHumanAttestation: entry.verifyHumanAttestation,
    });
    assert.equal(context.separation, entry.expected);
    await assert.doesNotReject(() => verifyReviewContext(context));
  }

  await assert.rejects(() => deriveReviewContext({
    builder: baseBuilder,
    reviewer: {
      ...baseBuilder,
      runId: "run:forged",
      separation: "independent-model",
    },
    protectedEvaluatorRefs: [],
  }), /caller cannot set separation/);
});

test("the graph layer exposes NodeTrace vocabulary but no approval, verdict, or stage authority", async () => {
  const input = scenario([stageTask({ taskId: "build.ui" })]);
  const graph = await compile(input);
  assert.deepEqual(NODETRACE_GRAPH_EVENT_TYPES, [
    "node.started",
    "edge.consumed",
    "artifact.produced",
    "node.completed",
    "node.failed",
    "barrier.opened",
    "barrier.blocked",
  ]);
  const serialized = JSON.stringify(graph);
  assert.equal(serialized.includes('"approval"'), false);
  assert.equal(serialized.includes('"verdict"'), false);
  assert.equal(serialized.includes('"advanceStage"'), false);
  assert.equal(graph.graphHash, contentHash({
    schemaVersion: graph.schemaVersion,
    caseBinding: graph.caseBinding,
    compiler: graph.compiler,
    nodes: graph.nodes,
    edges: graph.edges,
  }));
});

// @nodekit-verifies runtime.stage-graph#protected-authority-fails-closed
// @nodekit-verifies inv:stage-local-execution-graph#protected-authority-fails-closed
test("a release integrator can compile, bind, and derive a frontier through the CLI while mutations and protected-authority claims fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-stage-graph-cli-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const cli = path.resolve("src", "cli.mjs");
  const run = async (...args) => JSON.parse((await execFileAsync(
    process.execPath,
    [cli, ...args, "--repo-root", root, "--json"],
    { maxBuffer: 8 * 1024 * 1024 },
  )).stdout);
  const write = (name, value) => writeFile(
    path.join(root, name),
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );

  const input = scenario([
    stageTask({ taskId: "inspect.repository", readSet: ["repository"], writeSet: [] }),
    stageTask({
      taskId: "build.notebook",
      readSet: ["repository"],
      writeSet: ["src/notebook"],
      inputs: [{
        fromTaskId: "inspect.repository",
        outputSlot: "result",
        inputSlot: "repository",
        requiredSchemaVersion: "candidate/inspect.repository/v1",
        authorityRequirement: "agent-produced",
        required: true,
      }],
    }),
  ]);
  const compileInput = {
    snapshot: input.caseflow.snapshot(),
    caseId: input.caseRecord.caseId,
    taskArtifactIds: input.taskArtifacts.map((artifact) => artifact.artifactId),
  };
  await write("compile.json", compileInput);
  const graph = await run("graph", "compile", "--input", "compile.json");
  assert.equal(graph.schemaVersion, "nodekit.execution-graph/v1");
  assert.equal(graph.caseBinding.stageId, "build");

  const output = input.caseflow.createArtifact({
    caseId: input.caseRecord.caseId,
    runId: input.run.runId,
    kind: "task-output",
    title: "Repository inspection",
    content: { schemaVersion: "candidate/inspect.repository/v1", finding: "notebook route located" },
    actor: ACTOR,
  });
  const edge = graph.edges[0];
  const draft = {
    graphId: graph.graphId,
    graphHash: graph.graphHash,
    edgeId: edge.edgeId,
    producer: { nodeId: edge.from.nodeId, runId: input.run.runId },
    artifact: {
      artifactId: output.artifactId,
      schemaVersion: output.versions[0].content.schemaVersion,
      contentHash: output.versions[0].contentHash,
    },
    repositoryBinding: REPOSITORY,
    authority: { kind: "agent-produced" },
    createdAt: NOW,
  };
  const snapshot = input.caseflow.snapshot();
  await write("bind.json", { draft, graph, snapshot, repositoryState: REPOSITORY });
  const binding = await run("graph", "bind-edge", "--input", "bind.json");
  assert.equal(binding.edgeId, edge.edgeId);

  await write("frontier.json", {
    graph,
    snapshot,
    bindings: [binding],
    repositoryState: REPOSITORY,
  });
  const frontier = await run("graph", "frontier", "--input", "frontier.json");
  assert.deepEqual(frontier.runnableNodeIds, ["node:build.notebook"]);
  assert.equal(frontier.blocked.length, 0);

  await write("mutated-bind.json", {
    draft: {
      ...draft,
      artifact: { ...draft.artifact, contentHash: "c".repeat(64) },
    },
    graph,
    snapshot,
    repositoryState: REPOSITORY,
  });
  await assert.rejects(
    () => run("graph", "bind-edge", "--input", "mutated-bind.json"),
    (error) => {
      assert.match(`${error.stdout ?? ""}\n${error.stderr ?? ""}`, /artifact hash does not match canonical bytes/);
      return true;
    },
  );

  const staleSnapshot = structuredClone(snapshot);
  staleSnapshot.runs.find((runRecord) => runRecord.runId === input.run.runId).currentStageId = "prove";
  await write("stale-frontier.json", {
    graph,
    snapshot: staleSnapshot,
    bindings: [binding],
    repositoryState: REPOSITORY,
  });
  const stale = await run("graph", "frontier", "--input", "stale-frontier.json");
  assert.deepEqual(stale.runnableNodeIds, []);
  assert.equal(stale.blocked.every((entry) => entry.reasonCode === "STAGE_NOT_CURRENT"), true);

  await write("malformed.json", "{ not-json");
  await assert.rejects(
    () => run("graph", "compile", "--input", "malformed.json"),
    (error) => {
      assert.match(`${error.stdout ?? ""}\n${error.stderr ?? ""}`, /invalid JSON/);
      return true;
    },
  );

  const protectedInput = scenario([
    stageTask({ taskId: "build.candidate" }),
    stageTask({
      taskId: "review.candidate",
      kind: "review",
      writeSet: [],
      reviewContextRef: "review-context:protected",
      inputs: [{
        fromTaskId: "build.candidate",
        outputSlot: "result",
        inputSlot: "candidate",
        requiredSchemaVersion: "candidate/build.candidate/v1",
        authorityRequirement: "human-attested",
        required: true,
      }],
    }),
  ]);
  const protectedGraph = await compile(protectedInput);
  const protectedOutput = protectedInput.caseflow.createArtifact({
    caseId: protectedInput.caseRecord.caseId,
    runId: protectedInput.run.runId,
    kind: "task-output",
    title: "Protected candidate",
    content: { schemaVersion: "candidate/build.candidate/v1", value: "requires a real verifier" },
    actor: ACTOR,
  });
  const protectedEdge = protectedGraph.edges[0];
  await write("protected-bind.json", {
    draft: {
      graphId: protectedGraph.graphId,
      graphHash: protectedGraph.graphHash,
      edgeId: protectedEdge.edgeId,
      producer: { nodeId: protectedEdge.from.nodeId, runId: protectedInput.run.runId },
      artifact: {
        artifactId: protectedOutput.artifactId,
        schemaVersion: protectedOutput.versions[0].content.schemaVersion,
        contentHash: protectedOutput.versions[0].contentHash,
      },
      authority: {
        kind: "human-attested",
        attestationRef: "caller-asserted-attestation-must-not-pass",
      },
      createdAt: NOW,
    },
    graph: protectedGraph,
    snapshot: protectedInput.caseflow.snapshot(),
  });
  await assert.rejects(
    () => run("graph", "bind-edge", "--input", "protected-bind.json"),
    (error) => {
      assert.match(`${error.stdout ?? ""}\n${error.stderr ?? ""}`, /human attestation verifier is required/);
      return true;
    },
  );
});
