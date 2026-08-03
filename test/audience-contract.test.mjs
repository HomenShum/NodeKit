// The job description named "Python, FastAPI, and Postgres". It was in the user's inbox the whole
// time. Web research 403'd and honestly concluded "I don't know their stack" — which was true, and
// avoidable by asking. These tests hold the two halves of that: research must land before the
// design is decided, and a primary document must be asked for before anything is inferred.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudienceContract, evaluateStackSwitch, parseAudienceContract } from "../src/lib/audience-contract.mjs";

const contract = (over = {}) => parseAudienceContract(`
audience:
  org: Cheiron
  reads: "as a miniature of their Life Sciences Knowledge Graph"
researchedAt: "${over.researchedAt ?? "2026-08-01T09:00:00.000Z"}"
designDecidedAt: "${over.designDecidedAt ?? "2026-08-01T12:00:00.000Z"}"
primarySourcesConsidered:
  - kind: job-description
    askedUser: ${over.askedUser ?? true}
    obtained: ${over.obtained ?? true}
${over.reason ? `    reason: "${over.reason}"\n` : ""}stack:
  - technology: Postgres
    evidenceTier: ${over.tier ?? "primary-document"}
    sourceRef: "job description: 'backend services and APIs on Python, FastAPI, and Postgres'"
`);

test("a contract researched before the design was decided passes", () => {
  assert.equal(evaluateAudienceContract(contract()).passed, true);
});

test("research that lands after the design could only justify it", () => {
  const late = contract({ researchedAt: "2026-08-01T18:00:00.000Z" });
  const verdict = evaluateAudienceContract(late);
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /could only justify the build rather than shape it/);
});

test("inferring a stack while never asking for the document that answers it", () => {
  // The exact failure: searched the web, never asked the user, guessed.
  const guessed = parseAudienceContract(`
audience: {org: Cheiron, reads: "as a knowledge graph"}
researchedAt: "2026-08-01T09:00:00.000Z"
designDecidedAt: "2026-08-01T12:00:00.000Z"
primarySourcesConsidered:
  - kind: job-description
    askedUser: false
    obtained: false
stack:
  - technology: FastAPI
    evidenceTier: inferred
    assumed: true
`);
  const verdict = evaluateAudienceContract(guessed);
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /never asked for/);
  assert.deepEqual(verdict.inferredClaims, ["FastAPI"]);
});

test("an inferred stack claim must look like a guess", () => {
  assert.throws(
    () => parseAudienceContract(`
audience: {org: X, reads: y}
researchedAt: "2026-08-01T09:00:00.000Z"
designDecidedAt: "2026-08-01T12:00:00.000Z"
primarySourcesConsidered: []
stack:
  - technology: FastAPI
    evidenceTier: inferred
`),
    /not marked assumed:true/,
  );
});

test("asking and being refused is an answer; not chasing it is not", () => {
  const unchased = contract({ obtained: false });
  assert.match(evaluateAudienceContract(unchased).faults.join(" "), /no reason recorded/);
  const refused = contract({ obtained: false, reason: "user could not share the rubric" });
  assert.equal(evaluateAudienceContract(refused).passed, true);
});

test("a late reframe cannot replace a stronger claim with a weaker one", () => {
  // "damn, we should have just used neo4j" — after seeing the reviewer builds knowledge graphs.
  // The JD names Postgres and never mentions Neo4j. The vibe is not evidence.
  const blocked = evaluateStackSwitch(contract(), { technology: "Neo4j", replacing: "Postgres", evidenceTier: "inferred" });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /weaker claim replacing a stronger one/);

  const allowed = evaluateStackSwitch(contract(), { technology: "Neo4j", replacing: "Postgres", evidenceTier: "primary-document" });
  assert.equal(allowed.allowed, true);
});
