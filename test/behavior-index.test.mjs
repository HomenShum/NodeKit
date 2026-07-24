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
