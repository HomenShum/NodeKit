import { pathToFileURL } from "node:url";
import { contentHash, createMemoryCaseflow } from "../src/caseflow.mjs";
import {
  compileExecutionGraph,
  createExecutionTrace,
  recordExecutionResult,
  verifyExecutionProof,
} from "../src/execution-graph.mjs";

const stages = [
  { id: "execute", label: "Prepare a quoted source note", owner: "agent" },
  { id: "verify", label: "Check the exact quote and source", owner: "reviewer" },
  { id: "deliver", label: "Return the checked note", owner: "system" },
];
const actor = (id, type = "system") => ({ id, type });
const actorRef = (id) => `actor:sha256:${contentHash(id)}`;
const artifactRef = (digest) => `artifact:sha256:${digest}`;
const contract = (kind, authority) => ({ schemaVersion: `example.${kind}/v1`, kind, authority, completeness: "complete", limitations: [] });

function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must contain 1-${max} characters`);
  return value;
}

function binding(artifact) {
  const version = artifact.versions.find((entry) => entry.version === artifact.canonicalVersion);
  return { caseId: artifact.caseId, runId: artifact.runId, artifactId: artifact.artifactId, version: artifact.canonicalVersion, digest: version.contentHash };
}

// One disposable, synchronous task. This is a source recipe, not a service or package API.
export function createManagedHandoff({ source }) {
  const normalizedSource = { revision: text(source?.revision, "source revision", 128), text: text(source?.text, "source text", 65_536) };
  const runtime = createMemoryCaseflow();
  const work = runtime.createCase({ title: "Quoted source note", primaryJob: "Return a checked quote from the supplied revision; do not publish." });
  const run = runtime.startRun({ caseId: work.caseId, stages });
  const caseIdentity = contentHash({ title: work.title, primaryJob: work.primaryJob });
  const save = (kind, content, id) => runtime.createArtifact({ caseId: work.caseId, runId: run.runId, kind, content, actor: actor("managed-handoff"), idempotencyKey: id });
  const sourceArtifact = save("source", normalizedSource, "source");
  const sourceBinding = binding(sourceArtifact);
  const journeyArtifact = save("journey", { caseId: work.caseId, runId: run.runId, source: sourceBinding, criterion: "An independent reviewer verifies a nonempty exact quote from this revision.", externalWrites: false }, "journey");
  const noteContract = contract("quoted-note", "agent-produced");
  const reviewContract = contract("quote-review", "deterministic");
  const graph = compileExecutionGraph({
    projectRef: `caseflow:${work.caseId}/${run.runId}`,
    projectRevision: sourceBinding.digest,
    approvedJourneyRef: artifactRef(binding(journeyArtifact).digest),
    approvedJourneyDigest: binding(journeyArtifact).digest,
    designContext: { primaryUser: "A reviewer", primaryArtifact: "Checked source quote", primaryAction: "Read the quote and source revision" },
    nodes: [
      { id: "build", type: "BUILD", title: "Prepare quote", authority: "builder", expectedArtifact: noteContract },
      { id: "review", type: "REVIEW", title: "Check quote against source", authority: "reviewer", expectedArtifact: reviewContract },
      { id: "deliver", type: "DELIVER", title: "Return checked note locally", authority: "runtime", expectedArtifact: contract("delivery", "deterministic") },
    ],
    edges: [{ from: "build", to: "review", artifact: noteContract }, { from: "review", to: "deliver", artifact: reviewContract }],
  });
  const graphArtifact = save("execution-graph", graph, "graph");
  let trace = createExecutionTrace(graph);
  let finalRequestHash;
  let reviewRequestHash;
  let noteArtifact;
  let reviewArtifact;
  let proofArtifact;

  function current(expected) {
    const snapshot = runtime.snapshot();
    const currentCase = snapshot.cases.find((entry) => entry.caseId === work.caseId);
    if (currentCase.currentRunId !== run.runId || contentHash({ title: currentCase.title, primaryJob: currentCase.primaryJob }) !== caseIdentity) throw new Error("case or current run changed");
    const record = snapshot.artifacts.find((entry) => entry.artifactId === expected.artifactId);
    if (!record || contentHash(binding(record)) !== contentHash(expected)) throw new Error("canonical artifact binding changed");
    const value = record.versions.find((entry) => entry.version === record.canonicalVersion);
    if (contentHash(value.content) !== expected.digest) throw new Error("canonical artifact bytes changed");
    return value.content;
  }

  function checkBindings() {
    current(sourceBinding);
    current(binding(journeyArtifact));
    current(binding(graphArtifact));
    if (noteArtifact) current(binding(noteArtifact));
    if (reviewArtifact) current(binding(reviewArtifact));
    if (proofArtifact) current(binding(proofArtifact));
  }

  function checkTarget(input) {
    if (input.caseId !== work.caseId || input.runId !== run.runId) throw new Error("handoff belongs to a different case or run");
    checkBindings();
  }

  function result(nodeId, actorId, artifact) {
    const node = graph.nodes.find((entry) => entry.id === nodeId);
    const at = new Date().toISOString();
    return {
      nodeId, status: "passed", actorClass: node.authority, actorRef: actorRef(actorId), startedAt: at, completedAt: at,
      handoffs: graph.edges.filter((edge) => edge.fromNodeId === nodeId).map((edge) => ({
        edgeId: edge.edgeId, artifactRefs: [artifactRef(binding(artifact).digest)], artifactDigests: [binding(artifact).digest],
        requiredSchema: edge.requiredSchema, repositoryCommit: null, deploymentRevision: null,
        authority: edge.authority, completeness: "complete", limitations: [],
      })),
    };
  }

  function view() {
    return { caseId: work.caseId, run: runtime.getRun(run.runId), source: structuredClone(sourceBinding), note: noteArtifact ? binding(noteArtifact) : null, proof: verifyExecutionProof(graph, trace), receipt: runtime.snapshot().receipts.find((entry) => entry.caseId === work.caseId && entry.runId === run.runId) ?? null };
  }

  function receiveFinal(input) {
    checkTarget(input);
    const request = {
      eventId: text(input.eventId, "event id", 128), actorId: text(input.actorId, "executor identity", 128),
      quote: text(input.quote, "quote", 4096), sourceRevision: text(input.sourceRevision, "source revision", 128), source: input.source,
    };
    const requestHash = contentHash(request);
    if (finalRequestHash) {
      if (requestHash !== finalRequestHash) throw new Error("conflicting final delivery");
      return view();
    }
    if (contentHash(request.source) !== contentHash(sourceBinding) || request.sourceRevision !== normalizedSource.revision) throw new Error("source binding mismatch");
    noteArtifact = save("host-final", { schemaVersion: noteContract.schemaVersion, ...request }, "host-final");
    trace = recordExecutionResult(graph, trace, result("build", request.actorId, noteArtifact));
    runtime.enterStage({ runId: run.runId, stageId: "verify", actor: actor("managed-handoff"), idempotencyKey: "verify-stage" });
    finalRequestHash = requestHash;
    return view();
  }

  function block(reason) {
    checkBindings();
    runtime.raiseException({ runId: run.runId, code: "REVIEW_UNAVAILABLE", message: text(reason, "reason", 1024), preservedState: { trace }, actor: actor("managed-handoff"), idempotencyKey: "review-blocked" });
    return view();
  }

  function review(input) {
    checkTarget(input);
    if (!noteArtifact) throw new Error("no final note to review");
    const request = { actorId: text(input.actorId, "reviewer identity", 128), note: input.note, source: input.source };
    const requestHash = contentHash(request);
    if (reviewRequestHash) {
      if (requestHash !== reviewRequestHash) throw new Error("conflicting review delivery");
      return view();
    }
    if (contentHash(request.note) !== contentHash(binding(noteArtifact)) || contentHash(request.source) !== contentHash(sourceBinding)) throw new Error("review binding mismatch");
    const note = current(binding(noteArtifact));
    const exactSource = current(sourceBinding);
    if (!exactSource.text.includes(note.quote)) return block("The quote does not occur in the bound source revision. Prepare a corrected task.");
    reviewArtifact = save("quote-review", { schemaVersion: reviewContract.schemaVersion, ...request, quoteFound: true }, "review");
    trace = recordExecutionResult(graph, trace, result("review", request.actorId, reviewArtifact));
    trace = recordExecutionResult(graph, trace, result("deliver", "managed-handoff", reviewArtifact));
    reviewRequestHash = requestHash;
    const proof = verifyExecutionProof(graph, trace);
    if (!proof.passed) return block("Execution proof rejected the review. Inspect the recorded findings.");
    proofArtifact = save("execution-proof", { graph, trace, proof, source: sourceBinding, note: binding(noteArtifact), review: binding(reviewArtifact) }, "proof");
    return view();
  }

  function complete() {
    checkBindings();
    const proof = verifyExecutionProof(graph, trace);
    if (!proof.passed || !proofArtifact) return view();
    // No await, callback, or I/O can change canonical memory between these checks and closure.
    if (runtime.getRun(run.runId).status === "active") runtime.enterStage({ runId: run.runId, stageId: "deliver", actor: actor("managed-handoff"), idempotencyKey: "delivery-stage" });
    runtime.completeRun({ runId: run.runId, actor: actor("managed-handoff") });
    return view();
  }

  return { receiveFinal, review, complete, block, view, runtime };
}

export function runManagedHandoffExample() {
  const handoff = createManagedHandoff({ source: { revision: "guide-v1", text: "A completed response still needs its acceptance evidence checked." } });
  const initial = handoff.view();
  const input = { caseId: initial.caseId, runId: initial.run.runId, eventId: "local-final-1", actorId: "writer", quote: "A completed response still needs its acceptance evidence checked.", sourceRevision: "guide-v1", source: initial.source };
  const pending = handoff.receiveFinal(input);
  handoff.receiveFinal(input);
  handoff.review({ caseId: initial.caseId, runId: initial.run.runId, actorId: "reviewer", note: pending.note, source: initial.source });
  const completed = handoff.complete();
  return { proofName: "MANAGED-HANDOFF-VERIFY-BEFORE-CLOSE-01", scope: "Synchronous local quote verification; no provider, publication, or restart proof", afterFinal: { status: pending.run.status, stage: pending.run.currentStageId, receipt: pending.receipt }, completed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runManagedHandoffExample(), null, 2));
