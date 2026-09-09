import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "__NODEKIT_RUNTIME_IMPORT__";
import { createGuidedDemo } from "../agent/workflow.mjs";

test("generated base keeps proposals provisional until approval", () => {
  const demo = createGuidedDemo();
  const initial = demo.start();
  const proposal = demo.propose({ artifactId: initial.artifact.artifactId, runId: initial.run.runId });
  assert.equal(demo.runtime.snapshot().artifacts[0].canonicalVersion, 1);
  const completed = demo.decide({ decision: "accepted", proposalId: proposal.proposalId, runId: initial.run.runId });
  assert.equal(completed.artifact.canonicalVersion, 2);
  assert.match(completed.receipt.receiptHash, /^[a-f0-9]{64}$/);
});

// A reviewer rejects an unsafe attempt, then two proposals compete for the same version.
// The stale decision must preserve the winner and the exact original user input.
test("reviewed outcome survives rejection, competing proposals and receipt export", () => {
  const demo = createGuidedDemo();
  const initial = demo.start();
  const outcome = '  Verify supplier “茶” <receipt> & preserve €42.50 exactly.  ';
  const args = { artifactId: initial.artifact.artifactId, runId: initial.run.runId, outcome };
  const baseline = demo.runtime.snapshot().artifacts[0];
  const rejected = demo.propose(args);
  demo.decide({ decision: "rejected", proposalId: rejected.proposalId, runId: args.runId });
  assert.deepEqual(demo.runtime.snapshot().artifacts[0], baseline);
  const winner = demo.propose(args);
  const stale = demo.propose({ ...args, outcome: "Discard the original outcome." });
  demo.runtime.decideProposal({ proposalId: winner.proposalId, decision: "accepted" });
  const accepted = demo.runtime.snapshot().artifacts[0];
  const conflict = demo.decide({ decision: "accepted", proposalId: stale.proposalId, runId: args.runId });
  assert.equal(conflict.proposal.status, "conflicted");
  assert.deepEqual(demo.runtime.snapshot().artifacts[0], accepted);
  assert.equal(demo.runtime.snapshot().receipts.length, 0);
  const version = accepted.versions.find((entry) => entry.version === accepted.canonicalVersion);
  assert.equal(version.content.outcome, outcome);
  assert.equal(version.contentHash, contentHash(version.content));
  demo.runtime.enterStage({ runId: args.runId, stageId: "complete" });
  const { receipt } = demo.runtime.completeRun({ runId: args.runId });
  assert.equal(receipt.schemaVersion, "nodekit.receipt/v2");
  assert.deepEqual(receipt.artifactBindings.map(({ artifactId, canonicalVersion, contentHash }) => ({ artifactId, canonicalVersion, contentHash })), [
    { artifactId: accepted.artifactId, canonicalVersion: 2, contentHash: version.contentHash },
  ]);
});
