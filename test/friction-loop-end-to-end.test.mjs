import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateBuilderGym } from "../src/lib/builder-gym.mjs";
import { adoptRepair, collectFriction, proposeRepair } from "../src/lib/friction-loop.mjs";
import { preparedBuilderGym } from "./helpers/builder-gym-lab.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "harness/journey/baseline-2026-07-24.json";

// The unit tests for the loop use hand-built verdict objects, which proves the GATE but not the
// PIPE. These drive the real Builder Gym: a protected lock, two sealed trajectories, and a verdict
// this code did not author. Until this existed, "a repair cannot approve itself" was a claim about
// a function rather than about the system.

async function repairFromRealFriction() {
  const friction = await collectFriction(REPO, [BASELINE]);
  return proposeRepair(friction, {
    repairIntent: "Teach the undeclared-lifecycle error to name a recovery.",
    changeRoots: ["src/cli.mjs"],
  });
}

test("a repair answering recorded friction is adopted only after the REAL Builder Gym authorizes it", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t);

  // The verdict comes from the gym, not from this test.
  const verdict = await evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: lock.lockHash });
  assert.equal(verdict.schemaVersion, "nodekit.builder-gym-verdict/v1");
  assert.equal(verdict.passed, true);
  assert.equal(verdict.outcome, "improved");
  assert.equal(verdict.protectedEvaluatorUnchanged, true);
  assert.equal(verdict.fixedInputsHeld, true);

  const repair = await repairFromRealFriction();
  assert.equal(repair.status, "proposed");
  assert.equal(repair.promotionAuthorized, false);

  // The gym NEVER promotes anything itself. It measures. This is why a passing comparison alone
  // must not be enough to ship — otherwise "measured as better" silently becomes "approved".
  assert.equal(verdict.promotionAuthorized, false);
  assert.equal(verdict.realWorldClaimAuthorized, false);

  const verdictRef = `harness/gym/${verdict.gymId}.json`;
  const withoutApproval = adoptRepair(repair, verdict, { verdictRef });
  assert.equal(withoutApproval.status, "blocked", "a passing comparison is not permission to ship");
  assert.match(withoutApproval.blockedReason, /not permission to ship/);

  const adopted = adoptRepair(repair, verdict, {
    verdictRef,
    approval: { gymVerdictHash: verdict.verdictHash, approvedBy: "project-owner" },
  });
  assert.equal(adopted.status, "adopted");
  assert.equal(adopted.promotionAuthorized, true);
  assert.equal(adopted.approvedBy, "project-owner");
  // Even a real verdict plus a real approval does not end the loop. The ledger owns the decision.
  assert.equal(adopted.evolutionEventRequired, true);
});

// Replay: one genuine success must not become a skeleton key for later repairs.
test("an approval bound to a different comparison cannot be replayed onto this repair", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t);
  const verdict = await evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: lock.lockHash });
  const repair = await repairFromRealFriction();

  const replayed = adoptRepair(repair, verdict, {
    verdictRef: "harness/gym/other.json",
    approval: { gymVerdictHash: "f".repeat(64), approvedBy: "project-owner" },
  });
  assert.equal(replayed.status, "blocked");
  assert.match(replayed.blockedReason, /replayed/);

  const unsigned = adoptRepair(repair, verdict, {
    verdictRef: "harness/gym/other.json",
    approval: { gymVerdictHash: verdict.verdictHash, approvedBy: "" },
  });
  assert.equal(unsigned.status, "blocked", "an approval nobody signed is not an approval");
});

// The refusal path, driven by a genuinely worse candidate rather than a synthetic verdict object.
// A loop that only ever sees its own success is not a loop that can be trusted to stop.
test("a candidate the REAL gym judges worse cannot be adopted, and the refusal names the outcome", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t, {
    candidateScores: { task: 0.1, artifact: 0.1, ui: 0.1, efficiency: 0.1, durationMs: 900000, tokensOut: 90000 },
  });

  const verdict = await evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: lock.lockHash });
  assert.equal(verdict.passed, false, "a materially worse candidate must not pass the gym");
  assert.equal(verdict.promotionAuthorized, false);
  assert.ok(verdict.regressedDimensions.length > 0, "the gym must name what regressed");

  const repair = await repairFromRealFriction();
  const blocked = adoptRepair(repair, verdict, { verdictRef: "harness/gym/regressed.json" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.promotionAuthorized, false);
  assert.equal(blocked.gymVerdictRef, null);
  assert.match(blocked.blockedReason, /did not authorize promotion/);
});

// Tamper check: an authorizing verdict that was not produced over this protected lock must not be
// reusable. Otherwise one genuine success could be replayed to adopt any later repair.
test("the gym refuses to evaluate against a lock identity that was not externally pinned", async (t) => {
  const { baseline, candidate, lock, root } = await preparedBuilderGym(t);
  await assert.rejects(
    () => evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: "0".repeat(64) }),
    /does not match the externally pinned identity/,
  );
  await assert.rejects(
    () => evaluateBuilderGym(root, { baseline, candidate, lock, expectedLockHash: undefined }),
    /externally pinned expectedLockHash/,
  );
});
