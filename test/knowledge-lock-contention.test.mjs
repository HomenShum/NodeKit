import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeKnowledgeGraph, readKnowledgeGraph, recordKnowledgeAction } from "../src/lib/knowledge-evolution.mjs";

// The existing concurrency test failed about 1 run in 4 under a loaded test runner and never in
// isolation, which read as flakiness. It was not. Measured on Windows, 12 concurrent writers lost
// 1-2 receipts per round, because "the lock is held" is not one errno:
//
//   open(lockPath, "wx")  ->  EEXIST on POSIX, EPERM or EACCES on Windows when the existing lock
//                             file is delete-pending, the ordinary state while another writer
//                             releases it. Only EEXIST was retried, so the rest threw.
//   lstat(lockPath).nlink ->  0 on Windows in that same window. The guard demanded exactly 1 and
//                             threw "not one regular file", rejecting the caller's write.
//
// Both are invisible on Linux CI. This test raises the writer count so the release window is hit
// reliably, and asserts on the chain rather than on a count alone — a lost update can leave the
// right number of receipts with a broken chain.

async function graphRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-lock-contend-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeKnowledgeGraph(root, { graphId: "g", ownerId: "o" });
  return root;
}

test("concurrent writers never lose a receipt and never break the hash chain", async (t) => {
  const root = await graphRoot(t);
  const WRITERS = 32;                        // well past the 12 that used to fail

  const results = await Promise.allSettled(Array.from({ length: WRITERS }, (_, index) =>
    recordKnowledgeAction(root, {
      type: "INSPECT_ARTIFACT",
      receiptId: `knowledge_action_contend_${index}`,
      runId: "run:contend",
      caseId: "case:contend",
      actorId: `agent:${index}`,
    })));

  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.deepEqual(
    rejected.map((entry) => entry.reason?.message?.slice(0, 120)),
    [],
    "a contended writer must wait for the lock, not fail",
  );

  const graph = await readKnowledgeGraph(root);
  assert.equal(graph.actionReceipts.length, WRITERS, "every write must land");
  assert.deepEqual(
    graph.actionReceipts.map((entry) => entry.sequence),
    Array.from({ length: WRITERS }, (_, index) => index + 1),
    "sequences must be a dense 1..N with no gap and no duplicate",
  );
  assert.equal(graph.actionReceipts[0].previousReceiptHash, null);
  for (let index = 1; index < graph.actionReceipts.length; index += 1) {
    assert.equal(
      graph.actionReceipts[index].previousReceiptHash,
      graph.actionReceipts[index - 1].receiptHash,
      `chain broken at ${index}: a lost update can leave the right COUNT with a broken chain`,
    );
  }
});

// Repeat, because a race that reproduces once in four runs is not proven fixed by one green run.
test("the chain holds across repeated contended rounds", async (t) => {
  for (let round = 0; round < 5; round += 1) {
    const root = await graphRoot(t);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      recordKnowledgeAction(root, {
        type: "INSPECT_ARTIFACT",
        receiptId: `knowledge_action_round_${round}_${index}`,
        runId: "run:round", caseId: "case:round", actorId: `agent:${index}`,
      })));
    assert.equal(results.filter((entry) => entry.status === "rejected").length, 0, `round ${round} had a rejected writer`);
    const graph = await readKnowledgeGraph(root);
    assert.equal(graph.actionReceipts.length, 12, `round ${round} lost a receipt`);
  }
});

// The hardlink guard is a security property and must survive the fix that relaxed nlink === 0.
test("a hardlinked lock is still refused", async (t) => {
  const { link, writeFile } = await import("node:fs/promises");
  const root = await graphRoot(t);
  const lockPath = path.join(root, ".nodeagent", "knowledge", "graph.json.mutation.lock");
  await writeFile(lockPath, `${JSON.stringify({ pid: 999999, token: "x", acquiredAt: new Date(0).toISOString() })}\n`);
  await link(lockPath, `${lockPath}.other`);          // nlink becomes 2

  // Backdate so the staleness guard does not short-circuit before the hardlink check.
  const { utimes } = await import("node:fs/promises");
  const old = new Date(Date.now() - 600_000);
  await utimes(lockPath, old, old);

  await assert.rejects(
    () => recordKnowledgeAction(root, {
      type: "INSPECT_ARTIFACT", receiptId: "knowledge_action_hardlink", runId: "r", caseId: "c", actorId: "a",
    }),
    /hardlinked/,
    "nlink > 1 must still be refused; only nlink === 0 was relaxed",
  );
});

// A second, distinct cause of the same symptom, found after the errno fix above and diagnosed the
// same way: 2 of 32 writers failed under full-suite load, green in isolation on the same machine.
//
// The wait budget was a fixed wall clock set once on entry, which conflates "the holder is wedged"
// with "there are writers queued ahead of me". Thirty-two writers serialize, so the last one waits
// behind thirty-one predecessors; on a busy machine that exceeds the budget and the caller loses a
// receipt it was told would be recorded. Raising the constant only moves the cliff to a larger
// writer count. The budget now resets whenever the lock changes hands, so it measures lack of
// progress rather than elapsed time.
//
// Which creates exactly one new way to be wrong: a holder that never releases must still expire,
// or the fix has traded a lost receipt for a hang. That is what this asserts.
test("a wedged holder still expires; the budget measures lack of progress, not patience", async (t) => {
  const root = await graphRoot(t);
  const lockPath = path.join(root, ".nodeagent", "knowledge", "graph.json.mutation.lock");

  // Held open and never released, with a token that never changes. Its mtime stays well inside
  // GRAPH_LOCK_STALE_MS, so stale recovery deliberately does not rescue this — the deadline must.
  const handle = await open(lockPath, "wx", 0o600);
  t.after(async () => {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
  });
  await handle.writeFile(`${JSON.stringify({ acquiredAt: new Date().toISOString(), pid: process.pid, token: "wedged" })}\n`, "utf8");
  await handle.sync();

  const startedAt = Date.now();
  await assert.rejects(
    recordKnowledgeAction(root, {
      type: "INSPECT_ARTIFACT",
      receiptId: "knowledge_action_wedged",
      runId: "run:wedged",
      caseId: "case:wedged",
      actorId: "agent:wedged",
    }),
    (error) => /mutation lock timed out/.test(error.message) && /wedged rather than busy/.test(error.message),
  );
  // It waited the budget rather than giving up on the first contended open — the failure that would
  // reintroduce the lost receipts this whole file exists to prevent.
  assert.ok(Date.now() - startedAt >= 9_000, `expected to wait the full budget, waited ${Date.now() - startedAt}ms`);
});

// Codex's objection to the progress-based budget, and it was right: resetting the stall deadline on
// every change of holder makes the wait unbounded. `open(..., "wx")` has no fairness, so a writer
// can lose every race while others cycle, resetting its budget forever. That trades a lost receipt
// for a hang — a worse failure, and a much harder one to diagnose from a stuck agent.
//
// So there are two deadlines now and the wait ends at whichever comes first. This asserts the one
// the stationary-holder test above cannot reach: the holder keeps changing, this writer never wins,
// and it must still fail in bounded time rather than wait forever.
test("a writer that loses every race still fails; a moving queue is not a licence to wait forever", async (t) => {
  const root = await graphRoot(t);
  const lockPath = path.join(root, ".nodeagent", "knowledge", "graph.json.mutation.lock");

  // A ceiling short enough to assert against. A 120-second test is one nobody runs.
  const previous = process.env.NODEKIT_GRAPH_LOCK_CEILING_MS;
  process.env.NODEKIT_GRAPH_LOCK_CEILING_MS = "1500";
  t.after(() => {
    if (previous === undefined) delete process.env.NODEKIT_GRAPH_LOCK_CEILING_MS;
    else process.env.NODEKIT_GRAPH_LOCK_CEILING_MS = previous;
  });

  // Held continuously, but rewritten with a fresh token every 50ms: from the waiter's side this is
  // indistinguishable from a queue moving briskly, which is exactly the state that reset the budget.
  const handle = await open(lockPath, "wx", 0o600);
  let rotating = true;
  const rotator = (async () => {
    while (rotating) {
      await handle.truncate(0);
      await handle.write(`${JSON.stringify({ acquiredAt: new Date().toISOString(), pid: process.pid, token: randomBytes(8).toString("hex") })}\n`, 0, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  t.after(async () => {
    rotating = false;
    await rotator.catch(() => {});
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true });
  });

  const startedAt = Date.now();
  await assert.rejects(
    recordKnowledgeAction(root, {
      type: "INSPECT_ARTIFACT",
      receiptId: "knowledge_action_starved",
      runId: "run:starved",
      caseId: "case:starved",
      actorId: "agent:starved",
    }),
    (error) => /lost every race/.test(error.message),
  );
  const waited = Date.now() - startedAt;
  // Bounded: it gave up on the ceiling, not on the stall budget, and not never.
  assert.ok(waited >= 1_400 && waited < 9_000, `expected to fail on the ceiling, waited ${waited}ms`);
});
