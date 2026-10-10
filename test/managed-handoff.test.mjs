import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contentHash } from "../src/caseflow.mjs";
import { createManagedHandoff, runManagedHandoffExample } from "../reference-apps/managed-handoff.mjs";

const sourceText = readFileSync(new URL("../docs/EXECUTION_GRAPH_OF_LOOPS.md", import.meta.url), "utf8");
const quote = "Caseflow remains";

function scenario(actorId = "writer") {
  const handoff = createManagedHandoff({ source: { revision: contentHash(sourceText), text: sourceText } });
  const initial = handoff.view();
  const final = { caseId: initial.caseId, runId: initial.run.runId, eventId: "host-final-1", actorId, quote, sourceRevision: contentHash(sourceText), source: initial.source };
  const review = () => ({ caseId: initial.caseId, runId: initial.run.runId, actorId: "independent-reviewer", note: handoff.view().note, source: initial.source });
  return { handoff, initial, final, review };
}

function replaceCanonical(handoff, artifactId, patch) {
  const artifact = handoff.runtime.snapshot().artifacts.find((entry) => entry.artifactId === artifactId);
  const proposal = handoff.runtime.createProposal({ artifactId, baseVersion: artifact.canonicalVersion, patch, actor: { id: "owner", type: "human" } });
  handoff.runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted", actor: { id: "owner", type: "human" } });
}

test("reviewer receives a checked quote from a real repository document, with one exact receipt", () => {
  const { handoff, initial, final, review } = scenario();
  const pending = handoff.receiveFinal({ ...final, passed: true, proof: { passed: true } });
  assert.equal(pending.run.currentStageId, "verify");
  assert.equal(pending.run.status, "active");
  assert.equal(handoff.complete().receipt, null, "host final is not business completion");
  assert.equal(handoff.runtime.getCase(initial.caseId).status, "in_progress");
  const checked = handoff.review(review());
  assert.equal(checked.proof.passed, true);
  assert.equal(checked.receipt, null, "review does not silently close the task");
  const completed = handoff.complete();
  assert.equal(completed.run.status, "completed");
  assert.equal(completed.receipt.caseId, initial.caseId);
  assert.equal(completed.receipt.runId, initial.run.runId);
  assert.ok(completed.receipt.artifactBindings.some((entry) => entry.artifactId === pending.note.artifactId && entry.canonicalVersion === pending.note.version && entry.contentHash === pending.note.digest));
  assert.ok(completed.receipt.artifactBindings.some((entry) => entry.artifactId === initial.source.artifactId && entry.contentHash === initial.source.digest));
  assert.equal(handoff.complete().receipt.receiptHash, completed.receipt.receiptHash);
});

test("operator can run the documented local example without credentials or external writes", () => {
  const result = runManagedHandoffExample();
  assert.equal(result.proofName, "MANAGED-HANDOFF-VERIFY-BEFORE-CLOSE-01");
  assert.equal(result.afterFinal.receipt, null);
  assert.equal(result.completed.proof.passed, true);
  assert.equal(result.completed.run.status, "completed");
});

test("an owner's completed side task cannot substitute its receipt in the managed task view", () => {
  const { handoff, initial, final, review } = scenario();
  const sideCase = handoff.runtime.createCase({ title: "Owner side note", primaryJob: "Keep an unrelated note" });
  const sideRun = handoff.runtime.startRun({ caseId: sideCase.caseId, stages: [{ id: "save", label: "Save note", owner: "user" }] });
  handoff.runtime.createArtifact({ caseId: sideCase.caseId, runId: sideRun.runId, content: { note: "Unrelated owner work" } });
  const sideReceipt = handoff.runtime.completeRun({ runId: sideRun.runId }).receipt;
  assert.equal(handoff.view().receipt, null);
  assert.equal(handoff.receiveFinal(final).receipt, null);
  assert.equal(handoff.complete().receipt, null);
  handoff.review(review());
  const receipt = handoff.complete().receipt;
  assert.equal(receipt.caseId, initial.caseId);
  assert.equal(receipt.runId, initial.run.runId);
  assert.notEqual(receipt.receiptId, sideReceipt.receiptId);
  assert.equal(handoff.view().receipt.receiptId, receipt.receiptId);
});

test("reconnecting host burst reuses final, review and completion without growing task history", async () => {
  const { handoff, final, review } = scenario();
  handoff.receiveFinal(final);
  const afterFinal = handoff.runtime.snapshot();
  await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => handoff.receiveFinal(final))));
  assert.deepEqual(handoff.runtime.snapshot(), afterFinal);
  const request = review();
  handoff.review(request);
  const closed = handoff.complete();
  const beforeReplay = handoff.runtime.snapshot();
  await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => {
    handoff.receiveFinal(final);
    handoff.review(request);
    assert.equal(handoff.complete().receipt.receiptId, closed.receipt.receiptId);
  })));
  assert.deepEqual(handoff.runtime.snapshot(), beforeReplay);
  assert.throws(() => handoff.receiveFinal({ ...final, quote: "changed delivery" }), /conflicting final/);
  assert.throws(() => handoff.review({ ...request, actorId: "another-reviewer" }), /conflicting review/);
  assert.deepEqual(handoff.runtime.snapshot(), beforeReplay);
});

test("sustained repeated delivery preserves a fixed one-task history and discards no decisive evidence", () => {
  const { handoff, final, review } = scenario();
  handoff.receiveFinal(final);
  const request = review();
  handoff.review(request);
  handoff.complete();
  const baseline = handoff.runtime.snapshot();
  for (let index = 0; index < 1000; index += 1) {
    handoff.receiveFinal(final);
    handoff.review(request);
    handoff.complete();
  }
  assert.deepEqual(handoff.runtime.snapshot(), baseline);
  assert.equal(baseline.cases.length, 1);
  assert.equal(baseline.runs.length, 1);
  assert.equal(baseline.receipts.length, 1);
  assert.equal(baseline.artifacts.length, 6);
});

test("reviewer outage stays blocked and duplicate outage notifications do not grow state", () => {
  const { handoff, final } = scenario();
  handoff.receiveFinal(final);
  handoff.block("Reviewer is unavailable.");
  const blocked = handoff.runtime.snapshot();
  for (let index = 0; index < 30; index += 1) handoff.block("Reviewer is unavailable.");
  assert.deepEqual(handoff.runtime.snapshot(), blocked);
  assert.equal(handoff.complete().run.status, "blocked");
  assert.equal(handoff.complete().receipt, null);
  assert.equal(blocked.exceptions.length, 1);
});

test("fabricated quotes and the same writer posing as reviewer never close the case", () => {
  const fabricated = scenario();
  fabricated.handoff.receiveFinal({ ...fabricated.final, quote: "This sentence is absent from the source." });
  assert.equal(fabricated.handoff.review(fabricated.review()).run.status, "blocked");
  assert.equal(fabricated.handoff.complete().receipt, null);
  const selfReview = scenario("same-person");
  selfReview.handoff.receiveFinal(selfReview.final);
  const denied = selfReview.handoff.review({ ...selfReview.review(), actorId: "same-person" });
  assert.equal(denied.proof.passed, false);
  assert.ok(denied.proof.findings.some((entry) => entry.code === "SELF_VERIFICATION"));
  assert.equal(selfReview.handoff.complete().receipt, null);
});

test("two simultaneous tasks cannot exchange final responses, source bindings, or reviews", () => {
  const a = scenario();
  const b = scenario();
  assert.throws(() => b.handoff.receiveFinal(a.final), /different case or run/);
  assert.throws(() => a.handoff.receiveFinal({ ...a.final, source: b.initial.source }), /source binding mismatch/);
  a.handoff.receiveFinal(a.final);
  b.handoff.receiveFinal(b.final);
  assert.throws(() => b.handoff.review(a.review()), /different case or run/);
  assert.throws(() => b.handoff.review({ ...b.review(), note: a.handoff.view().note }), /review binding mismatch/);
  assert.equal(b.handoff.complete().receipt, null);
  assert.throws(() => b.handoff.receiveFinal({ ...b.final, sourceRevision: "stale" }), /conflicting final/);
});

test("owner edits after review invalidate closure even if replacement bytes or quote remain identical", () => {
  for (const kind of ["source", "journey", "execution-graph", "host-final", "quote-review", "execution-proof"]) {
    const { handoff, final, review } = scenario();
    handoff.receiveFinal(final);
    handoff.review(review());
    const artifact = handoff.runtime.snapshot().artifacts.find((entry) => entry.kind === kind);
    replaceCanonical(handoff, artifact.artifactId, artifact.versions[0].content);
    assert.throws(() => handoff.complete(), /canonical artifact binding changed/, kind);
    assert.equal(handoff.runtime.snapshot().receipts.length, 0);
  }
});

test("changing the task or replacing its active run invalidates otherwise good evidence", () => {
  const changed = scenario();
  changed.handoff.receiveFinal(changed.final);
  changed.handoff.review(changed.review());
  changed.handoff.runtime.updateCaseInput({ caseId: changed.initial.caseId, primaryJob: "Publish this note" });
  assert.throws(() => changed.handoff.complete(), /case or current run changed/);
  const restarted = scenario();
  restarted.handoff.receiveFinal(restarted.final);
  restarted.handoff.review(restarted.review());
  restarted.handoff.runtime.cancelRun({ runId: restarted.initial.run.runId });
  restarted.handoff.runtime.startRun({ caseId: restarted.initial.caseId, stages: [{ id: "new", label: "Different task", owner: "agent" }] });
  assert.throws(() => restarted.handoff.complete(), /case or current run changed/);
  assert.equal(restarted.handoff.runtime.snapshot().receipts.some((entry) => entry.status === "completed"), false);
});

test("new source wording and a post-review access block both prevent a previously verified close", () => {
  const changed = scenario();
  changed.handoff.receiveFinal(changed.final);
  changed.handoff.review(changed.review());
  replaceCanonical(changed.handoff, changed.initial.source.artifactId, { revision: "new-revision", text: "The old passage was removed." });
  assert.throws(() => changed.handoff.complete(), /canonical artifact binding changed/);
  assert.equal(changed.handoff.runtime.snapshot().receipts.length, 0);
  const blocked = scenario();
  blocked.handoff.receiveFinal(blocked.final);
  blocked.handoff.review(blocked.review());
  blocked.handoff.block("Access was withdrawn before delivery.");
  assert.throws(() => blocked.handoff.complete(), /run is not active: blocked/);
  assert.equal(blocked.handoff.runtime.snapshot().receipts.length, 0);
});

test("oversized, empty and wrong-revision host inputs cannot accumulate partial artifacts", () => {
  assert.throws(() => createManagedHandoff({ source: { revision: "v1", text: "x".repeat(65_537) } }), /source text/);
  const { handoff, final } = scenario();
  const before = handoff.runtime.snapshot();
  for (const patch of [{ quote: " " }, { quote: "x".repeat(4097) }, { eventId: "x".repeat(129) }, { sourceRevision: "wrong" }]) {
    assert.throws(() => handoff.receiveFinal({ ...final, ...patch }));
    assert.deepEqual(handoff.runtime.snapshot(), before);
  }
});
