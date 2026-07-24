import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyRepairPromotionApproval } from "./repair-approval.mjs";

// The recursive-improvement loop, wired through machinery that already exists rather than beside
// it. Observe -> classify -> propose -> branch -> test -> compare -> approve -> record.
//
// This module owns only the seam nothing else owned: turning a RECORDED friction observation into a
// repair candidate the Builder Gym can judge. It deliberately does NOT re-implement the judging
// (nodekit.builder-gym-verdict/v1 owns that), the friction event log
// (nodekit.human-study-event/v1 owns that), or the decision record (the Evolution Ledger owns that).
//
// The fail-closed rule that makes the loop trustworthy: a proposal is never self-adopting. It can
// only become adopted by presenting a Builder Gym verdict that authorized promotion, for that exact
// proposal. An agent may propose. An agent may not approve its own repair.

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

// Friction arrives in two shapes: an instrumented probe artifact (journey-baseline) and the
// append-only human study log. Normalise both, because the loop should not care which produced it.
function fromBaseline(record, source) {
  return {
    frictionId: record.id,
    source,
    severity: record.severity ?? "P2",
    kind: record.kind ?? "unclassified",
    observed: record.observed,
    consequence: record.consequence ?? null,
  };
}

function fromStudyEvent(event, source) {
  const severityByType = {
    "p0-p1-failure.recorded": "P0",
    "first-meaningful-action.not-reached": "P0",
    "wrong-turn.recorded": "P1",
    "help-request.recorded": "P1",
  };
  return {
    frictionId: `${event.participantId}:${event.sequence}`,
    source,
    severity: severityByType[event.type] ?? "P2",
    kind: event.type,
    observed: event.payload?.detail ?? event.type,
    consequence: null,
  };
}

/**
 * Normalise recorded friction from either an instrumented baseline or a human-study log.
 * @param {string} repoRoot
 * @param {string[]} sources repository-relative paths
 */
export async function collectFriction(repoRoot, sources) {
  const root = path.resolve(repoRoot);
  const friction = [];
  for (const source of sources) {
    const parsed = JSON.parse(await readFile(path.join(root, source), "utf8"));
    if (Array.isArray(parsed.friction)) {
      for (const record of parsed.friction) friction.push(fromBaseline(record, source));
    } else if (Array.isArray(parsed.events)) {
      for (const event of parsed.events) friction.push(fromStudyEvent(event, source));
    } else {
      throw new Error(`${source} is not a recognised friction source (expected friction[] or events[])`);
    }
  }
  return friction.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.frictionId.localeCompare(b.frictionId),
  );
}

/**
 * Turn recorded friction into ONE repair candidate the Builder Gym can judge.
 * One repair at a time is deliberate: a candidate that changes several things at once cannot be
 * attributed when the comparison moves, so the loop would learn nothing from its own result.
 * @param {object[]} friction
 * @param {{ repairIntent: string, changeRoots: string[] }} proposal
 */
export function proposeRepair(friction, { repairIntent, changeRoots }) {
  if (friction.length === 0) throw new Error("a repair must answer recorded friction; none was supplied");
  if (!repairIntent?.trim()) throw new Error("a repair must state what it intends to change");
  if (!Array.isArray(changeRoots) || changeRoots.length === 0) {
    throw new Error("a repair must name the roots it may write, so the gym can hold everything else fixed");
  }
  const target = friction[0];
  return {
    schemaVersion: "nodekit.friction-repair/v1",
    repairId: `repair-${target.frictionId}`,
    answersFrictionIds: [target.frictionId],
    severity: target.severity,
    repairIntent: repairIntent.trim(),
    changeRoots: [...changeRoots],
    // Named up front so the comparison cannot be chosen after seeing the result.
    comparisonDimensions: [
      "time-to-first-correct-action",
      "wrong-turns",
      "help-requests",
      "completion",
    ],
    status: "proposed",
    promotionAuthorized: false,
    gymVerdictRef: null,
  };
}

/**
 * Adopt a repair. FAIL-CLOSED: this is the only path to adopted.
 *
 * TWO independent things are required, because the Builder Gym deliberately never promotes anything
 * itself — it always seals `promotionAuthorized: false`. It measures whether a candidate is better;
 * it does not decide that the better candidate should ship. Gating adoption on the gym alone would
 * either be unreachable or would quietly treat "measured as better" as "approved to ship".
 *
 *   1. A gym verdict that PASSED over an unchanged protected evaluator and held fixed inputs.
 *   2. A SIGNED promotion approval, bound to that exact verdict and repair, from a key trusted for
 *      the repair-promotion purpose. Domain-separated so a signature made for another purpose
 *      cannot be replayed here.
 *
 * @param {object} repair
 * @param {object} gymVerdict a nodekit.builder-gym-verdict/v1
 * @param {{ verdictRef: string, approval?: object, trustedKeys?: Record<string, {publicKey: string, purposes: string[]}> }} binding
 */
// @nodekit-behavior inv:repair-cannot-self-approve owner
// @nodekit-behavior inv:measurement-is-not-permission owner
export function adoptRepair(repair, gymVerdict, { verdictRef, approval, trustedKeys } = {}) {
  const blocked = (reason) => ({ ...repair, status: "blocked", blockedReason: reason, promotionAuthorized: false, gymVerdictRef: null });

  if (!gymVerdict || gymVerdict.schemaVersion !== "nodekit.builder-gym-verdict/v1") {
    return blocked("no Builder Gym verdict was presented; a repair cannot approve itself");
  }
  if (gymVerdict.protectedEvaluatorUnchanged !== true) {
    return blocked("the protected evaluator changed during the comparison, so the verdict does not measure the repair");
  }
  if (gymVerdict.fixedInputsHeld !== true) {
    return blocked("fixed inputs did not hold, so baseline and candidate were not compared on equal terms");
  }
  if (gymVerdict.passed !== true || (gymVerdict.regressedDimensions?.length ?? 0) > 0) {
    return blocked(`the gym did not authorize promotion (outcome: ${gymVerdict.outcome ?? "unknown"})`);
  }
  if (!verdictRef) return blocked("an authorized verdict must be referenced so the adoption is auditable");

  // The gym proved improvement. A human still has to decide it should ship, and that decision must
  // be SIGNED. An unsigned approval is only an object, and anything able to construct an object
  // could grant it — including the agent proposing the repair.
  if (!approval) return blocked("a passing comparison is not permission to ship; a signed promotion approval is required");

  let verified;
  try {
    verified = verifyRepairPromotionApproval(approval, {
      gymVerdictHash: gymVerdict.verdictHash,
      repairId: repair.repairId,
      trustedKeys,
    });
  } catch (error) {
    return blocked(`the promotion approval did not verify: ${error.message}`);
  }

  return {
    ...repair,
    status: "adopted",
    promotionAuthorized: true,
    gymVerdictRef: verdictRef,
    approvedBy: verified.approvedBy,
    approvalKeyId: verified.keyId,
    approvalHash: verified.approvalHash,
    // The ledger still owns the decision record. Adoption produces the material a reviewed
    // evolution event needs; it does not write one, and it does not stand in for human review.
    evolutionEventRequired: true,
  };
}
