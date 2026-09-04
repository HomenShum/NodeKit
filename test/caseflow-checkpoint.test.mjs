import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCaseflow, contentHash } from "../src/caseflow.mjs";

test("a maker repeatedly reopens valid nested requirements and retries creation without losing its saved identity", () => {
  let content = { value: "Retain the supplier's nested requirement" };
  for (let i = 1; i < 10; i++) content = { nested: content };
  let runtime = createMemoryCaseflow({ ownerId: "nested-maker" });
  for (let i = 0; i < 20; i++) {
    const work = runtime.createCase({ title: `Nested sample ${i}`, primaryJob: "Preserve structured supplier requirements" });
    const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "review", label: "Review", owner: "user" }] });
    const request = { caseId: work.caseId, runId: run.runId, content, idempotencyKey: `nested-${i}` };
    const artifact = runtime.createArtifact(request);
    const before = runtime.snapshot();
    const saved = JSON.parse(JSON.stringify(runtime.checkpoint()));
    runtime = createMemoryCaseflow({ ownerId: "nested-maker", checkpoint: saved });
    assert.deepEqual(runtime.snapshot(), before);
    assert.equal(runtime.createArtifact(request).artifactId, artifact.artifactId);
    assert.throws(() => createMemoryCaseflow({ ownerId: "other", checkpoint: saved }), /identity/);
    saved.state.cases[0].title = "Changed after export";
    assert.throws(() => createMemoryCaseflow({ ownerId: "nested-maker", checkpoint: saved }), /hash/);
  }
  const accessor = runtime.checkpoint();
  let invoked = false;
  Object.defineProperty(accessor, "state", { enumerable: true, get() { invoked = true; return {}; } });
  assert.throws(() => createMemoryCaseflow({ ownerId: "nested-maker", checkpoint: accessor }), /accessor|enumerable|portable/);
  assert.equal(invoked, false);
  const oversized = runtime.checkpoint();
  oversized.extra = "x".repeat(768 * 1024 - 4096);
  assert.throws(() => createMemoryCaseflow({ ownerId: "nested-maker", checkpoint: oversized }), /byte limit|encoded bytes/);
  const journalAccessor = runtime.checkpoint();
  Object.defineProperty(journalAccessor.idempotencyJournal[0][1], "result", { enumerable: true, get() { invoked = true; return {}; } });
  assert.throws(() => createMemoryCaseflow({ ownerId: "nested-maker", checkpoint: journalAccessor }), /accessor|enumerable|portable/);
  assert.equal(invoked, false);
  assert.equal(runtime.snapshot().artifacts.length, 20);
});

test("maker returns after restart to the same pending proposal, then duplicate approval and stale tab preserve the receipt", () => {
  let runtime = createMemoryCaseflow({ ownerId: "maker" });
  const work = runtime.createCase({ title: "Backpack sample", primaryJob: "Preserve programmable LED requirements" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "review", label: "Review", owner: "user" }] });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { spec: "programmable" }, idempotencyKey: "create-spec" });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { spec: "test waterproofing" } });
  const stale = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { spec: "old tab" } });
  const baseline = runtime.snapshot();
  runtime = createMemoryCaseflow({ ownerId: "maker", checkpoint: JSON.parse(JSON.stringify(runtime.checkpoint())) });
  assert.deepEqual(runtime.snapshot(), baseline);
  assert.equal(runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { spec: "programmable" }, idempotencyKey: "create-spec" }).artifactId, artifact.artifactId);
  runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  assert.equal(runtime.decideProposal({ proposalId: stale.proposalId, decision: "accepted" }).proposal.status, "conflicted");
  const completed = runtime.completeRun({ runId: run.runId });
  runtime = createMemoryCaseflow({ ownerId: "maker", checkpoint: runtime.checkpoint() });
  assert.equal(runtime.completeRun({ runId: run.runId }).receipt.receiptHash, completed.receipt.receiptHash);
  assert.throws(() => createMemoryCaseflow({ ownerId: "other", checkpoint: runtime.checkpoint() }), /identity/);
  const corrupted = runtime.checkpoint();
  corrupted.state.cases[0].title = "changed";
  assert.throws(() => createMemoryCaseflow({ ownerId: "maker", checkpoint: corrupted }), /hash/);
});

test("a long-running local queue reopens exact history and rejects malformed or oversized checkpoint collections", () => {
  let runtime = createMemoryCaseflow({ ownerId: "maker" });
  for (let i = 0; i < 40; i++) {
    const work = runtime.createCase({ title: `Sample ${i}`, primaryJob: "Inspect sample" });
    const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "inspect", label: "Inspect", owner: "user" }] });
    runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { index: i } });
    runtime.completeRun({ runId: run.runId });
    runtime = createMemoryCaseflow({ ownerId: "maker", checkpoint: runtime.checkpoint() });
  }
  assert.equal(runtime.snapshot().receipts.length, 40);
  const changed = runtime.checkpoint();
  changed.state.cases.push(changed.state.cases[0]);
  const { checkpointHash, ...body } = changed;
  changed.checkpointHash = contentHash(body);
  assert.throws(() => createMemoryCaseflow({ ownerId: "maker", checkpoint: changed }), /duplicate/);
  const oversized = createMemoryCaseflow({ ownerId: "maker" }).checkpoint();
  oversized.state.cases = Array.from({ length: 4097 }, (_, i) => ({ caseId: `case-${i}` }));
  const { checkpointHash: ignored, ...largeBody } = oversized;
  oversized.checkpointHash = contentHash(largeBody);
  assert.throws(() => createMemoryCaseflow({ ownerId: "maker", checkpoint: oversized }), /limit|bound|4096|large/i);
});

test("a maker rejects malformed saved records and broken cross-case references before resuming an accepted sample", () => {
  const runtime = createMemoryCaseflow({ ownerId: "maker" });
  const work = runtime.createCase({ title: "Sample revision", primaryJob: "Retain the rejected controller evidence" });
  const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "review", label: "Review sample", owner: "user" }] });
  const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { revision: 1 }, idempotencyKey: "sample-artifact" });
  const exception = runtime.raiseException({ runId: run.runId, message: "Controller behavior failed inspection" });
  runtime.resolveException({ exceptionId: exception.exceptionId, resolution: "Replacement controller inspected" });
  const proposal = runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { revision: 2 } });
  runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  runtime.completeRun({ runId: run.runId });
  const saved = runtime.checkpoint();
  const reseal = (checkpoint) => {
    const { checkpointHash, ...body } = checkpoint;
    checkpoint.checkpointHash = contentHash(body);
  };
  const mutations = [
    ["required case fields", (s) => { s.cases[0] = { caseId: work.caseId }; }],
    ["current run reference", (s) => { s.cases[0].currentRunId = "missing-run"; }],
    ["run case reference", (s) => { s.runs[0].caseId = "missing-case"; }],
    ["empty stage plan", (s) => { s.runs[0].stages = []; }],
    ["missing current stage", (s) => { s.runs[0].currentStageId = "missing-stage"; }],
    ["artifact case binding", (s) => { s.artifacts[0].caseId = "missing-case"; }],
    ["artifact version content", (s) => { s.artifacts[0].versions[1].content = { revision: 999 }; }],
    ["artifact proposal reference", (s) => { s.artifacts[0].versions[1].proposalId = "missing-proposal"; }],
    ["proposal artifact reference", (s) => { s.proposals[0].artifactId = "missing-artifact"; }],
    ["approval proposal reference", (s) => { s.approvals[0].proposalId = "missing-proposal"; }],
    ["exception run reference", (s) => { s.exceptions[0].runId = "missing-run"; }],
    ["event aggregate reference", (s) => { s.events[0].aggregateId = "missing-case"; }],
    ["event ordering", (s) => { s.events[0].sequence = 8; }],
    ["terminal receipt reference", (s) => { s.receipts = []; }],
    ["receipt event reference with valid own hash", (s) => {
      s.receipts[0].eventBindings[0].eventId = "missing-event";
      s.receipts[0].eventIds[0] = "missing-event";
      const { receiptHash, receiptId, ...body } = s.receipts[0];
      s.receipts[0].receiptHash = contentHash(body);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const malformed = structuredClone(saved);
    mutate(malformed.state); reseal(malformed);
    assert.throws(() => createMemoryCaseflow({ ownerId: "maker", checkpoint: malformed }), /checkpoint|stages/i, label);
  }
  const missingRetryResult = structuredClone(saved);
  delete missingRetryResult.idempotencyJournal[0][1].result;
  reseal(missingRetryResult);
  assert.throws(() => createMemoryCaseflow({ ownerId: "maker", checkpoint: missingRetryResult }), /retry record/);
  assert.deepEqual(createMemoryCaseflow({ ownerId: "maker", checkpoint: saved }).snapshot(), runtime.snapshot());
});

test("a maker can still reopen cancelled and failed-safe runs with unresolved samples without inventing acceptance", () => {
  for (const terminal of ["cancelRun", "failRunSafely"]) {
    let runtime = createMemoryCaseflow({ ownerId: "maker" });
    const work = runtime.createCase({ title: "Unavailable sample", primaryJob: "Preserve evidence while stopping safely" });
    const run = runtime.startRun({ caseId: work.caseId, stages: [{ id: "sample", label: "Inspect", owner: "user" }] });
    const artifact = runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { status: "unverified" } });
    runtime.createProposal({ artifactId: artifact.artifactId, baseVersion: 1, patch: { status: "proposed" } });
    runtime.raiseException({ runId: run.runId, message: "Supplier sample unavailable" });
    const stopped = runtime[terminal]({ runId: run.runId, reason: "Wait for real sample evidence" });
    runtime = createMemoryCaseflow({ ownerId: "maker", checkpoint: runtime.checkpoint() });
    assert.equal(runtime.snapshot().exceptions[0].status, "open");
    assert.equal(runtime.snapshot().proposals[0].status, "pending");
    assert.equal(runtime.snapshot().artifacts[0].canonicalVersion, 1);
    assert.equal(runtime[terminal]({ runId: run.runId, reason: "Wait for real sample evidence" }).receipt.receiptHash, stopped.receipt.receiptHash);
    assert.equal(runtime.startRun({ caseId: work.caseId, stages: [{ id: "retry", label: "Request replacement sample", owner: "user" }] }).status, "active");
  }
});
