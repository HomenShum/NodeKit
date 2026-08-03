// Three gaps a six-agent audit found open across the ChatGPT threads, each one a rule that had been
// decided and never made checkable.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionReadiness, formatProductionReadiness, parseProductionReadiness, PRODUCTION_CHECKS } from "../src/lib/production-gate.mjs";
import { deriveIndependence, parseReviewContext, requireIndependence } from "../src/lib/review-context.mjs";
import { requireTrustForCanonicalPromotion, verifyContinuity } from "../src/lib/working-state.mjs";

// ---- gap 4: seven checks, and absence blocks -------------------------------------------------
const check = (id, over = {}) => ({ id, outcome: "PASS", evidenceRef: `proof/${id}.json`, attestedBy: "external-auditor", ...over });
const allPass = () => ({ application: "salon", revision: "abc1234", checks: PRODUCTION_CHECKS.map((id) => check(id)) });

test("a question nobody asked is NOT_RUN, and NOT_RUN blocks release", () => {
  const full = parseProductionReadiness(allPass());
  assert.equal(evaluateProductionReadiness(full).releasable, true);

  // The failure being caught: silence reading as absence-of-problem.
  const omitted = { ...allPass(), checks: allPass().checks.filter((c) => c.id !== "TENANT_ISOLATION") };
  const verdict = evaluateProductionReadiness(parseProductionReadiness(omitted));
  assert.equal(verdict.releasable, false);
  assert.match(verdict.blockers.join(" "), /TENANT_ISOLATION is absent/);
  assert.match(formatProductionReadiness(verdict), /BLOCKED/);
});

test("neither the builder nor the platform may certify the thing it built", () => {
  for (const attestedBy of ["nodekit", "NodeKit", "builder", "self"]) {
    const record = allPass();
    record.checks[0].attestedBy = attestedBy;
    assert.throws(() => parseProductionReadiness(record), /may not certify it/, attestedBy);
  }
});

test("only payment integrity is waivable, and only by someone who looked", () => {
  const waived = allPass();
  waived.checks = waived.checks.map((c) => (c.id === "PAYMENT_INTEGRITY"
    ? { id: c.id, outcome: "NOT_APPLICABLE", verifiedAbsentBy: "external-auditor" } : c));
  assert.equal(evaluateProductionReadiness(parseProductionReadiness(waived)).releasable, true);

  const bare = allPass();
  bare.checks = bare.checks.map((c) => (c.id === "PAYMENT_INTEGRITY" ? { id: c.id, outcome: "NOT_APPLICABLE" } : c));
  assert.throws(() => parseProductionReadiness(bare), /requires someone who looked/);

  const dodged = allPass();
  dodged.checks = dodged.checks.map((c) => (c.id === "TENANT_ISOLATION"
    ? { id: c.id, outcome: "NOT_APPLICABLE", verifiedAbsentBy: "x" } : c));
  assert.throws(() => parseProductionReadiness(dodged), /not waivable/);
});

// ---- gap 3: independence is derived, never declared -------------------------------------------
const parties = (over = {}) => ({
  parties: [
    { role: "producer", principal: over.producer ?? "team-a" },
    { role: "evaluator", principal: over.evaluator ?? "team-b" },
    { role: "approver", principal: over.approver ?? "team-c" },
    { role: "operator", principal: over.operator ?? "team-d" },
  ],
});

test("a record cannot supply its own independence verdict", () => {
  for (const key of ["independent", "independentlyEvaluated", "thirdParty", "armsLength"]) {
    assert.throws(() => parseReviewContext({ ...parties(), [key]: true }), /never declared/, key);
  }
});

test("independence is derived from who the parties actually were", () => {
  assert.equal(deriveIndependence(parties()).level, "party");
  assert.equal(deriveIndependence(parties({ evaluator: "team-a" })).level, "none");

  // The YC-S26 gap exactly: a different evaluator, but the judged party runs the campaign.
  const operatorIsProducer = deriveIndependence(parties({ operator: "team-a" }));
  assert.equal(operatorIsProducer.level, "process");
  assert.match(operatorIsProducer.reason, /re-run until it likes the answer/);

  assert.throws(() => requireIndependence(parties({ operator: "team-a" })), /below the required party/);
  assert.equal(requireIndependence(parties()).level, "party");
});

// ---- gap 2: trust below H2 cannot promote a canonical record ----------------------------------
test("a key the agent can reach cannot bind the ledger that constrains it", () => {
  for (const level of ["H0", "H1"]) {
    assert.throws(() => requireTrustForCanonicalPromotion(level), /same protection domain/, level);
  }
  assert.equal(requireTrustForCanonicalPromotion("H2"), "H2");
  assert.equal(requireTrustForCanonicalPromotion("H3"), "H3");
});

// ---- gap 1: continuity, and the field that dies first -----------------------------------------
const state = (over = {}) => ({
  objective: "migrate the notebook without losing behaviour",
  decisions: [{ id: "d1" }],
  constraints: [{ id: "c1" }],
  evidence: [{ id: "e1" }],
  failedApproaches: [{ approach: "rewrite the parser", whyItFailed: "lost three note types silently" }],
  openQuestions: [{ id: "q1" }],
  blockers: [],
  nextAction: "port the capture path",
  ...over,
});

test("compaction that drops what was already tried is a silent loss, and is caught", () => {
  assert.equal(verifyContinuity(state(), state()).continuous, true);

  const forgot = state({ failedApproaches: [] });
  const verdict = verifyContinuity(state(), forgot);
  assert.equal(verdict.continuous, false);
  assert.match(verdict.losses.join(" "), /failedApproaches: 1 entr/);

  const reaimed = state({ objective: "something else" });
  assert.match(verifyContinuity(state(), reaimed).losses.join(" "), /quietly re-aims/);
});

test("a failed approach without a reason cannot prevent the retry it exists to prevent", () => {
  assert.throws(
    () => verifyContinuity(state(), state({ failedApproaches: [{ approach: "rewrite the parser" }] })),
    /needs whyItFailed/,
  );
});
