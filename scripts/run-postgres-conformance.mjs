import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  assertCleanDistributablePaths,
  distributablePathspecs,
  parseGitStatusPorcelainZ,
} from "../src/lib/distributable-candidate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.NODEKIT_POSTGRES_URL;
const LIMITS = Object.freeze({
  fileBytes: 64 * 1024 * 1024, reportBytes: 1024 * 1024, subprocessBytes: 1024 * 1024,
  installMs: 180_000, proofMs: 360_000, processMs: 720_000, cleanupMs: 45_000,
  connectionMs: 3_000, statementMs: 10_000, lockMs: 4_000, idleTransactionMs: 12_000,
  queryMs: 12_000, synchronizationMs: 2_500, settlementMs: 15_000,
  clients: 8, fixtureRows: 512, artifactIds: 256,
});

function requireProof(condition, message) {
  if (!condition) throw new Error(message);
}

function errorSummary(error, includeCauses = true) {
  let message = String(error?.message ?? error);
  if (connectionString) message = message.replaceAll(connectionString, "[database URL redacted]");
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    code: String(error?.code ?? "").slice(0, 80),
    message: message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL redacted]").slice(0, 1024),
    ...(includeCauses && error instanceof AggregateError
      ? { causeCount: error.errors.length, causes: error.errors.slice(0, 4).map((cause) => errorSummary(cause, false)) } : {}),
  };
}

async function deadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} deadline exceeded`), { code: "PROOF_DEADLINE" })), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function boundedRead(file, maxBytes = LIMITS.fileBytes) {
  const metadata = await lstat(file);
  requireProof(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= maxBytes, "proof input is not a bounded regular file");
  const handle = await open(file, "r");
  try {
    const before = await handle.stat();
    requireProof(before.dev === metadata.dev && before.ino === metadata.ino && before.size === metadata.size, "proof input changed before read");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    requireProof(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs, "proof input changed during bounded read");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

// The same small finalizer is used by the real lifecycle and two harmless
// failure cases. A required cleanup failure can never turn into success.
async function finishLifecycle(operation, cleanups) {
  let value = null;
  let primaryError = null;
  try { value = await operation(); } catch (error) { primaryError = errorSummary(error); }
  const cleanup = [];
  for (const [name, action] of cleanups) {
    try {
      const detail = await deadline(Promise.resolve().then(action), LIMITS.cleanupMs, name);
      cleanup.push({ name, passed: true, detail: detail ?? null });
    } catch (error) {
      cleanup.push({ name, passed: false, error: errorSummary(error) });
    }
  }
  const passed = primaryError === null && value?.passed === true && cleanup.every((entry) => entry.passed);
  return { value, primaryError, cleanup, passed, exitCode: passed ? 0 : 1 };
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Hooks observe actual SQL results. No hook returns fabricated rows or replaces
// a query; a held transaction resumes through the installed public adapter.
function delegatedPool({ connected = () => {}, after = async () => {} } = {}) {
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      connected(client.processID);
      return {
        async query(text, values) {
          const result = await client.query(text, values);
          await after(text.replace(/\s+/g, " ").trim(), values, result, client);
          return result;
        },
        release: () => client.release(),
      };
    },
  };
}

async function observeBlocking(waiterPid, blockerPid) {
  const expires = Date.now() + LIMITS.synchronizationMs;
  do {
    const row = (await pool.query(
      "select pid, wait_event_type, pg_blocking_pids(pid) as blockers from pg_stat_activity where pid = $1",
      [waiterPid],
    )).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blockerPid)) {
      return { waiterPid, blockerPid, waitEventType: row.wait_event_type, blockerObserved: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < expires);
  throw new Error("second real client was not observed blocked by the first transaction");
}

async function forceOrder(createRuntime, firstOperation, firstLock, secondOperation) {
  const acquired = signal();
  const release = signal();
  const secondConnected = signal();
  let paused = false;
  let second;
  const settle = (promise) => promise.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
  const first = settle(firstOperation(createRuntime(delegatedPool({
    after: async (text, values, result, client) => {
      if (!paused && firstLock(text, values)) {
        requireProof(result.rowCount === 1, "first lock statement did not return its actual fixture row");
        paused = true;
        acquired.resolve(client.processID);
        await deadline(release.promise, LIMITS.settlementMs, "release first lock");
      }
    },
  }))));
  let observation;
  let orderingError;
  try {
    const blocker = await deadline(Promise.race([acquired.promise, first.then((result) => {
      if (result.status === "rejected") throw result.reason;
      throw new Error("first operation finished without the required lock observation");
    })]), LIMITS.synchronizationMs, "first lock acquisition");
    second = settle(secondOperation(createRuntime(delegatedPool({ connected: secondConnected.resolve }))));
    const waiter = await deadline(secondConnected.promise, LIMITS.synchronizationMs, "second client acquisition");
    requireProof(waiter !== blocker, "forced order requires two distinct database backends");
    observation = await observeBlocking(waiter, blocker);
  } catch (error) {
    orderingError = error;
  } finally {
    release.resolve();
    try {
      await deadline(Promise.all([first, ...(second ? [second] : [])]), LIMITS.settlementMs, "forced order settlement");
    } catch (error) {
      if (orderingError) throw new AggregateError([orderingError, error], "forced order and settlement failed");
      throw error;
    }
  }
  if (orderingError) throw orderingError;
  return { first: await first, second: await second, observation };
}

function rejected(result, pattern) {
  return result.status === "rejected" && pattern.test(String(result.reason?.message));
}

async function runGuardedProof(createPostgresCaseflow, contentHash) {
  const expires = Date.now() + LIMITS.proofMs;
  const checkBudget = () => requireProof(Date.now() < expires, "guarded proof operation budget exhausted");
  const runtime = createPostgresCaseflow({ pool, ownerId: ownerGuard });
  const createRuntime = (selectedPool) => createPostgresCaseflow({ pool: selectedPool, ownerId: ownerGuard });
  const schedules = [];
  const assertions = {};
  const stages = [{ id: "review", label: "Review", owner: "user" }];
  const runLock = (text) => /^select .* from nodekit\.runs .* for update$/.test(text);
  const caseLock = (text) => /^select \* from nodekit\.cases .* for update$/.test(text);
  const proposalFunction = (text) => text.startsWith("select * from nodekit.apply_proposal(");
  const close = (fixture) => (selected) => selected.completeRun({ runId: fixture.run.runId, expected: fixture.expected });
  async function fixture(title) {
    checkBudget();
    const work = await runtime.createCase({ title, primaryJob: "Publish the reviewed source" });
    const run = await runtime.startRun({ caseId: work.caseId, stages });
    const artifact = await runtime.createArtifact({ caseId: work.caseId, runId: run.runId, content: { quote: "original" } });
    return { work, run, artifact, expected: {
      caseId: work.caseId,
      caseInputHash: contentHash({ title: work.title, primaryJob: work.primaryJob }),
      artifactBindings: [{ artifactId: artifact.artifactId, canonicalVersion: 1, contentHash: contentHash({ quote: "original" }) }],
    } };
  }
  // This independent-client snapshot contains bounded counts and hashes of
  // every owned table, not a selected status field or a body dump in the report.
  async function state(client) {
    const counts = {};
    const hashes = {};
    const tables = ["cases", "runs", "artifacts", "proposals", "approvals", "exceptions", "receipts", "events", "artifact_versions"];
    for (const table of tables) {
      const ownership = table === "artifact_versions"
        ? "t.artifact_id in (select artifact_id from nodekit.artifacts where owner_id = $1)"
        : "t.owner_id = $1";
      const result = await client.query(
        `select case when octet_length(to_jsonb(t)::text) <= 16384 then to_jsonb(t) else null end as body
         from nodekit.${table} t where ${ownership} order by to_jsonb(t)::text limit ${LIMITS.fixtureRows + 1}`,
        [ownerGuard],
      );
      requireProof(result.rows.length <= LIMITS.fixtureRows && result.rows.every((row) => row.body !== null), "guard fixture snapshot exceeded its row/body cap");
      counts[table] = result.rows.length;
      hashes[table] = contentHash(result.rows.map((row) => row.body));
    }
    return { counts, hashes, hash: contentHash({ counts, hashes }) };
  }
  async function unchangedRejection(operation, pattern) {
    checkBudget();
    const observer = await pool.connect();
    try {
      const before = await state(observer);
      let error;
      try { await operation(); } catch (caught) { error = caught; }
      requireProof(error && pattern.test(String(error.message)), "guarded rejection did not have its required cause");
      const after = await state(observer);
      requireProof(after.hash === before.hash, "rejected guarded close changed owned state");
      return { before, after, error: errorSummary(error) };
    } finally { observer.release(); }
  }
  async function recordOrder(name, first, lock, second, check) {
    checkBudget();
    const result = await forceOrder(createRuntime, first, lock, second);
    requireProof(check(result), `${name} had an unexpected result`);
    requireProof(schedules.length < 8, "forced-order report cap exceeded");
    schedules.push({ name, ...result.observation, first: result.first.status, second: result.second.status,
      firstError: result.first.status === "rejected" ? errorSummary(result.first.reason) : null,
      secondError: result.second.status === "rejected" ? errorSummary(result.second.reason) : null });
  }

  for (const kind of ["criteria", "artifact"]) {
    for (const closeFirst of [false, true]) {
      const task = await fixture(`${kind}: ${closeFirst ? "close first" : "owner change first"}`);
      const edit = kind === "criteria"
        ? (selected) => selected.updateCaseInput({ caseId: task.work.caseId, primaryJob: "Owner changed the criteria" })
        : (selected) => selected.createArtifact({ caseId: task.work.caseId, runId: task.run.runId, content: { added: true } });
      await recordOrder(`${kind}-${closeFirst ? "close-first" : "edit-first"}`,
        closeFirst ? close(task) : edit, kind === "criteria" ? caseLock : runLock,
        closeFirst ? edit : close(task),
        (result) => result.first.status === "fulfilled" && rejected(result.second,
          closeFirst ? /completed case input|run is terminal: completed/ : /expected reviewed state/));
      const rows = await pool.query("select status from nodekit.runs where owner_id = $1 and run_id = $2", [ownerGuard, task.run.runId]);
      const receipts = await pool.query("select receipt_id from nodekit.receipts where owner_id = $1 and run_id = $2", [ownerGuard, task.run.runId]);
      const terminal = await pool.query("select event_type from nodekit.events where owner_id = $1 and aggregate_id = $2 and event_type in ('run.completed', 'receipt.created')", [ownerGuard, task.run.runId]);
      requireProof(rows.rows[0].status === (closeFirst ? "completed" : "active") && receipts.rowCount === (closeFirst ? 1 : 0)
        && terminal.rowCount === (closeFirst ? 2 : 0), "forced owner order left an invalid terminal state");
    }
  }
  assertions.caseAndArtifactBothOrdersObserved = true;

  for (const closeFirst of [false, true]) {
    const task = await fixture(`proposal acceptance: ${closeFirst ? "close first" : "accept first"}`);
    const proposal = await runtime.createProposal({ artifactId: task.artifact.artifactId, baseVersion: 1, patch: { quote: "accepted" } });
    const accept = (selected) => selected.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
    await recordOrder(`proposal-${closeFirst ? "pending-close-first" : "accept-first"}`,
      closeFirst ? close(task) : accept, closeFirst ? runLock : proposalFunction,
      closeFirst ? accept : close(task), (result) => closeFirst
        ? rejected(result.first, /pending proposals/) && result.second.status === "fulfilled"
        : result.first.status === "fulfilled" && rejected(result.second, /expected reviewed state/));
    const row = (await pool.query(
      "select r.status, a.canonical_version, (select count(*)::int from nodekit.receipts where owner_id = $1 and run_id = $2) as receipts from nodekit.runs r join nodekit.artifacts a on a.run_id = r.run_id where r.owner_id = $1 and r.run_id = $2",
      [ownerGuard, task.run.runId],
    )).rows[0];
    requireProof(row.status === "active" && row.canonical_version === 2 && row.receipts === 0, "proposal order did not preserve pending/stale-close semantics");
  }
  assertions.proposalBothOrdersPreservePendingRule = true;
  const lateProposal = await fixture("proposal admission after completed close");
  await recordOrder("close-before-proposal-admission", close(lateProposal), runLock,
    (selected) => selected.createProposal({ artifactId: lateProposal.artifact.artifactId, baseVersion: 1, patch: { quote: "late" } }),
    (result) => result.first.status === "fulfilled" && rejected(result.second, /run is terminal: completed/));
  assertions.completedRunRejectsProposalAdmission = true;

  const restored = await fixture("restored bytes still have a new canonical version");
  for (const [index, quote] of ["changed", "original"].entries()) {
    const proposal = await runtime.createProposal({ artifactId: restored.artifact.artifactId, baseVersion: index + 1, patch: { quote } });
    await runtime.decideProposal({ proposalId: proposal.proposalId, decision: "accepted" });
  }
  await unchangedRejection(() => close(restored)(runtime), /expected reviewed state/);
  assertions.restoredBytesRejectOldVersionWithoutMutation = true;
  const membership = await fixture("complete artifact membership");
  const added = await runtime.createArtifact({ caseId: membership.work.caseId, runId: membership.run.runId, content: { added: true } });
  await unchangedRejection(() => close(membership)(runtime), /expected reviewed state/);
  membership.expected.artifactBindings.push({ artifactId: added.artifactId, canonicalVersion: 1, contentHash: contentHash({ added: true }) });
  const memberReceipt = await close(membership)(runtime);
  requireProof(memberReceipt.receipt.artifactIds.length === 2 && memberReceipt.receipt.artifactIds.includes(added.artifactId), "exact artifact-set success omitted an artifact");
  assertions.exactMembershipRejectedThenCompleted = true;
  const privateTask = await fixture("wrong owner cannot close");
  await unchangedRejection(() => close(privateTask)(createPostgresCaseflow({ pool, ownerId: ownerB })), /run not found/);
  assertions.wrongOwnerRejectedWithoutMutation = true;
  const missing = await fixture("missing canonical version");
  const removed = await pool.query("delete from nodekit.artifact_versions v using nodekit.artifacts a where v.artifact_id = a.artifact_id and a.owner_id = $1 and a.artifact_id = $2 and v.version = 1", [ownerGuard, missing.artifact.artifactId]);
  requireProof(removed.rowCount === 1, "missing-version fixture did not remove its exact owned version");
  await unchangedRejection(() => close(missing)(runtime), /missing its canonical version/);
  assertions.missingCanonicalVersionRejectedWithoutMutation = true;

  const rollbackTask = await fixture("post-write rollback");
  const observer = await pool.connect();
  let rollbackObservation;
  try {
    const before = await state(observer);
    let uncommitted;
    let rollbackCommand;
    const injected = createRuntime(delegatedPool({ after: async (text, _values, result, client) => {
      if (text === "rollback") {
        rollbackCommand = result.command;
        return;
      }
      if (!text.startsWith("insert into nodekit.receipts ")) return;
      requireProof(result.rowCount === 1 && client.processID !== observer.processID, "rollback fixture lacks a real independent write");
      const row = (await client.query(
        "select r.status as run_status, c.status as case_status, (select count(*)::int from nodekit.receipts where owner_id = $1 and run_id = $2) as receipts, (select count(*)::int from nodekit.events where owner_id = $1 and aggregate_id = $2 and event_type = 'run.completed') as terminal_events from nodekit.runs r join nodekit.cases c on c.case_id = r.case_id where r.owner_id = $1 and r.run_id = $2",
        [ownerGuard, rollbackTask.run.runId],
      )).rows[0];
      requireProof(row.run_status === "completed" && row.case_status === "completed" && row.receipts === 1 && row.terminal_events === 1, "actual uncommitted terminal writes were not observed");
      uncommitted = { ...row, writerPid: client.processID, observerPid: observer.processID, injection: "after-real-receipt-insert-before-commit" };
      throw Object.assign(new Error("controlled post-write rollback"), { code: "PROOF_POST_WRITE" });
    } }));
    let error;
    try { await close(rollbackTask)(injected); } catch (caught) { error = caught; }
    requireProof(error?.code === "PROOF_POST_WRITE" && uncommitted && rollbackCommand === "ROLLBACK", "post-write injection did not observe its real write and acknowledged rollback");
    const after = await state(observer);
    requireProof(before.hash === after.hash, "separate client observed state drift after rollback");
    rollbackObservation = { uncommitted, rollbackCommand, before, after, originalError: errorSummary(error) };
  } finally { observer.release(); }
  assertions.postWriteRollbackRestoredExactState = true;

  const held = await fixture("held run lock expires without completion");
  const beforeHeld = await state(pool);
  const holder = await pool.connect();
  const waiting = signal();
  let heldLockObservation;
  const heldStart = Date.now();
  let contender;
  const heldLifecycle = await finishLifecycle(async () => {
    await holder.query("begin");
    await holder.query("select * from nodekit.runs where owner_id = $1 and run_id = $2 for update", [ownerGuard, held.run.runId]);
    contender = close(held)(createRuntime(delegatedPool({ connected: waiting.resolve })))
      .then(() => ({ passed: true }), (error) => ({ passed: false, error }));
    const waiter = await deadline(waiting.promise, LIMITS.synchronizationMs, "held-lock client");
    const blocking = await observeBlocking(waiter, holder.processID);
    const result = await deadline(contender, LIMITS.queryMs, "held-lock refusal");
    requireProof(!result.passed && result.error.code === "55P03", "held lock did not produce the required PostgreSQL lock timeout");
    heldLockObservation = { ...blocking, elapsedMs: Date.now() - heldStart, error: errorSummary(result.error) };
    return { passed: true };
  }, [
    ["held-lock-rollback", () => holder.query("rollback").then(() => null)],
    ["held-lock-release", () => holder.release()],
    ["held-lock-contender", () => contender ? deadline(contender, LIMITS.settlementMs, "held-lock settlement").then(() => null) : null],
  ]);
  if (!heldLifecycle.passed) throw new AggregateError(
    [heldLifecycle.primaryError, ...heldLifecycle.cleanup.filter((entry) => !entry.passed).map((entry) => entry.error)].filter(Boolean),
    "held-lock scenario or required release failed",
  );
  heldLockObservation.cleanup = heldLifecycle.cleanup;
  requireProof((await state(pool)).hash === beforeHeld.hash, "held-lock failure changed owned state");
  assertions.heldLockDeadlinePreservedState = true;

  const retry = await fixture("lost acknowledgment and replacement run");
  let acknowledgedFailure;
  let committedCommand;
  const lostAck = createRuntime(delegatedPool({ after: async (text, _values, result) => {
    if (text === "commit") {
      requireProof(result.command === "COMMIT", "lost-ack fixture did not receive an actual commit acknowledgment");
      committedCommand = result.command;
      throw Object.assign(new Error("controlled lost acknowledgment after real commit"), { code: "PROOF_LOST_ACK" });
    }
  } }));
  try { await close(retry)(lostAck); } catch (error) { acknowledgedFailure = error; }
  requireProof(acknowledgedFailure?.code === "PROOF_LOST_ACK", "lost acknowledgment was not injected after commit");
  const retried = await close(retry)(runtime);
  requireProof(retried.reused === true, "lost-ack retry created a second completion");
  const receiptId = retried.receipt.receiptId;
  const beforeRetries = await state(pool);
  let nextRetry = 0;
  const burstWorkers = await Promise.allSettled(Array.from({ length: LIMITS.clients }, async () => {
    while (nextRetry < 100) {
      checkBudget();
      nextRetry += 1;
      const result = await close(retry)(runtime);
      requireProof(result.reused && result.receipt.receiptId === receiptId, "burst retry changed receipt identity");
    }
  }));
  const burstFailure = burstWorkers.find((result) => result.status === "rejected");
  if (burstFailure) throw burstFailure.reason;
  for (let index = 0; index < 1000; index += 1) {
    checkBudget();
    const result = await close(retry)(runtime);
    requireProof(result.reused && result.receipt.receiptId === receiptId, "sustained retry changed receipt identity");
  }
  const afterRetries = await state(pool);
  requireProof(afterRetries.hash === beforeRetries.hash, "burst/sustained retries accumulated state");
  await unchangedRejection(() => runtime.completeRun({ runId: retry.run.runId, expected: { ...retry.expected, caseInputHash: "a".repeat(64) } }), /terminal retry/);
  await unchangedRejection(() => runtime.completeRun({ runId: retry.run.runId, expected: retry.expected, actor: { type: "human", id: "other-reviewer" } }), /terminal retry/);
  const replacement = await runtime.startRun({ caseId: retry.work.caseId, stages: [{ id: "next", label: "Next", owner: "agent" }] });
  const afterReplacement = await state(pool);
  const oldRetry = await close(retry)(runtime);
  requireProof(oldRetry.reused && oldRetry.receipt.receiptId === receiptId && (await state(pool)).hash === afterReplacement.hash, "old-run retry changed the replacement run");
  const replacementStatus = (await pool.query("select status from nodekit.runs where owner_id = $1 and run_id = $2", [ownerGuard, replacement.runId])).rows[0].status;
  requireProof(replacementStatus === "active", "old-run retry closed the replacement run");
  assertions.lostAckBurstSustainedReplacementRetriesStable = true;

  // An operator may resolve their failure while another reviewer still owns a
  // blocker. Exercise the installed mutation owner, not a presentation label.
  const externalAction = "Wait for the external reviewer";
  const ownershipAssertions = {};
  const mixedRecoveries = [];
  const raiseOwned = (selected, task, nextActionOwner, idempotencyKey) => selected.raiseException({
    runId: task.run.runId, code: `${nextActionOwner}_review`, message: `${nextActionOwner} owns the interrupted step`,
    preservedState: { artifactVersion: 1 }, nextActionOwner,
    nextAction: nextActionOwner === "external" ? externalAction : "Resolve your interrupted step",
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
  async function ownershipState(task) {
    const result = await pool.query(
      "select r.status, r.next_action, r.next_action_owner, a.canonical_version, v.content_hash, (select count(*)::int from nodekit.receipts where owner_id = $1 and run_id = $2) as receipts from nodekit.runs r join nodekit.artifacts a on a.run_id = r.run_id join nodekit.artifact_versions v on v.artifact_id = a.artifact_id and v.version = a.canonical_version where r.owner_id = $1 and r.run_id = $2",
      [ownerGuard, task.run.runId],
    );
    requireProof(result.rowCount === 1, "ownership fixture lost its actual canonical run/artifact");
    const row = result.rows[0];
    requireProof(row.status === "blocked" && row.canonical_version === 1
      && row.content_hash === task.expected.artifactBindings[0].contentHash && row.receipts === 0,
    "ownership recovery reopened work or changed its canonical artifact/receipt");
    return row;
  }
  for (const raiseOrder of ["user-first", "external-first"]) {
    for (const resolvedOwner of ["user", "external"]) {
      const task = await fixture(`mixed ownership ${raiseOrder} resolve ${resolvedOwner}`);
      const firstOwner = raiseOrder === "user-first" ? "user" : "external";
      const first = await raiseOwned(runtime, task, firstOwner);
      const second = await raiseOwned(runtime, task, firstOwner === "user" ? "external" : "user");
      const selected = first.exceptionId < second.exceptionId ? first : second;
      const raised = await ownershipState(task);
      requireProof(raised.next_action_owner === selected.nextActionOwner && raised.next_action === selected.nextAction,
        "raise did not select the ordinal-lowest open exception assignment");
      const resolving = first.nextActionOwner === resolvedOwner ? first : second;
      const remaining = resolving.exceptionId === first.exceptionId ? second : first;
      const resolved = await runtime.resolveException({ exceptionId: resolving.exceptionId,
        resolution: "The selected interruption was addressed", nextAction: "Attempted continuation override", nextActionOwner: "agent" });
      const partial = await ownershipState(task);
      requireProof(resolved.exception.status === "resolved" && resolved.run.status === "blocked"
        && resolved.run.nextActionOwner === remaining.nextActionOwner && resolved.run.nextAction === remaining.nextAction
        && partial.next_action_owner === remaining.nextActionOwner && partial.next_action === remaining.nextAction,
      "partial recovery overrode the unrelated remaining blocker");
      mixedRecoveries.push({ raiseOrder, resolvedOwner, remainingOwner: remaining.nextActionOwner,
        selectedExceptionId: selected.exceptionId, remainingExceptionId: remaining.exceptionId, status: partial.status });
    }
  }
  ownershipAssertions.mixedRecoveryPreservesRemainingAssignment = true;

  // Inject a real PostgreSQL statement error after observing the actual run
  // and exception writes. An independent client must see exact rollback.
  const ownershipRollbacks = [];
  for (const operation of ["raiseException", "resolveException"]) {
    const task = await fixture(`ownership post-write rollback ${operation}`);
    let userException;
    if (operation === "resolveException") {
      userException = await raiseOwned(runtime, task, "user");
      await raiseOwned(runtime, task, "external");
    }
    const observer = await pool.connect();
    try {
      const before = await state(observer);
      let uncommitted;
      let rollbackCommand;
      const injected = createRuntime(delegatedPool({ after: async (text, values, result, client) => {
        if (text === "rollback") { rollbackCommand = result.command; return; }
        if (!text.startsWith("update nodekit.runs set ") || !values?.includes(task.run.runId)) return;
        requireProof(result.rowCount === 1 && client.processID !== observer.processID,
          "ownership rollback requires a real run write and independent observer");
        const row = (await client.query(
          "select r.status, r.next_action, r.next_action_owner, e.status as exception_status from nodekit.runs r join nodekit.exceptions e on e.run_id = r.run_id and e.owner_id = r.owner_id where r.owner_id = $1 and r.run_id = $2 and (($3::text is null and e.next_action_owner = 'external') or e.exception_id = $3)",
          [ownerGuard, task.run.runId, userException?.exceptionId ?? null],
        )).rows;
        const expectedExceptionStatus = operation === "raiseException" ? "open" : "resolved";
        requireProof(row.length === 1 && row[0].status === "blocked" && row[0].next_action_owner === "external"
          && row[0].next_action === externalAction && row[0].exception_status === expectedExceptionStatus,
        "ownership rollback did not observe its actual prospective run/exception assignment");
        uncommitted = { writerPid: client.processID, observerPid: observer.processID, exceptionStatus: row[0].exception_status,
          runStatus: row[0].status, nextActionOwner: row[0].next_action_owner };
        await client.query("select 1 / 0");
        throw new Error("controlled PostgreSQL statement unexpectedly succeeded");
      } }));
      let error;
      try {
        if (operation === "raiseException") await raiseOwned(injected, task, "external");
        else await injected.resolveException({ exceptionId: userException.exceptionId, resolution: "Addressed user interruption" });
      } catch (caught) { error = caught; }
      const after = await state(observer);
      requireProof(error?.code === "22012" && uncommitted && rollbackCommand === "ROLLBACK" && before.hash === after.hash,
        "ownership post-write statement failure did not roll back exact owned state");
      ownershipRollbacks.push({ operation, injection: "after-real-run-update-before-commit", ...uncommitted,
        rollbackCommand, beforeStateHash: before.hash, afterStateHash: after.hash, originalError: errorSummary(error) });
    } finally { observer.release(); }
  }
  ownershipAssertions.postWriteStatementFailuresRestoreExactState = true;

  const ownershipRetry = await fixture("external wait lost acknowledgment and bounded retries");
  const pending = await runtime.createProposal({ artifactId: ownershipRetry.artifact.artifactId, baseVersion: 1, patch: { quote: "pending" } });
  const retryKey = "external-ownership-lost-ack";
  const ownershipRequest = { runId: ownershipRetry.run.runId, code: "external_review",
    message: "external owns the interrupted step", preservedState: { artifactVersion: 1 },
    nextActionOwner: "external", nextAction: externalAction, idempotencyKey: retryKey };
  let ownershipCommit;
  let ownershipAckError;
  const ownershipLostAck = createRuntime(delegatedPool({ after: async (text, _values, result) => {
    if (text !== "commit") return;
    requireProof(result.command === "COMMIT", "ownership lost acknowledgment was not after actual commit");
    ownershipCommit = result.command;
    throw Object.assign(new Error("controlled ownership acknowledgment loss after real commit"), { code: "PROOF_OWNERSHIP_LOST_ACK" });
  } }));
  try { await raiseOwned(ownershipLostAck, ownershipRetry, "external", retryKey); } catch (error) { ownershipAckError = error; }
  requireProof(ownershipAckError?.code === "PROOF_OWNERSHIP_LOST_ACK" && ownershipCommit === "COMMIT",
    "ownership acknowledgment failure was not observed after commit");
  const retryResult = await raiseOwned(runtime, ownershipRetry, "external", retryKey);
  const resultHash = contentHash(retryResult);
  const canonicalWait = await ownershipState(ownershipRetry);
  requireProof(retryResult.nextActionOwner === "external" && retryResult.nextAction === externalAction
    && canonicalWait.next_action_owner === "external" && canonicalWait.next_action === externalAction,
  "saved external waiting assignment disagrees with the replay result");
  ownershipAssertions.canonicalExternalWaitIsBlocked = true;
  const beforeOwnershipRetries = await state(pool);
  let ownershipRetryCount = 0;
  let activeOwnershipCalls = 0;
  let maximumOwnershipCalls = 0;
  const ownershipBurst = await Promise.allSettled(Array.from({ length: LIMITS.clients }, async () => {
    while (ownershipRetryCount < 100) {
      checkBudget();
      ownershipRetryCount += 1;
      activeOwnershipCalls += 1;
      maximumOwnershipCalls = Math.max(maximumOwnershipCalls, activeOwnershipCalls);
      try { requireProof(contentHash(await raiseOwned(runtime, ownershipRetry, "external", retryKey)) === resultHash,
        "burst ownership retry changed the original exception result"); }
      finally { activeOwnershipCalls -= 1; }
    }
  }));
  const ownershipBurstFailure = ownershipBurst.find((result) => result.status === "rejected");
  if (ownershipBurstFailure) throw ownershipBurstFailure.reason;
  for (let index = 0; index < 1000; index += 1) {
    checkBudget();
    requireProof(contentHash(await raiseOwned(runtime, ownershipRetry, "external", retryKey)) === resultHash,
      "sustained ownership retry changed the original exception result");
  }
  const afterOwnershipRetries = await state(pool);
  requireProof(ownershipRetryCount === 100 && maximumOwnershipCalls <= LIMITS.clients && activeOwnershipCalls === 0
    && beforeOwnershipRetries.hash === afterOwnershipRetries.hash, "bounded ownership retries accumulated state");
  ownershipAssertions.lostAckBurstAndSustainedRetriesPreserveState = true;
  const refusals = [];
  for (const [operation, action, pattern] of [
    ["changedOwnerReplay", () => runtime.raiseException({ ...ownershipRequest, nextActionOwner: "user" }), /idempotencyKey/],
    ["changedActionReplay", () => runtime.raiseException({ ...ownershipRequest, nextAction: "Wait for a different review" }), /idempotencyKey/],
    ["enterStage", () => runtime.enterStage({ runId: ownershipRetry.run.runId, stageId: "review" }), /not active|blocked/],
    ["createArtifact", () => runtime.createArtifact({ caseId: ownershipRetry.work.caseId, runId: ownershipRetry.run.runId, content: { late: true } }), /not active|blocked/],
    ["createProposal", () => runtime.createProposal({ artifactId: ownershipRetry.artifact.artifactId, baseVersion: 1, patch: { quote: "late" } }), /not active|blocked/],
    ["decideProposal", () => runtime.decideProposal({ proposalId: pending.proposalId, decision: "accepted" }), /not active|blocked/],
    ["completeRun", () => close(ownershipRetry)(runtime), /unresolved exceptions|not active|blocked/],
  ]) {
    const observation = await unchangedRejection(action, pattern);
    refusals.push({ operation, beforeStateHash: observation.before.hash, afterStateHash: observation.after.hash, error: observation.error });
  }
  ownershipAssertions.freshBlockedMutationsAndCompletionRefuseWithoutChange = true;
  ownershipAssertions.changedOwnerReplayRefusesWithoutChange = true;
  ownershipAssertions.changedActionReplayRefusesWithoutChange = true;
  const exceptionOwnership = {
    schemaVersion: "nodekit.exception-ownership-observations/v1", assertions: ownershipAssertions, mixedRecoveries,
    rollbacks: ownershipRollbacks, refusals,
    retries: { burstCalls: ownershipRetryCount, sustainedCalls: 1000, maximumConcurrentCalls: maximumOwnershipCalls,
      retainedPerRetryResults: 0, simulatedAcknowledgmentLossAfter: ownershipCommit,
      exceptionId: retryResult.exceptionId, resultHash, beforeStateHash: beforeOwnershipRetries.hash, afterStateHash: afterOwnershipRetries.hash },
  };
  return { assertions, schedules, rollbackObservation, heldLockObservation, exceptionOwnership,
    retries: { burstCalls: 100, sustainedCalls: 1000, maximumConcurrentCalls: LIMITS.clients, retainedPerRetryResults: 0,
      simulatedAcknowledgmentLossAfter: committedCommand,
      before: beforeRetries, after: afterRetries, afterReplacement, replacementRunActive: true } };
}

async function awaitReleasedClients() {
  if (!pool) return { required: false, reason: "pool not created" };
  const expires = Date.now() + LIMITS.settlementMs;
  const busy = () => activeClients.size !== 0 || pool.waitingCount !== 0 || pool.totalCount !== pool.idleCount;
  while (busy() && Date.now() < expires) await new Promise((resolve) => setTimeout(resolve, 25));
  requireProof(!busy(), "scenario clients did not finish before fixture cleanup");
  return { required: true, remainingCheckedOut: activeClients.size };
}

async function cleanOwnedFixtures() {
  if (!pool) return { required: false, reason: "pool not created" };
  requireProof(activeClients.size === 0 && pool.waitingCount === 0 && pool.totalCount === pool.idleCount, "cleanup refused while scenario clients remain busy");
  const client = await pool.connect();
  let observer;
  let committed = false;
  try {
    await client.query("begin");
    const artifacts = await client.query(
      `select artifact_id from nodekit.artifacts where owner_id = any($1::text[]) order by artifact_id limit ${LIMITS.artifactIds + 1}`,
      [caseOwners],
    );
    requireProof(artifacts.rowCount <= LIMITS.artifactIds, "owned cleanup artifact-ID cap exceeded");
    const artifactIds = artifacts.rows.map((row) => row.artifact_id);
    // The cyclic case -> current run reference must be removed explicitly.
    // No Caseflow FK cascades; events are independent and need their own delete.
    await client.query("update nodekit.cases set current_run_id = null where owner_id = any($1::text[])", [caseOwners]);
    for (const table of ["receipts", "exceptions", "approvals"]) {
      await client.query(`delete from nodekit.${table} where owner_id = any($1::text[])`, [caseOwners]);
    }
    await client.query("delete from nodekit.artifact_versions v using nodekit.artifacts a where v.artifact_id = a.artifact_id and a.owner_id = any($1::text[])", [caseOwners]);
    for (const table of ["proposals", "artifacts", "events", "runs", "cases"]) {
      await client.query(`delete from nodekit.${table} where owner_id = any($1::text[])`, [caseOwners]);
    }
    // Only this separately verified knowledge FK chain has cascade deletion.
    await client.query("delete from nodekit.knowledge_projections where owner_id = any($1::text[])", [knowledgeOwners]);
    await client.query("commit");
    committed = true;
    // Keep the first connection checked out so verification cannot accidentally
    // reuse the same backend. Counts are observed after the committed deletion.
    observer = await pool.connect();
    requireProof(observer.processID !== client.processID, "cleanup verification requires a separate client");
    const counts = {};
    for (const table of ["cases", "runs", "artifacts", "proposals", "approvals", "exceptions", "receipts", "events"]) {
      counts[table] = (await observer.query(`select count(*)::int as count from nodekit.${table} where owner_id = any($1::text[])`, [caseOwners])).rows[0].count;
    }
    counts.artifact_versions = (await observer.query("select count(*)::int as count from nodekit.artifact_versions where artifact_id = any($1::text[])", [artifactIds])).rows[0].count;
    for (const table of ["knowledge_projections", "knowledge_sessions", "knowledge_retrieval_receipts"]) {
      counts[table] = (await observer.query(`select count(*)::int as count from nodekit.${table} where owner_id = any($1::text[])`, [knowledgeOwners])).rows[0].count;
    }
    requireProof(Object.values(counts).every((count) => count === 0), "owned rows remain after committed cleanup");
    return { required: true, committed, writerPid: client.processID, observerPid: observer.processID,
      exactCaseOwnerCount: caseOwners.length, exactKnowledgeOwnerCount: knowledgeOwners.length,
      capturedArtifactIds: artifactIds.length, counts };
  } catch (error) {
    if (!committed) {
      try { await client.query("rollback"); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "owned cleanup and its rollback failed"); }
    }
    throw error;
  } finally {
    if (observer) observer.release();
    client.release();
  }
}

async function closePool() {
  if (!pool) return { required: false, reason: "pool not created" };
  const unreleased = activeClients.size;
  const releaseErrors = [];
  for (const client of [...activeClients]) {
    try { client.release(true); } catch (error) { releaseErrors.push(error); }
  }
  await pool.end();
  if (unreleased !== 0 || releaseErrors.length !== 0) throw new AggregateError(releaseErrors, `${unreleased} database clients required forced release during cleanup`);
  return { required: true, unreleased, poolEnded: true };
}

async function removeOwnedInstallation() {
  if (!installRoot) return { required: false, reason: "installation not created" };
  const metadata = await lstat(installRoot);
  const resolved = await realpath(installRoot);
  requireProof(installRootIdentity && metadata.isDirectory() && !metadata.isSymbolicLink()
    && metadata.dev === installRootIdentity.dev && metadata.ino === installRootIdentity.ino
    && resolved === installRootIdentity.path && path.dirname(resolved) === installRootIdentity.parent
    && path.basename(resolved).startsWith("nodekit-postgres-candidate-"), "disposable install root identity changed; cleanup refused");
  await rm(resolved, { recursive: true, force: false, maxRetries: 0 });
  let absent = false;
  try { await lstat(resolved); } catch (error) { if (error.code === "ENOENT") absent = true; else throw error; }
  requireProof(absent, "disposable install root remains after cleanup");
  return { required: true, exactOwnedRootVerified: true, removed: true };
}

const output = option("--output");
const ownerPrefix = `postgres-conformance-${randomUUID()}`;
const ownerA = `${ownerPrefix}-a`;
const ownerB = `${ownerPrefix}-b`;
const ownerRace = `${ownerPrefix}-race`;
const ownerGuard = `${ownerPrefix}-guard`;
const ownerKnowledge = `${ownerPrefix}-knowledge`;
const ownerKnowledgeOther = `${ownerPrefix}-knowledge-other`;
const ownerKnowledgeRace = `${ownerPrefix}-knowledge-race`;
const caseOwners = Object.freeze([ownerA, ownerB, ownerRace, ownerGuard]);
const knowledgeOwners = Object.freeze([ownerKnowledge, ownerKnowledgeOther, ownerKnowledgeRace]);
let pool;
let installRoot;
let installRootIdentity;
let candidateCommit;
let releaseCandidate;
let postgresIdentity = null;
const activeClients = new Set();
const poolErrors = [];
let poolErrorCount = 0;
const watchdog = setTimeout(() => {
  process.stderr.write('PostgreSQL proof process deadline exceeded; lifecycle incomplete, never a pass.\n');
  process.exit(1);
}, LIMITS.processMs);
watchdog.unref();

async function runCandidate() {
  if (!connectionString) throw new Error("NODEKIT_POSTGRES_URL is required");
  const candidateTarballOption = option("--candidate-tarball");
  if (!candidateTarballOption) throw new Error("--candidate-tarball is required; live conformance must exercise the exact packed release candidate");
  const originalTarballPath = path.resolve(candidateTarballOption);
  const candidateTarballMetadata = await lstat(originalTarballPath);
  if (!candidateTarballMetadata.isFile() || candidateTarballMetadata.isSymbolicLink()) {
    throw new Error("--candidate-tarball must be a regular non-symlink file");
  }
  const candidateTarballPath = await realpath(originalTarballPath);
  const resolvedTarballMetadata = await lstat(candidateTarballPath);
  requireProof(resolvedTarballMetadata.dev === candidateTarballMetadata.dev && resolvedTarballMetadata.ino === candidateTarballMetadata.ino
    && resolvedTarballMetadata.size === candidateTarballMetadata.size && resolvedTarballMetadata.mtimeMs === candidateTarballMetadata.mtimeMs,
  "candidate tarball changed during path resolution");
  const candidateTarballBytes = await boundedRead(candidateTarballPath);
  const nodekitTarballSha256 = sha256(candidateTarballBytes);
  candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", timeout: 10_000, maxBuffer: LIMITS.subprocessBytes }).trim();
  requireProof(/^[a-f0-9]{40}$/.test(candidateCommit), "candidate commit must be a full Git SHA");
  const packageJson = JSON.parse((await boundedRead(path.join(repoRoot, "package.json"), LIMITS.reportBytes)).toString("utf8"));
  const dirtySource = parseGitStatusPorcelainZ(execFileSync("git", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...distributablePathspecs(packageJson),
  ], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: LIMITS.subprocessBytes,
    timeout: 10_000,
  }));
  assertCleanDistributablePaths(dirtySource, "PostgreSQL conformance");
  const nodekitSourceHash = await computeNodeKitSourceHash(repoRoot);
  releaseCandidate = {
    nodekitCommit: candidateCommit,
    nodekitSourceHash,
    nodekitTarballSha256,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
  };
  if (releaseCandidate.packageName !== "@homenshum/nodekit") throw new Error("candidate package name is not @homenshum/nodekit");

  // Install the packed candidate into a disposable consumer. Importing the
  // adapter or conformance harness from this source checkout would allow a live
  // database pass to certify different bytes than consumers will install.
  const tempRoot = await realpath(os.tmpdir());
  installRoot = await mkdtemp(path.join(tempRoot, "nodekit-postgres-candidate-"));
  const installMetadata = await lstat(installRoot);
  requireProof(installMetadata.isDirectory() && !installMetadata.isSymbolicLink(), "disposable install root must be an owned directory");
  installRootIdentity = { path: await realpath(installRoot), parent: tempRoot, dev: installMetadata.dev, ino: installMetadata.ino };
  await writeFile(path.join(installRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  const immutableTarballPath = path.join(installRoot, "candidate.tgz");
  await writeFile(immutableTarballPath, candidateTarballBytes, { flag: "wx" });
  if (sha256(await boundedRead(immutableTarballPath)) !== nodekitTarballSha256) throw new Error("immutable candidate tarball copy hash mismatch");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCommand, [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", immutableTarballPath,
  ], { cwd: installRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: LIMITS.subprocessBytes, timeout: LIMITS.installMs, killSignal: "SIGKILL" });
  const consumerRequire = createRequire(path.join(installRoot, "package.json"));
  const adapterPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres"));
  const caseflowPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/caseflow"));
  const knowledgeRuntimePath = await realpath(consumerRequire.resolve("@homenshum/nodekit/knowledge-runtime"));
  const knowledgeAdapterPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/knowledge"));
  const installedPackagePath = await realpath(consumerRequire.resolve("@homenshum/nodekit/package.json"));
  const migrationPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/migration.sql"));
  const knowledgeMigrationPath = await realpath(consumerRequire.resolve("@homenshum/nodekit/adapters/postgres/knowledge-migration.sql"));
  for (const installedPath of [adapterPath, caseflowPath, knowledgeRuntimePath, knowledgeAdapterPath, installedPackagePath, migrationPath, knowledgeMigrationPath]) {
    const relative = path.relative(installRoot, installedPath);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`packed-candidate import escaped its disposable installation: ${installedPath}`);
    }
  }
  const installedPackageBytes = await boundedRead(installedPackagePath, LIMITS.reportBytes);
  const installedPackage = JSON.parse(installedPackageBytes.toString("utf8"));
  if (installedPackage.name !== releaseCandidate.packageName || installedPackage.version !== releaseCandidate.packageVersion) {
    throw new Error("installed packed candidate identity does not match the source release identity");
  }
  const [{ createPostgresCaseflow }, { contentHash, runCaseflowConformance }, { createPostgresKnowledgeRuntime }, { knowledgeRuntimeHash }] = await Promise.all([
    import(pathToFileURL(adapterPath).href),
    import(pathToFileURL(caseflowPath).href),
    import(pathToFileURL(knowledgeAdapterPath).href),
    import(pathToFileURL(knowledgeRuntimePath).href),
  ]);
  if (typeof createPostgresCaseflow !== "function" || typeof contentHash !== "function" || typeof runCaseflowConformance !== "function"
    || typeof createPostgresKnowledgeRuntime !== "function" || typeof knowledgeRuntimeHash !== "function") {
    throw new Error("installed packed candidate is missing required PostgreSQL/conformance exports");
  }
  const migration = (await boundedRead(migrationPath, LIMITS.reportBytes)).toString("utf8");
  const migrationSha256 = sha256(migration);
  const knowledgeMigration = (await boundedRead(knowledgeMigrationPath, LIMITS.reportBytes)).toString("utf8");
  const knowledgeMigrationSha256 = sha256(knowledgeMigration);
  pool = new Pool({
    connectionString, max: LIMITS.clients, connectionTimeoutMillis: LIMITS.connectionMs,
    query_timeout: LIMITS.queryMs, statement_timeout: LIMITS.statementMs,
    lock_timeout: LIMITS.lockMs, idle_in_transaction_session_timeout: LIMITS.idleTransactionMs,
  });
  pool.on("acquire", (client) => activeClients.add(client));
  pool.on("release", (_error, client) => activeClients.delete(client));
  pool.on("error", (error) => {
    poolErrorCount += 1;
    if (poolErrors.length < 4) poolErrors.push(errorSummary(error));
  });
  postgresIdentity = {
    serverVersion: (await pool.query("show server_version")).rows[0].server_version,
    serverVersionNum: Number((await pool.query("show server_version_num")).rows[0].server_version_num),
  };
  await pool.query(migration);
  await pool.query(knowledgeMigration);
  const conformance = await runCaseflowConformance(
    () => createPostgresCaseflow({ pool, ownerId: ownerA }),
    { requiredCapabilities: { durableState: true, optimisticConcurrency: true, transactions: true } },
  );

  const runtimeA = createPostgresCaseflow({ pool, ownerId: ownerA });
  const runtimeB = createPostgresCaseflow({ pool, ownerId: ownerB });
  const ownerASnapshot = await runtimeA.snapshot();
  const ownerBSnapshot = await runtimeB.snapshot();
  const ownerIsolation = ownerASnapshot.cases.length > 0 && ownerBSnapshot.cases.length === 0;
  let crossOwnerDenied = false;
  try {
    await runtimeB.startRun({ caseId: ownerASnapshot.cases[0].caseId, stages: [{ id: "working", label: "Working", owner: "agent" }] });
  } catch (error) {
    crossOwnerDenied = /case not found/.test(String(error?.message));
  }

  const raceCase = await runtimeA.createCase({ title: "Same-base race", primaryJob: "Apply exactly one proposal" });
  const raceRun = await runtimeA.startRun({
    caseId: raceCase.caseId,
    stages: [
      { id: "working", label: "Working", owner: "agent" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  });
  const raceArtifact = await runtimeA.createArtifact({ caseId: raceCase.caseId, runId: raceRun.runId, title: "Race artifact", content: { value: 1 } });
  const proposalA = await runtimeA.createProposal({ artifactId: raceArtifact.artifactId, baseVersion: 1, patch: { value: 2 } });
  const proposalB = await runtimeA.createProposal({ artifactId: raceArtifact.artifactId, baseVersion: 1, patch: { value: 3 } });
  const race = await Promise.all([
    runtimeA.decideProposal({ proposalId: proposalA.proposalId, decision: "accepted" }),
    runtimeA.decideProposal({ proposalId: proposalB.proposalId, decision: "accepted" }),
  ]);
  const raceStatuses = race.map((entry) => entry.proposal.status).sort();
  const sameBaseRaceFailedClosed = JSON.stringify(raceStatuses) === JSON.stringify(["accepted", "conflicted"])
    && race.every((entry) => entry.artifact.canonicalVersion === 2);

  const raceWriter = createPostgresCaseflow({ pool, ownerId: ownerRace });
  const raceCompleter = createPostgresCaseflow({ pool, ownerId: ownerRace });
  const boundaryCase = await raceWriter.createCase({ title: "Artifact completion barrier", primaryJob: "Never omit a committed artifact" });
  const boundaryRun = await raceWriter.startRun({
    caseId: boundaryCase.caseId,
    stages: [{ id: "work", label: "Work", owner: "agent" }],
  });
  const baselineArtifact = await raceWriter.createArtifact({
    caseId: boundaryCase.caseId,
    runId: boundaryRun.runId,
    title: "Baseline artifact",
    content: { baseline: true },
  });
  const [lateArtifactResult, completionResult] = await Promise.allSettled([
    raceWriter.createArtifact({
      caseId: boundaryCase.caseId,
      runId: boundaryRun.runId,
      title: "Racing artifact",
      content: { racing: true },
    }),
    raceCompleter.completeRun({ runId: boundaryRun.runId }),
  ]);
  const completionWon = completionResult.status === "fulfilled";
  const artifactCompletionRaceAtomic = completionWon && (
    lateArtifactResult.status === "fulfilled"
      ? completionResult.value.receipt.artifactIds.includes(lateArtifactResult.value.artifactId)
      : /run is terminal: completed/.test(String(lateArtifactResult.reason?.message))
  ) && completionResult.value.receipt.artifactIds.includes(baselineArtifact.artifactId);

  const reloaded = createPostgresCaseflow({ pool, ownerId: ownerA });
  const reloadedSnapshot = await reloaded.snapshot();
  const reloadPreservedState = reloadedSnapshot.cases.some((entry) => entry.caseId === raceCase.caseId)
    && reloadedSnapshot.artifacts.find((entry) => entry.artifactId === raceArtifact.artifactId)?.canonicalVersion === 2;
  const completionReceipt = ownerASnapshot.receipts[0];
  const { receiptHash, receiptId, ...receiptBody } = completionReceipt;
  const receiptIntegrity = /^[a-f0-9]{64}$/.test(receiptHash)
    && receiptId.startsWith("receipt_")
    && contentHash(receiptBody) === receiptHash;

  const knowledgeGraph = (ownerId, graphId, createdAt) => {
    const body = {
      schemaVersion: "nodekit.knowledge-graph/v1",
      graphId,
      version: 0,
      authority: { canonicalMutation: "accepted-patch-only", destructiveDelete: false, oneAuthoritativeGraph: true, ownerId },
      layers: ["source", "derived", "working", "proposal", "canonical", "hypothesis"].map((id) => ({ id, writableThrough: id === "source" ? "ingest-proposal" : "graph-patch" })),
      nodes: [],
      hyperedges: [],
      proposals: [],
      actionReceipts: [],
      evolutionReceipts: [],
      genesis: { createdAt, graphId },
      createdAt,
      updatedAt: createdAt,
    };
    return { ...body, contentHash: knowledgeRuntimeHash(body) };
  };
  const knowledgeRuntime = createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge });
  const knowledgeGraphId = `knowledge:${ownerPrefix}`;
  const projectedGraph = knowledgeGraph(ownerKnowledge, knowledgeGraphId, "2026-07-22T00:00:00.000Z");
  const projected = await knowledgeRuntime.projectGraph({ graph: projectedGraph, expectedVersion: null });
  const reloadedGraph = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge }).readGraph(knowledgeGraphId);
  const firstRetrieval = await knowledgeRuntime.retrieve({ graphId: knowledgeGraphId, sessionId: "session-1", query: "missing", minimumFacts: 1 });
  const secondRetrieval = await knowledgeRuntime.retrieve({ graphId: knowledgeGraphId, sessionId: "session-1", query: "missing", minimumFacts: 1 });
  const durableKnowledgeReceipts = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledge }).listSessionReceipts({ graphId: knowledgeGraphId, sessionId: "session-1" });
  let knowledgeOwnerIsolation = false;
  try {
    await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeOther }).readGraph(knowledgeGraphId);
  } catch (error) {
    knowledgeOwnerIsolation = /knowledge graph not found/.test(String(error?.message));
  }
  const raceGraphId = `knowledge:${ownerPrefix}:race`;
  const raceKnowledgeA = knowledgeGraph(ownerKnowledgeRace, raceGraphId, "2026-07-22T00:00:00.000Z");
  const raceKnowledgeB = knowledgeGraph(ownerKnowledgeRace, raceGraphId, "2026-07-22T00:00:00.001Z");
  const raceKnowledgeResults = await Promise.allSettled([
    createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).projectGraph({ graph: raceKnowledgeA, expectedVersion: null }),
    createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).projectGraph({ graph: raceKnowledgeB, expectedVersion: null }),
  ]);
  const raceKnowledgeStored = await createPostgresKnowledgeRuntime({ pool, ownerId: ownerKnowledgeRace }).readGraph(raceGraphId);
  const knowledgeFirstCreateRace = {
    outcomes: raceKnowledgeResults.map((entry, index) => ({
      index,
      inputContentHash: index === 0 ? raceKnowledgeA.contentHash : raceKnowledgeB.contentHash,
      settlement: entry.status,
      applied: typeof entry.value?.applied === "boolean" ? entry.value.applied : null,
      reused: typeof entry.value?.reused === "boolean" ? entry.value.reused : null,
      conflict: typeof entry.value?.conflict === "boolean" ? entry.value.conflict : null,
      actualVersion: Number.isSafeInteger(entry.value?.actualVersion) ? entry.value.actualVersion : null,
    })),
    storedVersion: raceKnowledgeStored.version,
    storedContentHash: raceKnowledgeStored.contentHash,
  };
  if (Buffer.byteLength(JSON.stringify(knowledgeFirstCreateRace), "utf8") > 2_048) {
    throw new Error("knowledge first-create race evidence exceeds its byte bound");
  }
  const knowledgeRaceWinner = knowledgeFirstCreateRace.outcomes.findIndex((entry) => entry.settlement === "fulfilled"
    && entry.applied === true && entry.reused === false && entry.conflict === false && entry.actualVersion === 0);
  const knowledgeRaceConflict = knowledgeFirstCreateRace.outcomes.findIndex((entry) => entry.settlement === "fulfilled"
    && entry.applied === false && entry.reused === false && entry.conflict === true && entry.actualVersion === 0);
  const knowledgeFirstCreateRaceAtomic = knowledgeFirstCreateRace.outcomes.length === 2
    && knowledgeFirstCreateRace.outcomes.every((entry) => entry.settlement === "fulfilled")
    && knowledgeRaceWinner >= 0 && knowledgeRaceConflict >= 0 && knowledgeRaceWinner !== knowledgeRaceConflict
    && knowledgeFirstCreateRace.storedVersion === 0
    && knowledgeFirstCreateRace.storedContentHash === knowledgeFirstCreateRace.outcomes[knowledgeRaceWinner].inputContentHash
    && knowledgeFirstCreateRace.storedContentHash !== knowledgeFirstCreateRace.outcomes[knowledgeRaceConflict].inputContentHash;

  const guardedCompletion = await runGuardedProof(createPostgresCaseflow, contentHash);
  const syntheticFailure = (code) => Object.assign(new Error(`controlled ${code}`), { code });
  const cleanupAfterPass = await finishLifecycle(async () => ({ passed: true }), [
    ["harmless-cleanup", async () => { throw syntheticFailure("PROOF_CLEANUP"); }],
  ]);
  const primaryAndCleanup = await finishLifecycle(async () => { throw syntheticFailure("PROOF_PRIMARY"); }, [
    ["harmless-cleanup", async () => { throw syntheticFailure("PROOF_CLEANUP"); }],
  ]);
  const assertions = {
    artifactCompletionRaceAtomic,
    crossOwnerDenied,
    ownerIsolation,
    receiptIntegrity,
    reloadPreservedState,
    sameBaseRaceFailedClosed,
    sharedConformancePassed: conformance.passed,
    knowledgeFirstCreateRaceAtomic,
    knowledgeOwnerIsolation,
    knowledgePackageExportsResolved: true,
    knowledgeProjectionApplied: projected.applied === true && projected.actualVersion === 0,
    knowledgeProjectionReloaded: reloadedGraph.contentHash === projectedGraph.contentHash,
    knowledgeRetrievalReceiptDurable: firstRetrieval.decision.status === "ABSTAIN"
      && secondRetrieval.receipt.repeatSession === true
      && durableKnowledgeReceipts.length === 2
      && durableKnowledgeReceipts[1].previousReceiptIds.includes(firstRetrieval.receipt.receiptId),
    ...guardedCompletion.assertions,
    cleanupFailureAfterPassFails: cleanupAfterPass.passed === false && cleanupAfterPass.exitCode === 1 && cleanupAfterPass.primaryError === null
      && cleanupAfterPass.cleanup[0]?.error?.code === "PROOF_CLEANUP",
    primaryAndCleanupFailuresPreserved: primaryAndCleanup.passed === false && primaryAndCleanup.exitCode === 1 && primaryAndCleanup.primaryError?.code === "PROOF_PRIMARY"
      && primaryAndCleanup.cleanup[0]?.error?.code === "PROOF_CLEANUP",
  };
  return {
    schemaVersion: "nodekit.postgres-conformance/v2",
    adapter: "@homenshum/nodekit/adapters/postgres",
    assertions,
    candidateCommit,
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${nodekitSourceHash}`,
    releaseCandidate,
    capabilities: conformance.capabilities,
    conformance,
    guardedCompletion,
    exceptionOwnership: guardedCompletion.exceptionOwnership,
    knowledgeFirstCreateRace,
    lifecycleFailureScenarios: { cleanupAfterPass, primaryAndCleanup },
    environment: "live-postgresql",
    testedAt: new Date().toISOString(),
    migration: {
      packagePath: "adapters/postgres/001_caseflow.sql",
      sha256: migrationSha256,
    },
    knowledgeMigration: {
      packagePath: "adapters/postgres/002_knowledge_runtime.sql",
      sha256: knowledgeMigrationSha256,
    },
    nodekitSourceHash,
    ownerScope: "isolated-test-identities",
    packageInstallation: {
      installTool: "npm",
      isolated: true,
      lifecycleScriptsDisabled: true,
      packageJsonSha256: sha256(installedPackageBytes),
      resolvedAdapterPath: path.relative(installRoot, adapterPath).replaceAll("\\", "/"),
      resolvedKnowledgeAdapterPath: path.relative(installRoot, knowledgeAdapterPath).replaceAll("\\", "/"),
      immutableTarballCopySha256: sha256(await boundedRead(immutableTarballPath)),
      sourceCheckoutImported: false,
    },
    passed: Object.values(assertions).every(Boolean),
    postgres: postgresIdentity,
    errors: [],
    publicationPerformed: false,
    deployPerformed: false,
  };
}

const lifecycle = await finishLifecycle(runCandidate, [
  ["settle-scenario-clients", awaitReleasedClients],
  ["exact-owned-fixtures", cleanOwnedFixtures],
  ["pool-and-clients", closePool],
  ["exact-disposable-installation", removeOwnedInstallation],
]);
const cleanupErrors = lifecycle.cleanup.filter((entry) => !entry.passed);
const verdict = {
  schemaVersion: "nodekit.postgres-conformance/v2",
  adapter: "@homenshum/nodekit/adapters/postgres",
  candidateCommit: candidateCommit ?? null,
  releaseCandidate: releaseCandidate ?? null,
  postgres: postgresIdentity,
  ...(lifecycle.value ?? {}),
  namedProof: "MANAGED-HANDOFF-POSTGRES-INTERLEAVINGS-01",
  limits: LIMITS,
  finalizedAt: new Date().toISOString(),
  primaryError: lifecycle.primaryError,
  failedAssertions: Object.entries(lifecycle.value?.assertions ?? {}).filter(([, passed]) => passed !== true).map(([name]) => name),
  cleanup: lifecycle.cleanup,
  poolErrorCount,
  poolErrors,
  errors: [lifecycle.primaryError, ...cleanupErrors.map((entry) => entry.error), ...poolErrors].filter(Boolean),
  passed: lifecycle.passed && poolErrorCount === 0,
  publicationPerformed: false,
  deployPerformed: false,
};
function encodeReport(report) {
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(encoded) <= LIMITS.reportBytes) return encoded;
  report.passed = false;
  return `${JSON.stringify({ schemaVersion: "nodekit.postgres-conformance/v2", candidateCommit, passed: false,
    primaryError: report.primaryError, cleanup: report.cleanup, reportWriteError: report.reportWriteError ?? null,
    reportError: "complete report exceeded the fixed byte cap", originalBytes: Buffer.byteLength(encoded),
    originalSha256: sha256(encoded), publicationPerformed: false, deployPerformed: false }, null, 2)}\n`;
}
let encoded = encodeReport(verdict);
try {
  if (output) await deadline(writeFile(path.resolve(output), encoded, { flag: "wx" }), 5_000, "final report write");
} catch (error) {
  verdict.passed = false;
  verdict.reportWriteError = errorSummary(error);
  encoded = encodeReport(verdict);
}
console.log(encoded.trimEnd());
process.exitCode = verdict.passed ? lifecycle.exitCode : 1;
if (lifecycle.cleanup.every((entry) => entry.passed)) clearTimeout(watchdog);
