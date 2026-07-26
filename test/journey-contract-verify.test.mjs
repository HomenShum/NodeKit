import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyJourneyContract } from "../src/lib/journey-contract-verify.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The contract said "never hand-edit a check to true" and then eleven of twelve were hand-edited to
// true, by the party being graded, with nothing reading the file. A rule nothing enforces is a note.
// These tests make the enforcement real: the contract's claims must match what evidence derives.
// @nodekit-verifies inv:journey-contract-self-verifies#claims-match-evidence
test("every claim in the committed contract is independently derivable from evidence on disk", async () => {
  const verdict = await verifyJourneyContract(REPO);
  assert.equal(verdict.schemaVersion, "nodekit.journey-contract-verdict/v1");

  const overclaimed = verdict.checks.filter((c) => c.claimed && !c.derived);
  assert.deepEqual(
    overclaimed.map((c) => c.id),
    [],
    `claimed true but not derivable: ${overclaimed.map((c) => c.id).join(", ")}. Either the evidence is missing or the claim is false.`,
  );
  assert.equal(verdict.counts.disagreements, 0);
  assert.equal(verdict.passed, true);

  // Every derived-true check must NAME its evidence. A pass with no evidence is the failure mode.
  for (const check of verdict.checks.filter((c) => c.derived)) {
    assert.ok(check.evidence, `${check.id} derived true but named no evidence`);
  }
});

// THE structural property. If this can ever be derived true, the checker has become the thing it
// was built to prevent.
// @nodekit-verifies inv:journey-contract-self-verifies#independence-never-self-granted
test("independent evaluation can never be granted by this repository's own checker", async () => {
  const verdict = await verifyJourneyContract(REPO);
  const independent = verdict.checks.find((c) => c.id === "independently.evaluated");
  assert.ok(independent, "the contract must still carry the independence check");
  assert.equal(independent.derived, false, "independence must never derive true");
  assert.equal(independent.claimed, false, "and must not be claimed either");
  assert.match(independent.unattainable, /launder|independent review/i, "it must say WHY it is underivable");
});

// Adversarial: flip a check to true with the evidence removed. The verifier must catch it.
// This is the exact edit the contract forbids and nothing previously detected.
// @nodekit-verifies inv:journey-contract-self-verifies#overclaim-is-caught
test("a check hand-set to true without its evidence is reported as an overclaim", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-contract-"));
  await mkdir(path.join(root, "harness", "journey"), { recursive: true });
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "src", "cli.mjs"), "// no tour here\n");

  // Claim two things that have no evidence in this fixture at all.
  await writeFile(
    path.join(root, "harness", "journey", "journey-contract.json"),
    JSON.stringify({
      schemaVersion: "nodekit.journey-contract/v1",
      contractId: "fixture",
      checks: [
        { id: "tour.executable", claim: "x", passes: true, evidence: "trust me" },
        { id: "vocabulary.mapped", claim: "x", passes: true, evidence: "trust me" },
        { id: "independently.evaluated", claim: "x", passes: false, evidence: null },
      ],
    }),
  );

  const verdict = await verifyJourneyContract(root);
  assert.equal(verdict.passed, false, "a contract claiming unevidenced passes must not pass");
  assert.equal(verdict.counts.overclaimed, 2);
  const ids = verdict.checks.filter((c) => c.claimed && !c.derived).map((c) => c.id).sort();
  assert.deepEqual(ids, ["tour.executable", "vocabulary.mapped"]);
  await rm(root, { recursive: true, force: true });
});

// The glossary check must test the terms the BASELINE recorded, not an easier list chosen later.
// Otherwise the gate drifts to whatever is convenient once the answer is known.
// @nodekit-verifies inv:journey-contract-self-verifies#glossary-bound-to-baseline
test("the glossary check is bound to the terms the baseline actually recorded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-contract-g-"));
  await mkdir(path.join(root, "harness", "journey"), { recursive: true });
  await writeFile(path.join(root, "src-placeholder"), "");
  await writeFile(
    path.join(root, "harness", "journey", "baseline-2026-07-24.json"),
    JSON.stringify({ friction: [{ id: "F2", observed: "Terms appear: alpha-term, beta-term." }], notRepaired: true }),
  );
  await writeFile(path.join(root, "GLOSSARY.md"), "# Glossary\n\nalpha-term means something.\n");
  await writeFile(
    path.join(root, "harness", "journey", "journey-contract.json"),
    JSON.stringify({ schemaVersion: "nodekit.journey-contract/v1", contractId: "g", checks: [{ id: "glossary.covers-undefined-terms", claim: "x", passes: true, evidence: null }] }),
  );

  const verdict = await verifyJourneyContract(root);
  const g = verdict.checks[0];
  assert.equal(g.derived, false, "one of two baseline terms is undefined, so the check must not derive true");
  assert.match(g.evidence, /beta-term/, "it must name which term is missing");
  await rm(root, { recursive: true, force: true });
});
