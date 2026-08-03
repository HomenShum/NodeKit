// The BUILD-stage producer exists to close a specific gap: four stage schemas ship, and nothing
// writes a conforming artifact from a real repository — the chain only ever passed against
// hand-authored fixtures. These tests probe the producer the way its consumers will meet it:
// a build agent finishing the BUILD stage (happy path), a reviewer walking the chain with the
// fresh pack (integration), and the two dishonesty routes the schema was built to shut —
// silently honouring a decision, and citing evidence that does not exist.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BUILD_EVIDENCE_PACK_SCHEMA,
  BuildEvidenceRefusal,
  produceBuildEvidencePack,
} from "../src/lib/build-evidence-producer.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";
import { canonicalSha256, verifyJourneyChain } from "../src/lib/journey-chain-gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(REPO, "test/fixtures/builder-journey");
const CONTRACT = path.join(FIXTURES, "salon.opportunity-contract.json");
const CASE_ID = "salon-weekly-profit-2026-07";

// Canonical JSON per docs/JOURNEY_INTERSTAGE_CONTRACT.md, computed here INDEPENDENTLY of both the
// producer and the gate, so a digest agreement between the three is three implementations agreeing
// rather than one implementation quoted three times.
// The gate verifies with canonicalSha256. A hand-rolled second canonicalizer here would let this
// test agree with itself while disagreeing with the thing that actually decides PASS — the same
// dual-truth failure the chain contract exists to prevent. Use the shipped one.
const canonicalDigest = (value) => canonicalSha256(value);
const fileSha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const scratchDirs = [];
async function scratchDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "build-evidence-producer-"));
  scratchDirs.push(dir);
  return dir;
}
test.after(async () => {
  await Promise.all(scratchDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
});

function allDecisionEntries(pack) {
  const out = [];
  for (const value of Object.values(pack.content.decisions.contract)) {
    if (value.disposition) out.push(value);
    else if (Array.isArray(value.elements)) out.push(...value.elements);
    else for (const bucket of Object.values(value)) out.push(...bucket.elements);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Persona: the build agent finishing the BUILD stage of the salon journey. It has made no
// honoured-decision claims, so the only honest pack is all-defaulted with a written disclosure —
// and it must validate, bind the contract by canonical digest, and back every artifact with bytes.
// ---------------------------------------------------------------------------------------------
// @nodekit-verifies journey.build.produce-evidence#every-pointer-dispositioned-no-silent-honour
test("happy path: an unattended run produces a schema-valid, fully disclosed, byte-backed pack", async () => {
  const dir = await scratchDir();
  const outPath = path.join(dir, "salon.build-evidence-pack.json");
  const { pack, packPath } = await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath,
    caseId: CASE_ID,
  });
  assert.equal(packPath, outPath);

  // 1. Valid against the schema, via the shared validator (empty error array = valid).
  assert.deepEqual(await validateSchema(BUILD_EVIDENCE_PACK_SCHEMA, pack, "pack"), []);

  // 2. The written file and the returned object are the same document.
  const onDisk = JSON.parse(await readFile(outPath, "utf8"));
  assert.deepEqual(onDisk, pack);

  // 3. inputs[0] binds the contract by the canonical digest of what is actually on disk.
  const contract = JSON.parse(await readFile(CONTRACT, "utf8"));
  assert.equal(pack.inputs.length, 1);
  assert.equal(pack.inputs[0].schemaVersion, "nodekit.opportunity-contract/v1");
  assert.equal(pack.inputs[0].sha256, canonicalDigest(contract));

  // 4. Every decision-bearing pointer of the salon contract is reconciled: 6 scalars, 4 inputs,
  //    4 rejected alternatives, 3 open unknowns, and 4+2+0+5 authority entries = 28. None is
  //    silently honoured: with no caller evidence, every disposition is defaulted-with-disclosure
  //    and points at a disclosure artifact that exists.
  const entries = allDecisionEntries(pack);
  assert.equal(entries.length, 28);
  for (const entry of entries) {
    assert.equal(entry.disposition, "defaulted-with-disclosure", `${entry.pointer} must not be silently honoured`);
    assert.ok(entry.disclosure.length >= 12);
    assert.ok(entry.whyNotEscalated.length >= 12);
    assert.ok(pack.content.evidence.some((e) => e.evidenceId === entry.disclosedIn));
  }
  const counts = pack.content.decisions.contract;
  assert.equal(counts.inputs.declaredElementCount, 4);
  assert.equal(counts.rejectedAlternatives.declaredElementCount, 4);
  assert.equal(counts.openUnknowns.declaredElementCount, 3);
  assert.equal(counts.authorityLimits.approve.declaredElementCount, 0);
  assert.equal(counts.authorityLimits.prohibited.declaredElementCount, 5);

  // 5. Evidence is bytes, never booleans: every artifact resolves on disk with the exact digest
  //    and byte length the pack records.
  assert.ok(pack.content.evidence.length >= 3);
  for (const entry of pack.content.evidence) {
    const abs = path.isAbsolute(entry.artifact.path)
      ? entry.artifact.path
      : (await stat(path.join(REPO, entry.artifact.path)).catch(() => null))
        ? path.join(REPO, entry.artifact.path)
        : path.join(dir, entry.artifact.path);
    const bytes = await readFile(abs);
    assert.equal(fileSha256(bytes), entry.artifact.sha256, `${entry.evidenceId} digest must match the bytes at ${entry.artifact.path}`);
    assert.equal(bytes.byteLength, entry.artifact.byteLength);
  }

  // 6. The empty emergent array is backed by a sweep receipt naming a real command and exit code.
  assert.deepEqual(pack.content.decisions.emergent, []);
  const sweepRef = pack.content.decisions.emergentSweep.evidenceRefs[0];
  const sweepEvidence = pack.content.evidence.find((e) => e.evidenceId === sweepRef);
  assert.equal(sweepEvidence.kind, "command-output");
  assert.match(sweepEvidence.generatedBy.command, /git .*ls-files/);
  assert.equal(sweepEvidence.generatedBy.exitCode, 0);

  // 7. The honesty floor: promotion pinned false, notRun non-empty, refusals carry reasons.
  assert.equal(pack.content.promotionAuthorized, false);
  assert.ok(pack.completeness.notRun.length > 0, "an empty notRun is a claim this producer may not make");
  assert.ok(pack.completeness.refused.every((entry) => entry.reason.length >= 12));
});

// ---------------------------------------------------------------------------------------------
// Persona: a build agent that actually honoured a decision and can point at the file that shows
// it. The producer digests the real bytes and only then records "honoured".
// ---------------------------------------------------------------------------------------------
test("an honoured decision requires caller evidence, and gets its file digested from real bytes", async () => {
  const dir = await scratchDir();
  const evidenceFile = "src/lib/build-evidence-producer.mjs";
  const { pack } = await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath: path.join(dir, "pack.json"),
    caseId: CASE_ID,
    honoured: {
      "/wedge": {
        how: "The producer itself is read-only over the repository: it runs no write-back, opens no network connection, and its one external command is a file inventory.",
        sourceFiles: [evidenceFile],
      },
    },
  });
  assert.deepEqual(await validateSchema(BUILD_EVIDENCE_PACK_SCHEMA, pack, "pack"), []);
  const wedge = pack.content.decisions.contract.wedge;
  assert.equal(wedge.disposition, "honoured");
  const cited = pack.content.evidence.find((e) => e.evidenceId === wedge.evidenceRefs[0]);
  const bytes = await readFile(path.join(REPO, evidenceFile));
  assert.equal(cited.artifact.sha256, fileSha256(bytes));
  assert.equal(cited.artifact.byteLength, bytes.byteLength);
  // The other 27 pointers stay defaulted: honouring one is never honouring the rest.
  assert.equal(allDecisionEntries(pack).filter((e) => e.disposition === "honoured").length, 1);
});

// ---------------------------------------------------------------------------------------------
// Refusal path 1 — the unreconcilable contract. Persona: an agent pointed at a contract missing a
// decision field. Silently covering the gap would recreate trial 1; the producer must fail closed
// and write nothing.
// ---------------------------------------------------------------------------------------------
test("refusal: a contract field the producer cannot reconcile fails closed and writes no pack", async () => {
  const dir = await scratchDir();
  const contract = JSON.parse(await readFile(CONTRACT, "utf8"));
  delete contract.wedge;
  const brokenContract = path.join(dir, "broken.opportunity-contract.json");
  await writeFile(brokenContract, JSON.stringify(contract, null, 2), "utf8");
  const outPath = path.join(dir, "pack.json");

  await assert.rejects(
    produceBuildEvidencePack({ repoRoot: REPO, contractPath: brokenContract, outPath, caseId: CASE_ID }),
    (error) => {
      assert.ok(error instanceof BuildEvidenceRefusal);
      assert.ok(error.refusals.some((entry) => entry.includes("/wedge")), "the refusal must name the missing field");
      return true;
    },
  );
  await assert.rejects(stat(outPath), "a refused pack must leave no file behind");
});

// ---------------------------------------------------------------------------------------------
// Refusal path 2 — fabricated evidence. Persona: an agent (or a bug) citing a file that does not
// exist, or trying to honour without evidence at all. Both silent-honour routes must be closed,
// and a tampered evidence path must fail schema validation downstream.
// ---------------------------------------------------------------------------------------------
// @nodekit-verifies journey.build.produce-evidence#fabricated-evidence-refuses-the-pack
test("refusal: honouring without evidence, or with a nonexistent file, never silently succeeds", async () => {
  const dir = await scratchDir();
  const outPath = path.join(dir, "pack.json");

  await assert.rejects(
    produceBuildEvidencePack({
      repoRoot: REPO,
      contractPath: CONTRACT,
      outPath,
      caseId: CASE_ID,
      honoured: { "/wedge": { how: "This was honoured, trust the prose.", sourceFiles: [] } },
    }),
    (error) => error instanceof BuildEvidenceRefusal && error.refusals.some((r) => r.includes("no source files")),
  );

  await assert.rejects(
    produceBuildEvidencePack({
      repoRoot: REPO,
      contractPath: CONTRACT,
      outPath,
      caseId: CASE_ID,
      honoured: {
        "/wedge": { how: "Cites a file that has never existed anywhere.", sourceFiles: ["src/lib/does-not-exist.mjs"] },
      },
    }),
    (error) =>
      error instanceof BuildEvidenceRefusal &&
      error.refusals.some((r) => r.includes("does-not-exist.mjs") && r.includes("fabricated")),
  );

  // A pointer the contract never had is also refused: evidence for an invented decision.
  await assert.rejects(
    produceBuildEvidencePack({
      repoRoot: REPO,
      contractPath: CONTRACT,
      outPath,
      caseId: CASE_ID,
      honoured: { "/pricing": { how: "The contract never made this decision.", sourceFiles: ["src/cli.mjs"] } },
    }),
    (error) => error instanceof BuildEvidenceRefusal && error.refusals.some((r) => r.includes("/pricing")),
  );

  await assert.rejects(stat(outPath), "no refusal variant may leave a pack behind");
});

test("a fabricated evidence path smuggled into a produced pack is rejected by the schema", async () => {
  const dir = await scratchDir();
  const { pack } = await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath: path.join(dir, "pack.json"),
    caseId: CASE_ID,
  });
  for (const forged of ["../outside-the-repo.log", "C:/Windows/evil.log", "/etc/passwd"]) {
    const tampered = JSON.parse(JSON.stringify(pack));
    tampered.content.evidence[0].artifact.path = forged;
    const errors = await validateSchema(BUILD_EVIDENCE_PACK_SCHEMA, tampered, "pack");
    assert.ok(errors.length > 0, `evidence path "${forged}" must not validate`);
  }
});

// ---------------------------------------------------------------------------------------------
// Persona: a reviewer walking the whole journey with the FRESH pack in place of the fixture one.
// The committed fixtures are copied to scratch and re-bound (replacing the BuildEvidencePack
// changes its digest, so downstream inputs[].sha256 must be recomputed in topological order);
// the committed chain itself is never touched. The gate — a separate module the producer does not
// consult — must walk the result end to end.
// ---------------------------------------------------------------------------------------------
// @nodekit-verifies journey.build.produce-evidence#produced-pack-walks-the-chain
test("the produced pack chains: rebound downstream fixtures walk PASS through the gate", async () => {
  const dir = await scratchDir();
  await copyFile(CONTRACT, path.join(dir, "salon.opportunity-contract.json"));
  await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath: path.join(dir, "salon.build-evidence-pack.json"),
    caseId: CASE_ID,
  });

  const digests = new Map();
  for (const [name, schemaVersion] of [
    ["salon.opportunity-contract.json", "nodekit.opportunity-contract/v1"],
    ["salon.build-evidence-pack.json", "nodekit.build-evidence-pack/v1"],
  ]) {
    digests.set(schemaVersion, canonicalDigest(JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  }
  for (const [name, schemaVersion] of [
    ["salon.story-pack.json", "nodekit.story-pack/v1"],
    ["salon.launch-manifest.json", "nodekit.launch-manifest/v1"],
    ["salon.observation-pack.json", "nodekit.observation-pack/v1"],
  ]) {
    const doc = JSON.parse(await readFile(path.join(FIXTURES, name), "utf8"));
    // Rebind only what this chain actually reproduced. Nulling an unrecognised binding turns a
    // fixture that was already consistent into a broken one, and the resulting FAIL looks like a
    // gate finding rather than a test defect.
    for (const binding of doc.inputs) binding.sha256 = digests.get(binding.schemaVersion) ?? binding.sha256;
    await writeFile(path.join(dir, name), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    digests.set(schemaVersion, canonicalDigest(doc));
  }

  const verdict = await verifyJourneyChain({ chainDir: dir });
  assert.equal(verdict.verdict, "PASS", JSON.stringify(verdict.failures, null, 1));
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.denominator.stagesFound, 5);
  assert.equal(verdict.denominator.digestsMatched, 6);
  assert.equal(verdict.caseId, CASE_ID);

  // And the committed fixture chain is still the committed fixture chain, still green.
  const committed = await verifyJourneyChain({ chainDir: FIXTURES });
  assert.equal(committed.verdict, "PASS");
});

// ---------------------------------------------------------------------------------------------
// Persona: a build agent recording its test run. The exit code is recorded exactly as it happened
// — a failing command becomes honest evidence of a failure, never a hidden one.
// ---------------------------------------------------------------------------------------------
test("a test command is executed for real and its exit code recorded, pass or fail", async () => {
  const dir = await scratchDir();
  const { pack } = await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath: path.join(dir, "pass/pack.json"),
    caseId: CASE_ID,
    testCommand: 'node -e "console.log(String(40 + 2)); process.exit(0)"',
  });
  const run = pack.content.evidence.find((e) => e.kind === "test-run");
  assert.equal(run.generatedBy.exitCode, 0);
  const log = await readFile(path.join(dir, "pass", run.artifact.path), "utf8");
  assert.ok(log.includes("42"), "the log artifact must hold the command's real output");

  const failing = await produceBuildEvidencePack({
    repoRoot: REPO,
    contractPath: CONTRACT,
    outPath: path.join(dir, "fail/pack.json"),
    caseId: CASE_ID,
    testCommand: 'node -e "process.exit(3)"',
  });
  const failedRun = failing.pack.content.evidence.find((e) => e.kind === "test-run");
  assert.equal(failedRun.generatedBy.exitCode, 3, "a failing run is recorded, not hidden");
  assert.deepEqual(await validateSchema(BUILD_EVIDENCE_PACK_SCHEMA, failing.pack, "pack"), []);
  assert.ok(
    failing.pack.completeness.claimed.some((entry) => entry.includes("(3)")),
    "completeness must state the exit code that actually happened",
  );
});
