// The StoryPack schema exists to make one specific failure inexpressible: a claim that is true
// about the software and false about the data. Trial 1 shipped exactly that, with clean receipts.
// A schema that merely *allows* an honest pack is worth nothing here, so most of these tests probe
// that the dishonest shapes are rejected — and the rest check the references the schema cannot
// resolve for itself, since a binding that does not resolve is a label.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const SCHEMA = "nodekit.story-pack.v1.schema.json";
const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(platformRoot, "test/fixtures/builder-journey/salon.story-pack.json");
const bepPath = path.join(platformRoot, "test/fixtures/builder-journey/salon.build-evidence-pack.json");
const contractPath = path.join(platformRoot, "test/fixtures/builder-journey/salon.opportunity-contract.json");

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const loadPack = () => loadJson(fixturePath);

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
  return validateSchema(SCHEMA, pack, "storyPack");
}

// A mutation helper: every negative test states the dishonest edit and asserts the schema refuses it.
async function assertRejected(label, mutate) {
  const pack = clone(await loadPack());
  mutate(pack);
  const errors = await errorsFor(pack);
  assert.ok(errors.length > 0, `schema accepted a shape it must refuse: ${label}`);
}

test("the salon story pack fixture validates against the schema", async () => {
  assert.deepEqual(await errorsFor(await loadPack()), []);
});

test("inputs bind the upstream artifacts by digest over canonical JSON, not by name", async () => {
  const pack = await loadPack();
  const expected = new Map([
    ["nodekit.opportunity-contract/v1", createHash("sha256").update(canonical(await loadJson(contractPath))).digest("hex")],
    ["nodekit.build-evidence-pack/v1", createHash("sha256").update(canonical(await loadJson(bepPath))).digest("hex")],
  ]);
  assert.equal(pack.inputs.length, expected.size);
  for (const input of pack.inputs) {
    assert.equal(input.sha256, expected.get(input.schemaVersion), `digest mismatch for ${input.schemaVersion}`);
    assert.equal(input.caseId, pack.caseId, "every input must belong to the same journey");
  }
});

test("every artifact the fixture cites exists on disk at the declared digest and length", async () => {
  const pack = await loadPack();
  const refs = [
    ...pack.content.sources.map((source) => source.artifact),
    ...pack.content.sources.flatMap((source) => (source.authority ? [source.authority.receipt] : [])),
    ...pack.content.surfaces.flatMap((surface) => (surface.artifact ? [surface.artifact] : [])),
  ];
  assert.ok(refs.length >= 1, "expected the fixture to cite at least one artifact");
  for (const ref of refs) {
    const absolute = path.join(platformRoot, ref.path);
    const bytes = await readFile(absolute);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256, `digest mismatch for ${ref.path}`);
    assert.equal((await stat(absolute)).size, ref.byteLength, `byteLength mismatch for ${ref.path}`);
  }
});

test("every build binding resolves into the BuildEvidencePack it declares as an input", async () => {
  const pack = await loadPack();
  const bep = await loadJson(bepPath);
  const bepClaims = new Set(bep.content.claims.map((claim) => claim.claimId));
  const bepEvidence = new Set(bep.content.evidence.map((entry) => entry.evidenceId));
  let bound = 0;
  for (const claim of pack.content.claims) {
    if (!claim.buildBinding) continue;
    bound += 1;
    for (const id of claim.buildBinding.bepClaimIds) {
      assert.ok(bepClaims.has(id), `${claim.claimId} cites a BuildEvidencePack claim that does not exist: ${id}`);
    }
    for (const id of claim.buildBinding.evidenceRefs) {
      assert.ok(bepEvidence.has(id), `${claim.claimId} cites evidence that does not exist: ${id}`);
    }
  }
  assert.ok(bound >= 1, "expected at least one build-bound claim");
});

test("every content binding, disclosure and narrative reference resolves inside the pack", async () => {
  const pack = await loadPack();
  const sources = new Set(pack.content.sources.map((source) => source.sourceId));
  const disclosures = new Set(pack.content.disclosures.map((entry) => entry.disclosureId));
  const surfaces = new Set(pack.content.surfaces.map((entry) => entry.surfaceId));
  const claims = new Set(pack.content.claims.map((claim) => claim.claimId));

  for (const claim of pack.content.claims) {
    for (const id of claim.surfaceRefs) assert.ok(surfaces.has(id), `${claim.claimId} renders on an undeclared surface: ${id}`);
    for (const id of claim.disclosureRefs ?? []) assert.ok(disclosures.has(id), `${claim.claimId} cites a missing disclosure: ${id}`);
    for (const id of claim.contentBinding?.sourceRefs ?? []) assert.ok(sources.has(id), `${claim.claimId} cites a missing source: ${id}`);
    for (const id of claim.contentBinding?.derivation?.inputSourceRefs ?? []) {
      assert.ok(sources.has(id), `${claim.claimId} derives from a missing source: ${id}`);
    }
  }
  for (const entry of pack.content.disclosures) {
    for (const id of entry.surfaceRefs) assert.ok(surfaces.has(id), `${entry.disclosureId} points at a missing surface: ${id}`);
  }
  for (const beat of pack.content.narrative) {
    for (const id of beat.claimRefs) assert.ok(claims.has(id), `narrative beat ${beat.order} cites a missing claim: ${id}`);
  }
});

test("declared data implications cover everything the phrase scan actually found", async () => {
  // The schema can only force a non-empty scan to yield a non-empty set; it cannot compute the
  // union. This is that verifier obligation, and it is what stops a claim from acknowledging one
  // implication of its copy while quietly dropping another.
  const pack = await loadPack();
  for (const claim of pack.content.claims) {
    const declared = new Set(claim.dataImplications);
    for (const match of claim.phraseScan.matches) {
      for (const implied of match.implies) {
        assert.ok(declared.has(implied), `${claim.claimId} scans "${match.phrase}" as ${implied} but does not declare it`);
      }
    }
  }
});

test("the fixture exercises the unbound case this schema exists for", async () => {
  const pack = await loadPack();
  const unbound = pack.content.claims.filter((claim) => claim.status === "unbound");
  assert.ok(unbound.length >= 1, "the fixture must carry at least one unbound claim");
  for (const claim of unbound) {
    assert.ok(claim.unbound.whatWouldBindIt.length > 0, "an unbound claim must say what would bind it");
    assert.ok(claim.unbound.riskIfBelieved.length > 0, "an unbound claim must say what goes wrong if believed");
    assert.ok(claim.disclosureRefs.length >= 1, "an unbound claim must be marked on the surface, not merely in this file");
    // Marked, not omitted: the claim still reaches the reader.
    const told = pack.content.narrative.some((beat) => beat.claimRefs.includes(claim.claimId));
    assert.ok(told, `${claim.claimId} is unbound and was silently dropped from the narrative`);
  }
});

test("no claim over non-authority data is presented as fact", async () => {
  const pack = await loadPack();
  for (const claim of pack.content.claims) {
    if (claim.dataImplications.length === 0) continue;
    const origin = claim.contentBinding?.origin;
    if (origin === "authority-issued") {
      assert.equal(claim.status, "bound");
    } else {
      assert.equal(claim.status, "disclosed-demo", `${claim.claimId} implies real data over ${origin} data`);
      assert.ok(claim.disclosureRefs.length >= 1);
    }
  }
});

// ---------------------------------------------------------------------------
// The shapes that must not be expressible.
// ---------------------------------------------------------------------------

test("a claim true of the software and false of the data cannot be marked bound", async () => {
  // The Trial 1 shape, exactly: a real buildBinding, a fixture contentBinding, and copy that says
  // "your". Every receipt genuine, the artifact still misrepresenting itself.
  await assertRejected("Trial 1", (pack) => {
    const claim = pack.content.claims[0];
    claim.status = "bound";
    delete claim.disclosureRefs;
  });
});

test("regulated copy cannot declare zero data implications", async () => {
  await assertRejected("scan says 'your', fields say nothing", (pack) => {
    pack.content.claims[0].dataImplications = [];
  });
});

test("a statement that renders data must say where the data came from", async () => {
  await assertRejected("rendersData without contentBinding", (pack) => {
    delete pack.content.claims[0].contentBinding;
  });
});

test("a claim implying real data cannot be rendered as merely unbound", async () => {
  // There is no honest way to show "your profit is $2,318" with nothing behind it. The escape
  // hatch is withheldClaims, which cannot carry a surface.
  await assertRejected("unbound data claim", (pack) => {
    const claim = pack.content.claims[0];
    claim.status = "unbound";
    claim.unbound = {
      reason: "no-evidence-generated",
      whatWouldBindIt: "A connected Square account belonging to the reader.",
      riskIfBelieved: "The owner treats an invented figure as her own week.",
    };
  });
});

test("an unbound claim cannot be shown without a record and a disclosure", async () => {
  await assertRejected("unbound with no record", (pack) => {
    delete pack.content.claims[3].unbound;
  });
  await assertRejected("unbound with no disclosure", (pack) => {
    pack.content.claims[3].disclosureRefs = [];
  });
});

test("a demo disclosure must negate something and sit beside the claim", async () => {
  for (const bare of ["Preview", "Example", "Demo", "Sample"]) {
    await assertRejected(`bare label ${bare}`, (pack) => {
      pack.content.disclosures[0].text = bare;
    });
  }
  await assertRejected("labels without negating", (pack) => {
    pack.content.disclosures[0].text = "Sample data for this walkthrough session.";
  });
  for (const placement of ["footer", "separate-page"]) {
    await assertRejected(`demo disclosure in ${placement}`, (pack) => {
      pack.content.disclosures[0].placement = placement;
    });
  }
});

test("authority is a property of who issued the bytes, never of what they resemble", async () => {
  await assertRejected("fixture wearing an issuer", (pack) => {
    pack.content.sources[0].authority = {
      issuer: "Square",
      issuerKind: "institution-export",
      artifactType: "Square transactions CSV export",
      receivedAt: "2026-07-20T10:00:00Z",
      receipt: {
        path: "test/fixtures/builder-journey/story/salon-week-synthetic-sales.csv",
        sha256: "58813d1ede05087112ab6d6f8228176a92cec1280b741a25b58fa852aec2ca87",
        byteLength: 431,
      },
    };
  });
  await assertRejected("authority-issued with no issuer", (pack) => {
    pack.content.sources[0].origin = "authority-issued";
  });
});

test("a derived figure must state whether it can be reproduced", async () => {
  await assertRejected("derivation with no status", (pack) => {
    delete pack.content.claims[1].contentBinding.derivedStatus;
  });
  await assertRejected("reproduced without command or digest", (pack) => {
    pack.content.claims[1].contentBinding.derivation.reproduction = { rerunnable: true };
  });
  await assertRejected("not rerunnable with no reason", (pack) => {
    pack.content.claims[0].contentBinding.derivation.reproduction = { rerunnable: false };
  });
});

test("an unreproducible figure must be disclosed on the surface", async () => {
  await assertRejected("derived_unverified with no disclosure", (pack) => {
    pack.content.claims[0].disclosureRefs = [];
  });
});

test("a withheld claim cannot acquire a rendering", async () => {
  await assertRejected("withheld claim with a surface", (pack) => {
    pack.content.withheldClaims[0].surfaceRefs = ["surface-weekly-brief"];
  });
  await assertRejected("withheld claim with a status", (pack) => {
    pack.content.withheldClaims[0].status = "bound";
  });
});

test("the pack cannot approve itself", async () => {
  await assertRejected("promotionAuthorized true", (pack) => {
    pack.content.promotionAuthorized = true;
  });
  for (const field of ["approved", "reviewedBy", "verdict", "signOff", "reviewStatus", "attestation", "humanReviewed"]) {
    await assertRejected(`self-approval field ${field}`, (pack) => {
      pack.content[field] = true;
    });
  }
});

test("the envelope is the frozen one, and EXPLAIN cannot have read LAUNCH", async () => {
  await assertRejected("wrong schemaVersion", (pack) => {
    pack.schemaVersion = "nodekit.story-pack/v2";
  });
  await assertRejected("wrong stage", (pack) => {
    pack.stage = "build";
  });
  await assertRejected("missing the build evidence pack input", (pack) => {
    pack.inputs = pack.inputs.filter((input) => input.schemaVersion !== "nodekit.build-evidence-pack/v1");
  });
  await assertRejected("consumed a launch manifest", (pack) => {
    pack.inputs.push({
      schemaVersion: "nodekit.launch-manifest/v1",
      caseId: "salon-weekly-profit-2026-07",
      sha256: "a".repeat(64),
    });
  });
  for (const field of ["caseId", "producedAt", "completeness", "content"]) {
    await assertRejected(`missing ${field}`, (pack) => {
      delete pack[field];
    });
  }
});

test("demo mode cannot be engaged over nothing", async () => {
  await assertRejected("engaged with no surfaces", (pack) => {
    pack.content.demoMode.surfaceRefs = [];
  });
  await assertRejected("engaged with no reason", (pack) => {
    delete pack.content.demoMode.reason;
  });
});
