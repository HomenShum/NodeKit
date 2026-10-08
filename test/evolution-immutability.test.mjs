import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, realpath, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeMutations, detectLedgerMutations } from "../src/lib/evolution-immutability.mjs";

// evolution/ledger.json declares mutation: "append-or-supersede". That rule was enforced only
// inside recordEvolutionEvent, which nothing writes evidence through, so a committed record could
// be edited from result "partial" to "pass" and `evolution verify` still returned EVOLUTION PASS.
// These tests make the enforcement real on the path people actually use: the file on disk.

// These are exclusively owned local fixtures, not a hostile-filesystem sandbox.
async function cleanupFixture(root, prefix) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  assert.equal(path.dirname(relative), ".");
  assert.ok(path.basename(relative).startsWith(prefix));
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(await realpath(root), path.join(await realpath(os.tmpdir()), relative));
  await rm(root, { recursive: true, force: true });
}

/** A throwaway repo with one committed evidence record. */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-immutable-"));
  t.after(() => cleanupFixture(root, "nodekit-immutable-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
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
  return { root, file, record };
}

// @nodekit-verifies inv:ledger-records-are-immutable#claim-edit-is-caught
test("editing a committed record's claim is reported as a mutation", async (t) => {
  const f = await fixture(t);
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
});

// The motivating case. Comparing against HEAD instead of disk would miss this entirely, because an
// uncommitted edit leaves HEAD untouched — and verify reports on the bytes on disk.
// @nodekit-verifies inv:ledger-records-are-immutable#uncommitted-edit-is-caught
test("an uncommitted edit is caught, because verify reports on the bytes on disk", async (t) => {
  const f = await fixture(t);
  const edited = { ...f.record, result: "pass" };
  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: edited }]);
  assert.equal(found.mutations.length, 1, "nothing was committed, and it must still be caught");
});

// A record cannot name the sha of the commit that will contain it, so the pointer is repaired
// after the fact by construction. Commit d3229a01 in this repository did exactly that and changed
// nothing else. Blocking it would block honest work.
// @nodekit-verifies inv:ledger-records-are-immutable#binding-repair-is-allowed
test("repairing a binding is allowed and reported separately from a claim change", async (t) => {
  const f = await fixture(t);
  const rebound = { ...f.record, sha256: "c".repeat(64), artifactRef: "git:" + "1".repeat(40) + ":a.md" };

  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: rebound }]);
  assert.equal(found.mutations.length, 0, "a binding repair is not a claim change");
  assert.equal(found.bindingRepairs.length, 1);

  const { issues, warnings } = describeMutations(found);
  assert.deepEqual(issues, [], "and must not block");
  assert.match(warnings[0], /binding repaired/);
});

// @nodekit-verifies inv:ledger-records-are-immutable#unchanged-is-silent
test("an untouched record produces neither an issue nor a warning", async (t) => {
  const f = await fixture(t);
  const found = await detectLedgerMutations(f.root, [{ file: f.file, record: f.record }]);
  assert.equal(found.checked, 1);
  assert.equal(found.mutations.length, 0);
  assert.equal(found.bindingRepairs.length, 0);
});

// "Nothing detected" and "nothing looked" must never read the same. Outside a git repository there
// is no revision to compare against, and reporting a clean pass would be the exact false-confidence
// this check exists to remove.
// @nodekit-verifies inv:ledger-records-are-immutable#no-git-is-not-a-pass
test("without git, the check reports that it could not look rather than passing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-nogit-"));
  t.after(() => cleanupFixture(root, "nodekit-nogit-"));
  const found = await detectLedgerMutations(root, [{ file: "evolution/evidence/evd-x.json", record: { id: "evd:x" } }]);
  assert.equal(found.gitAvailable, false);
  assert.equal(found.checked, 0);

  const { issues, warnings } = describeMutations(found);
  assert.deepEqual(issues, [], "absence of git is not a violation");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /NOT checked/, "but it must say it did not look");
});

const authoredFile = "evolution/assumptions/asm-strong-model-infers-topology.json";
const authoredCommit = "5b9c4d73";
async function authoredFixture(t, { shallow = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authored-contract-"));
  t.after(() => cleanupFixture(root, "nodekit-authored-contract-"));
  const nativeOptions = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 2 * 1024 * 1024 };
  const original = JSON.parse(execFileSync("git", ["show", `${authoredCommit}:${authoredFile}`], { ...nativeOptions, cwd: path.resolve(".") }));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", ...(shallow ? ["--depth=1", "--no-local"] : []), path.resolve("."), root], { ...nativeOptions, timeout: 30000 });
  const git = (...args) => execFileSync("git", args, { ...nativeOptions, cwd: root }).trim();
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Authored contract fixture");
  await writeFile(path.join(root, authoredFile), `${JSON.stringify(original, null, 2)}\n`);
  return { root, git, original };
}

test("a maintainer reads unchanged historical authorship without certifying unmeasured current dimensions", async (t) => {
  const f = await authoredFixture(t);
  const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
  assert.equal(found.mutations.length, 0);
  assert.equal((found.historicalQualifications ?? []).length, 1);
  const qualification = found.historicalQualifications[0];
  assert.equal(qualification.currentDimensionsCertified, false);
  assert.equal(qualification.originalSchemaSha256, "4d2998bf89b4eb2c1caf3cf5b2a95b600f68ed1565b0cb87a4aca2837526922f");
  assert.match(qualification.introducedIn, /^5b9c4d73/);
  assert.match(qualification.observedHead, /^[a-f0-9]{40}$/);
  assert.deepEqual(describeMutations(found).issues, []);
});

test("a later author cannot borrow historical provenance to rewrite a claim or fabricate dimensions", async (t) => {
  const f = await authoredFixture(t);
  for (const change of [
    { status: "supported" },
    { statement: `${f.original.statement} It now applies everywhere.` },
    { dimensionsTested: ["a later invented axis"] },
    { introducedIn: authoredCommit, legacy: true },
  ]) {
    await writeFile(path.join(f.root, authoredFile), `${JSON.stringify({ ...f.original, ...change }, null, 2)}\n`);
    const record = JSON.parse(await readFile(path.join(f.root, authoredFile), "utf8"));
    const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record }]);
    assert.equal((found.historicalQualifications ?? []).length, 0);
    assert.equal(found.mutations.length, 1);
    assert.match(describeMutations(found).issues.join("\n"), /append-or-supersede/);
  }
});

test("new, reintroduced, and moved paths cannot borrow an old authored contract", async (t) => {
  const f = await authoredFixture(t);
  const newFile = "evolution/assumptions/asm-new-unmeasured.json";
  const record = { ...f.original, id: "asm:new-unmeasured" };
  await writeFile(path.join(f.root, newFile), `${JSON.stringify(record, null, 2)}\n`);
  f.git("add", newFile);
  f.git("commit", "-qm", "new authored claim still owes current dimensions");
  let found = await detectLedgerMutations(f.root, [{ file: newFile, record }]);
  assert.equal((found.historicalQualifications ?? []).length, 0);
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  assert.ok((await validateSchema("nodekit.assumption.v1.schema.json", record, record.id)).length > 0);

  await rm(path.join(f.root, authoredFile));
  f.git("add", authoredFile);
  f.git("commit", "-qm", "remove the original path in fixture");
  await writeFile(path.join(f.root, authoredFile), `${JSON.stringify(f.original, null, 2)}\n`);
  f.git("add", authoredFile);
  f.git("commit", "-qm", "reintroduce bytes without continuous authored provenance");
  found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
  assert.equal((found.historicalQualifications ?? []).length, 0);

  const movedFile = "evolution/assumptions/asm-moved-history.json";
  f.git("mv", authoredFile, movedFile);
  f.git("commit", "-qm", "a moved path cannot borrow its former location's provenance");
  found = await detectLedgerMutations(f.root, [{ file: movedFile, record: f.original }]);
  assert.equal(found.historicalQualifications.length, 0);
  assert.ok((await validateSchema("nodekit.assumption.v1.schema.json", f.original, f.original.id)).length > 0);
});

test("burst and sustained release reads do not accumulate or share historical qualifications", async (t) => {
  const fixtures = [];
  for (let index = 0; index < 4; index += 1) fixtures.push(await authoredFixture(t));
  const burst = await Promise.all(fixtures.map((f) => detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }])));
  for (const result of burst) assert.equal((result.historicalQualifications ?? []).length, 1);
  burst[0].historicalQualifications[0].currentDimensionsCertified = true;
  for (const result of burst.slice(1)) assert.equal(result.historicalQualifications[0].currentDimensionsCertified, false);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const f = fixtures[iteration % fixtures.length];
    const result = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
    assert.equal((result.historicalQualifications ?? []).length, 1);
    assert.equal(result.historicalQualifications[0].currentDimensionsCertified, false);
    assert.deepEqual(describeMutations(result).issues, []);
  }
});

test("a shallow release checkout cannot silently qualify historical measurements", async (t) => {
  const f = await authoredFixture(t, { shallow: true });
  assert.equal(f.git("rev-parse", "--is-shallow-repository"), "true");
  const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
  assert.equal(found.historicalQualifications.length, 0);
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  assert.ok((await validateSchema("nodekit.assumption.v1.schema.json", f.original, f.original.id)).length > 0);
});

test("a checkout outside the measured-contract epoch still owes the current measurement contract", async (t) => {
  const f = await authoredFixture(t);
  f.git("restore", "--", authoredFile);
  f.git("checkout", "--quiet", "--detach", authoredCommit);
  const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
  assert.equal(found.checked, 1);
  assert.equal(found.historicalQualifications.length, 0);
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  assert.ok((await validateSchema("nodekit.assumption.v1.schema.json", f.original, f.original.id)).length > 0);
});

test("a broken native Git context is an inspection failure rather than an unchecked clean pass", async (t) => {
  const f = await authoredFixture(t);
  const configFile = path.resolve(f.root, f.git("rev-parse", "--git-path", "config"));
  assert.ok(configFile.startsWith(`${path.resolve(f.root)}${path.sep}`));
  await writeFile(configFile, "[invalid native config\n");
  const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: f.original }]);
  assert.equal(found.gitAvailable, false);
  assert.equal(found.checked, 0);
  assert.equal(found.historicalQualifications.length, 0);
  assert.ok(describeMutations(found).issues.length > 0);
  assert.deepEqual(describeMutations(found).warnings, []);
});

test("replacement objects cannot manufacture historical qualification for an edited claim", async (t) => {
  const f = await authoredFixture(t);
  const edited = { ...f.original, statement: "A fixture author tries to replace the recorded claim" };
  await writeFile(path.join(f.root, authoredFile), `${JSON.stringify(edited, null, 2)}\n`);
  const originalBlob = f.git("rev-parse", `${authoredCommit}:${authoredFile}`);
  const replacementBlob = f.git("hash-object", "-w", authoredFile);
  f.git("replace", originalBlob, replacementBlob);
  assert.deepEqual(JSON.parse(f.git("show", `${authoredCommit}:${authoredFile}`)), edited, "the adversarial native view really is altered");

  const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: edited }]);
  assert.equal(found.historicalQualifications.length, 0);
  assert.equal(found.mutations.length, 1);
  assert.ok(describeMutations(found).issues.length > 0);
});

test("an inherited graft file cannot hide the committed claim mutation by truncating its origin", async (t) => {
  const f = await authoredFixture(t);
  const current = { ...f.original, dimensionsTested: ["fixture-only invented axis"] };
  await writeFile(path.join(f.root, authoredFile), `${JSON.stringify(current, null, 2)}\n`);
  f.git("add", "--", authoredFile);
  f.git("commit", "-qm", "fixture commits fabricated dimensions");
  const head = f.git("rev-parse", "HEAD");
  const graftFile = path.join(f.root, "adversarial-graft.txt");
  await writeFile(graftFile, `${head}\n`);
  const previous = process.env.GIT_GRAFT_FILE;
  process.env.GIT_GRAFT_FILE = graftFile;
  try {
    assert.equal(f.git("log", "--diff-filter=A", "--format=%H", "HEAD", "--", authoredFile), head, "the adversarial native view truncates this record's history");
    const found = await detectLedgerMutations(f.root, [{ file: authoredFile, record: current }]);
    assert.equal(found.historicalQualifications.length, 0);
    assert.equal(found.mutations.length, 1);
    assert.ok(found.mutations[0].claimChanges.some((change) => change.path === "dimensionsTested"));
  } finally {
    if (previous === undefined) delete process.env.GIT_GRAFT_FILE;
    else process.env.GIT_GRAFT_FILE = previous;
  }
});

test("a release agent cannot start an unbounded origin-inspection collection", async () => {
  const loaded = Array.from({ length: 2049 }, () => ({ file: authoredFile, record: { id: "asm:too-many" } }));
  await assert.rejects(() => detectLedgerMutations(path.resolve("."), loaded), /exceeds 2048 records/);
});
