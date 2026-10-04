import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describeMutations, detectLedgerMutations } from "../src/lib/evolution-immutability.mjs";
import { EVOLUTION_RECORD_TYPES, verifyEvolutionLedger } from "../src/lib/evolution-ledger.mjs";
import { readJson, pathExists } from "../src/lib/files.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// evolution/ledger.json declares mutation: "append-or-supersede". That rule was enforced only
// inside recordEvolutionEvent, which nothing writes evidence through, so a committed record could
// be edited from result "partial" to "pass" and `evolution verify` still returned EVOLUTION PASS.
// These tests make the enforcement real on the path people actually use: the file on disk.

/** A throwaway repo with one committed evidence record. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-immutable-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  await mkdir(path.join(root, "evolution", "evidence"), { recursive: true });
  const file = "evolution/evidence/evd-x.json";
  const record = {
    schemaVersion: "nodekit.evolution-evidence/v1",
    id: "evd:x",
    kind: "test",
    artifactRef: "git:" + "0".repeat(40) + ":a.md",
    sha256: "a".repeat(64),
    sourceCommit: "b".repeat(40),
    generatedAt: "2026-07-25T00:00:00.000Z",
    environment: { evidenceBoundary: "Proves X only. Does not prove Y." },
    verifiesInvariantIds: [],
    result: "partial",
  };
  await writeFile(path.join(root, file), `${JSON.stringify(record, null, 2)}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "add evidence");
  return { root, file, record, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// @nodekit-verifies inv:ledger-records-are-immutable#claim-edit-is-caught
test("editing a committed record's claim is reported as a mutation", async () => {
  const f = await fixture();
  // The exact falsification that previously passed: soften the result, erase the boundary.
  const falsified = { ...f.record, result: "pass", environment: { evidenceBoundary: "Everything passed. No limitations." } };

  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: falsified }]);
  assert.equal(found.checked, 1);
  assert.equal(found.mutations.length, 1, "a rewritten claim must be caught");
  assert.equal(found.mutations[0].id, "evd:x");

  const paths = found.mutations[0].claimChanges.map((c) => c.path).sort();
  assert.deepEqual(paths, ["environment.evidenceBoundary", "result"]);

  const { issues } = describeMutations(found);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /append-or-supersede/, "the issue must say what to do instead");
  assert.match(issues[0], /partial.*pass/s, "and must show the claim that changed");
  await f.cleanup();
});

// The motivating case. Comparing against HEAD instead of disk would miss this entirely, because an
// uncommitted edit leaves HEAD untouched — and verify reports on the bytes on disk.
// @nodekit-verifies inv:ledger-records-are-immutable#uncommitted-edit-is-caught
test("an uncommitted edit is caught, because verify reports on the bytes on disk", async () => {
  const f = await fixture();
  const edited = { ...f.record, result: "pass" };
  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: edited }]);
  assert.equal(found.mutations.length, 1, "nothing was committed, and it must still be caught");
  await f.cleanup();
});

// A record cannot name the sha of the commit that will contain it, so the pointer is repaired
// after the fact by construction. Commit d3229a01 in this repository did exactly that and changed
// nothing else. Blocking it would block honest work.
// @nodekit-verifies inv:ledger-records-are-immutable#binding-repair-is-allowed
test("repairing a binding is allowed and reported separately from a claim change", async () => {
  const f = await fixture();
  const rebound = { ...f.record, sha256: "c".repeat(64), artifactRef: "git:" + "1".repeat(40) + ":a.md" };

  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: rebound }]);
  assert.equal(found.mutations.length, 0, "a binding repair is not a claim change");
  assert.equal(found.bindingRepairs.length, 1);

  const { issues, warnings } = describeMutations(found);
  assert.deepEqual(issues, [], "and must not block");
  assert.match(warnings[0], /binding repaired/);
  await f.cleanup();
});

// @nodekit-verifies inv:ledger-records-are-immutable#unchanged-is-silent
test("an untouched record produces neither an issue nor a warning", async () => {
  const f = await fixture();
  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: f.record }]);
  assert.equal(found.checked, 1);
  assert.equal(found.mutations.length, 0);
  assert.equal(found.bindingRepairs.length, 0);
  await f.cleanup();
});

// "Nothing detected" and "nothing looked" must never read the same. Outside a git repository there
// is no revision to compare against, and reporting a clean pass would be the exact false-confidence
// this check exists to remove.
// @nodekit-verifies inv:ledger-records-are-immutable#no-git-is-not-a-pass
test("without git, the check reports that it could not look rather than passing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-nogit-"));
  const found = await detectLedgerMutations(root, [{ file: "evolution/evidence/evd-x.json", record: { id: "evd:x" } }]);
  assert.equal(found.gitAvailable, false);
  assert.equal(found.checked, 0);

  const { issues, warnings } = describeMutations(found);
  assert.deepEqual(issues, [], "absence of git is not a violation");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /NOT checked/, "but it must say it did not look");
  await rm(root, { recursive: true, force: true });
});

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historicalFile = "evolution/assumptions/asm-strong-model-infers-topology.json";
const originalCommit = "5b9c4d73c286020fe7b7c52d208d7e0cbfeef626";
const historicalSchemaHash = "4d2998bf89b4eb2c1caf3cf5b2a95b600f68ed1565b0cb87a4aca2837526922f";

async function historicalFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authored-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", repositoryRoot, root], { stdio: "ignore" });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Authored contract fixture");
  const original = JSON.parse(git("show", `${originalCommit}:${historicalFile}`));
  return { root, git, original };
}

test("a release maintainer reads the exact pre-dimensions claim through full authored provenance", async (t) => {
  const f = await historicalFixture(t);
  const found = await detectLedgerMutations(f.root, [{ file: historicalFile, record: f.original }]);
  assert.deepEqual(describeMutations(found).issues, []);
  assert.equal(found.checked, 1);
  const origin = found.origins[0];
  assert.equal(origin.classification, "authored-historical-unscoped");
  assert.equal(origin.introducedIn, originalCommit);
  assert.equal(origin.observedHead, undefined, "HEAD belongs to the operation, not caller record input");
  assert.match(found.observedHead, /^[a-f0-9]{40}$/);
  assert.equal(origin.originalSchemaSha256, historicalSchemaHash);
  assert.equal(origin.payloadSha256, origin.originalPayloadSha256);
  assert.equal(origin.claimsEqual, true);
  assert.equal(origin.currentDimensionsCertified, false);

  // A later event may supersede the old interpretation; it cannot rewrite this claim's origin.
  await mkdir(path.join(f.root, "evolution", "drafts"), { recursive: true });
  await writeFile(path.join(f.root, "evolution", "drafts", "superseding-proposal.json"), JSON.stringify({
    id: "evt:later-proposal", supersedesIds: [f.original.introducedByEventId], interpretation: { status: "agent-proposed" },
  }));
  f.git("add", "evolution/drafts/superseding-proposal.json");
  f.git("commit", "-m", "propose a later interpretation without changing authored claims");
  const later = await detectLedgerMutations(f.root, [{ file: historicalFile, record: f.original }]);
  assert.equal(later.origins[0].classification, "authored-historical-unscoped");
  assert.equal(later.origins[0].introducedIn, originalCommit);
});

test("a new author cannot borrow historical scope or edit status, statement, evidence or dimensions", async (t) => {
  const f = await historicalFixture(t);
  const changes = [
    { statement: `${f.original.statement} This now applies everywhere.` },
    { status: "supported" },
    { contradictingEvidenceIds: [] },
    { dimensionsTested: [] },
    { dimensionsTested: ["an unverified later interpretation"] },
    { introducedIn: originalCommit, legacy: true },
  ];
  for (const change of changes) {
    const found = await detectLedgerMutations(f.root, [{ file: historicalFile, record: { ...f.original, ...change } }]);
    assert.notEqual(found.origins[0].classification, "authored-historical-unscoped");
    assert.equal(found.mutations.length, 1, JSON.stringify(change));
    assert.ok(describeMutations(found).issues.some((issue) => issue.includes("append-or-supersede")));
  }
  const newFile = "evolution/assumptions/asm-new-unscoped.json";
  const newRecord = { ...f.original, id: "asm:new-unscoped" };
  await writeFile(path.join(f.root, newFile), `${JSON.stringify(newRecord, null, 2)}\n`);
  const uncommitted = await detectLedgerMutations(f.root, [{ file: newFile, record: newRecord }]);
  assert.equal(uncommitted.origins[0].classification, "unknown");
  f.git("add", newFile);
  f.git("commit", "-m", "new direct-file unscoped claim cannot use an earlier contract");
  const committed = await detectLedgerMutations(f.root, [{ file: newFile, record: newRecord }]);
  assert.equal(committed.origins[0].classification, "unknown");
  assert.notEqual(committed.origins[0].originalSchemaSha256, historicalSchemaHash);
  assert.ok(describeMutations(committed).issues.length > 0);
});

test("a maintainer cannot turn deletion/readdition or a moved path into continuous authored history", async (t) => {
  const f = await historicalFixture(t);
  await rm(path.join(f.root, historicalFile));
  f.git("add", historicalFile);
  f.git("commit", "-m", "delete the old ledger path in fixture");
  await writeFile(path.join(f.root, historicalFile), `${JSON.stringify(f.original, null, 2)}\n`);
  f.git("add", historicalFile);
  f.git("commit", "-m", "reintroduce identical bytes at the old path");
  const reintroduced = await detectLedgerMutations(f.root, [{ file: historicalFile, record: f.original }]);
  assert.equal(reintroduced.origins[0].classification, "unknown");
  assert.ok(describeMutations(reintroduced).issues.length > 0);
  f.git("reset", "--hard", "HEAD~2");
  const movedFile = "evolution/assumptions/asm-moved-topology.json";
  await rename(path.join(f.root, historicalFile), path.join(f.root, movedFile));
  f.git("add", "-A");
  f.git("commit", "-m", "move a historical record rather than prove a new authored contract");
  const moved = await detectLedgerMutations(f.root, [{ file: movedFile, record: f.original }]);
  assert.equal(moved.origins[0].classification, "unknown");
  assert.ok(describeMutations(moved).issues.length > 0);
});

test("release burst and sustained reads keep pinned provenance local without accumulated qualifications", async (t) => {
  const f = await historicalFixture(t);
  const loaded = [{ file: historicalFile, record: f.original }];
  const burst = await Promise.all(Array.from({ length: 8 }, () => detectLedgerMutations(f.root, loaded)));
  assert.equal(new Set(burst.map((result) => result.observedHead)).size, 1);
  for (const result of burst) {
    assert.equal(result.origins.length, 1);
    assert.equal(result.origins[0].classification, "authored-historical-unscoped");
    assert.deepEqual(describeMutations(result).issues, []);
  }
  burst[0].origins[0].classification = "caller-mutated-result";
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const result = await detectLedgerMutations(f.root, loaded);
    assert.equal(result.origins.length, 1);
    assert.equal(result.origins[0].classification, "authored-historical-unscoped");
    assert.equal(result.mutations.length, 0);
    assert.equal(result.bindingRepairs.length, 0);
  }
});

test("history transport failures and unknown ancestry never certify a historical claim", async () => {
  // Instrument the actual observer body at its child-process seam, without a production override.
  const source = await readFile(new URL("../src/lib/evolution-immutability.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const DIMENSIONS_EPOCH ="), source.indexOf("/** Human-readable issue lines"))
    .replace("export async function detectLedgerMutations", "async function detectLedgerMutations");
  assert.ok(body.includes("maxBuffer: MAX_HISTORY_BYTES"));
  const original = JSON.parse(execFileSync("git", ["show", `${originalCommit}:${historicalFile}`], { cwd: repositoryRoot, encoding: "utf8" }));
  for (const fault of ["timeout", "body-cap", "invalid-json", "missing-epoch", "wrong-schema", "ancestry", "shallow", "deadline"]) {
    const calls = [];
    let clock = 0;
    const run = async (_command, args, options) => {
      calls.push(args);
      assert.equal(options.maxBuffer, 2 * 1024 * 1024);
      assert.ok(options.timeout > 0 && options.timeout <= 5000);
      if (args[0] === "rev-parse") {
        if (args.includes("--is-inside-work-tree")) { if (fault === "deadline") clock = 31000; return { stdout: "true\n" }; }
        if (args.includes("--is-shallow-repository")) return { stdout: `${fault === "shallow"}\n` };
        return { stdout: "f".repeat(40) + "\n" };
      }
      if (args[0] === "log") return { stdout: args.includes("--follow") ? "" : `commit:${originalCommit}\nA\t${historicalFile}\n` };
      if (args[0] === "merge-base") throw new Error(fault === "missing-epoch" ? "bad object" : "not an ancestor");
      if (args[0] === "show" && args[1].endsWith(historicalFile)) {
        if (["timeout", "body-cap"].includes(fault)) throw new Error(fault);
        return { stdout: fault === "invalid-json" ? "{" : JSON.stringify(original) };
      }
      if (args[0] === "show") return { stdout: fault === "wrong-schema" ? "{}" : await readFile(path.join(repositoryRoot, "schemas", "nodekit.assumption.v1.pre-dimensions.schema.json"), "utf8") };
      throw new Error("unexpected fixture child operation");
    };
    const observer = vm.runInNewContext(`${body}\ndetectLedgerMutations`, {
      run, createHash, Buffer, diffPaths: () => [], validateSchema: async () => [],
      Date: { now: () => clock },
    });
    const result = await observer(repositoryRoot, [{ file: historicalFile, record: original }]);
    assert.equal(result.origins[0].classification, "unknown", fault);
    assert.notEqual(result.origins[0].currentDimensionsCertified, true);
    assert.ok(result.failures.length > 0, fault);
    assert.ok(calls.length <= 8, "failure must terminate the current record's child sequence");
  }
  await assert.rejects(
    () => detectLedgerMutations(repositoryRoot, Array.from({ length: 2049 }, () => ({ file: historicalFile, record: original }))),
    /exceeds 2048 records/,
  );
});

async function currentPreflightFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-current-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Current claim preflight fixture");
  const artifact = Buffer.from("Current scoped verification fixture; no historical contract is needed.\n");
  await writeFile(path.join(root, "verifier.txt"), artifact);
  git("add", "verifier.txt");
  git("commit", "-q", "-m", "commit the current fixture artifact");
  const sourceCommit = git("rev-parse", "HEAD");
  const evidence = {
    schemaVersion: "nodekit.evolution-evidence/v1", id: "evd:current-preflight",
    kind: "test", artifactRef: "file:verifier.txt",
    sha256: createHash("sha256").update(artifact).digest("hex"), sourceCommit,
    generatedAt: "2026-10-04T00:00:00.000Z",
    environment: { evidenceBoundary: "Current scoped fixture only; not a historical or production guarantee" },
    verifiesInvariantIds: [], result: "partial",
  };
  const assumption = {
    schemaVersion: "nodekit.assumption/v1", id: "asm:current-preflight",
    statement: "The fixture's current author named its measured scope",
    scope: { applications: ["fixture"] }, status: "scope-limited",
    dimensionsTested: ["current scoped reader fixture"],
    supportingEvidenceIds: [evidence.id], contradictingEvidenceIds: [],
  };
  const evidenceFile = path.join(root, "evolution", "evidence", "evd-current-preflight.json");
  const assumptionFile = path.join(root, "evolution", "assumptions", "asm-current-preflight.json");
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await mkdir(path.dirname(assumptionFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(assumptionFile, `${JSON.stringify(assumption, null, 2)}\n`);
  git("add", "evolution");
  git("commit", "-q", "-m", "commit strict-valid current scoped claims");
  return { root, evidenceFile, evidence, assumption };
}

async function verifierAtOriginSeam(observer) {
  // Keep the actual inspection/reporting owner and strict schemas. Only the observer's
  // first child is faulted; unrelated invalid references cannot rescue this assertion.
  const source = await readFile(new URL("../src/lib/evolution-ledger.mjs", import.meta.url), "utf8");
  const slice = (first, last) => {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start);
    assert.ok(start >= 0 && end > start, `${first} verifier seam must exist`);
    return source.slice(start, end);
  };
  const body = [
    slice("function digest(", "const DEFERRED_REVIEW_SCHEMA"),
    slice("function resolveInside(", "// Bound the buffer"),
    slice("function commitExists(", "const MAX_LEDGER_RECORDS"),
    slice("const MAX_LEDGER_RECORDS", "export async function initializeEvolutionLedger"),
    slice("function hasCycle(", "async function inspectEvolutionLedger"),
    slice("async function inspectEvolutionLedger", "export async function queryEvolutionLedger"),
  ].join("\n").replace(/^export /gm, "");
  return vm.runInNewContext(`${body}\nverifyEvolutionLedger`, {
    createHash, execFileSync, readFile, readdir, path, pathExists, readJson,
    EVOLUTION_RECORD_TYPES, validateSchema, describeMutations, detectLedgerMutations: observer,
  });
}

test("first Git child failure cannot pass a strict-valid edited current claim during a release burst", async (t) => {
  const f = await currentPreflightFixture(t);
  const before = await verifyEvolutionLedger(f.root);
  assert.equal(before.passed, true, before.issues.join("\n"));
  assert.equal(before.immutability.checked, 2);
  const edited = { ...f.evidence, result: "pass" };
  await writeFile(f.evidenceFile, `${JSON.stringify(edited, null, 2)}\n`);
  assert.deepEqual(await validateSchema("nodekit.evolution-evidence.v1.schema.json", edited, edited.id), []);
  assert.deepEqual(await validateSchema("nodekit.assumption.v1.schema.json", f.assumption, f.assumption.id), []);
  const normal = await verifyEvolutionLedger(f.root);
  assert.equal(normal.passed, false);
  assert.equal(normal.immutability.claimMutations, 1, "a real introducing commit exists and the edited current claim is caught normally");
  assert.ok(normal.issues.some((issue) => issue.includes("append-or-supersede")));

  const observerSource = await readFile(new URL("../src/lib/evolution-immutability.mjs", import.meta.url), "utf8");
  const observerBody = observerSource.slice(observerSource.indexOf("const DIMENSIONS_EPOCH ="), observerSource.indexOf("/** Human-readable issue lines"))
    .replace("export async function detectLedgerMutations", "async function detectLedgerMutations");
  const privateMarker = "fixture-private-child-diagnostic";
  const normalNonrepositoryText = "fatal: not a git repository (or any of the parent directories): .git\n";
  const faults = [
    { name: "first-child-timeout", code: null, killed: true, signal: "SIGTERM", stderr: privateMarker },
    { name: "first-child-spawn-failure", code: "ENOENT", stderr: privateMarker },
    { name: "first-child-output-cap", code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: privateMarker },
    { name: "first-child-damaged-repository", code: 128, stderr: `fatal: damaged repository ${privateMarker}\n` },
    { name: "first-child-terminated-discovery", code: 128, killed: true, signal: "SIGTERM", stderr: normalNonrepositoryText },
    { name: "first-child-overlong-discovery", code: 128, stderr: normalNonrepositoryText + privateMarker.repeat(20) },
  ];
  for (const fault of faults) {
    let calls = 0;
    const observer = vm.runInNewContext(`${observerBody}\ndetectLedgerMutations`, {
      createHash, Buffer, validateSchema,
      diffPaths: () => { throw new Error("first-child failure must stop before claim comparison"); },
      run: async (command, args, options) => {
        calls += 1;
        assert.equal(command, "git");
        assert.deepEqual(Array.from(args), ["rev-parse", "--is-inside-work-tree"]);
        assert.equal(options.maxBuffer, 2 * 1024 * 1024);
        assert.ok(options.timeout > 0 && options.timeout <= 5000);
        throw Object.assign(new Error(privateMarker), { ...fault, stdout: "" });
      },
    });
    const verify = await verifierAtOriginSeam(observer);
    const assertFailed = (verdict) => {
      // This is the knockout: without preflight failure creation/reporting the current
      // schemas and references still pass, and this actual verifier body returns true.
      assert.equal(verdict.passed, false, fault.name);
      assert.equal(verdict.immutability.checked, 0);
      assert.equal(verdict.immutability.claimMutations, 0);
      assert.equal(verdict.issues.length, 1, "failure must remain one bounded operational issue");
      assert.match(verdict.issues[0], /ledger origin preflight failed/);
      assert.equal(verdict.warnings.some((warning) => /not a git repository/.test(warning)), false);
      assert.equal(JSON.stringify(verdict).includes(privateMarker), false);
    };
    const burst = await Promise.all(Array.from({ length: 8 }, () => verify(f.root)));
    burst.forEach(assertFailed);
    for (let iteration = 0; iteration < 16; iteration += 1) assertFailed(await verify(f.root));
    assert.equal(calls, 24, "each call terminates at its first bounded child with no accumulated state");
  }
});
