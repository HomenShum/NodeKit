import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityContractRefusal,
  evaluateCapability,
  formatCapabilityVerdict,
  parseCapabilityContract,
} from "../src/lib/capability-contract.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// The fixture is a real case, with the numbers that were really measured.
//
// On a clinical-trials system, a graph traversal was built, wired into shortlist expansion, and
// then measured: +2 to +4 entities surfaced per question, 1 of 3 questions with zero benefit, 0
// counts changed, +20-29% latency. Every one of those numbers was available before anybody asked
// whether the capability was worth keeping. The build survived because no prediction had been
// written down to lose against.
//
// So the tests below settle that same bet twice: once as it actually went, and once as it would
// have gone had the contract been written first.

const GRAPH = () => ({
  schemaVersion: "nodekit.capability-contract/v1",
  capability: "graph-traversal",
  declaredAt: "2026-08-02T09:00:00.000Z",
  questionItServes: "Which sponsors also work on the things this sponsor works on?",
  whyExistingToolsCannot: "Counting peers requires already knowing who they are; a count probe can confirm a name but cannot discover one.",
  measuredImprovement: {
    metric: "entities-surfaced-per-question",
    baseline: 12,
    predicted: 20,
    unit: "entities",
    howMeasured: "Run the five reference questions and count distinct entities in the rendered result, with and without traversal.",
  },
  killCondition: [
    { metric: "entities-surfaced-delta", comparator: "below", value: 4, unit: "entities", rationale: "Fewer than four extra entities is padding a chart, not answering a question." },
    { metric: "latency-cost-percent", comparator: "above", value: 15, unit: "percent" },
  ],
  consumers: [
    { consumerId: "peer_sponsors", kind: "user-facing-question", reachableFrom: "dimension enum" },
  ],
});

const LATER = "2026-08-02T17:00:00.000Z";

test("the contract validates against its own schema", async () => {
  assert.deepEqual(await validateSchema("nodekit.capability-contract.v1.schema.json", GRAPH(), "graph"), []);
});

test("the real measurement kills the real capability, and names which threshold did it", () => {
  // What was actually observed: +3 entities against a floor of 4, and 29% latency against a
  // ceiling of 15. Both clauses fire. Against a threshold declared that morning this is an
  // automatic verdict; written afterwards it would have been a debate.
  const verdict = evaluateCapability(GRAPH(), {
    observedAt: LATER,
    metrics: { "entities-surfaced-delta": 3, "latency-cost-percent": 29 },
  });

  assert.equal(verdict.verdict, "killed");
  assert.deepEqual(verdict.triggered.map((entry) => entry.metric).sort(), ["entities-surfaced-delta", "latency-cost-percent"]);
  assert.match(formatCapabilityVerdict(verdict), /entities-surfaced-delta observed 3, kill if below 4/);
});

test("the same capability survives once it answers a question that genuinely needs it", () => {
  // peer_sponsors: seed sponsor -> interventions -> peer sponsors. Two hops, every count probed.
  const verdict = evaluateCapability(GRAPH(), {
    observedAt: LATER,
    metrics: { "entities-surfaced-delta": 6, "latency-cost-percent": 12 },
  });

  assert.equal(verdict.verdict, "load-bearing");
  assert.equal(verdict.consumers.userFacing, 1);
});

test("a capability that beats every threshold is still decorative when only it consumes itself", () => {
  // The middle state, and the worst one to ship: it exists, it measures well, and no user question
  // reaches it. A purely numeric gate calls this a pass.
  const verdict = evaluateCapability(
    { ...GRAPH(), consumers: [{ consumerId: "shortlist-expansion", kind: "internal-only" }] },
    { observedAt: LATER, metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 } },
  );

  assert.equal(verdict.verdict, "decorative");
  assert.match(verdict.reason, /answers no question a user can ask/);
});

test("no declared consumer is decorative too, and says the plainer thing", () => {
  const verdict = evaluateCapability(
    { ...GRAPH(), consumers: [] },
    { observedAt: LATER, metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 } },
  );

  assert.equal(verdict.verdict, "decorative");
  assert.match(verdict.reason, /nothing calls this capability but itself/);
});

test("a contract declared AFTER its own measurement is refused, not scored", () => {
  // The whole mechanism. A kill condition authored once the number is known always passes, and
  // reads exactly like one that was risked. Only the timestamps can tell them apart.
  assert.throws(
    () => evaluateCapability(
      { ...GRAPH(), declaredAt: "2026-08-02T18:00:00.000Z" },
      { observedAt: LATER, metrics: { "entities-surfaced-delta": 9 } },
    ),
    (error) => error instanceof CapabilityContractRefusal && /not a threshold it could have failed/.test(error.message),
  );
});

test("a measurement simultaneous with the declaration is refused as well", () => {
  assert.throws(
    () => evaluateCapability(GRAPH(), { observedAt: "2026-08-02T09:00:00.000Z", metrics: { "entities-surfaced-delta": 9 } }),
    CapabilityContractRefusal,
  );
});

test("measuring nothing is insufficient, never a keep-by-default", () => {
  const verdict = evaluateCapability(GRAPH(), { observedAt: LATER, metrics: {} });

  assert.equal(verdict.verdict, "insufficient");
  assert.match(verdict.reason, /never kept by default/);
  assert.deepEqual(verdict.unmeasured.sort(), ["entities-surfaced-delta", "latency-cost-percent"]);
});

test("a kill clause whose metric nobody measured cannot clear the capability", () => {
  // Latency was the clause that fired hardest in the real case. Measuring only the flattering
  // metric and reporting a pass is the move this prevents.
  const verdict = evaluateCapability(GRAPH(), {
    observedAt: LATER,
    metrics: { "entities-surfaced-delta": 9 },
  });

  assert.equal(verdict.verdict, "insufficient");
  assert.deepEqual(verdict.unmeasured, ["latency-cost-percent"]);
  assert.match(verdict.reason, /an unrun check is not a passed one/);
});

test("a bet with no losing outcome is refused at parse time", () => {
  assert.throws(
    () => parseCapabilityContract({ ...GRAPH(), killCondition: [] }),
    (error) => /no losing outcome is not a bet/.test(error.message),
  );
});

test("a prediction equal to the baseline is refused; doing nothing would satisfy it", () => {
  assert.throws(
    () => parseCapabilityContract({ ...GRAPH(), measuredImprovement: { ...GRAPH().measuredImprovement, predicted: 12 } }),
    (error) => /predicts no improvement and cannot be lost/.test(error.message),
  );
});

test("a prose threshold is refused, because prose is what gets argued with", () => {
  assert.throws(
    () => parseCapabilityContract({
      ...GRAPH(),
      killCondition: [{ metric: "entities-surfaced-delta", comparator: "below", value: "not many" }],
    }),
    (error) => /a prose threshold is one that gets argued with/.test(error.message),
  );
});

test("killed outranks decorative — a failed threshold is not first a staffing question", () => {
  const verdict = evaluateCapability(
    { ...GRAPH(), consumers: [] },
    { observedAt: LATER, metrics: { "entities-surfaced-delta": 1, "latency-cost-percent": 40 } },
  );

  assert.equal(verdict.verdict, "killed");
});

// --- what the adversarial review reproduced ------------------------------------------------------

test("a timezone offset cannot smuggle a measurement in before the contract", async () => {
  // The bypass Codex found, and it defeated the whole mechanism. Comparing ISO strings
  // lexicographically, "2026-08-03T11:00:00+02:00" sorts AFTER "2026-08-03T10:00:00.000Z" while
  // being an hour earlier as an instant — so a contract authored after its own evidence settled
  // clean. The one comparison the design turns on, beaten by a suffix.
  assert.throws(
    () => evaluateCapability(
      { ...GRAPH(), declaredAt: "2026-08-03T10:00:00.000Z" },
      { observedAt: "2026-08-03T11:00:00+02:00", metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 } },
    ),
    (error) => error instanceof CapabilityContractRefusal && /could have failed/.test(error.message),
  );
});

test("an offset measurement that is genuinely later still settles", () => {
  // The fix must not reject all offsets — only ones that are earlier as instants.
  const verdict = evaluateCapability(
    { ...GRAPH(), declaredAt: "2026-08-03T10:00:00.000Z" },
    { observedAt: "2026-08-03T14:00:00+02:00", metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 } },
  );

  assert.equal(verdict.verdict, "load-bearing");
});

test("an unparseable observedAt is refused rather than compared", () => {
  assert.throws(
    () => evaluateCapability(GRAPH(), { observedAt: "last Tuesday", metrics: { "entities-surfaced-delta": 9 } }),
    (error) => /not a parseable timestamp/.test(error.message),
  );
});

test("a declared consumer measured unreachable does not make a capability load-bearing", () => {
  // Reachability was computed and then ignored: consumersReachable: [] returned load-bearing with
  // reachable 0, over a reason string asserting a consumer "can reach it". A consumer that cannot
  // be reached is a plan, not a caller.
  const verdict = evaluateCapability(GRAPH(), {
    observedAt: LATER,
    metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 },
    consumersReachable: [],
  });

  assert.equal(verdict.verdict, "decorative");
  assert.match(verdict.reason, /a plan, not a caller/);
});

test("a consumer measured reachable does settle load-bearing", () => {
  const verdict = evaluateCapability(GRAPH(), {
    observedAt: LATER,
    metrics: { "entities-surfaced-delta": 9, "latency-cost-percent": 2 },
    consumersReachable: ["peer_sponsors"],
  });

  assert.equal(verdict.verdict, "load-bearing");
  assert.equal(verdict.consumers.reachableUserFacing, 1);
});
