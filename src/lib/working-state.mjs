// The harness promises that a long-running build keeps its head. Nothing checked it. An agent that
// truncates its way through a six-hour run — losing what it already tried, what it ruled out, and
// why — passes every gate in this repository today, because none of them can see the difference
// between a context that was compacted and one that was simply cut.
//
// The load-bearing field is failedApproaches. Everything else survives truncation by accident: the
// objective is restated in every prompt, the next action is obvious from the diff. What dies first
// and costs most is the record of what was already tried and did not work, and its loss is
// invisible — the agent cheerfully re-attempts the thing it abandoned two hours ago and reports
// progress. A continuity check that does not require it is checking the wrong thing.

export const TRUST_LEVELS = Object.freeze(["H0", "H1", "H2", "H3"]);

// A protected canonical ledger requires a key the agent cannot reach. H1 is an exportable software
// key living in the same protection domain as the process that writes the ledger — which means the
// signature attests that the writer had the key, and the writer is who we were trying to constrain.
export const CANONICAL_PROMOTION_MIN_TRUST = "H2";

function fail(message, code = "WORKING_STATE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const REQUIRED_SECTIONS = Object.freeze([
  "objective",
  "decisions",
  "constraints",
  "evidence",
  "failedApproaches",
  "openQuestions",
  "blockers",
  "nextAction",
]);

export function parseWorkingState(state) {
  if (!state || typeof state !== "object") fail("working state must be an object");
  if (!isNonEmptyString(state.objective)) fail("needs an objective");
  if (!isNonEmptyString(state.nextAction)) fail("needs a nextAction");
  for (const key of ["decisions", "constraints", "evidence", "failedApproaches", "openQuestions", "blockers"]) {
    if (!Array.isArray(state[key])) fail(`needs ${key} as a list; an absent list and an empty one must not look the same`);
  }
  for (const [i, entry] of state.failedApproaches.entries()) {
    if (!isNonEmptyString(entry?.approach)) fail(`failedApproaches[${i}] needs an approach`);
    // Without why, the record cannot stop the retry — "we tried X" invites trying X differently.
    if (!isNonEmptyString(entry?.whyItFailed)) fail(`failedApproaches[${i}] needs whyItFailed, or it cannot prevent the retry it exists to prevent`);
  }
  return state;
}

/**
 * Continuity is a comparison between two checkpoints, not a property of one. `carried` is what
 * survived; the failure mode is silent loss, so anything present before and absent after is a
 * finding regardless of how the compaction was performed.
 */
export function verifyContinuity(before, after) {
  parseWorkingState(before);
  parseWorkingState(after);
  const losses = [];

  if (after.objective !== before.objective && !isNonEmptyString(after.objectiveChangeReason)) {
    losses.push("the objective changed with no objectiveChangeReason; a run that quietly re-aims is not the same run");
  }
  for (const key of ["decisions", "constraints", "failedApproaches", "openQuestions", "blockers"]) {
    const beforeKeys = new Set(before[key].map((e) => JSON.stringify(e?.approach ?? e?.id ?? e)));
    const afterKeys = new Set(after[key].map((e) => JSON.stringify(e?.approach ?? e?.id ?? e)));
    const dropped = [...beforeKeys].filter((k) => !afterKeys.has(k));
    if (dropped.length > 0) {
      losses.push(`${key}: ${dropped.length} entr(ies) present before compaction and absent after`);
    }
  }

  return {
    continuous: losses.length === 0,
    losses,
    // Reported so a pass over an empty state cannot look like a pass over a real one.
    carried: REQUIRED_SECTIONS.reduce((n, k) => n + (Array.isArray(after[k]) ? after[k].length : (after[k] ? 1 : 0)), 0),
  };
}

/**
 * Gap #2. The ceremony exists and the policy pins it at the level the agent can forge.
 */
export function requireTrustForCanonicalPromotion(trustLevel) {
  if (!TRUST_LEVELS.includes(trustLevel)) fail(`unknown trust level "${trustLevel}"`, "TRUST_LEVEL_UNKNOWN");
  if (TRUST_LEVELS.indexOf(trustLevel) < TRUST_LEVELS.indexOf(CANONICAL_PROMOTION_MIN_TRUST)) {
    fail(
      `trust level ${trustLevel} may not promote a canonical record: ${CANONICAL_PROMOTION_MIN_TRUST} or above is required, `
        + "because below it the signing key sits in the same protection domain as the agent being constrained — "
        + "the signature then attests only that the writer had the key, and the writer is who the ledger exists to bind",
      "TRUST_LEVEL_INSUFFICIENT",
    );
  }
  return trustLevel;
}
