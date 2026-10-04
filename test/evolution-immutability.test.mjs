import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { promisify } from "node:util";
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

// These scenarios build native commit objects and trees in disposable repositories.
// They exercise the installed Git engine; no fixture pins or rewrites its follow output.
async function nativeDagRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-two-origin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const raw = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  git("init", "-q");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Native evidence DAG fixture");
  const commit = (parents, changes, message) => {
    git("read-tree", ...(parents.length ? [parents[0]] : ["--empty"]));
    for (const [file, value] of Object.entries(changes)) {
      if (value === null) { git("update-index", "--force-remove", "--", file); continue; }
      const text = typeof value === "object" ? value.text : value;
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: root, encoding: "utf8", input: text, timeout: 5000,
        maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      git("update-index", "--add", "--cacheinfo", `${typeof value === "object" ? value.mode : "100644"},${blob},${file}`);
    }
    const tree = git("write-tree");
    return git("commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message);
  };
  const checkout = (head) => { git("update-ref", "HEAD", head); git("reset", "--hard", head); };
  const artifact = "A committed fixture artifact proves only endpoint inspection.\n";
  const alternate = "A second real committed artifact supplies a visible binding repair.\n";
  const artifactCommit = commit([], { "verifier.txt": artifact }, "commit artifact before any evidence");
  const base = commit([artifactCommit], { "alternate.txt": alternate }, "base for independent introductions");
  const record = (suffix) => ({
    schemaVersion: "nodekit.evolution-evidence/v1", id: `evd:dag-${suffix}`, kind: "test",
    artifactRef: `git:${artifactCommit}:verifier.txt`,
    sha256: createHash("sha256").update(artifact).digest("hex"), sourceCommit: artifactCommit,
    generatedAt: "2026-10-04T00:00:00.000Z", verifiesInvariantIds: [], result: "partial",
    environment: { evidenceBoundary: "Fixture endpoint comparison only; not pristine intermediate history" },
  });
  const repair = (value) => ({ ...value, artifactRef: `git:${base}:alternate.txt`, sourceCommit: base,
    sha256: createHash("sha256").update(alternate).digest("hex") });
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const parents = (id) => git("show", "--no-patch", "--format=%P", id).split(" ").filter(Boolean);
  return { root, git, raw, commit, checkout, base, artifactCommit, record, repair, json, parents };
}

async function faithfulDag(t, changeSquash = (record) => record) {
  const f = await nativeDagRepository(t);
  const suffixes = ["cli-authority-bypass-and-repair", "personal-action-store", "propose-evolution-guards",
    "recall-before-claim", "propose-evolution-guards-reached", "propose-evolution-guards-v2", "recall-before-claim-v2"];
  const loaded = suffixes.map((suffix) => ({ file: `evolution/evidence/evd-dag-${suffix}.json`, record: f.record(suffix) }));
  const originals = new Map();
  let tip = f.base;
  let changedGuard;
  for (const [group, indexes] of [["cli", [0]], ["guards", [1, 2, 3]], ["reached", [4]], ["v2", [5, 6]]]) {
    const changes = Object.fromEntries(indexes.map((index) => [loaded[index].file, f.json(loaded[index].record)]));
    if (group === "reached") changes[loaded[2].file] = f.json(loaded[2].record);
    tip = f.commit([tip], changes, `original grouped introduction ${group}`);
    for (const index of indexes) originals.set(loaded[index].file, tip);
    if (group === "guards") {
      changedGuard = { ...f.repair(loaded[2].record), environment: { evidenceBoundary: "A real temporary intermediate claim edit, restored later" } };
      tip = f.commit([tip], { [loaded[2].file]: f.json(changedGuard) }, "temporary guard claim and binding edit");
      f.intermediate = tip;
    }
  }
  const originalTip = tip;
  const squash = f.commit([f.base], Object.fromEntries(loaded.map(({ file, record }, index) =>
    [file, f.json(index === 0 ? changeSquash(record, f) : record)])), "independent squash introduction");
  const convergence = f.commit([originalTip, squash], {}, "converge original and squash preserving original payloads");
  const head = f.commit([squash, convergence], Object.fromEntries(loaded.map(({ file, record }) => [file, f.json(record)])), "main-style merge of squash and convergence");
  f.checkout(head);
  assert.deepEqual(f.parents(convergence), [originalTip, squash]);
  assert.deepEqual(f.parents(head), [squash, convergence]);
  assert.notEqual(JSON.parse(f.git("show", `${f.intermediate}:${loaded[2].file}`)).environment.evidenceBoundary, loaded[2].record.environment.evidenceBoundary);
  assert.deepEqual(JSON.parse(f.git("show", `${originalTip}:${loaded[2].file}`)), loaded[2].record);
  for (const { file, record } of loaded) {
    assert.deepEqual(await validateSchema("nodekit.evolution-evidence.v1.schema.json", record, record.id), []);
    const introducing = [originals.get(file), squash].sort();
    assert.deepEqual(f.git("merge-base", "--independent", ...introducing).split(/\s+/u).sort(), introducing);
    assert.deepEqual(f.git("log", "--full-history", "--diff-filter=A", "--format=%H", "--no-renames", head, "--", file).split(/\s+/u).sort(), introducing, "native discovery has exactly these two additions");
    for (const id of introducing) {
      assert.equal(f.parents(id).length, 1);
      assert.equal(f.git("ls-tree", f.parents(id)[0], "--", file), "", "absent at each actual introducing parent");
      const original = JSON.parse(f.git("show", `${id}:${file}`));
      assert.deepEqual(await validateSchema("nodekit.evolution-evidence.v1.schema.json", original, original.id), []);
      const full = f.raw("diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", f.parents(id)[0], id, "--");
      assert.ok(full.includes(`A\0${file}\0`));
    }
  }
  return { ...f, loaded, originals, originalTip, squash, convergence, head };
}

async function observerAtChildSeam(root, interceptor = (_args, native) => native(), { clock, knockout } = {}) {
  let source = await readFile(new URL("../src/lib/evolution-immutability.mjs", import.meta.url), "utf8");
  if (knockout) { const changed = knockout(source); assert.notEqual(changed, source); source = changed; }
  const body = source.slice(source.indexOf("const BINDING_FIELDS ="), source.indexOf("/** Human-readable issue lines"))
    .replace("export async function detectLedgerMutations", "async function detectLedgerMutations");
  const first = source.indexOf("  const git = async (args) => {");
  const last = source.indexOf("  const mutations = [];", first);
  assert.ok(first > 0 && last > first, "private owner must use the actual bounded wrapper text");
  const calls = [];
  const nativeRun = promisify(execFile);
  const run = async (command, args, options) => {
    assert.equal(command, "git");
    assert.equal(options.cwd, root);
    assert.equal(options.maxBuffer, 2 * 1024 * 1024);
    assert.ok(options.timeout > 0 && options.timeout <= 5000);
    assert.ok(calls.length < 96, "finite child trace per scenario operation");
    const call = { args: Array.from(args), native: false };
    calls.push(call);
    const native = async () => {
      call.native = true;
      const result = await nativeRun(command, args, options);
      call.stdout = result.stdout;
      call.stderr = result.stderr;
      return result;
    };
    return interceptor(Array.from(args), native);
  };
  const owner = vm.runInNewContext(`${body}\nconst deadline = Date.now() + INSPECTION_BUDGET_MS;\n${source.slice(first, last)}\n({ observer: detectLedgerMutations, inspect: (id, file) => inspectIntroducingTarget(git, id, file), classify: classifyIntroducingDiff })`, {
    repoRoot: root, run, createHash, Buffer, validateSchema, ...(clock ? { Date: { now: clock } } : {}),
  });
  return { ...owner, calls };
}

function assertUninspected(result, file, marker = "fixture-private-origin-diagnostic") {
  assert.equal(result.checked, 0);
  assert.equal(result.mutations.length, 0);
  assert.equal(result.bindingRepairs.length, 0);
  assert.equal(result.origins.length, 1);
  assert.equal(result.origins[0].file, file);
  assert.equal(result.origins[0].classification, "unknown");
  assert.equal(result.origins[0].claimsEqual, false);
  assert.equal(result.origins[0].introducedIn, null);
  assert.equal(result.origins[0].originalPayloadSha256, null);
  assert.equal(result.failures.length, 1);
  assert.equal(describeMutations(result).issues.length, 1);
  assert.equal(JSON.stringify(result).includes(marker), false);
}

test("a release maintainer inspects seven original/squash claims after both genuine merges", async (t) => {
  const f = await faithfulDag(t);
  for (const { file, record } of f.loaded) {
    assert.deepEqual(JSON.parse(f.git("show", `${f.originals.get(file)}:${file}`)), record);
    assert.deepEqual(JSON.parse(f.git("show", `${f.squash}:${file}`)), record);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, file), "utf8")), record);
  }
  const result = await detectLedgerMutations(f.root, f.loaded);
  assert.equal(result.checked, 7);
  assert.deepEqual(result.mutations, []);
  assert.deepEqual(result.bindingRepairs, []);
  assert.deepEqual(result.failures, []);
  assert.equal(result.origins.length, 7);
  for (const origin of result.origins) {
    assert.equal(origin.classification, "current");
    assert.equal(origin.claimsEqual, true);
    assert.equal(origin.introducedIn, null, "both were inspected; no scalar origin selected");
    assert.equal(origin.originalPayloadSha256, null);
    assert.match(origin.reason, /both independent/);
  }
  const verdict = await verifyEvolutionLedger(f.root);
  assert.equal(verdict.passed, true, verdict.issues.join("\n"));
  assert.equal(verdict.immutability.checked, 7);
  const burst = await Promise.all(Array.from({ length: 8 }, () => detectLedgerMutations(f.root, f.loaded)));
  assert.equal(new Set(burst.map((item) => item.observedHead)).size, 1);
  for (const item of burst) { assert.equal(item.checked, 7); assert.deepEqual(item.failures, []); }
  burst[0].origins[0].claimsEqual = false;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const item = await detectLedgerMutations(f.root, f.loaded);
    assert.equal(item.origins.length, 7);
    assert.ok(item.origins.every((origin) => origin.claimsEqual));
    assert.deepEqual(item.mutations, []);
    assert.deepEqual(item.bindingRepairs, []);
  }
});

test("a conflicting result or nested boundary on either inspected origin cannot borrow its matching branch", async (t) => {
  for (const field of ["result", "nested-boundary"]) await t.test(field, async (t) => {
    const f = await faithfulDag(t, (record) => field === "result" ? { ...record, result: "pass" }
      : { ...record, environment: { evidenceBoundary: "A conflicting original branch claims universal success" } });
    const file = f.loaded[0].file;
    const verdict = await verifyEvolutionLedger(f.root);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.issues.length, 1, "only the actual differing original claim blocks this strict-valid ledger");
    assert.match(verdict.issues[0], /append-or-supersede/);
    assert.ok(verdict.issues[0].includes(f.squash.slice(0, 8)));
    const assertConflict = (result) => {
      assert.equal(result.checked, 7);
      assert.equal(result.mutations.length, 1);
      assert.equal(result.mutations[0].introducedIn, f.squash.slice(0, 8));
      assert.equal(result.mutations[0].claimChanges[0].path, field === "result" ? "result" : "environment.evidenceBoundary");
      assert.deepEqual(result.failures, []);
    };
    const burst = await Promise.all(Array.from({ length: 8 }, () => detectLedgerMutations(f.root, f.loaded)));
    burst.forEach(assertConflict);
    burst[0].mutations.length = 0;
    for (let iteration = 0; iteration < 16; iteration += 1) assertConflict(await detectLedgerMutations(f.root, f.loaded));
    const matching = f.originals.get(file);
    const seam = await observerAtChildSeam(f.root, undefined, { knockout: (source) => source.replace(
      "for (const introducedIn of introducing) {\n          const original = JSON.parse",
      `for (const introducedIn of file === ${JSON.stringify(file)} ? [${JSON.stringify(matching)}] : introducing) {\n          const original = JSON.parse`,
    ) });
    const knocked = await verifierAtOriginSeam(seam.observer);
    assert.equal((await knocked(f.root)).passed, true, "removing the differing-origin comparison creates the actual false pass");
  });
});

test("uncommitted current claims are compared twice while real binding repairs stay visible", async (t) => {
  const f = await faithfulDag(t);
  const { file, record } = f.loaded[0];
  for (const edited of [{ ...record, result: "pass" }, { ...record, environment: { evidenceBoundary: "The current loaded claim erased its boundary" } }]) {
    await writeFile(path.join(f.root, file), f.json(edited));
    assert.deepEqual(await validateSchema("nodekit.evolution-evidence.v1.schema.json", edited, edited.id), []);
    const verdict = await verifyEvolutionLedger(f.root);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.immutability.claimMutations, 2);
    assert.equal(verdict.issues.length, 2);
    assert.ok(verdict.issues.every((issue) => issue.includes("append-or-supersede")));
  }
  await writeFile(path.join(f.root, file), f.json(f.repair(record)));
  const repaired = await verifyEvolutionLedger(f.root);
  assert.equal(repaired.passed, true, repaired.issues.join("\n"));
  assert.equal(repaired.immutability.bindingRepairs, 2);
  assert.equal(repaired.warnings.filter((warning) => /binding repaired/.test(warning)).length, 2);
  const variant = await faithfulDag(t, (value, fixture) => fixture.repair(value));
  const bindingVariant = await verifyEvolutionLedger(variant.root);
  assert.equal(bindingVariant.passed, true, bindingVariant.issues.join("\n"));
  assert.equal(bindingVariant.immutability.bindingRepairs, 1);
});

test("current scoped arrays retain their order while reordered object keys retain their meaning", async (t) => {
  const f = await faithfulDag(t);
  const file = "evolution/assumptions/asm-dag-scoped-array.json";
  const record = { schemaVersion: "nodekit.assumption/v1", id: "asm:dag-scoped-array",
    statement: "The current fixture measured only its named release surfaces",
    scope: { applications: ["web", "api"] }, status: "scope-limited",
    dimensionsTested: ["fixture endpoints"], supportingEvidenceIds: [f.loaded[0].record.id], contradictingEvidenceIds: [] };
  const a = f.commit([f.head], { [file]: f.json(record) }, "original current scoped array");
  const b = f.commit([f.head], { [file]: f.json({ ...record, scope: { applications: ["web", "api"] } }) }, "independent current scoped array");
  f.checkout(f.commit([a, b], {}, "converge current array claims"));
  assert.equal((await verifyEvolutionLedger(f.root)).passed, true);
  const reordered = Object.fromEntries(Object.entries(record).reverse());
  await writeFile(path.join(f.root, file), f.json(reordered));
  const unchanged = await detectLedgerMutations(f.root, [{ file, record: reordered }]);
  assert.equal(unchanged.checked, 1);
  assert.equal(unchanged.origins[0].claimsEqual, true);
  assert.deepEqual(unchanged.mutations, []);
  const edited = { ...record, scope: { applications: ["api", "web"] } };
  await writeFile(path.join(f.root, file), f.json(edited));
  const verdict = await verifyEvolutionLedger(f.root);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.issues.length, 2);
  assert.ok(verdict.issues.every((issue) => /scope.applications.*append-or-supersede|append-or-supersede.*scope.applications/.test(issue)));
});

test("reintroduction, branch loss, merge deletion, type changes and a third origin remain unavailable", async (t) => {
  for (const scenario of ["comparable-readdition", "branch-readdition", "merge-deletion", "type-change", "third-origin"]) await t.test(scenario, async (t) => {
    const f = await nativeDagRepository(t);
    const file = "evolution/evidence/evd-dag-lifecycle.json";
    const record = f.record("lifecycle");
    const added = { [file]: f.json(record) };
    const a = f.commit([f.base], added, "first independent introduction");
    const b = f.commit([f.base], added, "second independent introduction");
    let head;
    if (scenario === "comparable-readdition" || scenario === "branch-readdition") {
      const deleted = f.commit([a], { [file]: null }, "delete on original lineage");
      const readded = f.commit([deleted], added, "readd identical endpoint bytes");
      head = scenario === "comparable-readdition" ? readded : f.commit([b, readded], {}, "converge intact and readded branches");
    } else if (scenario === "merge-deletion") {
      const deleted = f.commit([a, b], { [file]: null }, "merge resolution deletes a claim present in both parents");
      head = f.commit([deleted, a], added, "later merge restores the intact endpoint");
      const separate = f.raw("log", "--full-history", "--diff-merges=separate", "--format=commit:%H", "--name-status", "--find-renames", head, "--", file);
      assert.ok(separate.includes(`D\t${file}`), "real parent-separated history exposes the merge deletion");
    } else if (scenario === "type-change") {
      const changed = f.commit([a], { [file]: { mode: "120000", text: "verifier.txt" } }, "change the ledger path type");
      head = f.commit([b, changed], added, "restore regular JSON in a merge");
      assert.ok(f.raw("log", "--full-history", "--format=commit:%H", "--name-status", "--no-renames", head, "--", file).includes(`T\t${file}`));
    } else {
      const c = f.commit([f.base], added, "third independent introduction");
      head = f.commit([a, b, c], {}, "three-origin convergence is outside the finite supported case");
      assert.equal(f.git("merge-base", "--independent", a, b, c).split(/\s+/u).length, 3);
    }
    f.checkout(head);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, file), "utf8")), record);
    const result = await detectLedgerMutations(f.root, [{ file, record }]);
    assertUninspected(result, file);
    const verdict = await verifyEvolutionLedger(f.root);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.issues.length, 1, "the real lifecycle inspection is the sole failure");
    assert.match(verdict.issues[0], /ledger origin inspection failed/);
  });
});

test("incoming moves on either introducing branch cannot hide behind the matching merge parent", async (t) => {
  for (const movedRole of ["original", "squash"]) await t.test(movedRole, async (t) => {
    let matchingParentWitnesses = 0;
    for (const firstRole of ["addition", "move"]) await t.test(`final first parent ${firstRole}`, async (t) => {
      const f = await nativeDagRepository(t);
      const file = "evolution/evidence/evd-dag-incoming-move.json";
      const predecessor = "prior-outside-ledger.json";
      const record = f.record("incoming-move");
      const base = f.commit([f.base], { [predecessor]: f.json(record) }, "older claim outside the ledger");
      const move = f.commit([base], { [predecessor]: null, [file]: f.json(record) }, `${movedRole} branch moves the older claim`);
      const addition = f.commit([base], { [file]: f.json(record) }, `${movedRole === "original" ? "squash" : "original"} branch genuinely adds identical bytes`);
      const first = firstRole === "addition" ? addition : move;
      const second = firstRole === "addition" ? move : addition;
      const convergence = f.commit([first, second], { [predecessor]: null, [file]: f.json(record) }, "converge with the selected actual parent order");
      const head = f.commit([first, convergence], { [predecessor]: null, [file]: f.json(record) }, "main-style convergence with the same actual first parent");
      f.checkout(head);
      const full = f.raw("diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", base, move, "--");
      assert.ok(full.includes(`R100\0${predecessor}\0${file}\0`), "native full diff retains the predecessor before pairing");
      assert.deepEqual(JSON.parse(f.git("show", `${move}:${file}`)), record);
      assert.deepEqual(JSON.parse(f.git("show", `${addition}:${file}`)), record);
      const independent = [move, addition].sort();
      assert.deepEqual(f.git("merge-base", "--independent", ...independent).split(/\s+/u).sort(), independent);
      const restricted = f.raw("log", "--full-history", "--format=commit:%H", "--name-status", "--no-renames", head, "--", file);
      const supplemental = f.raw("log", "--full-history", "--diff-merges=separate", "--format=commit:%H", "--name-status", "--find-renames", head, "--", file);
      const follow = f.raw("log", "--follow", "--diff-filter=R", "--format=%H", head, "--", file);
      const seam = await observerAtChildSeam(f.root);
      const result = await seam.observer(f.root, [{ file, record }]);
      assertUninspected(result, file);
      const verdict = await verifyEvolutionLedger(f.root);
      assert.equal(verdict.passed, false);
      assert.equal(verdict.issues.length, 1, "current schema and real references cannot rescue a missing move check");
      const owner = await observerAtChildSeam(f.root);
      await assert.rejects(() => owner.inspect(move, file), /not unambiguously added/);
      await owner.inspect(addition, file);
      const directKnockout = await observerAtChildSeam(f.root, undefined, { knockout: (source) => source.replace(
        "classifyIntroducingDiff(await git(args), file);", "await git(args);",
      ) });
      await directKnockout.inspect(move, file);
      const reached = seam.calls.some((call) => call.args[0] === "diff-tree" && call.args.includes(move));
      t.diagnostic(JSON.stringify({ gitVersion: f.git("--version"), movedRole, firstRole, move, addition,
        convergenceParents: f.parents(convergence), headParents: f.parents(head), restricted, supplemental, follow,
        fullDiffBytes: Buffer.byteLength(full), reachedIntroducingOwner: reached }));
      if (reached) {
        assert.equal(follow.trim(), "", "the real matching-parent counterexample must bind its native empty-follow fact");
        matchingParentWitnesses += 1;
        const knocked = await observerAtChildSeam(f.root, undefined, { knockout: (source) => source.replace(
          "for (const introducedIn of introducing) await inspectIntroducingTarget(git, introducedIn, file);",
          `for (const introducedIn of introducing) if (introducedIn !== ${JSON.stringify(move)}) await inspectIntroducingTarget(git, introducedIn, file);`,
        ) });
        const verify = await verifierAtOriginSeam(knocked.observer);
        assert.equal((await verify(f.root)).passed, true, "omitting this actual moved origin produces the strict-valid false pass");
      } else {
        assert.ok(follow.trim() || /(?:^|\n)[^AM\n][^\n]*\t/u.test(supplemental), "an earlier actual lifecycle guard must explain the unavailable new-owner witness");
      }
    });
    assert.ok(matchingParentWitnesses > 0, "native proof needs one genuine reached matching-parent counterexample per role; never fabricate a Git stream or pin an older engine");
  });
});

test("the same private introducing owner inspects actual roots and every actual merge parent", async (t) => {
  const f = await nativeDagRepository(t);
  const file = "evolution/evidence/evd-dag-parent-framing.json";
  const record = f.record("parent-framing");
  const added = { [file]: f.json(record) };
  const root = f.commit([], added, "actual root introduction for private framing proof");
  const rootOwner = await observerAtChildSeam(f.root);
  await rootOwner.inspect(root, file);
  assert.equal(rootOwner.calls.length, 2);
  assert.ok(rootOwner.calls[1].args.includes("--root"));
  assert.equal(rootOwner.calls[1].args.at(-1), "--");
  const a = f.commit([f.base], { "left.txt": "left parent\n" }, "actual left parent without target");
  const b = f.commit([f.base], { "right.txt": "right parent\n" }, "actual right parent without target");
  const genuine = f.commit([a, b], { ...added, "right.txt": "right parent\n" }, "genuine target introduction against both parents");
  const owner = await observerAtChildSeam(f.root);
  await owner.inspect(genuine, file);
  assert.equal(owner.calls.filter((call) => call.args[0] === "diff-tree").length, 2);
  assert.deepEqual(owner.calls.slice(1).map((call) => call.args.at(-3)), [a, b]);
  assert.ok(owner.calls.every((call) => call.native));
  const exists = f.commit([f.base], added, "target exists in one import parent");
  const imported = f.commit([a, exists], added, "one-parent import is not an all-parent introduction");
  const importing = await observerAtChildSeam(f.root);
  await assert.rejects(() => importing.inspect(imported, file), /not unambiguously added/);
  assert.equal(importing.calls.filter((call) => call.args[0] === "diff-tree").length, 2);
  const firstParentOnly = await observerAtChildSeam(f.root, undefined, { knockout: (source) => source.replace(
    "for (const parent of parents.length ? parents : [null])", "for (const parent of parents.length ? parents.slice(0, 1) : [null])",
  ) });
  await firstParentOnly.inspect(imported, file);
  const predecessor = "merge-parent-predecessor.json";
  const withPredecessor = f.commit([f.base], { [predecessor]: f.json(record) }, "one parent owns an older nonledger path");
  for (const order of [[a, withPredecessor], [withPredecessor, a]]) {
    const moved = f.commit(order, { ...added, [predecessor]: null }, "rename versus one actual merge parent only");
    const movedOwner = await observerAtChildSeam(f.root);
    await assert.rejects(() => movedOwner.inspect(moved, file), /not unambiguously added/);
    const nativeRename = f.raw("diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", withPredecessor, moved, "--");
    assert.ok(nativeRename.includes(`R100\0${predecessor}\0${file}\0`));
  }
  const c = f.commit([f.base], { "third.txt": "third actual parent\n" }, "third actual parent without target");
  const octopus = f.commit([a, b, c], added, "three actual parents exceed the private supported bound");
  const degraded = await observerAtChildSeam(f.root);
  await assert.rejects(() => degraded.inspect(octopus, file), /exceeds two actual parents/);
  assert.equal(degraded.calls.length, 1, "reject before any partial parent selection or payload read");
  const unrelatedBefore = "unrelated\told.txt";
  const unrelatedAfter = "unrelated\nnew.txt";
  const old = f.commit([f.base], { [unrelatedBefore]: "unrelated exact bytes\n" }, "old unrelated path");
  const newTarget = f.commit([old], { ...added, [unrelatedBefore]: null, [unrelatedAfter]: "unrelated exact bytes\n" }, "unrelated native rename alongside genuine target addition");
  const unrelated = await observerAtChildSeam(f.root);
  await unrelated.inspect(newTarget, file);
  assert.ok(unrelated.calls[1].stdout.includes(`R100\0${unrelatedBefore}\0${unrelatedAfter}\0`));
});

test("full NUL framing ignores ordinary unrelated changes but rejects every ambiguous target", async (t) => {
  const f = await faithfulDag(t);
  const { file } = f.loaded[0];
  const seam = await observerAtChildSeam(f.root);
  const valid = `A\0${file}\0`;
  seam.classify(`${valid}M087\0unrelated\tmodified\n.txt\0R050\0outside-old\0outside-new\0C100\0copy-old\0copy-new\0D\0removed-other\0T\0type-other\0U\0unmerged-other\0X\0unknown-other\0B\0broken-other\0`, file);
  // Source-seam C framing is deliberately not a claim that -M discovers every copy.
  const invalid = [
    "", "A\0other\0", `A\0${file}`, `${valid}partial`, `${valid}M\0`, `${valid}A\0\0`,
    `${valid}${valid}`, `R100\0outside\0${file}\0`, `R100\0${file}\0outside\0`,
    `C100\0outside\0${file}\0`, `C100\0${file}\0outside\0`,
    ...["D", "T", "M", "M071", "R", "C", "R101", "M101", "Rno", "Z"].map((status) => `${status}\0${file}\0`),
    `${valid}R100\0${file}\0outside\0`, `${valid}C100\0outside\0${file}\0`,
    `${valid}R100\0unrelated-source\0`, `${valid}M0000\0unrelated\0`,
  ];
  for (const body of invalid) assert.throws(() => seam.classify(body, file), /incomplete|invalid|unambiguously/);
  const actual = await verifyEvolutionLedger(f.root);
  assert.equal(actual.passed, true, "the classifier negatives do not hide a schema/reference failure in the native fixture");
});

test("later child failures keep current verification honest and publish no partial origin comparison", async (t) => {
  const f = await faithfulDag(t);
  const target = f.loaded[0];
  const ids = [f.originals.get(target.file), f.squash].sort();
  assert.equal((await verifyEvolutionLedger(f.root)).passed, true);
  const marker = "fixture-private-origin-diagnostic";
  const isBody = (args, id) => args[0] === "show" && args[1] === `${id}:${target.file}`;
  const isMetadata = (args, id) => args[0] === "show" && args.includes("--no-patch") && args.includes(id);
  const isDiff = (args, id) => args[0] === "diff-tree" && args.includes(id);
  const transportFailure = (code = "ENOENT") => Object.assign(new Error(marker), { code, stderr: marker, stdout: "" });
  const faults = [
    { name: "supplemental-history-spawn", when: (args) => args[0] === "log" && args.includes("--diff-merges=separate"), fail: () => { throw transportFailure(); }, noBody: true },
    { name: "supplemental-history-lifecycle", when: (args) => args[0] === "log" && args.includes("--diff-merges=separate"), output: (value) => `${value.stdout}D\t${target.file}\n`, noBody: true },
    { name: "supplemental-history-other-introduction", when: (args) => args[0] === "log" && args.includes("--diff-merges=separate"), output: (value) => value.stdout.replace(ids[1], f.head), noBody: true },
    { name: "topology-operational-exit-one", when: (args) => args[0] === "merge-base", fail: () => { throw transportFailure(1); }, noBody: true },
    { name: "first-body-invalid-json", when: (args) => isBody(args, ids[0]), output: () => "{" },
    { name: "second-body-invalid-json", when: (args) => isBody(args, ids[1]), output: () => "{", repeat: true },
    { name: "second-body-output-cap", when: (args) => isBody(args, ids[1]), fail: () => { throw transportFailure("ERR_CHILD_PROCESS_STDIO_MAXBUFFER"); } },
    { name: "second-body-timeout", when: (args) => isBody(args, ids[1]), fail: () => { throw Object.assign(transportFailure(), { killed: true, signal: "SIGTERM" }); } },
    { name: "deadline-after-first-body", when: (args) => isBody(args, ids[0]), deadline: true },
    { name: "second-metadata-warning-suffix", when: (args) => isMetadata(args, ids[1]), output: (value) => `${value.stdout}${marker}`, noBody: true, repeat: true },
    { name: "second-full-diff-warning", when: (args) => isDiff(args, ids[1]), warning: true, noBody: true },
    { name: "deadline-after-first-introduction-metadata", when: (args) => isMetadata(args, ids[0]), deadline: true, noBody: true },
  ];
  for (const [name, value] of [["empty", ""], ["one-input", `${ids[0]}\n`], ["duplicate", `${ids[0]}\n${ids[0]}\n`],
    ["unknown", `${ids[0]}\n${f.head}\n`], ["malformed", `${ids[0]}\nnot-a-commit\n`], ["third-token", `${ids.join("\n")}\n${f.head}\n`]]) {
    faults.push({ name: `topology-${name}`, when: (args) => args[0] === "merge-base", output: () => value, noBody: true, repeat: name === "one-input" });
  }
  for (const id of ids) {
    for (const [stage, predicate] of [["metadata", isMetadata], ["full-diff", isDiff]]) {
      for (const mode of ["missing-object", "output-cap", "timeout"]) faults.push({
        name: `${stage}-${id.slice(0, 8)}-${mode}`, when: (args) => predicate(args, id), noBody: true,
        fail: () => { throw mode === "timeout" ? Object.assign(transportFailure(), { killed: true, signal: "SIGTERM" })
          : transportFailure(mode === "output-cap" ? "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" : 128); },
      });
    }
  }
  for (const [name, replace] of [
    ["wrong-commit", (body) => body.replace(ids[1], f.head)],
    ["missing-terminal-lf", (body) => body.slice(0, -1)],
    ["extra-nul-field", (body) => `${body}\0${marker}`],
    ["missing-nul", (body) => body.replace(/\0(?=\n$)/u, "")],
    ["duplicate-parent", () => `${ids[1]}\0${f.parents(ids[1])[0]} ${f.parents(ids[1])[0]}\0\n`],
    ["trailing-parent-space", () => `${ids[1]}\0${f.parents(ids[1])[0]} \0\n`],
    ["leading-parent-space", () => `${ids[1]}\0 ${f.parents(ids[1])[0]}\0\n`],
    ["non-hex-parent", () => `${ids[1]}\0malformed-parent\0\n`],
  ]) faults.push({ name: `metadata-${name}`, when: (args) => isMetadata(args, ids[1]), output: (value) => replace(value.stdout), noBody: true });
  for (const [name, body] of [
    ["target-copy", `C100\0older-outside\0${target.file}\0`], ["target-type", `T\0${target.file}\0`],
    ["duplicate-target", `A\0${target.file}\0A\0${target.file}\0`],
    ["late-partial-frame", `A\0${target.file}\0R100\0outside\0`],
  ]) faults.push({ name: `full-diff-${name}`, when: (args) => isDiff(args, ids[1]), output: () => body, noBody: true });

  const operation = async (fault, asVerifier = false, knockout) => {
    let activeFile;
    let triggered = false;
    let clock = 0;
    const seam = await observerAtChildSeam(f.root, async (args, native) => {
      if (args[0] === "log") activeFile = args.at(-1);
      if (activeFile !== target.file || !fault.when(args)) return native();
      triggered = true;
      if (fault.fail) return fault.fail();
      const value = await native();
      if (fault.deadline) clock = 31000;
      return { ...value, stdout: fault.output ? fault.output(value) : value.stdout, stderr: fault.warning ? marker : value.stderr };
    }, { ...(fault.deadline ? { clock: () => clock } : {}), knockout });
    const result = asVerifier ? await (await verifierAtOriginSeam(seam.observer))(f.root)
      : await seam.observer(f.root, [target]);
    assert.equal(triggered, true, `${fault.name} must reach the actual faulted owner`);
    if (fault.noBody) assert.equal(seam.calls.some((call) => ids.some((id) => isBody(call.args, id))), false, "both introduction inspections precede every original JSON read");
    assert.ok(seam.calls.length <= (asVerifier ? 96 : 16), "failure ends the owned record sequence; it never expands a child budget");
    return result;
  };
  for (const fault of faults) await t.test(fault.name, async () => {
    assertUninspected(await operation(fault), target.file, marker);
    const verdict = await operation(fault, true);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.immutability.claimMutations, 0);
    assert.equal(verdict.immutability.bindingRepairs, 0);
    assert.ok(verdict.issues.length > 0 && verdict.issues.length <= 7);
    assert.ok(verdict.issues.every((issue) => issue.includes("ledger origin inspection failed")));
    assert.equal(JSON.stringify(verdict).includes(marker), false);
    if (fault.repeat) {
      const burst = await Promise.all(Array.from({ length: 8 }, () => operation(fault)));
      burst.forEach((result) => assertUninspected(result, target.file, marker));
      burst[0].failures.length = 0;
      for (let iteration = 0; iteration < 16; iteration += 1) assertUninspected(await operation(fault), target.file, marker);
    }
  });
  const secondBody = faults.find((fault) => fault.name === "second-body-invalid-json");
  const noFailureIssue = await operation(secondBody, true, (source) => source.replace(
    "failures.push(`${origin.id} ledger origin inspection failed; authored provenance is unavailable or inconsistent`);", "",
  ));
  assert.equal(noFailureIssue.passed, true, "removing the actual later failure issue creates a strict-valid verifier false pass");
});

test("shallow two-origin history and independently copied legacy contracts cannot supply a convenient origin", async (t) => {
  const f = await faithfulDag(t);
  const target = f.loaded[0];
  const shallow = await observerAtChildSeam(f.root, async (args, native) => args.includes("--is-shallow-repository")
    ? { stdout: "true\n", stderr: "" } : native());
  const incomplete = await shallow.observer(f.root, [target]);
  assertUninspected(incomplete, target.file);
  assert.equal(shallow.calls.some((call) => call.args[0] === "show"), false);
  const verify = await verifierAtOriginSeam((await observerAtChildSeam(f.root, async (args, native) => args.includes("--is-shallow-repository")
    ? { stdout: "true\n", stderr: "" } : native())).observer);
  const verdict = await verify(f.root);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.issues.length, 7);
  assert.ok(verdict.issues.every((issue) => issue.includes("ledger origin inspection failed")));
  const legacy = JSON.parse(execFileSync("git", ["show", `${originalCommit}:${historicalFile}`], { cwd: repositoryRoot, encoding: "utf8" }));
  for (const mixed of [false, true]) {
    const file = "evolution/assumptions/asm-dag-copied-legacy.json";
    const a = f.commit([f.base], { [file]: f.json(legacy) }, "one independently copied old claim");
    const b = f.commit([f.base], { [file]: f.json(mixed ? { ...legacy, dimensionsTested: ["a later proposed scope"] } : legacy) }, "another independent claim cannot provide a selected old contract");
    const head = f.commit([a, b], { [file]: f.json(legacy) }, "retain an unscoped endpoint without choosing an old schema");
    f.checkout(head);
    const owner = await observerAtChildSeam(f.root);
    const result = await owner.observer(f.root, [{ file, record: legacy }]);
    assertUninspected(result, file);
    assert.equal(result.origins[0].readSchema, undefined);
    assert.equal(result.origins[0].originalSchemaSha256, null);
    assert.equal(owner.calls.some((call) => call.args[0] === "show" || call.args[0] === "merge-base" || call.args[0] === "diff-tree"), false, "multiple old origins fail before any schema or convenient ancestry may be selected");
  }
});
