import assert from "node:assert/strict";
import { componentsGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { contentHash } from "@homenshum/nodekit/caseflow";
import { modules, register } from "@homenshum/nodekit/test";

const t = convexTest(undefined, modules);
register(t, "nodekitCaseflow");
const component = componentsGeneric().nodekitCaseflow;
const scopeKey = "package_consumer_owner";
const otherScope = "package_consumer_other_owner";
const actor = { id: "package_consumer", type: "human" };

const work = await t.mutation(component.caseflow.createCase, {
  actor,
  primaryJob: "Prove the installed component runtime",
  scopeKey,
  title: "Installed package proof",
});
assert.match(work.caseId, /^case_[a-f0-9]{26}$/);
assert.equal(await t.query(component.caseflow.getCase, { caseId: work.caseId, scopeKey: otherScope }), null);
let crossScopeDenied = false;
try {
  await t.mutation(component.caseflow.updateCaseInput, { caseId: work.caseId, scopeKey: otherScope, title: "Forbidden" });
} catch (error) {
  crossScopeDenied = /case not found/.test(String(error));
}
assert.equal(crossScopeDenied, true);

const run = await t.mutation(component.caseflow.startRun, {
  actor,
  caseId: work.caseId,
  scopeKey,
  stages: [
    { id: "work", label: "Prepare artifact", owner: "agent" },
    { id: "review", label: "Review proposal", owner: "user" },
    { id: "complete", label: "Verify completion", owner: "system" },
  ],
});
assert.match(run.runId, /^run_[a-f0-9]{26}$/);
const blocked = await t.mutation(component.caseflow.raiseException, {
  actor,
  code: "package_probe",
  idempotencyKey: "exception-retry",
  preservedState: { stage: "work" },
  preservedStateHash: contentHash({ stage: "work" }),
  runId: run.runId,
  scopeKey,
});
const blockedRetry = await t.mutation(component.caseflow.raiseException, {
  actor,
  code: "package_probe",
  idempotencyKey: "exception-retry",
  preservedState: { stage: "work" },
  preservedStateHash: contentHash({ stage: "work" }),
  runId: run.runId,
  scopeKey,
});
assert.deepEqual(blockedRetry, blocked);
const recovered = await t.mutation(component.caseflow.resolveException, {
  actor,
  exceptionId: blocked.exceptionId,
  nextAction: "Prepare artifact",
  nextActionOwner: "agent",
  resolution: "Package probe recovered",
  scopeKey,
});
assert.equal(recovered.run.status, "active");

const artifact = await t.mutation(component.caseflow.createArtifact, {
  actor,
  caseId: work.caseId,
  content: { status: "baseline" },
  contentHash: contentHash({ status: "baseline" }),
  idempotencyKey: "artifact-retry",
  kind: "neutral",
  runId: run.runId,
  scopeKey,
  title: "Verified artifact",
});
const artifactRetry = await t.mutation(component.caseflow.createArtifact, {
  actor,
  caseId: work.caseId,
  content: { status: "baseline" },
  contentHash: contentHash({ status: "baseline" }),
  idempotencyKey: "artifact-retry",
  kind: "neutral",
  runId: run.runId,
  scopeKey,
  title: "Verified artifact",
});
assert.deepEqual(artifactRetry, artifact);
assert.match(artifact.artifactId, /^artifact_[a-f0-9]{26}$/);

const acceptedCandidate = await t.mutation(component.caseflow.createProposal, {
  actor,
  artifactId: artifact.artifactId,
  baseVersion: 1,
  patch: { status: "accepted" },
  patchHash: contentHash({ status: "accepted" }),
  rationale: "Exact installed-package lifecycle",
  scopeKey,
});
const staleCandidate = await t.mutation(component.caseflow.createProposal, {
  actor,
  artifactId: artifact.artifactId,
  baseVersion: 1,
  patch: { status: "stale" },
  patchHash: contentHash({ status: "stale" }),
  rationale: "Exercise stale conflict protection",
  scopeKey,
});
const accepted = await t.mutation(component.caseflow.decideProposal, {
  actor,
  decision: "accepted",
  proposalId: acceptedCandidate.proposalId,
  scopeKey,
});
assert.equal(accepted.artifact.canonicalVersion, 2);
const conflicted = await t.mutation(component.caseflow.decideProposal, {
  actor,
  decision: "accepted",
  proposalId: staleCandidate.proposalId,
  scopeKey,
});
assert.equal(conflicted.proposal.status, "conflicted");

await t.mutation(component.caseflow.enterStage, { actor, runId: run.runId, scopeKey, stageId: "complete" });
const completion = await t.mutation(component.caseflow.completeRun, { actor, runId: run.runId, scopeKey });
const { receiptHash, receiptId, ...receiptBody } = completion.receipt;
assert.match(receiptId, /^receipt_[a-f0-9]{26}$/);
assert.equal(receiptHash, contentHash(receiptBody));
assert.equal(completion.receipt.artifactBindings[0].contentHash, contentHash({ status: "accepted" }));

console.log(JSON.stringify({
  checks: {
    componentRegistered: true,
    crossScopeDenied,
    exceptionRecovery: recovered.run.status === "active",
    idempotentRetries: artifactRetry.artifactId === artifact.artifactId && blockedRetry.exceptionId === blocked.exceptionId,
    receiptVerified: receiptHash === contentHash(receiptBody),
    scopedLifecycleCompleted: completion.run.status === "completed",
    staleConflictProtected: conflicted.proposal.status === "conflicted" && conflicted.artifact.canonicalVersion === 2,
  },
  receiptHash,
  schemaVersion: "nodekit.installed-convex-runtime-proof/v1",
}));
