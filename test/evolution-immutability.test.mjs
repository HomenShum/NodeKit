import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeMutations, detectLedgerMutations } from "../src/lib/evolution-immutability.mjs";

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

const authoredFile = "evolution/assumptions/asm-strong-model-infers-topology.json";
const authoredCommit = "5b9c4d73";
async function authoredFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authored-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", path.resolve("."), root], { stdio: "ignore" });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Authored contract fixture");
  const original = JSON.parse(git("show", `${authoredCommit}:${authoredFile}`));
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

test("a new unmeasured record and a deleted then reintroduced path cannot use an old authored contract", async (t) => {
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
});

test("burst and sustained release reads do not accumulate or share historical qualifications", async (t) => {
  const f = await authoredFixture(t);
  const loaded = [{ file: authoredFile, record: f.original }];
  const burst = await Promise.all(Array.from({ length: 4 }, () => detectLedgerMutations(f.root, loaded)));
  for (const result of burst) assert.equal((result.historicalQualifications ?? []).length, 1);
  burst[0].historicalQualifications[0].currentDimensionsCertified = true;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const result = await detectLedgerMutations(f.root, loaded);
    assert.equal((result.historicalQualifications ?? []).length, 1);
    assert.equal(result.historicalQualifications[0].currentDimensionsCertified, false);
    assert.deepEqual(describeMutations(result).issues, []);
  }
});
