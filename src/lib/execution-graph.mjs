import { contentHash } from "./caseflow.mjs";
import { validateSchema } from "./schema-validation.mjs";

const STAGE_TASK_SCHEMA = "nodekit.stage-task.v1.schema.json";
const EXECUTION_GRAPH_SCHEMA = "nodekit.execution-graph.v1.schema.json";
const EDGE_BINDING_SCHEMA = "nodekit.execution-edge-binding.v1.schema.json";
const RUNNABLE_FRONTIER_SCHEMA = "nodekit.runnable-frontier.v1.schema.json";
const REVIEW_CONTEXT_SCHEMA = "nodekit.review-context.v1.schema.json";
const COMPILER_VERSION = "stage-local-v1";

export const NODETRACE_GRAPH_EVENT_TYPES = Object.freeze([
  "node.started",
  "edge.consumed",
  "artifact.produced",
  "node.completed",
  "node.failed",
  "barrier.opened",
  "barrier.blocked",
]);

function fail(message) {
  throw new Error(message);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value.trim();
}

function canonicalTimestamp(value, label) {
  const timestamp = requireText(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    fail(`${label} must be canonical UTC ISO-8601`);
  }
  return timestamp;
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const normalized = values.map((value, index) => requireText(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must contain unique values`);
  return normalized.sort((left, right) => left.localeCompare(right));
}

async function validateOrThrow(schema, value, label) {
  const findings = await validateSchema(schema, value, label);
  if (findings.length > 0) fail(findings.join("\n"));
}

function withoutDerived(value, idField, hashField) {
  const { [idField]: _id, [hashField]: _hash, ...body } = value;
  return body;
}

function currentCaseState(snapshot, caseId) {
  const caseRecord = snapshot.cases.find((entry) => entry.caseId === caseId);
  if (!caseRecord) fail(`Caseflow case not found: ${caseId}`);
  if (!caseRecord.currentRunId) fail(`Caseflow case has no current run: ${caseId}`);
  const run = snapshot.runs.find((entry) => entry.runId === caseRecord.currentRunId);
  if (!run) fail(`Caseflow current run not found: ${caseRecord.currentRunId}`);
  const stage = run.stages.find((entry) => entry.id === run.currentStageId);
  if (!stage) fail(`Caseflow current stage not found: ${run.currentStageId}`);
  return {
    caseRecord,
    run,
    stage,
    caseContentHash: contentHash({ caseRecord, run, stage }),
  };
}

function canonicalArtifact(artifact) {
  const version = artifact?.versions?.find((entry) => entry.version === artifact.canonicalVersion);
  if (!version) fail(`artifact is missing canonical version: ${artifact?.artifactId ?? "unknown"}`);
  return { artifact, version };
}

function artifactIndex(snapshot) {
  return new Map(snapshot.artifacts.map((artifact) => [artifact.artifactId, canonicalArtifact(artifact)]));
}

function normalizeTask(task) {
  return {
    ...task,
    readSet: sortedUnique(task.readSet, `${task.taskId}.readSet`),
    writeSet: sortedUnique(task.writeSet, `${task.taskId}.writeSet`),
    outputSlots: [...task.outputSlots].sort((left, right) => left.slot.localeCompare(right.slot)),
    inputs: [...task.inputs].sort((left, right) =>
      left.fromTaskId.localeCompare(right.fromTaskId)
      || left.outputSlot.localeCompare(right.outputSlot)
      || left.inputSlot.localeCompare(right.inputSlot)),
  };
}

function graphNodeId(taskId) {
  return `node:${taskId}`;
}

function edgeBody(input, sourceNodeId, targetNodeId) {
  return {
    from: {
      nodeId: sourceNodeId,
      outputSlot: input.outputSlot,
    },
    to: {
      nodeId: targetNodeId,
      inputSlot: input.inputSlot,
    },
    requiredSchemaVersion: input.requiredSchemaVersion,
    authorityRequirement: input.authorityRequirement,
    required: input.required,
  };
}

function graphBody(graph) {
  return {
    schemaVersion: graph.schemaVersion,
    caseBinding: graph.caseBinding,
    compiler: graph.compiler,
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

// @nodekit-behavior runtime.stage-graph owner
// @nodekit-behavior inv:stage-local-execution-graph owner
export async function compileStageExecutionGraph({
  snapshot,
  caseId,
  taskArtifactIds,
  compilerVersion = COMPILER_VERSION,
}) {
  const current = currentCaseState(snapshot, caseId);
  const artifacts = artifactIndex(snapshot);
  const uniqueTaskArtifactIds = sortedUnique(taskArtifactIds, "taskArtifactIds");
  const taskBindings = [];
  for (const artifactId of uniqueTaskArtifactIds) {
    const binding = artifacts.get(artifactId);
    if (!binding) fail(`stage task artifact not found: ${artifactId}`);
    if (binding.artifact.kind !== "stage-task") fail(`artifact is not a stage-task: ${artifactId}`);
    if (binding.artifact.caseId !== caseId || binding.artifact.runId !== current.run.runId) {
      fail(`stage task artifact is not bound to the current Caseflow run: ${artifactId}`);
    }
    await validateOrThrow(STAGE_TASK_SCHEMA, binding.version.content, "stage task");
    const task = normalizeTask(binding.version.content);
    if (task.stageId !== current.run.currentStageId) {
      fail(`stage task ${task.taskId} does not belong to current Caseflow stage ${current.run.currentStageId}`);
    }
    if (contentHash(task) !== contentHash(binding.version.content)) {
      fail(`stage task ${task.taskId} set-like fields must use canonical order`);
    }
    taskBindings.push({ artifactId, contentHash: binding.version.contentHash, task });
  }
  taskBindings.sort((left, right) => left.task.taskId.localeCompare(right.task.taskId));
  const tasks = new Map(taskBindings.map((binding) => [binding.task.taskId, binding]));
  if (tasks.size !== taskBindings.length) fail("stage taskIds must be unique");

  const edges = [];
  for (const { task } of taskBindings) {
    for (const input of task.inputs) {
      const source = tasks.get(input.fromTaskId);
      if (!source) fail(`stage task ${task.taskId} has unknown source task: ${input.fromTaskId}`);
      const output = source.task.outputSlots.find((slot) => slot.slot === input.outputSlot);
      if (!output) fail(`stage task ${input.fromTaskId} does not expose output slot ${input.outputSlot}`);
      if (output.schemaVersion !== input.requiredSchemaVersion) {
        fail(`edge schema mismatch: ${input.fromTaskId}.${input.outputSlot} does not satisfy ${input.requiredSchemaVersion}`);
      }
      const body = edgeBody(input, graphNodeId(input.fromTaskId), graphNodeId(task.taskId));
      edges.push({ edgeId: `edge:${contentHash(body)}`, ...body });
    }
  }
  edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  if (new Set(edges.map((edge) => edge.edgeId)).size !== edges.length) fail("execution edgeIds must be unique");

  const nodes = taskBindings.map(({ artifactId, task }) => ({
    nodeId: graphNodeId(task.taskId),
    kind: task.kind,
    taskRef: artifactId,
    readSet: task.readSet,
    writeSet: task.writeSet,
    requiredEdgeIds: edges
      .filter((edge) => edge.to.nodeId === graphNodeId(task.taskId) && edge.required)
      .map((edge) => edge.edgeId)
      .sort((left, right) => left.localeCompare(right)),
    outputSlots: task.outputSlots,
    ...(task.reviewContextRef === undefined ? {} : { reviewContextRef: task.reviewContextRef }),
  }));

  for (const node of [...nodes]) {
    if (node.requiredEdgeIds.length < 2) continue;
    const barrierKey = contentHash({ targetNodeId: node.nodeId, requiredEdgeIds: node.requiredEdgeIds });
    nodes.push({
      nodeId: `barrier:${barrierKey}`,
      kind: "barrier",
      taskRef: `derived:all-required:${node.nodeId}`,
      readSet: [],
      writeSet: [],
      requiredEdgeIds: [...node.requiredEdgeIds],
      outputSlots: [],
    });
  }
  nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  const caseBinding = {
    caseId,
    stageId: current.run.currentStageId,
    caseContentHash: current.caseContentHash,
  };
  const compiler = {
    version: requireText(compilerVersion, "compilerVersion"),
    inputContentHash: contentHash({
      caseBinding,
      taskBindings: taskBindings.map(({ artifactId, contentHash: taskContentHash }) => ({
        artifactId,
        contentHash: taskContentHash,
      })),
    }),
  };
  const body = {
    schemaVersion: "nodekit.execution-graph/v1",
    caseBinding,
    compiler,
    nodes,
    edges,
  };
  const graphHash = contentHash(body);
  const graph = {
    ...body,
    graphId: `execution-graph:sha256:${graphHash}`,
    graphHash,
  };
  await verifyExecutionGraph(graph);
  return graph;
}

function assertAcyclic(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.nodeId, []]));
  for (const edge of graph.edges) adjacency.get(edge.from.nodeId).push(edge.to.nodeId);
  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId, trail) {
    if (visiting.has(nodeId)) fail(`execution graph contains a cycle: ${[...trail, nodeId].join(" -> ")}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId)) visit(target, [...trail, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of adjacency.keys()) visit(nodeId, []);
}

export async function verifyExecutionGraph(graph) {
  await validateOrThrow(EXECUTION_GRAPH_SCHEMA, graph, "execution graph");
  const expectedHash = contentHash(graphBody(graph));
  if (graph.graphHash !== expectedHash) fail("execution graph hash does not match its canonical body");
  if (graph.graphId !== `execution-graph:sha256:${expectedHash}`) {
    fail("execution graph id does not match its canonical body");
  }
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  if (nodes.size !== graph.nodes.length) fail("execution graph nodeIds must be unique");
  if (new Set(graph.edges.map((edge) => edge.edgeId)).size !== graph.edges.length) {
    fail("execution graph edgeIds must be unique");
  }
  for (const node of graph.nodes) {
    if (node.kind === "review" && node.writeSet.length > 0) fail(`review node has non-empty writeSet: ${node.nodeId}`);
    if (node.kind === "barrier" && !node.taskRef.startsWith("derived:")) {
      fail(`barrier must be derived state: ${node.nodeId}`);
    }
  }
  for (const edge of graph.edges) {
    const source = nodes.get(edge.from.nodeId);
    const target = nodes.get(edge.to.nodeId);
    if (!source || !target) fail(`execution edge endpoint does not resolve: ${edge.edgeId}`);
    const output = source.outputSlots.find((slot) => slot.slot === edge.from.outputSlot);
    if (!output) fail(`execution edge output slot does not resolve: ${edge.edgeId}`);
    if (output.schemaVersion !== edge.requiredSchemaVersion) {
      fail(`execution edge output schema does not match: ${edge.edgeId}`);
    }
    if (edge.required && !target.requiredEdgeIds.includes(edge.edgeId)) {
      fail(`required execution edge is absent from target requiredEdgeIds: ${edge.edgeId}`);
    }
  }
  assertAcyclic(graph);
  return { graph, graphHash: expectedHash, verified: true };
}

export function sealExecutionEdgeBinding(input) {
  const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
  const body = {
    schemaVersion: "nodekit.execution-edge-binding/v1",
    graphId: requireText(input.graphId, "graphId"),
    graphHash: requireText(input.graphHash, "graphHash"),
    edgeId: requireText(input.edgeId, "edgeId"),
    producer: {
      nodeId: requireText(input.producer?.nodeId, "producer.nodeId"),
      runId: requireText(input.producer?.runId, "producer.runId"),
    },
    artifact: {
      artifactId: requireText(input.artifact?.artifactId, "artifact.artifactId"),
      schemaVersion: requireText(input.artifact?.schemaVersion, "artifact.schemaVersion"),
      contentHash: requireText(input.artifact?.contentHash, "artifact.contentHash"),
    },
    ...(input.repositoryBinding === undefined ? {} : {
      repositoryBinding: {
        remote: requireText(input.repositoryBinding.remote, "repositoryBinding.remote"),
        commitSha: requireText(input.repositoryBinding.commitSha, "repositoryBinding.commitSha"),
        treeHash: requireText(input.repositoryBinding.treeHash, "repositoryBinding.treeHash"),
      },
    }),
    authority: {
      kind: input.authority?.kind,
      ...(input.authority?.attestationRef === undefined ? {} : {
        attestationRef: requireText(input.authority.attestationRef, "authority.attestationRef"),
      }),
      ...(input.authority?.receiptRef === undefined ? {} : {
        receiptRef: requireText(input.authority.receiptRef, "authority.receiptRef"),
      }),
    },
    createdAt,
  };
  const bindingHash = contentHash(body);
  return {
    ...body,
    bindingId: `execution-edge-binding:sha256:${bindingHash}`,
    bindingHash,
  };
}

function receiptBindsArtifact(receipt, artifact) {
  return receipt?.artifactBindings?.some((binding) =>
    binding.artifactId === artifact.artifactId
    && binding.canonicalVersion === artifact.canonicalVersion
    && binding.contentHash === artifact.version.contentHash);
}

function repositoryBindingMatches(actual, expected) {
  return actual?.remote === expected?.remote
    && actual?.commitSha === expected?.commitSha
    && actual?.treeHash === expected?.treeHash;
}

// @nodekit-behavior runtime.stage-graph support
export async function verifyExecutionEdgeBinding({
  binding,
  graph,
  snapshot,
  repositoryState,
  verifyHumanAttestation,
  verifyNodeProofReceipt,
}) {
  await validateOrThrow(EDGE_BINDING_SCHEMA, binding, "execution edge binding");
  await verifyExecutionGraph(graph);
  const expectedHash = contentHash(withoutDerived(binding, "bindingId", "bindingHash"));
  if (binding.bindingHash !== expectedHash) fail("execution edge binding hash does not match its canonical body");
  if (binding.bindingId !== `execution-edge-binding:sha256:${expectedHash}`) {
    fail("execution edge binding id does not match its canonical body");
  }
  if (binding.graphId !== graph.graphId || binding.graphHash !== graph.graphHash) {
    fail("execution edge binding is bound to a different graph");
  }
  const edge = graph.edges.find((entry) => entry.edgeId === binding.edgeId);
  if (!edge) fail(`bound execution edge does not exist: ${binding.edgeId}`);
  if (binding.producer.nodeId !== edge.from.nodeId) fail("execution edge producer does not match source node");
  const producerRun = snapshot.runs.find((entry) => entry.runId === binding.producer.runId);
  if (!producerRun) fail(`execution edge producer run does not exist: ${binding.producer.runId}`);
  if (["cancelled", "failed_safely"].includes(producerRun.status)) {
    fail(`execution edge producer run is terminal without success: ${producerRun.status}`);
  }
  if (producerRun.caseId !== graph.caseBinding.caseId) fail("execution edge producer run belongs to another case");

  const artifacts = artifactIndex(snapshot);
  const artifact = artifacts.get(binding.artifact.artifactId);
  if (!artifact) fail(`bound execution artifact does not exist: ${binding.artifact.artifactId}`);
  if (artifact.version.contentHash !== binding.artifact.contentHash) {
    fail("execution edge artifact hash does not match canonical bytes");
  }
  if (artifact.version.content?.schemaVersion !== binding.artifact.schemaVersion) {
    fail("execution edge artifact schemaVersion does not match canonical bytes");
  }
  if (binding.artifact.schemaVersion !== edge.requiredSchemaVersion) {
    fail("execution edge artifact schema does not satisfy edge requirement");
  }
  if (repositoryState !== undefined && !repositoryBindingMatches(binding.repositoryBinding, repositoryState)) {
    fail("execution edge repository binding does not match the verified repository state");
  }
  if (binding.authority.kind !== edge.authorityRequirement) {
    fail("execution edge authority does not satisfy edge requirement");
  }

  if (binding.authority.kind === "deterministic") {
    if (!binding.authority.receiptRef) fail("deterministic execution edge requires receiptRef");
    const receipt = snapshot.receipts.find((entry) => entry.receiptId === binding.authority.receiptRef);
    if (!receiptBindsArtifact(receipt, artifact)) fail("deterministic receipt does not bind the exact artifact");
  } else if (binding.authority.kind === "human-attested") {
    if (!binding.authority.attestationRef) fail("human-attested execution edge requires attestationRef");
    if (typeof verifyHumanAttestation !== "function") fail("human attestation verifier is required");
    const verdict = await verifyHumanAttestation(binding.authority.attestationRef);
    if (!verdict?.verified || !["H2", "H3"].includes(verdict.trustLevel)) {
      fail("human-attested execution edge requires a verified H2 or H3 attestation");
    }
  } else if (binding.authority.kind === "nodeproof-verified") {
    if (!binding.authority.receiptRef) fail("nodeproof-verified execution edge requires receiptRef");
    if (typeof verifyNodeProofReceipt !== "function") fail("NodeProof receipt verifier is required");
    const verdict = await verifyNodeProofReceipt(binding.authority.receiptRef);
    if (!verdict?.verified) fail("NodeProof receipt did not verify");
  }
  return { binding, bindingHash: expectedHash, edge, verified: true };
}

function normalizeScope(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalized === "" ? "." : normalized;
}

function scopesOverlap(left, right) {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if ([".", "*"].includes(a) || [".", "*"].includes(b)) return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function nodesConflict(left, right) {
  return left.writeSet.some((leftScope) =>
    right.writeSet.some((rightScope) => scopesOverlap(leftScope, rightScope)));
}

function frontierBody(frontier) {
  const { frontierHash: _hash, ...body } = frontier;
  return body;
}

// @nodekit-behavior runtime.stage-graph support
export async function deriveRunnableFrontier({
  graph,
  snapshot,
  bindings,
  repositoryState,
  verifyHumanAttestation,
  verifyNodeProofReceipt,
}) {
  await verifyExecutionGraph(graph);
  const current = currentCaseState(snapshot, graph.caseBinding.caseId);
  const executableNodes = graph.nodes.filter((node) => node.kind !== "barrier");
  if (current.run.currentStageId !== graph.caseBinding.stageId
    || current.caseContentHash !== graph.caseBinding.caseContentHash) {
    const stale = {
      schemaVersion: "nodekit.runnable-frontier/v1",
      graphId: graph.graphId,
      graphHash: graph.graphHash,
      caseBinding: graph.caseBinding,
      consumedBindingHashes: [],
      runnableNodeIds: [],
      blocked: executableNodes.map((node) => ({
        nodeId: node.nodeId,
        reasonCode: "STAGE_NOT_CURRENT",
        blockingEdgeIds: [],
        conflictingNodeIds: [],
      })),
    };
    const result = { ...stale, frontierHash: contentHash(stale) };
    await validateOrThrow(RUNNABLE_FRONTIER_SCHEMA, result, "runnable frontier");
    return result;
  }

  const validBindings = [];
  const invalidBindings = [];
  for (const binding of bindings) {
    try {
      const verified = await verifyExecutionEdgeBinding({
        binding,
        graph,
        snapshot,
        repositoryState,
        verifyHumanAttestation,
        verifyNodeProofReceipt,
      });
      validBindings.push(verified.binding);
    } catch (error) {
      invalidBindings.push({
        binding,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const validByEdge = new Map(validBindings.map((binding) => [binding.edgeId, binding]));
  const invalidByEdge = new Map();
  for (const invalid of invalidBindings) {
    const bucket = invalidByEdge.get(invalid.binding.edgeId) ?? [];
    bucket.push(invalid);
    invalidByEdge.set(invalid.binding.edgeId, bucket);
  }
  const completedNodeIds = new Set(validBindings.map((binding) => binding.producer.nodeId));
  const candidates = [];
  const blocked = [];

  for (const node of executableNodes) {
    if (completedNodeIds.has(node.nodeId)) continue;
    const missing = node.requiredEdgeIds.filter((edgeId) => !validByEdge.has(edgeId));
    if (missing.length === 0) {
      candidates.push(node);
      continue;
    }
    const invalid = missing.flatMap((edgeId) => invalidByEdge.get(edgeId) ?? []);
    const authorityFailure = invalid.some((entry) => /authority|attestation|NodeProof|receipt/.test(entry.message));
    blocked.push({
      nodeId: node.nodeId,
      reasonCode: invalid.length > 0
        ? (authorityFailure ? "AUTHORITY_REQUIRED" : "INVALID_EDGE")
        : (node.requiredEdgeIds.length > 1 ? "BARRIER_CLOSED" : "MISSING_EDGE"),
      blockingEdgeIds: missing.sort((left, right) => left.localeCompare(right)),
      conflictingNodeIds: [],
    });
  }

  candidates.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const selected = [];
  for (const candidate of candidates) {
    const conflicts = selected.filter((node) => nodesConflict(candidate, node));
    if (conflicts.length === 0) {
      selected.push(candidate);
    } else {
      blocked.push({
        nodeId: candidate.nodeId,
        reasonCode: "WRITE_CONFLICT",
        blockingEdgeIds: [],
        conflictingNodeIds: conflicts.map((node) => node.nodeId),
      });
    }
  }
  blocked.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const body = {
    schemaVersion: "nodekit.runnable-frontier/v1",
    graphId: graph.graphId,
    graphHash: graph.graphHash,
    caseBinding: graph.caseBinding,
    consumedBindingHashes: validBindings
      .map((binding) => binding.bindingHash)
      .sort((left, right) => left.localeCompare(right)),
    runnableNodeIds: selected.map((node) => node.nodeId),
    blocked,
  };
  const frontier = { ...body, frontierHash: contentHash(body) };
  await validateOrThrow(RUNNABLE_FRONTIER_SCHEMA, frontier, "runnable frontier");
  return frontier;
}

export async function verifyRunnableFrontier(frontier) {
  await validateOrThrow(RUNNABLE_FRONTIER_SCHEMA, frontier, "runnable frontier");
  const expectedHash = contentHash(frontierBody(frontier));
  if (frontier.frontierHash !== expectedHash) fail("runnable frontier hash does not match its canonical body");
  return { frontier, frontierHash: expectedHash, verified: true };
}

export async function deriveReviewContext({
  builder,
  reviewer,
  protectedEvaluatorRefs = [],
  verifyHumanAttestation,
}) {
  if (reviewer?.separation !== undefined) fail("caller cannot set separation");
  const builderRunId = requireText(builder?.runId, "builder.runId");
  const reviewerRunId = requireText(reviewer?.runId, "reviewer.runId");
  const builderSessionId = requireText(builder?.sessionId, "builder.sessionId");
  const reviewerSessionId = requireText(reviewer?.sessionId, "reviewer.sessionId");
  const builderModelRef = requireText(builder?.modelRef, "builder.modelRef");
  const reviewerModelRef = requireText(reviewer?.modelRef, "reviewer.modelRef");
  const reviewerIdentityRef = requireText(reviewer?.identityRef, "reviewer.identityRef");
  const protectedEvaluator = reviewer.evaluatorRef !== undefined
    && protectedEvaluatorRefs.includes(reviewer.evaluatorRef);

  let verifiedHuman = false;
  if (reviewer.humanAttestationRef !== undefined && typeof verifyHumanAttestation === "function") {
    const verdict = await verifyHumanAttestation(reviewer.humanAttestationRef);
    verifiedHuman = verdict?.verified === true && ["H2", "H3"].includes(verdict.trustLevel);
  }
  const separation = verifiedHuman
    ? "independent-human"
    : protectedEvaluator
      && reviewerSessionId !== builderSessionId
      && reviewerModelRef !== builderModelRef
      ? "independent-model"
      : reviewerSessionId === builderSessionId
        ? "same-context"
        : "fresh-context";
  const context = {
    schemaVersion: "nodekit.review-context/v1",
    builderRunId,
    reviewerRunId,
    separation,
    protectedEvaluator,
    reviewerModelRef,
    reviewerIdentityRef,
    ...(verifiedHuman ? { humanAttestationRef: reviewer.humanAttestationRef } : {}),
  };
  await verifyReviewContext(context);
  return context;
}

export async function verifyReviewContext(context) {
  await validateOrThrow(REVIEW_CONTEXT_SCHEMA, context, "review context");
  if (context.separation === "independent-model" && !context.protectedEvaluator) {
    fail("independent-model review requires a protected evaluator");
  }
  if (context.separation === "independent-human" && !context.humanAttestationRef) {
    fail("independent-human review requires humanAttestationRef");
  }
  return { context, verified: true };
}
