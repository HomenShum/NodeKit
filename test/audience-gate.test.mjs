// Enforcement for the AUDIENCE gate added in 36826262d. The schema defines the record; these hold
// the two things a schema cannot see — whether the research arrived in time to change anything, and
// whether the document that would have answered the question was ever asked for.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudienceRecord, evaluateStackSwitch } from "../src/lib/audience-contract.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const SCHEMA = "nodekit.audience-research.v1.schema.json";

const record = (over = {}) => ({
  id: "audience-cheiron",
  capturedAt: "2026-08-01",
  designDecidedAt: "2026-08-02",
  deliverable: "clinical-trials take-home",
  audience: { organisation: "Cheiron" },
  productThesis: "Life Sciences Knowledge Graph: one model over biomedical, clinical, regulatory knowledge",
  namedStack: [{ technology: "Postgres", source: "job description: 'backend services and APIs on Python, FastAPI, and Postgres'", confidence: "stated" }],
  statedNeeds: [{ need: "ground AI outputs in source data with traceable, verifiable citations", source: "job description" }],
  sources: [{ url: "https://cheiron.bio/newsroom", read: true }],
  primarySourcesRequested: [{ kind: "job-description", asked: true, obtained: true }],
  ...over,
});

test("a well-formed record validates and passes the gate", async () => {
  const doc = record();
  assert.deepEqual(await validateSchema(SCHEMA, doc, "audience"), []);
  assert.equal(evaluateAudienceRecord(doc).passed, true);
});

test("research captured after the design could only justify it", () => {
  const late = record({ capturedAt: "2026-08-03" });
  const verdict = evaluateAudienceRecord(late);
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /could only justify the build rather than shape it/);
});

test("inferring a stack while never asking for the document that states it", () => {
  // The exact Cheiron failure: newsroom 403'd, stack recorded as unknown, JD unread in the inbox.
  const guessed = record({
    namedStack: [{ technology: "FastAPI", source: "guessed from the domain", confidence: "inferred" }],
    sources: [{ url: "https://cheiron.bio/newsroom", read: false }],
    primarySourcesRequested: [{ kind: "job-description", asked: false, obtained: false }],
  });
  const verdict = evaluateAudienceRecord(guessed);
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /already in the user's possession/);
  assert.match(verdict.faults.join(" "), /a failed fetch is the moment to ask/);
  assert.deepEqual(verdict.inferred, ["FastAPI"]);
});

test("asked and refused is an answer; never chased is not", () => {
  const unchased = record({ primarySourcesRequested: [{ kind: "rubric", asked: true, obtained: false }] });
  assert.match(evaluateAudienceRecord(unchased).faults.join(" "), /no reason recorded/);
  const refused = record({ primarySourcesRequested: [{ kind: "rubric", asked: true, obtained: false, reason: "not shareable" }] });
  assert.equal(evaluateAudienceRecord(refused).passed, true);
});

test("a hunch about the audience cannot override a stack they explicitly named", () => {
  const blocked = evaluateStackSwitch(record(), { technology: "Neo4j", replacing: "Postgres" });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /deviates from a stated stack/);

  const inferredOnly = record({ namedStack: [{ technology: "Postgres", source: "assumed", confidence: "inferred" }] });
  assert.equal(evaluateStackSwitch(inferredOnly, { technology: "Neo4j", replacing: "Postgres" }).allowed, true);
});
