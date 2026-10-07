// The enforcement half of the AUDIENCE gate. `schemas/nodekit.audience-research.v1.schema.json` and
// `docs/AUDIENCE_GATE.md` define the record and say the gate "refuses a BUILD phase that names an
// audience with no AUDIENCE record" — this is what does the refusing.
//
// The schema can check that fields are present. It cannot check the two things that actually went
// wrong on the Cheiron take-home:
//
//   1. The research was real and landed AFTER the build, so it could only justify what existed.
//      capturedAt and designDecidedAt are both valid dates in any order; only comparing them shows
//      that the research never had a chance to change a decision.
//
//   2. The job description named "Python, FastAPI, and Postgres" and sat unread in the user's own
//      inbox while the newsroom 403'd and the stack was written down as unknown. The defect was not
//      bad searching. It was searching instead of asking.

import { readFile } from "node:fs/promises";

export const AUDIENCE_SCHEMA = "nodekit.audience-research.v1.schema.json";

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export async function readAudienceRecord(file) {
  try {
    return { record: JSON.parse(await readFile(file, "utf8")), present: true };
  } catch (error) {
    if (error.code === "ENOENT") return { record: null, present: false };
    throw error;
  }
}

export function evaluateAudienceRecord(record) {
  if (!record) return { passed: false, faults: ["no AUDIENCE record; the reviewer was never researched"] };
  const faults = [];

  const captured = Date.parse(record.capturedAt);
  const decided = Date.parse(record.designDecidedAt);
  if (Number.isFinite(captured) && Number.isFinite(decided) && captured > decided) {
    faults.push("research was captured after the design was decided, so it could only justify the build rather than shape it");
  }

  // A source recorded with read:false is honest about a failed fetch — and a failed fetch is exactly
  // when asking the user matters most, because that is the moment the web stops answering.
  const unread = (record.sources ?? []).filter((source) => source.read === false);
  const requested = record.primarySourcesRequested ?? [];
  const unasked = requested.filter((entry) => !entry.asked);
  const inferred = (record.namedStack ?? []).filter((entry) => entry.confidence === "inferred");

  if (inferred.length > 0 && unasked.length > 0) {
    faults.push(
      `${inferred.length} stack entr(ies) are inferred (${inferred.map((e) => e.technology).join(", ")}) `
        + `while ${unasked.map((e) => e.kind).join(", ")} was never asked for; that document is usually already in the user's possession`,
    );
  }
  if (unread.length > 0 && unasked.length > 0) {
    faults.push(
      `${unread.length} source(s) could not be read and ${unasked.map((e) => e.kind).join(", ")} was never asked for; `
        + "a failed fetch is the moment to ask, not the moment to infer",
    );
  }
  for (const entry of requested) {
    if (entry.asked && entry.obtained === false && !isNonEmptyString(entry.reason)) {
      faults.push(`${entry.kind} was asked for and not obtained, with no reason recorded`);
    }
  }

  return { passed: faults.length === 0, faults, inferred: inferred.map((e) => e.technology) };
}

/**
 * The opposite error, which `correctionsAvoided` records after the fact and this refuses up front:
 * "knowledge-graph company, so use Neo4j" was about to be acted on when the job description
 * explicitly named Postgres. A hunch about an audience is not evidence.
 */
export function evaluateStackSwitch(record, { technology, replacing }) {
  const named = (record?.namedStack ?? []).find((entry) => entry.technology === replacing);
  if (!named) return { allowed: true, reason: `${replacing} is not in the audience's named stack` };
  if (named.confidence === "stated") {
    return {
      allowed: false,
      reason: `${replacing} is explicitly named by the audience (${named.source}); switching to ${technology} deviates from a stated stack and needs a stated reason, not an impression of what they build`,
    };
  }
  return { allowed: true, reason: `${replacing} was only inferred, so it is not a stated constraint` };
}
