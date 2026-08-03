// A launch video is where a product acquires abilities it does not have. Nobody lies on purpose —
// a claim gets written because it would land well, and by the time it is a shot nobody remembers it
// was aspirational. These two checks are the pass condition of Increment 1.

import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDeliveryBrief,
  evaluateDeliveryBrief,
  evaluateStoryDirections,
  formatDeliveryVerdict,
  parseDeliveryBrief,
} from "../src/lib/delivery-brief.mjs";

const pack = (evidenceIds = ["ev-upload", "ev-reconcile"]) => ({
  caseId: "moms-biz",
  stage: "build",
  content: { evidence: evidenceIds.map((evidenceId) => ({ evidenceId })) },
  completeness: { notRun: ["No OCR engine was run; receipt confidence is a fixture value."], claimed: [], refused: [] },
});

const audience = { role: "salon owner", pain: "POS sales are not weekly profit", desiredOutcome: "a weekly close she trusts" };
const delivery = { goal: "teach", platforms: ["youtube"], targetDurationsSeconds: [45], aspectRatios: ["16:9"] };
const claim = (over = {}) => ({ claimId: "c1", statement: "every number traces to a source row", evidenceRefs: ["ev-reconcile"], ...over });

test("a claim citing evidence the build cannot show is an invented capability", () => {
  const brief = compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [claim({ evidenceRefs: ["ev-does-not-exist"] })] });
  const verdict = evaluateDeliveryBrief(brief, pack());
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /invented one/);
  assert.deepEqual(verdict.claimCoverage, { required: 1, verified: 0, unsupported: 1 });
});

test("a claim bound to real pack evidence passes, and the coverage is reported", () => {
  const brief = compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [claim(), claim({ claimId: "c2", evidenceRefs: ["ev-upload"] })] });
  const verdict = evaluateDeliveryBrief(brief, pack());
  assert.equal(verdict.passed, true, formatDeliveryVerdict(verdict));
  assert.deepEqual(verdict.claimCoverage, { required: 2, verified: 2, unsupported: 0 });
});

test("a claim with an empty evidence list is refused at write time", () => {
  // It reads as cited and cites nothing — the exact shape an aspiration takes on its way to a shot.
  assert.throws(
    () => compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [claim({ evidenceRefs: [] })] }),
    /how an aspiration reaches a shot/,
  );
});

test("the brief inherits the build's own statement of what it did not establish", () => {
  const brief = compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [claim()] });
  assert.deepEqual(brief.knownLimitations, ["No OCR engine was run; receipt confidence is a fixture value."]);
});

test("a brief compiled against one case cannot be evaluated against another", () => {
  const brief = compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [claim()] });
  const other = { ...pack(), caseId: "noderoom" };
  assert.match(evaluateDeliveryBrief(brief, other).faults.join(" "), /but the pack is for noderoom/);
});

test("a brief with no claims measured nothing, and is not a pass", () => {
  const brief = compileDeliveryBrief({ pack: pack(), audience, delivery, claims: [] });
  const verdict = evaluateDeliveryBrief(brief, pack());
  assert.equal(verdict.passed, false);
  assert.equal(verdict.insufficient, true);
  assert.match(formatDeliveryVerdict(verdict), /nothing was checked/);
});

test("three directions that tell the same story are one direction with three titles", () => {
  const beats = (roles) => roles.map((role) => ({ role }));
  const same = evaluateStoryDirections([
    { directionId: "tutorial-first", beats: beats(["hook", "pain", "action"]) },
    { directionId: "owner-story", beats: beats(["hook", "pain", "action"]) },
    { directionId: "product-proof", beats: beats(["hook", "proof", "action"]) },
  ]);
  assert.equal(same.passed, false);
  assert.match(same.faults.join(" "), /tell the same story/);
  assert.match(same.faults.join(" "), /rubber-stamped/);

  const distinct = evaluateStoryDirections([
    { directionId: "tutorial-first", beats: beats(["pain", "process", "risk", "action"]) },
    { directionId: "owner-story", beats: beats(["hook", "start", "result", "action"]) },
    { directionId: "product-proof", beats: beats(["pain", "start", "proof", "action"]) },
  ]);
  assert.equal(distinct.passed, true, distinct.faults.join("; "));
  assert.equal(distinct.distinctShapes, 3);
});

test("fewer than three directions is not a choice, and an unknown role is refused", () => {
  assert.throws(() => evaluateStoryDirections([{ directionId: "only", beats: [{ role: "hook" }] }]), /not a choice/);
  assert.throws(
    () => evaluateStoryDirections([
      { directionId: "a", beats: [{ role: "vibes" }] },
      { directionId: "b", beats: [{ role: "hook" }] },
      { directionId: "c", beats: [{ role: "pain" }] },
    ]),
    /role must be one of/,
  );
});

test("the brief refuses shapes that would read as complete", () => {
  assert.throws(() => parseDeliveryBrief({ schemaVersion: "wrong" }), /schemaVersion/);
  assert.throws(
    () => compileDeliveryBrief({ pack: pack(), audience: { role: "x" }, delivery, claims: [claim()] }),
    /audience needs pain/,
  );
  assert.throws(
    () => compileDeliveryBrief({ pack: pack(), audience, delivery: { ...delivery, goal: "vibes" }, claims: [claim()] }),
    /delivery.goal must be one of/,
  );
});

// A contract derived from a product's README and one authored by the product's owner read
// identically, and the difference decides how much weight a reader gives it. Same distinction the
// audience gate draws between a stated and an inferred stack.
test("a derived contract says so, and names what its source did not settle", async () => {
  const { readFile } = await import("node:fs/promises");
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  for (const name of ["nodeslide", "noderoom"]) {
    const contract = JSON.parse(await readFile(path.join(root, "cases", `${name}.opportunity-contract.json`), "utf8"));
    assert.deepEqual(await validateSchema("nodekit.opportunity-contract.v1.schema.json", contract, name), []);
    assert.ok(contract.derivedFrom?.source, `${name} was derived and must cite its source`);
    // The load-bearing half: a derived contract claiming its source answered everything is lying by
    // omission. These two were derived from a README, which does not state open unknowns.
    assert.ok(
      contract.derivedFrom.unverifiedFields?.length > 0,
      `${name} claims its source settled every field, which a README does not`,
    );
  }

  // And an authored contract needs no provenance — the absence is what marks it as authored.
  const salon = JSON.parse(await readFile(path.join(root, "test/fixtures/builder-journey/salon.opportunity-contract.json"), "utf8"));
  assert.equal(salon.derivedFrom, undefined);
  assert.deepEqual(await validateSchema("nodekit.opportunity-contract.v1.schema.json", salon, "salon"), []);
});

test("derivedFrom refuses a shape that would read as provenance without being it", async () => {
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const base = JSON.parse(await readFile(path.join(root, "cases/nodeslide.opportunity-contract.json"), "utf8"));

  const noSource = { ...base, derivedFrom: { method: "mixed" } };
  assert.ok((await validateSchema("nodekit.opportunity-contract.v1.schema.json", noSource, "x")).length > 0, "derived from nothing is not derived");

  const badMethod = { ...base, derivedFrom: { ...base.derivedFrom, method: "vibes" } };
  assert.ok((await validateSchema("nodekit.opportunity-contract.v1.schema.json", badMethod, "x")).length > 0);
});
