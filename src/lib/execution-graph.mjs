import { createHash } from "node:crypto";

export const EXECUTION_GRAPH_SCHEMA_VERSION = "nodekit.execution-graph/v1";
export const EXECUTION_TRACE_SCHEMA_VERSION = "nodekit.execution-trace/v1";
export const NODEPROOF_SCHEMA_VERSION = "nodekit.execution-nodeproof/v1";
export const EXECUTION_EXPERIMENT_SCHEMA_VERSION = "nodekit.execution-strategy-experiment/v1";

export const EXECUTION_NODE_TYPES = Object.freeze([
  "CONTEXT",
  "DECISION",
  "BUILD",
  "CHECK",
  "REVIEW",
  "BROWSER",
  "AGENT_EVAL",
  "AGGREGATE",
  "REPAIR",
  "DELIVER",
  "HUMAN_GATE",
]);

const NODE_TYPE_SET = new Set(EXECUTION_NODE_TYPES);
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9-]*:sha256:[a-f0-9]{64}$/;
const MAX_NODES = 512;
const MAX_EDGES = 2_048;
const MAX_EVENTS = 10_000;
const MAX_SET_ITEMS = 256;
const MAX_LIMITATIONS = 32;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function fail(message) {
  throw new Error(`execution graph: ${message}`);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function timestamp(value, label) {
  nonEmpty(value, label);
  if (!Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO timestamp`);
  return value;
}

function exactEnum(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} must be one of ${allowed.join(", ")}`);
  return value;
}

function boundedStrings(value, label, maximum = MAX_SET_ITEMS) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array with at most ${maximum} items`);
  const normalized = value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates`);
  return normalized.sort();
}

function normalizeExternalSystems(value, label) {
  if (!Array.isArray(value) || value.length > MAX_SET_ITEMS) fail(`${label} must be a bounded array`);
  const systems = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label}[${index}] must be an object`);
    return {
      system: nonEmpty(entry.system, `${label}[${index}].system`),
      access: exactEnum(entry.access, ["read", "write"], `${label}[${index}].access`),
    };
  });
  const identities = systems.map((entry) => `${entry.system}:${entry.access}`);
  if (new Set(identities).size !== identities.length) fail(`${label} must not contain duplicates`);
  return systems.sort((left, right) => `${left.system}:${left.access}`.localeCompare(`${right.system}:${right.access}`));
}

function normalizeArtifactContract(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return {
    schemaVersion: nonEmpty(value.schemaVersion, `${label}.schemaVersion`),
    kind: nonEmpty(value.kind, `${label}.kind`),
    authority: exactEnum(
      value.authority,
      ["canonical", "proposal", "evidence", "verification", "human-approval"],
      `${label}.authority`,
    ),
    completeness: exactEnum(value.completeness, ["complete", "partial"], `${label}.completeness`),
    limitations: boundedStrings(value.limitations ?? [], `${label}.limitations`, MAX_LIMITATIONS),
  };
}

function normalizeNode(value, graphIdentity) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("every node must be an object");
  const id = nonEmpty(value.id, "node.id");
  const type = exactEnum(value.type, EXECUTION_NODE_TYPES, `node ${id}.type`);
  const maximumAttempts = value.maximumAttempts ?? 1;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 20) {
    fail(`node ${id}.maximumAttempts must be an integer from 1 to 20`);
  }
  const authority = exactEnum(
    value.authority,
    ["runtime", "builder", "reviewer", "evaluator", "human"],
    `node ${id}.authority`,
  );
  if (type === "HUMAN_GATE" && authority !== "human") fail(`HUMAN_GATE node ${id} must use human authority`);
  if (type === "AGENT_EVAL" && authority !== "evaluator") fail(`AGENT_EVAL node ${id} must use evaluator authority`);
  if (type === "REVIEW" && !["reviewer", "human"].includes(authority)) fail(`REVIEW node ${id} must use reviewer or human authority`);

  const verifierQualificationRef = value.verifierQualificationRef ?? null;
  if (type === "AGENT_EVAL" && (typeof verifierQualificationRef !== "string" || !REF.test(verifierQualificationRef))) {
    fail(`AGENT_EVAL node ${id} requires a content-addressed verifierQualificationRef`);
  }

  const browserMode = value.browserMode ?? null;
  if (type === "BROWSER") {
    exactEnum(browserMode, ["headless-embedded", "headful-operational"], `node ${id}.browserMode`);
  } else if (browserMode !== null) {
    fail(`only BROWSER nodes may declare browserMode`);
  }

  const externalSystems = normalizeExternalSystems(value.externalSystems ?? [], `node ${id}.externalSystems`);
  if (externalSystems.some((entry) => entry.access === "write") && authority === "runtime") {
    fail(`node ${id} writes an external system without an accountable authority`);
  }

  return {
    id,
    type,
    title: nonEmpty(value.title, `node ${id}.title`),
    taskHandle: `task:sha256:${digest({ graphIdentity, nodeId: id })}`,
    authority,
    maximumAttempts,
    readSet: boundedStrings(value.readSet ?? [], `node ${id}.readSet`),
    writeSet: boundedStrings(value.writeSet ?? [], `node ${id}.writeSet`),
    externalSystems,
    expectedArtifact: normalizeArtifactContract(value.expectedArtifact, `node ${id}.expectedArtifact`),
    parallelGroup: value.parallelGroup === undefined ? null : nonEmpty(value.parallelGroup, `node ${id}.parallelGroup`),
    browserMode,
    verifierQualificationRef,
  };
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((entry) => rightSet.has(entry));
}

function validateParallelGroups(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    if (node.parallelGroup === null) continue;
    const entries = groups.get(node.parallelGroup) ?? [];
    entries.push(node);
    groups.set(node.parallelGroup, entries);
  }
  for (const [group, entries] of groups) {
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        if (
          intersects(left.writeSet, [...right.readSet, ...right.writeSet])
          || intersects(right.writeSet, [...left.readSet, ...left.writeSet])
        ) {
          fail(`parallel group ${group} has overlapping read/write sets between ${left.id} and ${right.id}`);
        }
        const leftWrites = left.externalSystems.filter((entry) => entry.access === "write").map((entry) => entry.system);
        const rightTouches = right.externalSystems.map((entry) => entry.system);
        const rightWrites = right.externalSystems.filter((entry) => entry.access === "write").map((entry) => entry.system);
        const leftTouches = left.externalSystems.map((entry) => entry.system);
        if (intersects(leftWrites, rightTouches) || intersects(rightWrites, leftTouches)) {
          fail(`parallel group ${group} has overlapping external-system authority between ${left.id} and ${right.id}`);
        }
      }
    }
  }
}

function normalizeEdge(value, nodeById) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("every edge must be an object");
  const from = nonEmpty(value.from, "edge.from");
  const to = nonEmpty(value.to, "edge.to");
  if (!nodeById.has(from) || !nodeById.has(to)) fail(`edge ${from} -> ${to} references an unknown node`);
  if (from === to) fail(`edge ${from} -> ${to} cannot self-loop; bound repair inside a REPAIR node`);
  const on = exactEnum(value.on ?? "success", ["success", "failure", "always"], `edge ${from} -> ${to}.on`);
  const artifact = normalizeArtifactContract(value.artifact, `edge ${from} -> ${to}.artifact`);
  return {
    edgeId: `edge:sha256:${digest({ from, to, on, artifact })}`,
    from,
    to,
    on,
    artifact,
  };
}

function validateAcyclic(nodes, edges) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const queue = [...nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)].sort();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    visited += 1;
    for (const next of outgoing.get(id).sort()) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
    queue.sort();
  }
  if (visited !== nodes.length) fail("the execution graph must be acyclic; each node is the bounded loop");
}

function validateExternalWriteBarriers(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) predecessors.get(edge.to).push(edge.from);
  const hasHumanGateAncestor = (nodeId) => {
    const pending = [...predecessors.get(nodeId)];
    const visited = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      if (nodeById.get(current).type === "HUMAN_GATE") return true;
      pending.push(...predecessors.get(current));
    }
    return false;
  };
  for (const node of nodes) {
    if (node.externalSystems.some((system) => system.access === "write") && !hasHumanGateAncestor(node.id)) {
      fail(`external-write node ${node.id} requires an upstream HUMAN_GATE barrier`);
    }
  }
}

export function compileExecutionGraph(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("input must be an object");
  const source = {
    projectRef: nonEmpty(input.projectRef, "projectRef"),
    projectRevision: nonEmpty(input.projectRevision, "projectRevision"),
    approvedJourneyRef: nonEmpty(input.approvedJourneyRef, "approvedJourneyRef"),
    approvedJourneyDigest: nonEmpty(input.approvedJourneyDigest, "approvedJourneyDigest"),
  };
  if (!REF.test(source.approvedJourneyRef)) fail("approvedJourneyRef must be content-addressed");
  if (!HASH.test(source.approvedJourneyDigest)) fail("approvedJourneyDigest must be a sha256 digest");
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_NODES) {
    fail(`nodes must contain 1 to ${MAX_NODES} entries`);
  }
  if (!Array.isArray(input.edges) || input.edges.length > MAX_EDGES) fail(`edges must contain at most ${MAX_EDGES} entries`);

  const graphIdentity = digest(source);
  const nodes = input.nodes.map((node) => normalizeNode(node, graphIdentity)).sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (nodeById.size !== nodes.length) fail("node ids must be unique");
  validateParallelGroups(nodes);
  const edges = input.edges.map((edge) => normalizeEdge(edge, nodeById)).sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  if (new Set(edges.map((edge) => edge.edgeId)).size !== edges.length) fail("edges must be unique");
  for (const edge of edges) {
    const producer = nodeById.get(edge.from);
    if (canonical(edge.artifact) !== canonical(producer.expectedArtifact)) {
      fail(`edge ${edge.from} -> ${edge.to} does not match producer ${edge.from}.expectedArtifact`);
    }
  }
  validateAcyclic(nodes, edges);

  const incoming = new Set(edges.map((edge) => edge.to));
  const outgoing = new Set(edges.map((edge) => edge.from));
  const roots = nodes.filter((node) => !incoming.has(node.id));
  const terminals = nodes.filter((node) => !outgoing.has(node.id));
  if (roots.length < 1) fail("graph requires at least one root");
  if (terminals.length < 1 || terminals.some((node) => !["DELIVER", "HUMAN_GATE"].includes(node.type))) {
    fail("every terminal node must be DELIVER or HUMAN_GATE");
  }
  validateExternalWriteBarriers(nodes, edges);

  const body = {
    schemaVersion: EXECUTION_GRAPH_SCHEMA_VERSION,
    source,
    policy: {
      canonicalState: "caseflow",
      projection: "disposable",
      automaticPromotion: false,
      maximumNodes: MAX_NODES,
      maximumEdges: MAX_EDGES,
      maximumEvents: MAX_EVENTS,
    },
    nodes,
    edges,
  };
  return {
    ...body,
    graphDigest: digest(body),
    graphId: `execution-graph:sha256:${digest(body)}`,
  };
}

function validateArtifact(value, contract, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (!REF.test(value.artifactRef)) fail(`${label}.artifactRef must be content-addressed`);
  if (!HASH.test(value.digest)) fail(`${label}.digest must be a sha256 digest`);
  if (value.artifactRef.split(":").at(-1) !== value.digest) fail(`${label}.artifactRef must bind digest`);
  for (const key of ["schemaVersion", "kind", "authority", "completeness"]) {
    if (value[key] !== contract[key]) fail(`${label}.${key} does not match the edge contract`);
  }
  const limitations = boundedStrings(value.limitations ?? [], `${label}.limitations`, MAX_LIMITATIONS);
  if (canonical(limitations) !== canonical(contract.limitations)) fail(`${label}.limitations do not match the edge contract`);
  return {
    artifactRef: value.artifactRef,
    digest: value.digest,
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    revision: nonEmpty(value.revision, `${label}.revision`),
    authority: value.authority,
    completeness: value.completeness,
    limitations,
  };
}

export function createExecutionTrace(graph) {
  verifyGraphIdentity(graph);
  return {
    schemaVersion: EXECUTION_TRACE_SCHEMA_VERSION,
    graphId: graph.graphId,
    graphDigest: graph.graphDigest,
    traceDigest: digest([]),
    events: [],
  };
}

function verifyGraphIdentity(graph) {
  if (graph?.schemaVersion !== EXECUTION_GRAPH_SCHEMA_VERSION) fail("unsupported graph schemaVersion");
  const { graphId, graphDigest, ...body } = graph;
  const actual = digest(body);
  if (graphDigest !== actual || graphId !== `execution-graph:sha256:${actual}`) fail("graph identity mismatch");
}

function statusActivates(edge, status) {
  return edge.on === "always"
    || (edge.on === "success" && status === "passed")
    || (edge.on === "failure" && status === "failed");
}

function latestEvents(trace) {
  const latest = new Map();
  for (const event of trace.events) latest.set(event.nodeId, event);
  return latest;
}

export function deriveRunnableFrontier(graph, trace) {
  verifyGraphIdentity(graph);
  verifyTraceIdentity(graph, trace);
  const latest = latestEvents(trace);
  const frontier = [];
  for (const node of graph.nodes) {
    const prior = latest.get(node.id);
    if (prior?.status === "passed" || prior?.status === "blocked") continue;
    if (prior?.status === "failed" && prior.attempt >= node.maximumAttempts) continue;
    const incoming = graph.edges.filter((edge) => edge.to === node.id);
    const allPredecessorsResolved = incoming.every((edge) => latest.has(edge.from));
    const activeIncoming = incoming.filter((edge) => {
      const source = latest.get(edge.from);
      return source && statusActivates(edge, source.status);
    });
    const ready = incoming.length === 0
      ? true
      : allPredecessorsResolved
        && activeIncoming.length > 0
        && activeIncoming.every((edge) => latest.get(edge.from)?.handoffs.some((entry) => entry.edgeId === edge.edgeId));
    if (ready) {
      frontier.push({
        nodeId: node.id,
        type: node.type,
        title: node.title,
        taskHandle: node.taskHandle,
        requiresHuman: node.type === "HUMAN_GATE",
        attempt: (prior?.attempt ?? 0) + 1,
      });
    }
  }
  return frontier.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function verifyTraceIdentity(graph, trace) {
  if (trace?.schemaVersion !== EXECUTION_TRACE_SCHEMA_VERSION) fail("unsupported trace schemaVersion");
  if (trace.graphId !== graph.graphId || trace.graphDigest !== graph.graphDigest) fail("trace is bound to a different graph");
  if (!Array.isArray(trace.events) || trace.events.length > MAX_EVENTS) fail(`trace events exceed ${MAX_EVENTS}`);
  if (trace.traceDigest !== digest(trace.events)) fail("trace identity mismatch");
}

export function recordExecutionResult(graph, trace, result) {
  const frontier = deriveRunnableFrontier(graph, trace);
  const runnable = frontier.find((entry) => entry.nodeId === result?.nodeId);
  if (!runnable) fail(`node ${result?.nodeId ?? "<missing>"} is not in the current runnable frontier`);
  const node = graph.nodes.find((entry) => entry.id === result.nodeId);
  const status = exactEnum(result.status, ["passed", "failed", "blocked"], "result.status");
  const actorClass = exactEnum(result.actorClass, ["builder", "reviewer", "evaluator", "human", "runtime"], "result.actorClass");
  if (actorClass !== node.authority && !(node.type === "REVIEW" && actorClass === "human")) {
    fail(`node ${node.id} requires actorClass ${node.authority}`);
  }
  if (node.type === "HUMAN_GATE" && actorClass !== "human") fail(`HUMAN_GATE node ${node.id} requires a human actor`);
  if (node.type === "AGENT_EVAL" && actorClass !== "evaluator") fail(`AGENT_EVAL node ${node.id} requires an evaluator actor`);
  const applicableEdges = graph.edges.filter((edge) => edge.from === node.id && statusActivates(edge, status));
  const supplied = result.handoffs ?? [];
  if (!Array.isArray(supplied) || supplied.length !== applicableEdges.length) {
    fail(`node ${node.id} must materialize exactly ${applicableEdges.length} applicable edge handoffs`);
  }
  const edgeById = new Map(applicableEdges.map((edge) => [edge.edgeId, edge]));
  const handoffs = supplied.map((handoff, index) => {
    const edge = edgeById.get(handoff.edgeId);
    if (!edge) fail(`result.handoffs[${index}] references a non-applicable edge`);
    return { edgeId: edge.edgeId, artifact: validateArtifact(handoff.artifact, edge.artifact, `result.handoffs[${index}].artifact`) };
  }).sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  if (new Set(handoffs.map((handoff) => handoff.edgeId)).size !== handoffs.length) fail("result handoffs must be unique");

  const startedAt = timestamp(result.startedAt, "result.startedAt");
  const completedAt = timestamp(result.completedAt, "result.completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) fail("result.completedAt cannot precede result.startedAt");
  if (!Array.isArray(result.findings ?? []) || (result.findings ?? []).length > MAX_SET_ITEMS) {
    fail(`result.findings must contain at most ${MAX_SET_ITEMS} entries`);
  }
  const event = {
    sequence: trace.events.length,
    nodeId: node.id,
    taskHandle: node.taskHandle,
    attempt: runnable.attempt,
    status,
    actorClass,
    actorRef: nonEmpty(result.actorRef, "result.actorRef"),
    startedAt,
    completedAt,
    findings: (result.findings ?? []).map((finding, index) => ({
      code: nonEmpty(finding.code, `result.findings[${index}].code`),
      severity: exactEnum(finding.severity, ["P0", "P1", "P2", "P3"], `result.findings[${index}].severity`),
      message: nonEmpty(finding.message, `result.findings[${index}].message`),
    })),
    handoffs,
  };
  if (!REF.test(event.actorRef)) fail("result.actorRef must be content-addressed");
  const events = [...trace.events, event];
  if (events.length > MAX_EVENTS) fail(`trace events exceed ${MAX_EVENTS}`);
  return { ...trace, events, traceDigest: digest(events) };
}

export function verifyExecutionProof(graph, trace) {
  const findings = [];
  try {
    verifyGraphIdentity(graph);
    verifyTraceIdentity(graph, trace);
  } catch (error) {
    return {
      schemaVersion: NODEPROOF_SCHEMA_VERSION,
      passed: false,
      graphId: graph?.graphId ?? null,
      traceDigest: trace?.traceDigest ?? null,
      findings: [{ code: "IDENTITY_MISMATCH", severity: "P0", message: error.message }],
      runnableFrontier: [],
    };
  }
  let replay = createExecutionTrace(graph);
  for (const event of trace.events) {
    try {
      replay = recordExecutionResult(graph, replay, event);
    } catch (error) {
      findings.push({ code: "INVALID_EVENT", severity: "P0", message: error.message });
      break;
    }
  }
  if (!findings.some((finding) => finding.code === "INVALID_EVENT") && replay.traceDigest !== trace.traceDigest) {
    findings.push({ code: "NON_CANONICAL_TRACE", severity: "P0", message: "trace events do not replay to the declared digest" });
  }
  const latest = latestEvents(replay);
  const eventByNode = new Map();
  for (const event of replay.events) {
    const node = graph.nodes.find((entry) => entry.id === event.nodeId);
    if (!node || event.taskHandle !== node.taskHandle || event.attempt > node.maximumAttempts) {
      findings.push({ code: "INVALID_EVENT", severity: "P0", message: `invalid event binding for ${event.nodeId}` });
      continue;
    }
    const priorActors = graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => eventByNode.get(edge.from)?.actorRef)
      .filter(Boolean);
    if (["REVIEW", "AGENT_EVAL"].includes(node.type) && priorActors.includes(event.actorRef)) {
      findings.push({
        code: "SELF_VERIFICATION",
        severity: "P0",
        message: `${node.type} node ${node.id} reused a producing actor; fresh context is not independence`,
      });
    }
    eventByNode.set(node.id, event);
  }
  for (const node of graph.nodes.filter((entry) => entry.type === "AGENT_EVAL")) {
    if (!node.verifierQualificationRef) {
      findings.push({ code: "UNQUALIFIED_EVALUATOR", severity: "P0", message: `AGENT_EVAL node ${node.id} lacks qualification evidence` });
    }
  }
  for (const node of graph.nodes.filter((entry) => entry.type === "AGGREGATE")) {
    if (!graph.edges.some((edge) => edge.from === node.id)) {
      findings.push({ code: "AGGREGATOR_FINAL_DECIDER", severity: "P0", message: `AGGREGATE node ${node.id} cannot be terminal` });
    }
  }
  for (const event of replay.events) findings.push(...event.findings);
  const terminals = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.from === node.id));
  const terminalComplete = terminals.every((node) => latest.get(node.id)?.status === "passed");
  if (!terminalComplete) {
    findings.push({ code: "TERMINAL_INCOMPLETE", severity: "P1", message: "not every terminal delivery or human gate has passed" });
  }
  const runnableFrontier = deriveRunnableFrontier(graph, replay);
  return {
    schemaVersion: NODEPROOF_SCHEMA_VERSION,
    passed: terminalComplete && !findings.some((finding) => ["P0", "P1"].includes(finding.severity)),
    graphId: graph.graphId,
    traceDigest: trace.traceDigest,
    findings,
    runnableFrontier,
  };
}

export function renderExecutionDesignMarkdown(graph) {
  verifyGraphIdentity(graph);
  const lines = [
    "# Compiled execution design",
    "",
    "> Generated from canonical Caseflow-approved records. This file is a disposable projection, not authority.",
    "",
    `- Graph: \`${graph.graphId}\``,
    `- Project: \`${graph.source.projectRef}@${graph.source.projectRevision}\``,
    `- Approved journey: \`${graph.source.approvedJourneyRef}\` (\`${graph.source.approvedJourneyDigest}\`)`,
    "",
    "## Nodes",
    "",
  ];
  for (const node of graph.nodes) {
    lines.push(`### ${node.id} — ${node.type}`, "");
    lines.push(`- Task handle: \`${node.taskHandle}\``);
    lines.push(`- Authority: \`${node.authority}\``);
    lines.push(`- Bounded attempts: ${node.maximumAttempts}`);
    lines.push(`- Reads: ${node.readSet.length ? node.readSet.map((entry) => `\`${entry}\``).join(", ") : "none"}`);
    lines.push(`- Writes: ${node.writeSet.length ? node.writeSet.map((entry) => `\`${entry}\``).join(", ") : "none"}`);
    lines.push(`- Expected artifact: \`${node.expectedArtifact.schemaVersion}\` (${node.expectedArtifact.authority}, ${node.expectedArtifact.completeness})`);
    if (node.browserMode) lines.push(`- Browser lane: \`${node.browserMode}\``);
    if (node.verifierQualificationRef) lines.push(`- Verifier qualification: \`${node.verifierQualificationRef}\``);
    lines.push("");
  }
  lines.push("## Typed handoffs", "");
  for (const edge of graph.edges) {
    lines.push(`- \`${edge.from}\` → \`${edge.to}\` on **${edge.on}**: \`${edge.artifact.schemaVersion}\`, authority \`${edge.artifact.authority}\`, completeness \`${edge.artifact.completeness}\``);
  }
  lines.push("", "## Runtime rule", "", "The next task is the current runnable frontier derived from NodeTrace receipts. NodeProof, not an orchestrator or aggregator, verifies the complete handoff chain.", "");
  return lines.join("\n");
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function normalizeExperimentRuns(value, label, maximumRuns) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumRuns) {
    fail(`${label} must contain 1 to ${maximumRuns} runs`);
  }
  const ids = new Set();
  return value.map((run, index) => {
    const runId = nonEmpty(run?.runId, `${label}[${index}].runId`);
    if (ids.has(runId)) fail(`${label} runId values must be unique`);
    ids.add(runId);
    if (typeof run.succeeded !== "boolean") fail(`${label}[${index}].succeeded must be a boolean`);
    const numeric = {};
    for (const [key, maximum] of [
      ["durationMs", 86_400_000],
      ["costUsd", 1_000_000],
      ["artifactCompleteness", 1],
      ["humanReprompts", 1_000],
      ["findingCount", 100_000],
    ]) {
      const entry = run[key];
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > maximum) {
        fail(`${label}[${index}].${key} is outside its honest bounded range`);
      }
      numeric[key] = entry;
    }
    if (numeric.artifactCompleteness > 1) fail(`${label}[${index}].artifactCompleteness must be at most 1`);
    return {
      runId,
      succeeded: run.succeeded,
      ...numeric,
    };
  });
}

function summarizeExperimentArm(runs) {
  return {
    runs: runs.length,
    successRate: runs.filter((run) => run.succeeded).length / runs.length,
    medianDurationMs: median(runs.map((run) => run.durationMs)),
    medianCostUsd: median(runs.map((run) => run.costUsd)),
    medianArtifactCompleteness: median(runs.map((run) => run.artifactCompleteness)),
    medianHumanReprompts: median(runs.map((run) => run.humanReprompts)),
    medianFindingCount: median(runs.map((run) => run.findingCount)),
  };
}

export function evaluateExecutionStrategyExperiment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("experiment input must be an object");
  const maximumRunsPerArm = 100;
  const taskRef = nonEmpty(input.taskRef, "experiment.taskRef");
  if (!REF.test(taskRef)) fail("experiment.taskRef must be content-addressed");
  const taskDigest = nonEmpty(input.taskDigest, "experiment.taskDigest");
  if (!HASH.test(taskDigest) || taskRef.split(":").at(-1) !== taskDigest) fail("experiment task ref and digest must match");
  const thresholds = {
    minimumRunsPerArm: input.thresholds?.minimumRunsPerArm,
    maximumSuccessRateRegression: input.thresholds?.maximumSuccessRateRegression,
    maximumMedianDurationRatio: input.thresholds?.maximumMedianDurationRatio,
    maximumMedianCostRatio: input.thresholds?.maximumMedianCostRatio,
    minimumCompletenessLift: input.thresholds?.minimumCompletenessLift,
  };
  if (!Number.isInteger(thresholds.minimumRunsPerArm) || thresholds.minimumRunsPerArm < 2 || thresholds.minimumRunsPerArm > maximumRunsPerArm) {
    fail(`experiment.thresholds.minimumRunsPerArm must be an integer from 2 to ${maximumRunsPerArm}`);
  }
  for (const key of ["maximumSuccessRateRegression", "minimumCompletenessLift"]) {
    if (typeof thresholds[key] !== "number" || thresholds[key] < 0 || thresholds[key] > 1) {
      fail(`experiment.thresholds.${key} must be between 0 and 1`);
    }
  }
  for (const key of ["maximumMedianDurationRatio", "maximumMedianCostRatio"]) {
    if (typeof thresholds[key] !== "number" || thresholds[key] <= 0 || thresholds[key] > 10) {
      fail(`experiment.thresholds.${key} must be greater than 0 and at most 10`);
    }
  }
  const sequentialRuns = normalizeExperimentRuns(input.sequentialRuns, "experiment.sequentialRuns", maximumRunsPerArm);
  const graphRuns = normalizeExperimentRuns(input.graphRuns, "experiment.graphRuns", maximumRunsPerArm);
  const sequential = summarizeExperimentArm(sequentialRuns);
  const graph = summarizeExperimentArm(graphRuns);
  const safeRatio = (numerator, denominator) => denominator === 0 ? (numerator === 0 ? 1 : Number.POSITIVE_INFINITY) : numerator / denominator;
  const gates = {
    sampleSize: sequential.runs >= thresholds.minimumRunsPerArm && graph.runs >= thresholds.minimumRunsPerArm,
    successRate: graph.successRate >= sequential.successRate - thresholds.maximumSuccessRateRegression,
    duration: safeRatio(graph.medianDurationMs, sequential.medianDurationMs) <= thresholds.maximumMedianDurationRatio,
    cost: safeRatio(graph.medianCostUsd, sequential.medianCostUsd) <= thresholds.maximumMedianCostRatio,
    completeness: graph.medianArtifactCompleteness >= sequential.medianArtifactCompleteness + thresholds.minimumCompletenessLift,
  };
  const body = {
    schemaVersion: EXECUTION_EXPERIMENT_SCHEMA_VERSION,
    taskRef,
    taskDigest,
    thresholds,
    arms: { sequential, graph },
    gates,
    passed: Object.values(gates).every(Boolean),
  };
  return { ...body, experimentDigest: digest(body) };
}
