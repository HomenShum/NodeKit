// Increment 1 of NodeVideo AppLaunch, which needs no video generation at all: turn a finished
// application's BuildEvidencePack into a delivery brief, and offer three story directions to choose
// between.
//
// Its pass condition names the two failures worth checking mechanically.
//
// ZERO INVENTED PRODUCT CAPABILITY. A launch video is where a product acquires abilities it does
// not have. Nobody lies on purpose; a claim gets written because it would land well, and by the
// time it is a shot nobody remembers it was aspirational. So a claim cites evidence by id, and an
// id that resolves to nothing in the pack is an invented capability by definition — not a
// judgement call, a lookup.
//
// THREE MATERIALLY DIFFERENT DIRECTIONS. Offering three options that are the same option wearing
// different titles is the standard way a choice gets rubber-stamped. Materially different means the
// ordered sequence of story ROLES differs — not the wording. Tutorial-first, owner-story and
// product-proof genuinely open on different beats; three drafts that all open on the problem and
// close on the CTA are one direction and should be presented as one.

export const DELIVERY_GOALS = Object.freeze(["teach", "demo", "launch", "judge", "investor", "grant"]);

// The story roles a beat can occupy. Order is what makes a direction distinctive.
export const STORY_ROLES = Object.freeze([
  "hook", "pain", "start", "process", "human-review", "result", "proof", "risk", "action",
]);

function fail(message, code = "DELIVERY_BRIEF_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Every evidence id the pack actually contains. This is the whole authority for a claim. */
export function evidenceIdsOf(pack) {
  const evidence = pack?.content?.evidence;
  if (!Array.isArray(evidence)) fail("the build evidence pack has no content.evidence to bind claims to");
  return new Set(evidence.map((entry) => entry?.evidenceId).filter(isNonEmptyString));
}

export function parseDeliveryBrief(brief) {
  if (!brief || typeof brief !== "object") fail("delivery brief must be an object");
  if (brief.schemaVersion !== "nodevideo.delivery-brief/v1") fail("schemaVersion must be nodevideo.delivery-brief/v1");
  for (const field of ["caseId", "audience", "delivery", "claims"]) {
    if (brief[field] === undefined) fail(`needs ${field}`);
  }
  for (const field of ["role", "pain", "desiredOutcome"]) {
    if (!isNonEmptyString(brief.audience?.[field])) fail(`audience needs ${field}`);
  }
  if (!DELIVERY_GOALS.includes(brief.delivery?.goal)) {
    fail(`delivery.goal must be one of ${DELIVERY_GOALS.join(", ")}`);
  }
  if (!Array.isArray(brief.claims)) fail("claims must be a list");
  for (const [i, claim] of brief.claims.entries()) {
    const at = `claims[${i}]`;
    if (!isNonEmptyString(claim?.claimId)) fail(`${at} needs a claimId`);
    if (!isNonEmptyString(claim?.statement)) fail(`${at} needs a statement`);
    // An empty list is the shape an aspirational claim takes: it reads as cited and cites nothing.
    if (!Array.isArray(claim.evidenceRefs) || claim.evidenceRefs.length === 0) {
      fail(`${at} ("${claim.statement}") cites no evidence; a claim with an empty evidence list is how an aspiration reaches a shot`);
    }
  }
  // knownLimitations must be present, and empty is a positive claim that there are none.
  if (!Array.isArray(brief.knownLimitations)) fail("needs knownLimitations as a list; an absent list and an empty one must not look the same");
  return brief;
}

/** Compile the parts of a brief that are derivable, so they are read rather than retyped. */
export function compileDeliveryBrief({ pack, audience, delivery, claims = [], knownLimitations }) {
  if (!isNonEmptyString(pack?.caseId)) fail("the build evidence pack needs a caseId");
  const known = Array.isArray(knownLimitations)
    ? knownLimitations
    : (pack?.completeness?.notRun ?? []);
  return parseDeliveryBrief({
    schemaVersion: "nodevideo.delivery-brief/v1",
    caseId: pack.caseId,
    buildEvidenceStage: pack.stage,
    audience,
    delivery,
    claims,
    // The pack already states what it did NOT establish. Carrying that forward means the video
    // inherits the build's honesty instead of restating it optimistically.
    knownLimitations: known,
  });
}

export function evaluateDeliveryBrief(brief, pack) {
  parseDeliveryBrief(brief);
  const known = evidenceIdsOf(pack);
  const faults = [];
  let verified = 0;

  for (const claim of brief.claims) {
    const missing = claim.evidenceRefs.filter((ref) => !known.has(ref));
    if (missing.length > 0) {
      faults.push(
        `claim ${claim.claimId} ("${claim.statement}") cites ${missing.join(", ")}, which the build evidence pack does not contain — `
          + "a capability the build cannot show is an invented one",
      );
    } else verified += 1;
  }

  if (brief.caseId !== pack.caseId) {
    faults.push(`brief is for case ${brief.caseId} but the pack is for ${pack.caseId}`);
  }

  return {
    passed: faults.length === 0 && brief.claims.length > 0,
    // No claims measured nothing; a brief that claims nothing is not a verified brief.
    insufficient: brief.claims.length === 0,
    faults,
    claimCoverage: { required: brief.claims.length, verified, unsupported: brief.claims.length - verified },
  };
}

/**
 * Three directions must be genuinely different routes through the same evidence. Compared by their
 * ordered role sequence, because that is the story; two directions with identical role order are
 * one direction with two titles, however differently they are written.
 */
export function evaluateStoryDirections(directions) {
  if (!Array.isArray(directions) || directions.length < 3) {
    fail("needs at least three story directions; fewer is not a choice", "DIRECTIONS_INSUFFICIENT");
  }
  const faults = [];
  const seen = new Map();

  for (const [i, direction] of directions.entries()) {
    const at = `directions[${i}]`;
    if (!isNonEmptyString(direction?.directionId)) fail(`${at} needs a directionId`);
    if (!Array.isArray(direction.beats) || direction.beats.length === 0) fail(`${at} needs beats`);
    for (const [j, beat] of direction.beats.entries()) {
      if (!STORY_ROLES.includes(beat?.role)) fail(`${at}.beats[${j}] role must be one of ${STORY_ROLES.join(", ")}`);
    }
    const shape = direction.beats.map((beat) => beat.role).join(">");
    if (seen.has(shape)) {
      faults.push(
        `${direction.directionId} and ${seen.get(shape)} tell the same story (${shape}); `
          + "three options that are one option is how a choice gets rubber-stamped",
      );
    } else seen.set(shape, direction.directionId);
  }

  return { passed: faults.length === 0, faults, distinctShapes: seen.size, offered: directions.length };
}

export function formatDeliveryVerdict(verdict) {
  if (verdict.insufficient) return "DELIVERY BRIEF: no claims — nothing was checked.";
  const { required, verified, unsupported } = verdict.claimCoverage;
  const head = `DELIVERY BRIEF ${verdict.passed ? "PASS" : "BLOCKED"}: ${verified}/${required} claims bound to build evidence, ${unsupported} unsupported.`;
  return verdict.passed ? head : [head, ...verdict.faults.map((f) => `  ${f}`)].join("\n");
}
