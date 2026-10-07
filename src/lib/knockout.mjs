// The most-cited mechanism in this repository's design docs and the least implemented: five
// documents invoke the knockout gate, and the only occurrence in code was the word "ablations" in
// an unrelated schema. Geometry, markup and a passing render prove an element EXISTS. They cannot
// prove it is RESPONSIBLE for anything. Only removing it and watching the observable change does.
//
// The naive version of this is a trap the design council already walked into and wrote down:
//
//   "GSAP knockout jumps to the end and falsely passes — because the end state is exactly what the
//    un-knocked-out run produces too."
//
// That is the whole difficulty. A knockout that fast-forwards, disables easing, or sets duration to
// zero still arrives at the baseline's terminal state, so the two observations differ during the
// run and agree at the end. Compare the wrong frame and a decorative mechanism certifies itself as
// load-bearing. Worse, the same shape appears outside motion: stubbing a cache still returns the
// value, mocking a validator still yields the validated object.
//
// So this refuses the fast-forward by name, and refuses a knockout whose observation equals the
// baseline's TERMINAL state even when it differs from the baseline overall.

export const KNOCKOUT_METHODS = Object.freeze([
  "mechanism-removed",   // the code path is gone. The only method that proves necessity.
  "input-withheld",      // the mechanism remains but cannot fire. Also sound.
  "fast-forward",        // REFUSED: arrives at the same terminal state
  "duration-zeroed",     // REFUSED: same
  "disabled-flag",       // REFUSED unless the flag removes the path rather than skipping its effect
]);

// Methods that cannot establish necessity, and why, so the refusal teaches rather than blocks.
const UNSOUND = new Map([
  ["fast-forward", "a fast-forwarded run reaches the baseline's terminal state, so agreement at the end is guaranteed and proves nothing"],
  ["duration-zeroed", "zero duration is a fast-forward wearing a different name; the end state is unchanged"],
  ["disabled-flag", "a flag that skips the effect but leaves the path can still produce the baseline's result; remove the mechanism or withhold its input instead"],
]);

function fail(message, code = "KNOCKOUT_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * `baseline` and `knockout` are OBSERVATIONS, not verdicts: whatever was actually measured, plus the
 * terminal state the run settles into. terminalState is required on the baseline because the
 * gaming route is invisible without it — you cannot detect "it jumped to the end" unless you were
 * told what the end looks like.
 */
export function verifyCausalNecessity(claim) {
  if (!claim || typeof claim !== "object") fail("a necessity claim must be an object");
  for (const field of ["claim", "mechanism", "method"]) {
    if (!isNonEmptyString(claim[field])) fail(`needs ${field}`);
  }
  if (!KNOCKOUT_METHODS.includes(claim.method)) {
    fail(`method must be one of ${KNOCKOUT_METHODS.join(", ")}`);
  }
  if (UNSOUND.has(claim.method)) {
    fail(`method "${claim.method}" cannot establish necessity: ${UNSOUND.get(claim.method)}`, "KNOCKOUT_METHOD_UNSOUND");
  }

  const { baseline, knockout } = claim;
  for (const [name, obs] of [["baseline", baseline], ["knockout", knockout]]) {
    if (!obs || typeof obs !== "object") fail(`${name} must be an observation`);
    if (!isNonEmptyString(obs.observed)) fail(`${name} needs an \`observed\` field — what was actually measured`);
  }
  if (!isNonEmptyString(baseline.terminalState)) {
    fail("baseline needs terminalState; without it the jump-to-the-end knockout cannot be detected", "KNOCKOUT_TERMINAL_UNKNOWN");
  }

  const same = baseline.observed === knockout.observed;
  if (same) {
    return {
      necessary: false,
      reason: `removing ${claim.mechanism} changed nothing observable; it is present, not responsible`,
      mechanism: claim.mechanism,
    };
  }

  // The gaming route: the two runs differ, but the knockout landed exactly where the baseline was
  // always going to end up. That is what a fast-forward looks like from the outside, and it is the
  // shape a decorative mechanism uses to certify itself.
  if (knockout.observed === baseline.terminalState) {
    return {
      necessary: false,
      reason: `the knockout observation equals the baseline's terminal state ("${baseline.terminalState}"); `
        + "the run reached the end it was always going to reach, which is indistinguishable from the mechanism being skipped rather than removed",
      mechanism: claim.mechanism,
      gamed: true,
    };
  }

  return {
    necessary: true,
    reason: `with ${claim.mechanism} removed the observation changed from "${baseline.observed}" to "${knockout.observed}", `
      + `and did not collapse to the baseline's terminal state`,
    mechanism: claim.mechanism,
  };
}

export function formatNecessity(verdict) {
  const head = verdict.necessary
    ? `KNOCKOUT: ${verdict.mechanism} is load-bearing.`
    : `KNOCKOUT: ${verdict.mechanism} is NOT shown necessary${verdict.gamed ? " (gamed knockout)" : ""}.`;
  return `${head}\n  ${verdict.reason}`;
}
