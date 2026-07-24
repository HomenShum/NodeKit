import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { adoptRepair, collectFriction, proposeRepair } from "../src/lib/friction-loop.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "harness/journey/baseline-2026-07-24.json";

const APPROVAL = { gymVerdictHash: "a".repeat(64), approvedBy: "project-owner" };

function verdict(overrides = {}) {
  return {
    schemaVersion: "nodekit.builder-gym-verdict/v1",
    verdictHash: "a".repeat(64),
    outcome: "improved",
    passed: true,
    regressedDimensions: [],
    promotionAuthorized: false,
    protectedEvaluatorUnchanged: true,
    fixedInputsHeld: true,
    ...overrides,
  };
}

async function proposal() {
  const friction = await collectFriction(REPO, [BASELINE]);
  return { friction, repair: proposeRepair(friction, { repairIntent: "Teach the lifecycle error to name a recovery.", changeRoots: ["src/cli.mjs"] }) };
}

// Persona: the loop itself. It observed real friction and wants to change the product because of
// it. The whole question is whether it can do that without an independent judgement.
test("recorded friction is normalised and the worst finding is the one a repair answers", async () => {
  const friction = await collectFriction(REPO, [BASELINE]);
  assert.ok(friction.length >= 7, "the committed baseline should still carry its findings");
  assert.equal(friction[0].severity, "P0", "P0 friction must sort ahead of everything else");
  assert.ok(friction.every((f) => f.frictionId && f.observed && f.source === BASELINE));

  const repair = proposeRepair(friction, { repairIntent: "x", changeRoots: ["src/cli.mjs"] });
  assert.deepEqual(repair.answersFrictionIds, [friction[0].frictionId]);
  assert.equal(repair.status, "proposed");
  assert.equal(repair.promotionAuthorized, false, "a fresh proposal must never start authorized");
  // Dimensions are fixed at proposal time so the comparison cannot be chosen after seeing results.
  assert.ok(repair.comparisonDimensions.includes("wrong-turns"));
});

test("a repair must answer real friction, state an intent, and name the roots it may write", async () => {
  const friction = await collectFriction(REPO, [BASELINE]);
  assert.throws(() => proposeRepair([], { repairIntent: "x", changeRoots: ["src"] }), /recorded friction/);
  assert.throws(() => proposeRepair(friction, { repairIntent: "  ", changeRoots: ["src"] }), /intends to change/);
  assert.throws(() => proposeRepair(friction, { repairIntent: "x", changeRoots: [] }), /roots it may write/);
});

// THE property. Every one of these must stay blocked, because each is a way an agent could
// otherwise mark its own work as good.
test("a repair cannot approve itself: adoption is refused without an independent authorizing verdict", async () => {
  const { repair } = await proposal();

  const noVerdict = adoptRepair(repair, null, { verdictRef: "r", approval: APPROVAL });
  assert.equal(noVerdict.status, "blocked");
  assert.match(noVerdict.blockedReason, /cannot approve itself/);

  const selfDeclared = adoptRepair(repair, { schemaVersion: "something.else/v1", promotionAuthorized: true }, { verdictRef: "r", approval: APPROVAL });
  assert.equal(selfDeclared.status, "blocked", "a non-gym object claiming authorization must not work");

  const tamperedEvaluator = adoptRepair(repair, verdict({ protectedEvaluatorUnchanged: false }), { verdictRef: "r", approval: APPROVAL });
  assert.equal(tamperedEvaluator.status, "blocked");
  assert.match(tamperedEvaluator.blockedReason, /evaluator changed/);

  const movedInputs = adoptRepair(repair, verdict({ fixedInputsHeld: false }), { verdictRef: "r", approval: APPROVAL });
  assert.equal(movedInputs.status, "blocked");
  assert.match(movedInputs.blockedReason, /equal terms/);

  const regressed = adoptRepair(repair, verdict({ outcome: "regressed", passed: false, regressedDimensions: ["task"] }), { verdictRef: "r", approval: APPROVAL });
  assert.equal(regressed.status, "blocked");

  const unreferenced = adoptRepair(repair, verdict(), { verdictRef: null, approval: APPROVAL });
  assert.equal(unreferenced.status, "blocked", "an adoption nobody can audit is not an adoption");

  for (const outcome of [noVerdict, selfDeclared, tamperedEvaluator, movedInputs, regressed, unreferenced]) {
    assert.equal(outcome.promotionAuthorized, false);
    assert.equal(outcome.gymVerdictRef, null);
  }
});

test("an authorized verdict adopts the repair and still requires a reviewed ledger entry", async () => {
  const { repair } = await proposal();
  const adopted = adoptRepair(repair, verdict(), { verdictRef: "harness/gym/verdict-1.json", approval: APPROVAL });
  assert.equal(adopted.status, "adopted");
  assert.equal(adopted.promotionAuthorized, true);
  assert.equal(adopted.gymVerdictRef, "harness/gym/verdict-1.json");
  // Adoption produces what a reviewed evolution event needs. It does not stand in for the review.
  assert.equal(adopted.evolutionEventRequired, true);
});
