import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createPostgresCaseflow,
  rehashLegacyPostgresProposalPatches,
} from "@homenshum/nodekit/adapters/postgres";
import { contentHash } from "@homenshum/nodekit/caseflow";

// SQL contract fixture only: no database or real lock scheduling is simulated.
function completionDatabase() {
  const now = "2026-10-04T00:00:00.000Z";
  const owner = "reviewer-workspace";
  const state = {
    work: { case_id: "case_review", owner_id: owner, current_run_id: "run_review", title: "Review", primary_job: "Close reviewed state", status: "in_progress", created_at: now, updated_at: now },
    run: { run_id: "run_review", owner_id: owner, case_id: "case_review", status: "active", stages: [], current_stage_id: "review", next_action: "Review", next_action_owner: "user", created_at: now, updated_at: now },
    artifacts: [{ artifact_id: "artifact_review", owner_id: owner, case_id: "case_review", run_id: "run_review", canonical_version: 1, content_hash: contentHash({ source: "original" }) }],
    events: [], receipts: [], exceptions: [],
  };
  const calls = [];
  let before, failOn, waitForClient, connects = 0;
  const result = (rows) => ({ rows: structuredClone(rows), rowCount: rows.length });
  const client = {
    async query(text, values = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      calls.push({ sql, values: structuredClone(values) });
      if (sql === "begin") { before = structuredClone(state); return result([]); }
      if (sql === "rollback") { Object.assign(state, before); return result([]); }
      if (sql === "commit") return result([]);
      if (failOn && sql.includes(failOn)) throw new Error("fixture statement failure");
      if (sql.startsWith("select * from nodekit.runs") || sql.startsWith("select status from nodekit.runs")) return result(values[0] === owner && values[1] === state.run.run_id ? [state.run] : []);
      if (sql.startsWith("select request_hash, result")) return result(state.events.filter((event) => event.owner_id === values[0] && event.idempotency_key === values[1]).slice(0, 1));
      if (sql.startsWith("select * from nodekit.exceptions")) {
        const scoped = state.exceptions.filter((entry) => entry.owner_id === values[0]);
        if (sql.includes("status = 'open'")) {
          assert.match(sql, /order by exception_id collate "C" limit 1$/);
          return result(scoped.filter((entry) => entry.run_id === values[1] && entry.status === "open").sort((a, b) => a.exception_id < b.exception_id ? -1 : a.exception_id > b.exception_id ? 1 : 0).slice(0, 1));
        }
        return result(scoped.filter((entry) => entry.exception_id === values[1]));
      }
      if (sql.startsWith("insert into nodekit.exceptions")) {
        const row = { exception_id: values[0], owner_id: values[1], run_id: values[2], code: values[3], message: values[4], preserved_state: JSON.parse(values[5]), status: "open", resolution: null, raised_at: values[6], next_action: values[7], next_action_owner: values[8] };
        state.exceptions.push(row); return result([row]);
      }
      if (sql.startsWith("update nodekit.exceptions")) {
        const row = state.exceptions.find((entry) => entry.owner_id === values[2] && entry.exception_id === values[3]);
        if (!row) return result([]);
        Object.assign(row, { status: "resolved", resolution: values[0], resolved_at: values[1] }); return result([row]);
      }
      if (sql.startsWith("select * from nodekit.cases")) return result(values[0] === owner && values[1] === state.work.case_id ? [state.work] : []);
      if (sql.startsWith("select a.*, v.content_hash")) {
        assert.match(sql, /left join/); assert.match(sql, /limit 8193$/); assert.doesNotMatch(sql, /for update/);
        return result(state.artifacts.slice(0, 8193));
      }
      if (sql.startsWith("select * from nodekit.artifacts")) return result(state.artifacts);
      if (sql.startsWith("select a.artifact_id, a.canonical_version")) return result(state.artifacts);
      if (sql.startsWith("select 1 from nodekit.exceptions") || sql.startsWith("select 1 from nodekit.proposals")) return result([]);
      if (sql.startsWith("update nodekit.runs")) {
        if (sql.includes("status = 'blocked'")) Object.assign(state.run, { status: "blocked", next_action: values[0], next_action_owner: values[1], updated_at: values[2] });
        else if (sql.includes("next_action_owner = $3")) Object.assign(state.run, { status: values[0], next_action: values[1], next_action_owner: values[2], updated_at: values[3] });
        else Object.assign(state.run, { status: values[0], next_action: values[1], next_action_owner: "user", stages: JSON.parse(values[2]), updated_at: values[3] });
        return result([state.run]);
      }
      if (sql.startsWith("update nodekit.cases")) { Object.assign(state.work, { status: values[0], updated_at: values[1] }); return result([]); }
      if (sql === "select pg_advisory_xact_lock(hashtextextended($1, 0))") return result([]);
      if (sql.startsWith("select coalesce(max(sequence)")) return result([{ sequence: state.events.length + 1 }]);
      if (sql.startsWith("insert into nodekit.events")) {
        state.events.push({ event_id: values[0], owner_id: values[1], aggregate_type: values[2], aggregate_id: values[3], sequence: values[4], event_type: values[5], actor: JSON.parse(values[6]), payload: JSON.parse(values[7]), idempotency_key: values[8], request_hash: values[9], result: values[10] === null ? null : JSON.parse(values[10]), occurred_at: values[11] }); return result([]);
      }
      if (sql.startsWith("select * from nodekit.proposals") || sql.startsWith("select * from nodekit.approvals")) return result([]);
      if (sql.startsWith("select * from nodekit.events")) return result(state.events);
      if (sql.startsWith("insert into nodekit.receipts")) { state.receipts.push({ body: JSON.parse(values[4]) }); return result([]); }
      if (sql.startsWith("select * from nodekit.receipts")) return result(state.receipts);
      if (sql.startsWith("select actor, payload")) return result(state.events.filter((event) => event.event_type === values[2]).slice(0, 1));
      throw new Error(`unexpected fixture query: ${sql}`);
    },
    release() { calls.push({ sql: "release", values: [] }); },
  };
  const pool = { async query() { throw new Error("pool query outside transaction"); }, async connect() { connects += 1; if (waitForClient) await waitForClient; return client; } };
  const expected = { caseId: state.work.case_id, caseInputHash: contentHash({ title: state.work.title, primaryJob: state.work.primary_job }), artifactBindings: [{ artifactId: state.artifacts[0].artifact_id, canonicalVersion: 1, contentHash: state.artifacts[0].content_hash }] };
  return { state, calls, expected, connectCalls: () => connects, runtime: createPostgresCaseflow({ pool, ownerId: owner, clock: () => now }), failAt(value) { failOn = value; }, delayClient(value) { waitForClient = value; } };
}

test("guarded PostgreSQL contract: stale reviewer state rolls back before mutation", async () => {
  for (const change of ["criteria", "current-run", "case", "version", "hash", "missing-version", "extra", "foreign-artifact"]) {
    const f = completionDatabase();
    if (change === "criteria") f.state.work.primary_job = "new";
    if (change === "current-run") f.state.work.current_run_id = "new-run";
    if (change === "case") f.expected.caseId = "other-case";
    if (change === "version") f.state.artifacts[0].canonical_version = 3;
    if (change === "hash") f.state.artifacts[0].content_hash = "0".repeat(64);
    if (change === "missing-version") f.state.artifacts[0].content_hash = null;
    if (change === "extra") f.state.artifacts.push({ ...f.state.artifacts[0], artifact_id: "extra" });
    if (change === "foreign-artifact") f.state.artifacts[0].case_id = "other-case";
    const before = structuredClone(f.state);
    await assert.rejects(f.runtime.completeRun({ runId: "run_review", expected: f.expected }), /expected|reviewed|canonical version/);
    assert.deepEqual(f.state, before, change);
    assert.equal(f.calls.some(({ sql }) => /^(update|insert)/.test(sql)), false);
    assert.deepEqual(f.calls.slice(-2).map(({ sql }) => sql), ["rollback", "release"]);
  }
});

test("guarded PostgreSQL contract: exact input is copied before waiting for client acquisition", async () => {
  const f = completionDatabase();
  let release;
  f.delayClient(new Promise((resolve) => { release = resolve; }));
  const original = structuredClone(f.expected);
  const pending = f.runtime.completeRun({ runId: "run_review", expected: f.expected });
  f.expected.caseId = "mutated"; f.expected.artifactBindings[0].contentHash = "0".repeat(64);
  release();
  const done = await pending;
  assert.equal(done.receipt.status, "completed");
  assert.deepEqual(f.state.events[0].payload, { expectedStateHash: contentHash(original) });
  const locks = f.calls.filter(({ sql }) => /for update/.test(sql));
  assert.match(locks[0].sql, /nodekit.runs/); assert.match(locks[1].sql, /nodekit.cases/); assert.equal(locks.length, 2);
  const before = structuredClone(f.state);
  for (let index = 0; index < 100; index += 1) assert.equal((await f.runtime.completeRun({ runId: "run_review", expected: original })).receipt.receiptHash, done.receipt.receiptHash);
  assert.deepEqual(f.state, before);
  f.state.work.current_run_id = "next-run";
  assert.equal((await f.runtime.completeRun({ runId: "run_review", expected: original })).reused, true);
  await assert.rejects(f.runtime.completeRun({ runId: "run_review" }), /retry/);
  await assert.rejects(f.runtime.completeRun({ runId: "run_review", expected: { ...original, caseInputHash: "0".repeat(64) } }), /retry/);
});

test("guarded PostgreSQL contract: invalid conditions never acquire a client; bounded reads and statement failures roll back", async () => {
  const seed = completionDatabase().expected;
  const binding = seed.artifactBindings[0];
  let getterCalls = 0;
  const accessor = { ...seed };
  Object.defineProperty(accessor, "caseId", { enumerable: true, get() { getterCalls += 1; return seed.caseId; } });
  const invalid = [null, [], {}, { bad: true }, accessor,
    ...Object.keys(seed).map((key) => Object.fromEntries(Object.entries(seed).filter(([name]) => name !== key))),
    ...Object.keys(binding).map((key) => ({ ...seed, artifactBindings: [Object.fromEntries(Object.entries(binding).filter(([name]) => name !== key))] })),
    { ...seed, ignored: true }, { ...seed, artifactBindings: [{ ...binding, ignored: true }] },
    { ...seed, artifactBindings: [binding, { ...binding, artifactId: ` ${binding.artifactId} ` }] },
    { ...seed, caseInputHash: seed.caseInputHash.toUpperCase() },
    { ...seed, artifactBindings: [{ ...binding, canonicalVersion: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...seed, artifactBindings: Array.from({ length: 8193 }, () => binding) },
  ];
  for (const expected of invalid) {
    const f = completionDatabase();
    await assert.rejects(f.runtime.completeRun({ runId: "run_review", expected }));
    assert.deepEqual(f.calls, []);
  }
  assert.equal(getterCalls, 0);
  const large = completionDatabase();
  large.state.artifacts = Array.from({ length: 8193 }, (_, index) => ({ ...large.state.artifacts[0], artifact_id: `artifact_${index}` }));
  await assert.rejects(large.runtime.completeRun({ runId: "run_review", expected: large.expected }), /exceeds the portable limit/);
  assert.equal(large.state.receipts.length, 0);
  const failed = completionDatabase();
  failed.failAt("insert into nodekit.receipts");
  const before = structuredClone(failed.state);
  await assert.rejects(failed.runtime.completeRun({ runId: "run_review", expected: failed.expected }), /fixture statement failure/);
  assert.deepEqual(failed.state, before);
  assert.deepEqual(failed.calls.slice(-2).map(({ sql }) => sql), ["rollback", "release"]);
});

// @nodekit-verifies inv:postgres-caseflow-conformance#adapter-conforms
test("PostgreSQL adapter is available through the supported package entry point", () => {
  assert.equal(typeof createPostgresCaseflow, "function");
  assert.equal(typeof rehashLegacyPostgresProposalPatches, "function");
  assert.throws(() => createPostgresCaseflow(), /query-capable pool/);
  assert.throws(() => createPostgresCaseflow({ pool: { query() {} } }), /ownerId/);
  assert.throws(() => rehashLegacyPostgresProposalPatches(), /query-capable pool/);
  assert.throws(
    () => rehashLegacyPostgresProposalPatches({ pool: { query() {} }, ownerId: "owner", batchSize: 0 }),
    /batchSize must be an integer from 1 through 1000/,
  );
});

test("PostgreSQL legacy proposal rehash uses NodeKit canonical contentHash in an atomic owner batch", async () => {
  const patch = { z: [3, 2, 1], a: { stable: true } };
  const calls = [];
  let released = false;
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text === "begin" || text === "commit" || text === "rollback") return { rowCount: null, rows: [] };
      if (text.includes("select proposal_id, patch")) {
        return { rowCount: 1, rows: [{ patch, proposal_id: "proposal_legacy" }] };
      }
      if (text.includes("update nodekit.proposals set patch_hash")) {
        return { rowCount: 1, rows: [{ proposal_id: "proposal_legacy" }] };
      }
      if (text.includes("count(*)::integer as remaining")) {
        return { rowCount: 1, rows: [{ remaining: 0 }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { released = true; },
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rowCount: 0, rows: [] }; },
  };

  const result = await rehashLegacyPostgresProposalPatches({
    batchSize: 25,
    ownerId: "owner_legacy",
    pool,
  });

  assert.deepEqual(result, {
    complete: true,
    ownerId: "owner_legacy",
    rehashed: [{ patchHash: contentHash(patch), proposalId: "proposal_legacy" }],
    remaining: 0,
    schemaVersion: "nodekit.postgres-legacy-patch-rehash/v1",
  });
  const select = calls.find((entry) => entry.text.includes("select proposal_id, patch"));
  assert.deepEqual(select.values, ["owner_legacy", 25]);
  assert.match(select.text, /patch_hash is null/);
  assert.match(select.text, /for update skip locked/);
  const update = calls.find((entry) => entry.text.includes("update nodekit.proposals set patch_hash"));
  assert.deepEqual(update.values, [contentHash(patch), "owner_legacy", "proposal_legacy"]);
  assert.equal(calls.at(-1).text, "commit");
  assert.equal(released, true);
});

test("PostgreSQL legacy proposal rehash rolls back a non-portable legacy patch", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(text) {
      calls.push(text);
      if (text === "begin" || text === "rollback") return { rowCount: null, rows: [] };
      if (text.includes("select proposal_id, patch")) {
        return { rowCount: 1, rows: [{ patch: { "legacy-key": true }, proposal_id: "proposal_bad" }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() { released = true; },
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rowCount: 0, rows: [] }; },
  };

  await assert.rejects(
    rehashLegacyPostgresProposalPatches({ ownerId: "owner_legacy", pool }),
    /object key must be a portable value; keys must use Convex-compatible ASCII identifiers/,
  );
  assert.equal(calls.includes("rollback"), true);
  assert.equal(calls.includes("commit"), false);
  assert.equal(calls.some((text) => text.includes("update nodekit.proposals set patch_hash")), false);
  assert.equal(released, true);
});

test("PostgreSQL receipt construction normalizes provider query results before hashing", async () => {
  const source = await readFile(path.resolve("src/adapters/postgres-caseflow.mjs"), "utf8");
  assert.match(source, /import \{ normalizeReceiptBindings \} from "\.\.\/lib\/receipt-bindings\.mjs"/);
  assert.match(source, /normalizeReceiptBindings\(\{\s*approvalBindings: rawApprovalBindings,\s*artifactBindings: rawArtifactBindings,\s*eventBindings: rawEventBindings,\s*proposalBindings: rawProposalBindings,/s);
  assert.match(source, /eventIds,\s*generatedAt: now,/s);
  assert.doesNotMatch(source, /where a\.owner_id = \$1 and a\.run_id = \$2 order by a\.created_at/);
  assert.doesNotMatch(source, /aggregate_id = any\(\$2::text\[\]\) order by occurred_at/);
});

test("portable and component receipt hashing share a fixed-ID fixed-clock golden vector", () => {
  const fixedReceiptBody = {
    approvalBindings: [{ approvalId: "approval_1", commentHash: "a".repeat(64), decision: "accepted", proposalId: "proposal_1" }],
    artifactBindings: [{ artifactId: "artifact_1", canonicalVersion: 2, contentHash: "b".repeat(64) }],
    artifactIds: ["artifact_1"],
    caseHash: "c".repeat(64),
    caseId: "case_1",
    eventBindings: [{ actorHash: "d".repeat(64), aggregateId: "run_1", aggregateType: "run", eventId: "event_1", eventType: "run.completed", payloadHash: "e".repeat(64), sequence: 1 }],
    eventIds: ["event_1"],
    generatedAt: "2026-07-21T00:00:00.000Z",
    proposalBindings: [{ artifactId: "artifact_1", baseVersion: 1, patchHash: "f".repeat(64), proposalId: "proposal_1", status: "accepted" }],
    proposalIds: ["proposal_1"],
    runHash: "0".repeat(64),
    runId: "run_1",
    schemaVersion: "nodekit.receipt/v2",
    status: "completed",
  };
  assert.equal(contentHash(fixedReceiptBody), "ba7fa48da69643eccb656f75375168470f0c57fb5c400a4bb50b800f0e01f1d7");
});

test("PostgreSQL migration defines the complete owner-scoped Caseflow record set", async () => {
  const sql = await readFile(path.resolve("adapters/postgres/001_caseflow.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`create table if not exists nodekit\\.${table}`));
  }
  assert.match(sql, /owner_id text not null/);
  assert.match(sql, /create or replace function nodekit\.apply_proposal/);
  assert.match(sql, /patch_hash text not null constraint nodekit_proposals_patch_hash_sha256/);
  assert.match(sql, /nodekit_proposals_patch_hash_canonical_required/);
  assert.match(sql, /check \(patch_hash is not null and patch_hash ~ '\^\[a-f0-9\]\{64\}\$'\) not valid/);
  assert.match(sql, /legacy_patch_count = 0/);
  assert.match(sql, /alter column patch_hash set not null/);
  assert.match(sql, /legacy proposal % has no canonical patch hash/);
  assert.doesNotMatch(sql, /patch::text/);
  assert.doesNotMatch(sql, /sha256\s*\(\s*convert_to/i);
  assert.doesNotMatch(sql, /update nodekit\.proposals\s+set patch_hash\s*=/i);
  assert.match(sql, /proposal_row\.patch_hash/);
  assert.match(sql, /drop function if exists nodekit\.apply_proposal\(text, text, text, text, text, text, timestamptz\) cascade/);
  assert.doesNotMatch(sql, /next_content_hash/);
  assert.match(sql, /proposal_row\.base_version <> artifact_row\.canonical_version/);
  assert.match(sql, /approval_row\.decision <> requested_decision/);
  assert.match(sql, /idempotency_key text/);
  assert.match(sql, /nodekit_events_owner_idempotency/);
  assert.match(sql, /artifact_run_status in \('cancelled', 'completed', 'failed_safely'\)/);
  assert.match(sql, /artifact_run_status <> 'active'/);
  assert.match(sql, /select r\.status into artifact_run_status from nodekit\.runs r/);
});

test("PostgreSQL adapter stores the canonical proposal digest once and never sends a hash to apply", async () => {
  const source = await readFile(path.resolve("src/adapters/postgres-caseflow.mjs"), "utf8");

  assert.match(source, /const patchHash = contentHash\(portablePatch\)/);
  assert.match(source, /patch, patch_hash, rationale/);
  assert.match(source, /select \* from nodekit\.apply_proposal\(\$1, \$2, \$3, \$4, \$5, \$6\)/);
  assert.match(source, /patchHash: row\.patch_hash/);
  assert.doesNotMatch(source, /nextContentHash|next_content_hash/);
});

test("live PostgreSQL proof exercises a two-client artifact-versus-completion lock barrier", async () => {
  const source = await readFile(path.resolve("scripts/run-postgres-conformance.mjs"), "utf8");
  assert.match(source, /const \[lateArtifactResult, completionResult\] = await Promise\.allSettled/);
  assert.match(source, /artifactCompletionRaceAtomic/);
  assert.match(source, /receipt\.artifactIds\.includes\(lateArtifactResult\.value\.artifactId\)/);
  assert.match(source, /run is terminal: completed/);
  assert.match(source, /distributablePathspecs\(packageJson\)/);
  assert.match(source, /assertCleanDistributablePaths\(dirtySource, "PostgreSQL conformance"\)/);
  assert.match(source, /--candidate-tarball is required/);
  assert.match(source, /npmCommand, \[\s*"install", "--ignore-scripts"/);
  assert.match(source, /consumerRequire\.resolve\("@homenshum\/nodekit\/adapters\/postgres"\)/);
  assert.match(source, /consumerRequire\.resolve\("@homenshum\/nodekit\/adapters\/postgres\/knowledge"\)/);
  assert.match(source, /consumerRequire\.resolve\("@homenshum\/nodekit\/adapters\/postgres\/knowledge-migration\.sql"\)/);
  assert.match(source, /immutable candidate tarball copy hash mismatch/);
  assert.match(source, /knowledgeFirstCreateRaceAtomic/);
  assert.match(source, /knowledgeRetrievalReceiptDurable/);
  assert.match(source, /sourceCheckoutImported: false/);
  assert.match(source, /schemaVersion: "nodekit\.postgres-conformance\/v2"/);
  assert.doesNotMatch(source, /from "\.\.\/src\/adapters\/postgres-caseflow\.mjs"/);
  assert.doesNotMatch(source, /NODEKIT_ALLOW_DIRTY_CONFORMANCE/);
  assert.doesNotMatch(source, /\(\?:proof\|docs\|evolution\)/);
});

test("Supabase profile extends the complete portable record set with owner RLS", async () => {
  const sql = await readFile(path.resolve("adapters/supabase/001_profile.sql"), "utf8");
  for (const table of ["cases", "runs", "artifacts", "artifact_versions", "proposals", "approvals", "exceptions", "receipts", "events"]) {
    assert.match(sql, new RegExp(`alter table nodekit\\.${table} enable row level security`));
  }
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /create policy nodekit_case_owner on nodekit\.cases for select to authenticated/);
  assert.doesNotMatch(sql, /create policy nodekit_\w+_owner[^;]*for (insert|update|delete)/);
  assert.match(sql, /Revoke direct DML\s+-- even though RLS is enabled/);
  assert.match(sql, /pg_publication_tables/);
});


test("a PostgreSQL host keeps restored external blockers assigned through partial recovery", async () => {
  for (const order of [["z", "A", "10"], ["10", "A", "z"]]) {
    const f = completionDatabase();
    f.state.run.status = "blocked";
    f.state.exceptions = order.map((suffix) => ({ exception_id: `exception_${suffix}`, owner_id: f.state.run.owner_id, run_id: f.state.run.run_id,
      code: "restored_review", message: "Preserve the review", preserved_state: { artifactVersion: 1 }, status: "open", resolution: null,
      raised_at: suffix === "10" ? "2026-10-05T01:00:00.000Z" : "2026-10-05T00:00:00.000Z",
      ...(suffix === "10" ? { next_action: "Await external review", next_action_owner: "external" } : suffix === "A" ? { next_action: "Attach source", next_action_owner: null } : {}),
    }));
    const partial = await f.runtime.resolveException({ exceptionId: "exception_z", nextAction: "Do not override", nextActionOwner: "agent" });
    assert.equal(partial.run.status, "blocked");
    assert.equal(partial.run.nextAction, "Await external review");
    assert.equal(partial.run.nextActionOwner, "external");
    assert.equal(Object.hasOwn(partial.exception, "nextAction"), false);
    const external = await f.runtime.resolveException({ exceptionId: "exception_10", nextActionOwner: "agent" });
    assert.equal(external.run.nextAction, "Attach source"); assert.equal(external.run.nextActionOwner, "user");
    assert.equal(external.exception.nextActionOwner, "external");
    const last = await f.runtime.resolveException({ exceptionId: "exception_A" });
    assert.equal(last.run.status, "active"); assert.equal(last.run.nextAction, "Continue run"); assert.equal(last.run.nextActionOwner, "system");
    const before = structuredClone(f.state);
    await assert.rejects(f.runtime.resolveException({ exceptionId: "exception_z" }), /already resolved/);
    assert.deepEqual(f.state, before);
    const selected = f.calls.filter(({ sql }) => sql.startsWith("select * from nodekit.exceptions") && sql.includes("status = 'open'"));
    assert.equal(selected.length, 3);
    assert.equal(selected.every(({ sql, values }) => /owner_id = \$1 and run_id = \$2/.test(sql) && /collate "C" limit 1$/.test(sql) && values[0] === f.state.run.owner_id), true);
    assert.equal(f.state.events.every((event, index) => /^event_[a-f0-9]{26}$/.test(event.event_id) && event.sequence === index + 1), true);
  }
});

test("a pooled PostgreSQL raise validates and copies assignments before acquisition, preserving legacy journals", async () => {
  const f = completionDatabase();
  let release;
  f.delayClient(new Promise((resolve) => { release = resolve; }));
  const input = { runId: f.state.run.run_id, code: "review_wait", nextAction: " Await external review ", nextActionOwner: " external ", preservedState: { artifactVersion: 1 }, idempotencyKey: "external" };
  const original = structuredClone(input);
  const pending = f.runtime.raiseException(input);
  input.preservedState.artifactVersion = 99; input.nextAction = "changed"; input.nextActionOwner = "user";
  release();
  const raised = await pending;
  assert.equal(raised.nextAction, "Await external review"); assert.equal(raised.nextActionOwner, "external");
  assert.deepEqual(raised.preservedState, { artifactVersion: 1 });
  const before = structuredClone(f.state);
  for (let index = 0; index < 100; index += 1) assert.deepEqual(await f.runtime.raiseException(original), raised);
  assert.deepEqual(f.state, before);
  for (const changed of [{ nextAction: "Different instruction" }, { nextActionOwner: "user" }]) {
    await assert.rejects(f.runtime.raiseException({ ...original, ...changed }), /different request/);
    assert.deepEqual(f.state, before);
  }
  const legacyInput = { runId: f.state.run.run_id, code: "legacy", idempotencyKey: "legacy" };
  const legacy = await f.runtime.raiseException(legacyInput);
  assert.equal(Object.hasOwn(legacy, "nextAction"), false); assert.equal(Object.hasOwn(legacy, "nextActionOwner"), false);
  const event = f.state.events.find((entry) => entry.idempotency_key === "legacy");
  assert.equal(event.request_hash, contentHash({ actor: { id: "nodekit", type: "system" }, code: "legacy", message: "An exception occurred.", operation: "raiseException", preservedState: {}, runId: f.state.run.run_id }));
  assert.deepEqual(await f.runtime.raiseException({ ...legacyInput, nextAction: undefined, nextActionOwner: undefined }), legacy);
  f.state.run.status = "completed";
  const terminal = structuredClone(f.state);
  assert.deepEqual(await f.runtime.raiseException(original), raised);
  assert.deepEqual(await f.runtime.raiseException(legacyInput), legacy);
  await assert.rejects(f.runtime.raiseException({ ...original, idempotencyKey: "fresh" }), /terminal/);
  assert.deepEqual(f.state, terminal);
});

test("a PostgreSQL operator's invalid assignment never acquires a client; post-write failures roll back", async () => {
  for (const candidate of [{ nextAction: null }, { nextActionOwner: null }, { nextAction: "" }, { nextActionOwner: " " }, { nextAction: 2 }, { nextActionOwner: {} }, { nextAction: "bad\0action" }, { nextActionOwner: "\ud800" },
    { nextAction: "x".repeat(786_432) }, { nextAction: "x".repeat(300_000), nextActionOwner: "y".repeat(300_000), preservedState: { body: "z".repeat(300_000) } }]) {
    const f = completionDatabase();
    await assert.rejects(f.runtime.raiseException({ runId: f.state.run.run_id, ...candidate }));
    assert.equal(f.connectCalls(), 0); assert.deepEqual(f.calls, []); assert.equal(f.state.exceptions.length, 0);
  }
  for (const candidate of [{ resolution: "" }, { resolution: "bad\0resolution" }, { nextAction: "\ud800" }, { nextActionOwner: null }]) {
    const f = completionDatabase();
    await assert.rejects(f.runtime.resolveException({ exceptionId: "exception_unseen", ...candidate }));
    assert.equal(f.connectCalls(), 0); assert.deepEqual(f.calls, []);
  }
  const f = completionDatabase();
  f.failAt("update nodekit.runs");
  const before = structuredClone(f.state);
  await assert.rejects(f.runtime.raiseException({ runId: f.state.run.run_id, nextActionOwner: "external" }), /fixture statement failure/);
  assert.deepEqual(f.state, before); assert.deepEqual(f.calls.slice(-2).map(({ sql }) => sql), ["rollback", "release"]);
  f.failAt(undefined);
  const raised = await f.runtime.raiseException({ runId: f.state.run.run_id, nextActionOwner: "external" });
  const blocked = structuredClone(f.state);
  f.failAt("update nodekit.runs");
  await assert.rejects(f.runtime.resolveException({ exceptionId: raised.exceptionId }), /fixture statement failure/);
  assert.deepEqual(f.state, blocked); assert.deepEqual(f.calls.slice(-2).map(({ sql }) => sql), ["rollback", "release"]);
});
