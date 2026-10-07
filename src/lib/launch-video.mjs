// The launch-video gate: the process that separates a launch film from a screen recording with
// music, declared as one contract that walks a driven coding agent through it stage by stage.
//
// Source: Motion Studio's process, observed live at motion.so/studio 2026-08-04. Their four steps
// — Direction, First draft, Revisions, Delivery — with a human making every taste call, are the
// same shape as this repo's judge loop, plus the two things the judge loop alone never enforced:
// the film is DIRECTED before it is rendered, and it exists FOR a launch date. Four stage-exits,
// each of which dies in chat scrollback unless a contract carries it:
//
//   BRIEF       the product, the story in the stakeholder's words, the launch date, the channel.
//   DIRECTION   the single moment the film is built around, ordered beats, timestamped reference
//               facts (never adjectives), a duration target, and a HUMAN approval — no first cut
//               before the direction came back approved.
//   DRAFTS      render → judge → human notes → recut. The judge loop is already the default in
//               nodekit-present; the contract records each cycle so revision is a ledger, not a
//               memory.
//   DELIVERY    the final cut, its judge receipt, a human approval, delivered BEFORE the launch
//               date. A launch film delivered after the launch is a retrospective.
//
// The schema enforces shape. This module enforces what a schema cannot say: that drafts before an
// approved direction are refused, that the mom test (non_expert_sense) blocks delivery on its own,
// that a reference claim without a timestamp is an adjective, and that the delivery date precedes
// the launch date.

export const LAUNCH_VIDEO_SCHEMA = "nodekit.launch-video.v1.schema.json";
export const LAUNCH_VIDEO_SCHEMA_VERSION = "nodekit.launch-video/v1";

// find-references.mjs rejects anything over 180s as the wrong shape and the wrong cost for a
// launch cut; the contract holds the same line. Measured: an 18-minute reference cost 102k prompt
// tokens against 3.9k for a 39s demo.
export const MAX_DURATION_SECONDS = 180;

// The ten comprehension dimensions judge-video.mjs scores, by name. non_expert_sense is the mom
// test and blocks alone.
export const COMPREHENSION_DIMENSIONS = Object.freeze([
  "persona", "purpose", "use_case", "feature_clarity", "full_interaction",
  "responsiveness", "flow", "result", "non_expert_sense", "transfer",
]);
export const COMPREHENSION_PASS_FLOOR = 2; // per dimension, 0-2 scale: 2 = stated, 1 = implied, 0 = absent

export class LaunchVideoRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`launch-video contract refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "LaunchVideoRefusal";
    this.refusals = list;
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isApproval = (value) => isNonEmptyString(value?.approvedBy) && isNonEmptyString(value?.at);
// "at 0:12 the loading state holds 1.4s" is a fact; "their pacing is good" is an adjective.
const TIMESTAMP = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/**
 * Semantic parse, run after (or without) schema validation. Throws LaunchVideoRefusal with every
 * refusal at once — a gate that reports one problem per run is a gate people stop running.
 */
export function parseLaunchVideoContract(contract) {
  if (!contract || typeof contract !== "object") {
    throw new LaunchVideoRefusal(["a launch-video contract must be an object"]);
  }
  const refusals = [];
  if (contract.schemaVersion !== LAUNCH_VIDEO_SCHEMA_VERSION) {
    refusals.push(`schemaVersion must be ${LAUNCH_VIDEO_SCHEMA_VERSION}`);
  }

  // Template blanks anywhere are an unfilled form, not a declaration.
  const blanks = [];
  (function walk(node, trail) {
    if (typeof node === "string" && node.includes("REPLACE")) blanks.push(trail);
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${trail}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, trail ? `${trail}.${k}` : k);
  })(contract, "");
  if (blanks.length > 0) refusals.push(`template blanks not replaced: ${blanks.join(", ")}`);

  const launchDate = contract.brief?.launchDate;
  if (isNonEmptyString(launchDate) && Number.isNaN(Date.parse(launchDate))) {
    refusals.push(`brief.launchDate is not a parseable date: ${launchDate}`);
  }

  const direction = contract.direction ?? {};
  const directionApproved = isApproval(direction.approval);

  // Direction content: the single moment is the finding this gate exists for — a real film judged
  // three cuts deep turned out to be built around the wrong moment, which no self-review surfaced.
  // Declare it before the first render, so the judge argues with a declaration instead of a guess.
  if (direction.beats !== undefined || direction.singleMoment !== undefined || directionApproved) {
    if (!isNonEmptyString(direction.singleMoment)) {
      refusals.push("direction.singleMoment is the moment the film is built around; without it every cut is a guess");
    }
    if (!Array.isArray(direction.beats) || direction.beats.length === 0) {
      refusals.push("direction.beats must order the story; a film without beats is a screen recording");
    }
    const references = Array.isArray(direction.references) ? direction.references : [];
    if (references.length === 0) {
      refusals.push("direction needs at least one reference (URL + timestamped facts); taste is calibrated against something, or it is a coin flip");
    }
    for (const [i, ref] of references.entries()) {
      const facts = Array.isArray(ref?.facts) ? ref.facts : [];
      if (facts.length === 0) refusals.push(`direction.references[${i}] has no timestamped facts; an observation without a timestamp is an adjective`);
      for (const [j, fact] of facts.entries()) {
        if (!TIMESTAMP.test(fact?.at ?? "")) refusals.push(`direction.references[${i}].facts[${j}].at must be a timestamp (m:ss); got: ${fact?.at ?? "nothing"}`);
      }
    }
    const duration = direction.durationTargetSeconds;
    if (typeof duration !== "number" || duration <= 0) {
      refusals.push("direction.durationTargetSeconds must be a positive number");
    } else if (duration > MAX_DURATION_SECONDS) {
      refusals.push(`direction.durationTargetSeconds ${duration} exceeds ${MAX_DURATION_SECONDS}; a launch cut is a single moment, not a keynote`);
    }
  }

  // Drafts before an approved direction: Motion's step 2 comes after step 1 for a reason — the
  // first cut aligns on a direction, it does not discover one.
  const drafts = Array.isArray(contract.draftCycles) ? contract.draftCycles : [];
  if (drafts.length > 0 && !directionApproved) {
    refusals.push("draftCycles exist but direction.approval is missing; a render made before direction was approved is the revision bill");
  }
  for (const [i, cycle] of drafts.entries()) {
    if (!isNonEmptyString(cycle?.cut)) refusals.push(`draftCycles[${i}].cut must point at the rendered file`);
    const scores = cycle?.judge?.comprehension;
    if (scores && typeof scores === "object") {
      const missing = COMPREHENSION_DIMENSIONS.filter((d) => typeof scores[d] !== "number");
      if (missing.length > 0) refusals.push(`draftCycles[${i}].judge.comprehension is missing dimensions by name: ${missing.join(", ")}`);
    }
  }

  // Delivery: the taste call is human, the judge is advisory, and the date is the whole point.
  const delivery = contract.delivery;
  if (delivery !== undefined) {
    if (drafts.length === 0) {
      refusals.push("delivery without a single draft cycle; the revision loop is the process, not an optional extra");
    }
    if (!isApproval(delivery?.approval)) {
      refusals.push("delivery.approval must name a human and a time; an advisory model judgment is not an authoritative verdict");
    }
    if (!isNonEmptyString(delivery?.finalCut)) refusals.push("delivery.finalCut must point at the delivered file");
    if (!isNonEmptyString(delivery?.judgeReceipt)) refusals.push("delivery.judgeReceipt must point at the judge verdict for the FINAL cut; judging an earlier cut is a stale measurement");
    if (isNonEmptyString(delivery?.deliveredAt) && isNonEmptyString(launchDate)
      && !Number.isNaN(Date.parse(delivery.deliveredAt)) && !Number.isNaN(Date.parse(launchDate))
      && Date.parse(delivery.deliveredAt) > Date.parse(launchDate)) {
      refusals.push(`delivery.deliveredAt ${delivery.deliveredAt} is after brief.launchDate ${launchDate}; a launch film delivered after the launch is a retrospective`);
    }
    const last = drafts[drafts.length - 1];
    const scores = last?.judge?.comprehension;
    if (scores && typeof scores === "object") {
      const mom = scores.non_expert_sense;
      if (typeof mom === "number" && mom < COMPREHENSION_PASS_FLOOR) {
        refusals.push(`non_expert_sense scored ${mom} on the final cycle; the mom test blocks delivery on its own — a film nobody outside the field can follow is not launched, it is posted`);
      }
      const flat = COMPREHENSION_DIMENSIONS.every((d) => scores[d] === 1);
      if (flat) refusals.push("comprehension scored 1 on all ten dimensions on the final cycle — everything implied, nothing stated; that is a finding, not a middling pass");
    }
  }

  if (refusals.length > 0) throw new LaunchVideoRefusal(refusals);
  return contract;
}

/** A template with every field present and obviously unanswered. */
export function launchVideoTemplate(application, declaredAt) {
  return {
    schemaVersion: LAUNCH_VIDEO_SCHEMA_VERSION,
    application,
    declaredAt,
    brief: {
      product: "REPLACE: what is launching, in one line",
      story: "REPLACE: the story in the stakeholder's own words",
      audience: "REPLACE: who must understand this film on first watch",
      launchDate: "REPLACE: ISO date the post goes up",
      channels: ["REPLACE: linkedin | x | youtube | demo-day"],
    },
    direction: {
      singleMoment: "REPLACE: the one moment the film is built around",
      beats: [{ order: 1, job: "REPLACE: what this beat must make the viewer understand" }],
      references: [{
        url: "REPLACE: https://youtube.com/watch?v=…",
        facts: [{ at: "0:00", fact: "REPLACE: an atomic timestamped observation, never an adjective" }],
        whatToSteal: "REPLACE",
        whatNotToSteal: "REPLACE",
      }],
      durationTargetSeconds: 0,
      approval: { approvedBy: "REPLACE: the human who made the taste call", at: "REPLACE: ISO time" },
    },
    draftCycles: [],
    delivery: undefined,
  };
}

export function formatLaunchVideoVerdict(contract) {
  const cycles = Array.isArray(contract.draftCycles) ? contract.draftCycles.length : 0;
  const stage = contract.delivery ? "DELIVERED" : cycles > 0 ? `IN REVISION (cycle ${cycles})` : contract.direction?.approval ? "DIRECTED" : "BRIEFED";
  return `LAUNCH-VIDEO CONTRACT OK — ${contract.application}: ${stage}, launch ${contract.brief?.launchDate ?? "unset"}`;
}
