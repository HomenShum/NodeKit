import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildBehaviorIndex } from "../src/lib/behavior-index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture({ manifest, src = {}, tests = {} }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-behavior-"));
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "nodekit.yaml"), manifest, "utf8");
  for (const [name, body] of Object.entries(src)) await writeFile(path.join(root, "src", "lib", name), body, "utf8");
  for (const [name, body] of Object.entries(tests)) await writeFile(path.join(root, "test", name), body, "utf8");
  return root;
}

const MANIFEST = `schemaVersion: nodekit.repo/v1
behaviors:
  billing.invoice.issue:
    statement: An authorized user can issue one invoice.
    requiredScenarios:
      - invoice-is-created
      - duplicate-is-rejected
`;

// Persona: an engineer asked to fix a bug in billing. The question they need answered in seconds is
// "which code owns this, and what proves it works". Receipts answer "did this artifact pass"; the
// evolution ledger answers "why did this change". Neither answers ownership.
test("the index answers which code owns a behavior and which test proves each scenario", async () => {
  const root = await fixture({
    manifest: MANIFEST,
    src: {
      "billing.mjs": [
        "// @nodekit-behavior billing.invoice.issue owner",
        "export async function issueInvoice() {}",
        "// @nodekit-behavior billing.invoice.issue support",
        "export function formatInvoice() {}",
      ].join("\n"),
    },
    tests: {
      "billing.test.mjs": [
        "// @nodekit-verifies billing.invoice.issue#invoice-is-created",
        'test("creates one invoice", () => {});',
        "// @nodekit-verifies billing.invoice.issue#duplicate-is-rejected",
        'test("rejects a duplicate", () => {});',
      ].join("\n"),
    },
  });
  const index = await buildBehaviorIndex(root);
  const billing = index.behaviors[0];
  assert.equal(billing.implementationState, "mapped");
  assert.equal(billing.verificationState, "verified");
  // Ownership must resolve to a SYMBOL, not merely to a file. A file-level pointer sends the reader
  // hunting; the whole value is landing on the definition.
  assert.deepEqual(billing.owners, [{ file: "src/lib/billing.mjs", symbol: "issueInvoice", line: 1 }]);
  assert.equal(billing.supporting[0].symbol, "formatInvoice");
  assert.equal(billing.verifiedBy.length, 2);
  assert.deepEqual(billing.verificationGaps, []);
  await rm(root, { recursive: true, force: true });
});

// The index earns its keep by reporting absence, not presence. These are the states that must NOT
// be silently reported as healthy.
test("a declared behavior no code claims is reported unmapped rather than assumed present", async () => {
  const root = await fixture({ manifest: MANIFEST, src: {}, tests: {} });
  const billing = (await buildBehaviorIndex(root)).behaviors[0];
  assert.equal(billing.implementationState, "unmapped");
  assert.equal(billing.verificationState, "unverified");
  assert.match(billing.implementationGaps[0], /No source symbol claims ownership/);
  await rm(root, { recursive: true, force: true });
});

test("a behavior proved for only some of its required scenarios is partial, and names the missing one", async () => {
  const root = await fixture({
    manifest: MANIFEST,
    src: { "billing.mjs": "// @nodekit-behavior billing.invoice.issue owner\nexport function issueInvoice() {}" },
    tests: {
      "billing.test.mjs": '// @nodekit-verifies billing.invoice.issue#invoice-is-created\ntest("creates", () => {});',
    },
  });
  const billing = (await buildBehaviorIndex(root)).behaviors[0];
  assert.equal(billing.verificationState, "partial", "partial coverage must never read as verified");
  assert.equal(billing.verificationGaps.length, 1);
  assert.match(billing.verificationGaps[0], /duplicate-is-rejected/);
  await rm(root, { recursive: true, force: true });
});

// Drift in the other direction: code or tests claiming a behavior the contract does not declare.
// Silently ignoring these would let the map look complete while the repository disagrees with it.
test("annotations naming an undeclared behavior are surfaced as drift, not ignored", async () => {
  const root = await fixture({
    manifest: MANIFEST,
    src: {
      "billing.mjs": "// @nodekit-behavior billing.invoice.issue owner\nexport function issueInvoice() {}",
      "ghost.mjs": "// @nodekit-behavior billing.refund.issue owner\nexport function refund() {}",
    },
    tests: {
      "billing.test.mjs": [
        "// @nodekit-verifies billing.invoice.issue#invoice-is-created",
        'test("a", () => {});',
        "// @nodekit-verifies billing.invoice.issue#duplicate-is-rejected",
        'test("b", () => {});',
        "// @nodekit-verifies billing.invoice.issue#some-scenario-nobody-declared",
        'test("c", () => {});',
      ].join("\n"),
    },
  });
  const index = await buildBehaviorIndex(root);
  assert.equal(index.counts.orphanAnnotations, 1, "code owning an undeclared behavior must surface");
  assert.equal(index.orphanAnnotations[0].behaviorId, "billing.refund.issue");
  // A test proving a scenario the behavior never declared is also drift.
  assert.ok(index.behaviors[0].verificationGaps.some((g) => /some-scenario-nobody-declared/.test(g)));
  await rm(root, { recursive: true, force: true });
});

// Regression: the first version of this scanner counted annotations that merely APPEARED inside
// string literals, so a test fixture quoting an annotation was read as a real ownership claim. A
// map that counts quoted text as truth is how a map starts lying.
test("an annotation quoted inside a string literal is not counted as a real claim", async () => {
  const root = await fixture({
    manifest: MANIFEST,
    src: {
      "billing.mjs": "// @nodekit-behavior billing.invoice.issue owner\nexport function issueInvoice() {}",
      // The annotation here is DATA inside a string, not a comment. It must be ignored.
      "fixture-builder.mjs": 'export const sample = "// @nodekit-behavior billing.refund.issue owner";',
    },
    tests: {
      "billing.test.mjs": [
        "// @nodekit-verifies billing.invoice.issue#invoice-is-created",
        'test("a", () => {});',
        "// @nodekit-verifies billing.invoice.issue#duplicate-is-rejected",
        'test("b", () => {});',
        '  const quoted = "// @nodekit-verifies billing.ghost.behavior#not-real";',
      ].join("\n"),
    },
  });
  const index = await buildBehaviorIndex(root);
  assert.equal(index.counts.orphanAnnotations, 0, "quoted annotations must not register as claims");
  assert.equal(index.behaviors[0].verificationState, "verified");
  await rm(root, { recursive: true, force: true });
});

// The whole point of extending the index: "which code owns X" must be answerable for the REPOSITORY,
// not just for the handful of behaviours declared in the manifest. The Evolution Ledger already
// carries the repository's human-reviewed invariants, so they are the honest population to cover.
// @nodekit-verifies inv:ownership-resolves-to-symbol#every-invariant-owned
test("every ledger invariant resolves to an owning symbol, and the answer is a definition not a filename", async () => {
  const index = await buildBehaviorIndex(REPO);
  const coverage = index.invariantCoverage;
  assert.equal(coverage.available, true, "the ledger invariants must be readable");
  assert.ok(coverage.counts.total >= 18, "coverage should span the whole ledger");

  // The state this work existed to remove: an invariant nobody owns.
  assert.equal(coverage.counts.unowned, 0, "an invariant with no owner is an unanswerable 'who owns this'");
  assert.equal(
    coverage.counts.namedFileOnly,
    0,
    "naming a file is not ownership — it sends the reader hunting instead of landing on the definition",
  );

  for (const invariant of coverage.invariants) {
    assert.ok(invariant.owners.length > 0, `${invariant.invariantId} has no owner`);
    for (const owner of invariant.owners) {
      assert.ok(owner.symbol, `${invariant.invariantId} owner in ${owner.file} did not resolve to a symbol`);
    }
    assert.deepEqual(invariant.gaps, [], `${invariant.invariantId} still reports gaps`);
  }
});

// Ownership answers "who enforces this". It does NOT answer "what checks that they do". A verifierRef
// naming a test FILE says proof lives somewhere in there; the file can keep passing long after the
// assertion that mattered was deleted. Verification gets the same strictness as ownership.
// @nodekit-verifies inv:invariant-proof-is-bound#proof-bound-to-assertion
test("an invariant whose proof is only a test filename is reported as gestured at, not as verified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-proof-bind-"));
  await mkdir(path.join(root, "evolution", "invariants"), { recursive: true });
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "nodekit.yaml"), "schemaVersion: nodekit.repo/v1\n");
  const invariant = (id, refs) => JSON.stringify({
    schemaVersion: "nodekit.invariant-claim/v1", id, statement: "Something is guaranteed.", verifierRefs: refs,
  });
  await writeFile(path.join(root, "evolution", "invariants", "inv-gestured.json"),
    invariant("inv:gestured", ["src/lib/thing.mjs", "test/thing.test.mjs"]));
  await writeFile(path.join(root, "evolution", "invariants", "inv-bound.json"),
    invariant("inv:bound", ["src/lib/thing.mjs", "test/thing.test.mjs"]));
  await writeFile(path.join(root, "src", "lib", "thing.mjs"),
    "// @nodekit-behavior inv:gestured owner\n// @nodekit-behavior inv:bound owner\nexport function thing() {}");
  // Only ONE of the two invariants has a test that names it, though the same file is a verifierRef
  // for both. That is exactly the difference between proof and a gesture at proof.
  await writeFile(path.join(root, "test", "thing.test.mjs"),
    "// @nodekit-verifies inv:bound#the-scenario\ntest('proves the bound one', () => {});");

  const coverage = (await buildBehaviorIndex(root)).invariantCoverage;
  const gestured = coverage.invariants.find((i) => i.invariantId === "inv:gestured");
  const bound = coverage.invariants.find((i) => i.invariantId === "inv:bound");

  // Both are OWNED. Only one is PROVEN. Ownership must not be mistaken for verification.
  assert.equal(gestured.ownership, "annotated-symbol");
  assert.equal(bound.ownership, "annotated-symbol");

  assert.equal(gestured.verification, "named-test-file-only", "a filename is not an assertion");
  assert.match(gestured.gaps.join(" "), /gestured at/);
  assert.equal(bound.verification, "annotated-test");
  assert.equal(bound.provenBy[0].scenario, "the-scenario");

  assert.equal(coverage.counts.fullyBound, 1, "only the bound invariant completes the chain");
  assert.equal(coverage.counts.namedTestFileOnly, 1);
  await rm(root, { recursive: true, force: true });
});

// The repository's own chain must be complete: every invariant owned by a definition AND proven by
// a named assertion. This is the claim the whole index exists to support.
test("every ledger invariant in this repository is fully bound: a symbol owns it and an assertion proves it", async () => {
  const coverage = (await buildBehaviorIndex(REPO)).invariantCoverage;
  assert.equal(coverage.counts.namedTestFileOnly, 0, "a test filename is not proof of an invariant");
  assert.equal(coverage.counts.unverified, 0);
  assert.equal(
    coverage.counts.fullyBound,
    coverage.counts.total,
    "every invariant must have both an owning symbol and a proving assertion",
  );
  for (const invariant of coverage.invariants) {
    assert.ok(invariant.provenBy.length > 0, `${invariant.invariantId} has no proving assertion`);
    for (const proof of invariant.provenBy) {
      assert.ok(proof.scenario && proof.file.startsWith("test/"), `${invariant.invariantId} proof is not a real test scenario`);
    }
  }
});

// Rot in the ledger itself: an invariant may name a verifier file that has since been deleted or
// renamed. That is a silent lie — the ledger keeps asserting a guarantee whose proof is gone.
// @nodekit-verifies inv:ownership-resolves-to-symbol#verifier-rot-reported
test("an invariant pointing at a verifier file that no longer exists is reported, not ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-inv-rot-"));
  await mkdir(path.join(root, "evolution", "invariants"), { recursive: true });
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await writeFile(path.join(root, "nodekit.yaml"), "schemaVersion: nodekit.repo/v1\n");
  await writeFile(
    path.join(root, "evolution", "invariants", "inv-ghost.json"),
    JSON.stringify({
      schemaVersion: "nodekit.invariant-claim/v1",
      id: "inv:ghost",
      statement: "Something is guaranteed.",
      verifierRefs: ["src/lib/present.mjs", "test/deleted-long-ago.test.mjs#a-scenario"],
    }),
  );
  await writeFile(path.join(root, "src", "lib", "present.mjs"), "// @nodekit-behavior inv:ghost owner\nexport function present() {}");

  const coverage = (await buildBehaviorIndex(root)).invariantCoverage;
  const ghost = coverage.invariants[0];
  assert.equal(ghost.ownership, "annotated-symbol", "ownership is fine; the ROT is the missing verifier");
  assert.deepEqual(ghost.missingVerifierRefs, ["test/deleted-long-ago.test.mjs#a-scenario"]);
  assert.equal(coverage.counts.withMissingRefs, 1);
  // Order-independent: an invariant can carry several gaps at once (here it is also unproven), and
  // asserting on gaps[0] would break every time a new gap kind is added.
  assert.ok(ghost.gaps.some((gap) => /points at code that is gone/.test(gap)), "the rot must be named");

  // The `#scenario` anchor is not part of the path. Treating it as one would report every anchored
  // ref as rot — a false positive that would train readers to ignore the signal.
  assert.ok(!ghost.missingVerifierRefs.includes("src/lib/present.mjs"));
  await rm(root, { recursive: true, force: true });
});

// The real repository must stay honest, and the committed index must not be stale.
test("every behavior this repository declares is owned by a real symbol and the committed index is current", async () => {
  const index = await buildBehaviorIndex(REPO);
  assert.ok(index.counts.declared >= 4);
  assert.equal(index.counts.unmapped, 0, "a declared behavior with no owner is a real gap, not a test failure to paper over");
  for (const behavior of index.behaviors) {
    for (const owner of behavior.owners) {
      assert.ok(owner.symbol, `${behavior.behaviorId} owner in ${owner.file} did not resolve to a symbol`);
    }
  }
  const committed = JSON.parse(await readFile(path.join(REPO, "behavior-index.json"), "utf8"));
  assert.deepEqual(committed, index, "behavior-index.json is stale — run `npm run behavior:index`");
});
