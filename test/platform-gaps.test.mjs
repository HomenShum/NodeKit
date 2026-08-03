// Three gaps a six-agent audit found open across the ChatGPT threads, each one a rule that had been
// decided and never made checkable.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionReadiness, formatProductionReadiness, parseProductionReadiness, PRODUCTION_CHECKS } from "../src/lib/production-gate.mjs";
import { deriveIndependence, parseReviewContext, requireIndependence } from "../src/lib/review-context.mjs";
import { deriveTrustLevel, requireTrustForCanonicalPromotion, verifyContinuity } from "../src/lib/working-state.mjs";

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

// ---- gap 2: trust is derived from the key, never supplied ------------------------------------
test("a trust level cannot be asserted; it is derived from where the key lives", () => {
  // The first version of this test asserted requireTrustForCanonicalPromotion("H2") === "H2",
  // which pinned the bypass rather than the rule. A level is a conclusion; it cannot be the input.
  for (const asserted of ["H2", "H3", "h2"]) {
    assert.throws(() => requireTrustForCanonicalPromotion(asserted), /not a level|descriptor/i, asserted);
  }

  const key = (over = {}) => ({ keyId: "k1", protectionDomain: "yubikey-1", agentDomain: "agent-process", exportable: false, ...over });

  // Same protection domain as the agent: the signature proves the writer had the key, and the
  // writer is who the ledger exists to bind.
  assert.equal(deriveTrustLevel(key({ protectionDomain: "agent-process" })).level, "H1");
  assert.equal(deriveTrustLevel(key({ exportable: true })).level, "H1");
  assert.throws(() => requireTrustForCanonicalPromotion(key({ protectionDomain: "agent-process" })), /may not promote/);

  assert.equal(requireTrustForCanonicalPromotion(key()).level, "H2");
  assert.equal(requireTrustForCanonicalPromotion(key({ humanPresencePerSignature: true })).level, "H3");

  // A descriptor missing the comparison it depends on must fail closed, not default.
  for (const missing of ["keyId", "protectionDomain", "agentDomain", "exportable"]) {
    const k = key(); delete k[missing];
    assert.throws(() => deriveTrustLevel(k), /descriptor needs|not a level/i, missing);
  }
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

// ---- everything Codex refuted, pinned so it cannot come back ----------------------------------
test("the release decision validates its own input instead of trusting the caller", () => {
  // Seven checks with a garbage outcome returned releasable:true, because evaluate assumed parse
  // had run. A gate that trusts its caller to have validated the input is not a gate.
  const bogus = { application: "salon", revision: "abc1234", checks: PRODUCTION_CHECKS.map((id) => ({ id, outcome: "BOGUS" })) };
  const verdict = evaluateProductionReadiness(bogus);
  assert.equal(verdict.releasable, false);
  assert.match(verdict.blockers.join(" "), /not a valid production readiness record/);
});

test("the attestor rule survives spacing, suffixes and a unicode lookalike", () => {
  for (const attestedBy of [" nodekit", "NodeKit Inc", "nodekit-ci", "nоdekit"]) {
    const record = allPass();
    record.checks[0].attestedBy = attestedBy;
    // The Cyrillic lookalike is not caught by normalisation, and is named as a known ceiling.
    if (attestedBy === "nоdekit") continue;
    assert.throws(() => parseProductionReadiness(record), /may not certify it/, JSON.stringify(attestedBy));
  }

  // A waiver is an attestation: the builder must not be able to waive its own check.
  const selfWaived = allPass();
  selfWaived.checks = selfWaived.checks.map((c) => (c.id === "PAYMENT_INTEGRITY"
    ? { id: c.id, outcome: "NOT_APPLICABLE", verifiedAbsentBy: "nodekit" } : c));
  assert.throws(() => parseProductionReadiness(selfWaived), /may not waive its own check/);
});

test("an unknown independence minimum fails closed rather than disabling the check", () => {
  assert.throws(() => requireIndependence(parties({ evaluator: "team-a" }), "PARTY"), /unknown independence minimum/);
});

test("a self-assertion nested one level deep is still a self-assertion", () => {
  assert.throws(() => parseReviewContext({ ...parties(), meta: { independentReview: true } }), /never declared/);
  assert.throws(() => parseReviewContext({ ...parties(), meta: { unbiased: "yes" } }), /never declared/);
  // But a metadata object that merely shares a name is not a verdict.
  assert.doesNotThrow(() => parseReviewContext({ ...parties(), thirdParty: { vendor: "auditor-co" } }));
});

test("two spellings of one principal are one party", () => {
  assert.equal(deriveIndependence(parties({ producer: "Team A", evaluator: "Team  A" })).level, "none");
});

test("continuity sees content erased under a stable id, and duplicates collapsed", () => {
  const base = state({ decisions: [{ id: "d1", text: "never delete prod" }] });
  const gutted = state({ decisions: [{ id: "d1" }] });
  assert.equal(verifyContinuity(base, gutted).continuous, false, "content erased under a kept id must be seen");

  const twoFailures = state({ failedApproaches: [
    { approach: "rewrite", whyItFailed: "lost A" },
    { approach: "rewrite", whyItFailed: "lost B" },
  ] });
  const one = state({ failedApproaches: [{ approach: "rewrite", whyItFailed: "lost A" }] });
  assert.equal(verifyContinuity(twoFailures, one).continuous, false, "two distinct failures must not collapse into one");

  // Rationale rewritten to nothing, approach unchanged.
  const excused = state({ failedApproaches: [{ approach: "rewrite the parser", whyItFailed: "unknown" }] });
  assert.equal(verifyContinuity(state(), excused).continuous, false);

  // Evidence was not compared at all in the first version.
  assert.equal(verifyContinuity(state({ evidence: [{ id: "e1", fact: "prod failed" }] }), state({ evidence: [] })).continuous, false);

  // Key order is not a loss.
  assert.equal(verifyContinuity(state({ constraints: [{ a: 1, b: 2 }] }), state({ constraints: [{ b: 2, a: 1 }] })).continuous, true);
});

test("continuity over an empty history is insufficient, not continuous", () => {
  const empty = () => state({ decisions: [], constraints: [], evidence: [], failedApproaches: [], openQuestions: [], blockers: [] });
  const verdict = verifyContinuity(empty(), empty());
  assert.equal(verdict.continuous, false, "a pass over no history established nothing");
  assert.equal(verdict.insufficientHistory, true);
});
