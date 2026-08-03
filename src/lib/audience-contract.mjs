// A take-home was built as "a query-to-visualization backend": Python, FastAPI, no database, a bar
// chart as the centrepiece. The research that would have reframed it ran afterwards, and found the
// reviewer builds a Life Sciences Knowledge Graph — so the network graph should have led, and
// provenance was a regulatory requirement rather than engineering hygiene. Same artifacts, described
// in the wrong language to the only people whose reading decides anything.
//
// The sharper failure was the stack. Public sources 403'd, and the honest conclusion was "I don't
// know their stack" — while the job description naming "Python, FastAPI, and Postgres" sat unread in
// the user's own inbox. Nobody asked for it. Inference was used where a primary document was
// available and simply never requested.
//
// So two things are mechanical here. Research must precede the design decision, because "we
// researched" and "we researched in time to change anything" are different claims. And a primary
// document the user may already hold must be explicitly asked for before anything is inferred: the
// failure was not bad searching, it was searching instead of asking.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const AUDIENCE_FILE = "audience.yaml";

// Ordered weakest to strongest. A document in hand beats what someone said, which beats what the
// web implies, which beats what seemed likely.
export const EVIDENCE_TIERS = Object.freeze(["inferred", "public-web", "direct-statement", "primary-document"]);

// The classes of document a reviewer-facing build should always ask about before inferring.
export const PRIMARY_SOURCE_KINDS = Object.freeze(["job-description", "rubric", "rfp", "brief", "contract"]);

function fail(message) {
  const error = new Error(message);
  error.code = "AUDIENCE_CONTRACT_INVALID";
  throw error;
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function parseAudienceContract(raw, label = AUDIENCE_FILE) {
  const doc = parse(raw) ?? {};
  for (const field of ["audience", "researchedAt", "designDecidedAt"]) {
    if (doc[field] === undefined) fail(`${label}: needs ${field}`);
  }
  if (!isNonEmptyString(doc.audience?.org) || !isNonEmptyString(doc.audience?.reads)) {
    fail(`${label}: audience needs org and reads — who reviews this, and what they will read it as`);
  }
  for (const field of ["researchedAt", "designDecidedAt"]) {
    if (Number.isNaN(Date.parse(doc[field]))) fail(`${label}: ${field} must be a date`);
  }
  if (!Array.isArray(doc.primarySourcesConsidered)) {
    fail(`${label}: needs primarySourcesConsidered as a list; the failure being prevented is not asking`);
  }
  for (const [i, entry] of doc.primarySourcesConsidered.entries()) {
    const at = `${label}: primarySourcesConsidered[${i}]`;
    if (!PRIMARY_SOURCE_KINDS.includes(entry?.kind)) fail(`${at} kind must be one of ${PRIMARY_SOURCE_KINDS.join(", ")}`);
    if (typeof entry.askedUser !== "boolean") fail(`${at} needs askedUser as a boolean`);
    if (typeof entry.obtained !== "boolean") fail(`${at} needs obtained as a boolean`);
  }
  for (const [i, claim] of (doc.stack ?? []).entries()) {
    const at = `${label}: stack[${i}]`;
    if (!isNonEmptyString(claim?.technology)) fail(`${at} needs a technology`);
    if (!EVIDENCE_TIERS.includes(claim.evidenceTier)) fail(`${at} evidenceTier must be one of ${EVIDENCE_TIERS.join(", ")}`);
    // A guess is allowed. A guess that does not look like one is not.
    if (claim.evidenceTier === "inferred" && claim.assumed !== true) {
      fail(`${at} is inferred but not marked assumed:true; an inferred stack that reads as a known one is how you are confidently wrong in front of the people who built it`);
    }
    if (claim.evidenceTier !== "inferred" && !isNonEmptyString(claim.sourceRef)) {
      fail(`${at} claims ${claim.evidenceTier} evidence without a sourceRef`);
    }
  }
  return doc;
}

export async function readAudienceContract(repoRoot = ".") {
  try {
    return { contract: parseAudienceContract(await readFile(path.join(repoRoot, AUDIENCE_FILE), "utf8")), present: true };
  } catch (error) {
    if (error.code === "ENOENT") return { contract: null, present: false };
    throw error;
  }
}

export function evaluateAudienceContract(contract) {
  const faults = [];
  if (!contract) return { passed: false, faults: ["no audience contract; the reviewer was never researched"] };

  // "We researched it" and "we researched it in time to change anything" are different claims.
  if (Date.parse(contract.researchedAt) > Date.parse(contract.designDecidedAt)) {
    faults.push("research ran after the design was decided, so it could only justify the build rather than shape it");
  }

  const unasked = contract.primarySourcesConsidered.filter((entry) => !entry.askedUser);
  const inferredClaims = (contract.stack ?? []).filter((claim) => claim.evidenceTier === "inferred");
  if (inferredClaims.length > 0 && unasked.length > 0) {
    faults.push(
      `${inferredClaims.length} stack claim(s) are inferred while ${unasked.map((e) => e.kind).join(", ")} was never asked for; `
        + "the document that answers this is usually already in the user's possession",
    );
  }
  // A source that was asked for and refused is a real answer. One nobody chased is not.
  for (const entry of contract.primarySourcesConsidered) {
    if (entry.askedUser && !entry.obtained && !isNonEmptyString(entry.reason)) {
      faults.push(`${entry.kind} was asked for and not obtained, with no reason recorded`);
    }
  }
  return { passed: faults.length === 0, faults, inferredClaims: inferredClaims.map((c) => c.technology) };
}

/**
 * A late reframe is not evidence. Seeing the reviewer's product and reaching for a graph database
 * feels like responsiveness; the job description named Postgres and never mentioned Neo4j. So a
 * load-bearing switch must cite evidence at least as strong as whatever established the original.
 */
export function evaluateStackSwitch(contract, { technology, replacing, evidenceTier }) {
  const existing = (contract?.stack ?? []).find((claim) => claim.technology === replacing);
  if (!existing) return { allowed: true, reason: `${replacing} was never an established choice` };
  if (EVIDENCE_TIERS.indexOf(evidenceTier) < EVIDENCE_TIERS.indexOf(existing.evidenceTier)) {
    return {
      allowed: false,
      reason: `${replacing} rests on ${existing.evidenceTier} evidence (${existing.sourceRef ?? "assumed"}); `
        + `switching to ${technology} on ${evidenceTier} evidence is a weaker claim replacing a stronger one`,
    };
  }
  return { allowed: true, reason: `${evidenceTier} evidence is at least as strong as the ${existing.evidenceTier} it replaces` };
}
