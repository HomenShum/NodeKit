// The BuildEvidencePack schema exists to make one specific failure inexpressible: a product
// decision that was made and never reconciled. Trial 1 shipped ten of them. A schema that merely
// *allows* an honest pack is worth nothing here — these tests probe that the dishonest shapes are
// rejected, and that the fixture's evidence points at bytes that actually exist.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const SCHEMA = "nodekit.build-evidence-pack.v1.schema.json";
const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(platformRoot, "test/fixtures/builder-journey/salon.build-evidence-pack.json");
const contractPath = path.join(platformRoot, "test/fixtures/builder-journey/salon.opportunity-contract.json");

async function loadPack() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Canonical JSON per docs/JOURNEY_INTERSTAGE_CONTRACT.md: sorted keys at every level, no
// insignificant whitespace.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function errorsFor(pack) {
  return (await validateSchema(SCHEMA, pack, "pack")).join("\n");
}

test("the salon build evidence pack fixture validates against the schema", async () => {
  assert.deepEqual(await validateSchema(SCHEMA, await loadPack(), "pack"), []);
});

test("every artifact the fixture cites exists on disk at the declared digest and length", async () => {
  const pack = await loadPack();
  const refs = [
    ...pack.content.evidence.map((entry) => entry.artifact),
    ...pack.content.built.surfaces.flatMap((surface) => surface.sourceFiles),
  ];
  assert.ok(refs.length >= 12, "expected the fixture to cite a meaningful number of artifacts");
  for (const ref of refs) {
    const absolute = path.join(platformRoot, ref.path);
    const bytes = await readFile(absolute);
    const stats = await stat(absolute);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256, `digest mismatch for ${ref.path}`);
    assert.equal(stats.size, ref.byteLength, `byteLength mismatch for ${ref.path}`);
  }
});

test("inputs binds the OpportunityContract by sha256 over its canonical JSON", async () => {
  const pack = await loadPack();
  const binding = pack.inputs.find((entry) => entry.schemaVersion === "nodekit.opportunity-contract/v1");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  assert.equal(createHash("sha256").update(canonical(contract)).digest("hex"), binding.sha256);
});

test("every evidence reference resolves and every evidenceId is unique", async () => {
  const pack = await loadPack();
  const ids = pack.content.evidence.map((entry) => entry.evidenceId);
  assert.equal(new Set(ids).size, ids.length, "evidenceId collision — not expressible in JSON Schema, so checked here");

  const known = new Set(ids);
  const referenced = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "evidenceRefs") referenced.push(...value);
      else if (key === "disclosedIn" || key === "reportedIn") referenced.push(value);
      else walk(value);
    }
  };
  walk(pack.content);
  assert.ok(referenced.length > 0);
  for (const ref of referenced) assert.ok(known.has(ref), `dangling evidence reference: ${ref}`);
});

test("declaredElementCount matches both the elements listed and the bound contract array", async () => {
  const pack = await loadPack();
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const resolve = (pointer) =>
    pointer.slice(1).split("/").reduce((node, segment) => node[segment], contract);

  const collections = [
    pack.content.decisions.contract.inputs,
    pack.content.decisions.contract.rejectedAlternatives,
    pack.content.decisions.contract.openUnknowns,
    ...Object.values(pack.content.decisions.contract.authorityLimits),
  ];
  for (const entry of collections) {
    assert.equal(entry.elements.length, entry.declaredElementCount, `${entry.pointer} element count`);
    assert.equal(resolve(entry.pointer).length, entry.declaredElementCount, `${entry.pointer} disagrees with the bound contract`);
  }
});

test("the successCondition reconciliation must cite generated evidence, not narration", async () => {
  const pack = await loadPack();
  const byId = new Map(pack.content.evidence.map((entry) => [entry.evidenceId, entry]));
  const kinds = pack.content.decisions.contract.successCondition.evidenceRefs.map((ref) => byId.get(ref).kind);
  assert.ok(
    kinds.some((kind) => kind === "measurement" || kind === "test-run"),
    "the most gameable entry in the pack must lean on something that ran",
  );
});

test("a silent decision is inexpressible: omitting any contract reconciliation fails", async () => {
  const pack = await loadPack();
  for (const key of ["wedge", "primaryArtifact", "successCondition", "inputs", "authorityLimits"]) {
    const broken = clone(pack);
    delete broken.content.decisions.contract[key];
    assert.match(await errorsFor(broken), new RegExp(`must have required property '${key}'`), `omitting ${key} was accepted`);
  }

  const droppedBucket = clone(pack);
  delete droppedBucket.content.decisions.contract.authorityLimits.prohibited;
  assert.match(await errorsFor(droppedBucket), /must have required property 'prohibited'/);

  const droppedDisposition = clone(pack);
  delete droppedDisposition.content.decisions.contract.wedge.disposition;
  assert.match(await errorsFor(droppedDisposition), /must have required property 'disposition'/);
});

test("there is no fourth disposition and no escape hatch", async () => {
  const pack = await loadPack();
  for (const value of ["not-applicable", "unknown", "deferred", "n/a", null]) {
    const broken = clone(pack);
    broken.content.decisions.contract.wedge.disposition = value;
    assert.notDeepEqual(await validateSchema(SCHEMA, broken, "pack"), [], `disposition ${String(value)} was accepted`);
  }
});

test("each disposition must carry its own payload and may not borrow another's", async () => {
  const pack = await loadPack();

  const honouredWithoutHow = clone(pack);
  delete honouredWithoutHow.content.decisions.contract.wedge.how;
  assert.match(await errorsFor(honouredWithoutHow), /must have required property 'how'/);

  const defaultedWithoutArtifact = clone(pack);
  delete defaultedWithoutArtifact.content.decisions.contract.primaryJob.disclosedIn;
  assert.match(await errorsFor(defaultedWithoutArtifact), /must have required property 'disclosedIn'/);

  const defaultedWithoutEscalationReason = clone(pack);
  delete defaultedWithoutEscalationReason.content.decisions.contract.primaryJob.whyNotEscalated;
  assert.match(await errorsFor(defaultedWithoutEscalationReason), /must have required property 'whyNotEscalated'/);

  const contradictedWithoutReport = clone(pack);
  delete contradictedWithoutReport.content.decisions.contract.primaryArtifact.reportedIn;
  assert.match(await errorsFor(contradictedWithoutReport), /must have required property 'reportedIn'/);

  // A default dressed as an honoured decision is exactly the trial-1 move.
  const smuggled = clone(pack);
  smuggled.content.decisions.contract.wedge.defaultApplied = "quietly capped uploads at five megabytes";
  assert.notDeepEqual(await validateSchema(SCHEMA, smuggled, "pack"), [], "an honoured entry carrying a default was accepted");

  const unevidenced = clone(pack);
  unevidenced.content.decisions.contract.wedge.evidenceRefs = [];
  assert.match(await errorsFor(unevidenced), /must NOT have fewer than 1 items/);
});

test("acting outside the declared authority limits requires stating the cost of undoing it", async () => {
  const pack = await loadPack();
  const broken = clone(pack);
  const decision = broken.content.decisions.emergent.find((entry) => entry.decisionId === "dec-parsed-total-retention");
  delete decision.reversal;
  assert.match(await errorsFor(broken), /must have required property 'reversal'/);
});

test("an emergent decision cannot be recorded without alternatives or a disclosure artifact", async () => {
  const pack = await loadPack();

  const noAlternatives = clone(pack);
  noAlternatives.content.decisions.emergent[0].alternativesConsidered = [];
  assert.match(await errorsFor(noAlternatives), /must NOT have fewer than 1 items/);

  const noDisclosure = clone(pack);
  delete noDisclosure.content.decisions.emergent[0].disclosedIn;
  assert.match(await errorsFor(noDisclosure), /must have required property 'disclosedIn'/);

  // Claiming zero emergent decisions is allowed, but only alongside the sweep that found zero.
  const noSweep = clone(pack);
  noSweep.content.decisions.emergent = [];
  delete noSweep.content.decisions.emergentSweep;
  assert.match(await errorsFor(noSweep), /must have required property 'emergentSweep'/);
});

test("evidence must be generated bytes, never a boolean", async () => {
  const pack = await loadPack();

  const booleanEvidence = clone(pack);
  booleanEvidence.content.evidence[0].artifact = true;
  assert.notDeepEqual(await validateSchema(SCHEMA, booleanEvidence, "pack"), []);

  const noDigest = clone(pack);
  delete noDigest.content.evidence[0].artifact.sha256;
  assert.match(await errorsFor(noDigest), /must have required property 'sha256'/);

  const passedFlag = clone(pack);
  passedFlag.content.evidence[0].passed = true;
  assert.match(await errorsFor(passedFlag), /must NOT have additional properties/);

  const testRunWithoutExitCode = clone(pack);
  delete testRunWithoutExitCode.content.evidence[0].generatedBy.exitCode;
  assert.match(await errorsFor(testRunWithoutExitCode), /must have required property 'exitCode'/);

  const unbounded = clone(pack);
  delete unbounded.content.evidence[0].boundary;
  assert.match(await errorsFor(unbounded), /must have required property 'boundary'/);

  const absolutePath = clone(pack);
  absolutePath.content.evidence[0].artifact.path = "/etc/passwd";
  assert.notDeepEqual(await validateSchema(SCHEMA, absolutePath, "pack"), []);

  const traversal = clone(pack);
  traversal.content.evidence[0].artifact.path = "test/../../secrets.txt";
  assert.notDeepEqual(await validateSchema(SCHEMA, traversal, "pack"), []);
});

test("a claim without evidence or without a stated boundary is rejected", async () => {
  const pack = await loadPack();

  const noEvidence = clone(pack);
  noEvidence.content.claims[0].evidenceRefs = [];
  assert.match(await errorsFor(noEvidence), /must NOT have fewer than 1 items/);

  const noBoundary = clone(pack);
  delete noBoundary.content.claims[0].boundary;
  assert.match(await errorsFor(noBoundary), /must have required property 'boundary'/);
});

test("the producer cannot approve itself", async () => {
  const pack = await loadPack();

  const authorized = clone(pack);
  authorized.content.promotionAuthorized = true;
  assert.match(await errorsFor(authorized), /must be equal to constant/);

  const missing = clone(pack);
  delete missing.content.promotionAuthorized;
  assert.match(await errorsFor(missing), /must have required property 'promotionAuthorized'/);

  for (const field of ["approved", "reviewedBy", "verdict", "signOff", "reviewStatus", "attestation"]) {
    const atRoot = clone(pack);
    atRoot[field] = field === "approved" ? true : "homen";
    assert.notDeepEqual(await validateSchema(SCHEMA, atRoot, "pack"), [], `root ${field} was accepted`);

    const inContent = clone(pack);
    inContent.content[field] = field === "approved" ? true : "homen";
    assert.notDeepEqual(await validateSchema(SCHEMA, inContent, "pack"), [], `content ${field} was accepted`);
  }
});

test("the frozen envelope is enforced", async () => {
  const pack = await loadPack();

  for (const [field, badValue] of [["schemaVersion", "nodekit.build-evidence-pack/v2"], ["stage", "explain"]]) {
    const broken = clone(pack);
    broken[field] = badValue;
    assert.match(await errorsFor(broken), /must be equal to constant/);
  }

  const localTime = clone(pack);
  localTime.producedAt = "2026-07-28T11:52:00-07:00";
  assert.match(await errorsFor(localTime), /must match pattern/);

  const unbound = clone(pack);
  unbound.inputs = [];
  assert.notDeepEqual(await validateSchema(SCHEMA, unbound, "pack"), [], "a pack consuming no upstream artifact was accepted");

  const nameOnly = clone(pack);
  delete nameOnly.inputs[0].sha256;
  assert.match(await errorsFor(nameOnly), /must have required property 'sha256'/);

  for (const field of ["completeness", "content", "caseId", "producedAt"]) {
    const broken = clone(pack);
    delete broken[field];
    assert.match(await errorsFor(broken), new RegExp(`must have required property '${field}'`));
  }

  for (const field of ["claimed", "notRun", "refused"]) {
    const broken = clone(pack);
    delete broken.completeness[field];
    assert.match(await errorsFor(broken), new RegExp(`must have required property '${field}'`));
  }

  const unreasonedRefusal = clone(pack);
  delete unreasonedRefusal.completeness.refused[0].reason;
  assert.match(await errorsFor(unreasonedRefusal), /must have required property 'reason'/);
});

test("the fixture does not quietly claim it attempted everything", async () => {
  const pack = await loadPack();
  assert.ok(pack.completeness.notRun.length > 0, "an empty notRun is itself a claim, and this fixture must not make it");
  assert.ok(pack.completeness.refused.length > 0);
  assert.equal(pack.content.promotionAuthorized, false);
});
