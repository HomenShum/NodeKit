// Borrowed from a Life Sciences Knowledge Graph, where entity resolution is the load-bearing
// problem rather than a detail. The discipline worth stealing is that an alias is a claim and a
// claim needs evidence — a resolution nobody verified silently merges two parties who are not the
// same, which is strictly worse than not resolving at all.

import assert from "node:assert/strict";
import test from "node:test";
import { assertAttestorIsIndependent, buildPrincipalRegistry, surfaceForm } from "../src/lib/principal-identity.mjs";

const registry = () => buildPrincipalRegistry([
  { id: "acme-audit", aliases: [
    { text: "Acme Audit LLC", evidence: "engagement-contract:2026-01-12" },
    { text: "Acme Audit", evidence: "engagement-contract:2026-01-12" },
  ] },
  { id: "nodekit", aliases: [
    { text: "NodeKit Inc", evidence: "repo:package.json#name" },
    { text: "nodekit-ci", evidence: "ci:service-account" },
    // The alias that carries none of the denylist's tokens — a subsidiary, a CI service account
    // under a company name, a contractor. This is the shape entity resolution exists for.
    { text: "Cafecorner Systems", evidence: "org-chart:2026-02" },
  ] },
]);

test("the three spellings that defeated the denylist all resolve to one identity", () => {
  const r = registry();
  for (const spelling of ["NodeKit Inc", " nodekit ", "nodekit-ci", "nоdekit"]) {
    assert.equal(r.resolve(spelling), "nodekit", spelling);
  }
  // Including the Cyrillic lookalike, via the same fold.
  assert.equal(surfaceForm("nоdekit"), "nodekit");
});

test("an alias without evidence is a hunch and is refused", () => {
  assert.throws(
    () => buildPrincipalRegistry([{ id: "x", aliases: [{ text: "X Corp" }] }]),
    /needs evidence; an unverified alias merges two parties on a hunch/,
  );
});

test("one surface form cannot resolve to two identities", () => {
  assert.throws(
    () => buildPrincipalRegistry([
      { id: "a", aliases: [{ text: "Shared Name", evidence: "e1" }] },
      { id: "b", aliases: [{ text: "shared  name", evidence: "e2" }] },
    ]),
    /cannot resolve to two identities/,
  );
});

test("unknown is a real answer, distinct from same and different", () => {
  const r = registry();
  assert.equal(r.sameParty("Acme Audit LLC", "acme-audit"), "same");
  assert.equal(r.sameParty("NodeKit Inc", "Acme Audit"), "different");
  // The state string comparison never had. Two strangers are not provably distinct.
  assert.equal(r.sameParty("Someone Else", "Another Party"), "unknown");
});

test("an unregistered attestor is refused, not assumed independent", () => {
  const r = registry();
  assert.equal(assertAttestorIsIndependent(r, "Acme Audit LLC", ["nodekit"]), "acme-audit");

  // The whole point: renaming the producer must not buy independence.
  assert.throws(() => assertAttestorIsIndependent(r, "NodeKit Inc", ["nodekit"]), /which produced the thing/);
  assert.throws(() => assertAttestorIsIndependent(r, "nodekit-ci", ["nodekit"]), /which produced the thing/);

  assert.throws(
    () => assertAttestorIsIndependent(r, "Totally New Auditor", ["nodekit"]),
    /cannot be shown independent/,
    "treating unknown as independent is how a builder certifies itself under a new name",
  );
});

// The registry is only worth building if it supersedes the denylist at the two places that named
// canonical identity as their ceiling.
test("a registry closes the gap the denylist could only narrow", async () => {
  const { parseProductionReadiness, PRODUCTION_CHECKS } = await import("../src/lib/production-gate.mjs");
  const { deriveIndependence } = await import("../src/lib/review-context.mjs");

  const r = registry();
  r.producerIds = ["nodekit"];
  const record = (attestedBy) => ({
    application: "salon",
    revision: "abc1234",
    checks: PRODUCTION_CHECKS.map((id) => ({ id, outcome: "PASS", evidenceRef: `proof/${id}.json`, attestedBy })),
  });

  // A name carrying none of the denylist's tokens, that IS the producer. The denylist cannot see
  // it by construction — no string of "nodekit" appears — and the registry resolves it.
  assert.doesNotThrow(() => parseProductionReadiness(record("Cafecorner Systems")), "denylist path: nothing to match on");
  assert.throws(() => parseProductionReadiness(record("Cafecorner Systems"), r), /resolves to nodekit/, "registry path: it is the producer");

  // And a genuine third party passes under both.
  assert.doesNotThrow(() => parseProductionReadiness(record("Acme Audit LLC"), r));

  // An attestor nobody registered is refused rather than assumed independent.
  assert.throws(() => parseProductionReadiness(record("Brand New Auditor"), r), /not a registered principal/);

  // review-context: two aliases of one party are one party.
  const parties = [
    { role: "producer", principal: "NodeKit Inc" },
    { role: "evaluator", principal: "Cafecorner Systems" },
    { role: "approver", principal: "Acme Audit" },
    { role: "operator", principal: "Acme Audit LLC" },
  ];
  assert.equal(deriveIndependence({ parties }, r).level, "none", "an alias of the producer is the producer");
  assert.equal(deriveIndependence({ parties }).level, "party", "without a registry it is still only name comparison");
});
