import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// The LEARN stage exists to answer "what happened after launch, from which source, and what did NOT
// get observed". Absence of observation is the NORMAL case for this stage, so every test below is a
// probe of one question: can a pack be written that reads as a clean result while having measured
// nothing? Each `assert.ok(errors.length)` is a way that used to be possible and is now a schema
// violation. A schema tested only against its own happy fixture proves nothing about the failure it
// was built to prevent.

const SCHEMA = "nodekit.observation-pack.v1.schema.json";

async function fixture() {
  return JSON.parse(
    await readFile(new URL("./fixtures/builder-journey/salon.observation-pack.json", import.meta.url), "utf8"),
  );
}

async function errorsFor(mutate) {
  const pack = await fixture();
  mutate(pack);
  return validateSchema(SCHEMA, pack, "observation-pack");
}

test("the committed fixture validates, and it carries an unobserved dimension", async () => {
  const pack = await fixture();
  const errors = await validateSchema(SCHEMA, pack, "observation-pack");
  assert.deepEqual(errors, [], errors.join("\n"));

  // The case the schema exists for must actually be present in the fixture, or the fixture is
  // demonstrating the easy half of the contract.
  const unobserved = Object.keys(pack.content.coverage.unobserved);
  assert.ok(unobserved.length > 0, "the fixture must exercise at least one unobserved dimension");
  assert.equal(pack.content.coverage.unobserved.errors.state, "not-instrumented");
  assert.equal(pack.content.coverage.unobserved.feedback.state, "refused");
});

// The flagship confusion: "no errors observed" from an instrument that saw nothing.
test("a no-instances claim backed by zero samples is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.coverage.observed.reachability.sampleCount = 0;
  });
  assert.ok(errors.length > 0, "sampleCount 0 with outcome no-instances must not validate");
});

test("zero samples is expressible — as inconclusive, which is the honest form of the same run", async () => {
  const errors = await errorsFor((pack) => {
    const report = pack.content.coverage.observed.reachability;
    report.sampleCount = 0;
    report.outcome = "inconclusive";
  });
  assert.deepEqual(errors, [], errors.join("\n"));
});

// An unobserved dimension must not be able to grow the vocabulary of a result.
test("an unobserved dimension cannot carry an outcome, a sampleCount or findings", async () => {
  for (const smuggled of [{ outcome: "no-instances" }, { sampleCount: 0 }, { findings: [] }, { conclusion: "no errors" }]) {
    const errors = await errorsFor((pack) => {
      Object.assign(pack.content.coverage.unobserved.errors, smuggled);
    });
    assert.ok(
      errors.length > 0,
      `an unobserved report accepted ${JSON.stringify(smuggled)}, which lets a gap read as a finding`,
    );
  }
});

test("an unobserved dimension must name what would observe it, so the gap feeds the next DECIDE", async () => {
  const errors = await errorsFor((pack) => {
    delete pack.content.coverage.unobserved.errors.wouldRequire;
  });
  assert.ok(errors.length > 0, "an unobserved dimension without wouldRequire is a dead end, not a handoff");
});

// Coverage is a partition. Silently narrowing scope is the quietest vacuous pass there is.
test("dropping a dimension from coverage entirely is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    delete pack.content.coverage.unobserved.errors;
  });
  assert.ok(errors.length > 0, "a dimension present in neither map must fail; omission is not an answer");
});

test("claiming a dimension in BOTH maps is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.coverage.observed.errors = {
      sourceIds: ["src-edge-access-log"],
      instrumentIds: ["ins-session-count"],
      window: { from: "2026-07-21T00:00:00Z", to: "2026-07-28T00:00:00Z" },
      measured: "count of 5xx responses: 0",
      sampleCount: 41,
      outcome: "no-instances",
      findings: [],
    };
  });
  assert.ok(errors.length > 0, "a dimension may not be simultaneously observed and unobserved");
});

// An instrument must state what it measured, not only what it concluded (docs/VACUOUS_PASS.md).
test("an observed report without `measured` is REJECTED even when it has a conclusion", async () => {
  const errors = await errorsFor((pack) => {
    const report = pack.content.coverage.observed.usage;
    delete report.measured;
    report.conclusion = "usage was healthy";
  });
  assert.ok(errors.length > 0, "a conclusion with no stated measurement is the vacuous pass");
});

test("an observed report must name the source and the instrument that produced it", async () => {
  for (const field of ["sourceIds", "instrumentIds"]) {
    const errors = await errorsFor((pack) => {
      delete pack.content.coverage.observed.usage[field];
    });
    assert.ok(errors.length > 0, `an observation without ${field} cannot be audited for having watched anything`);
  }
});

// Authority: derived by verification, never authored.
test("promotionAuthorized true is REJECTED; false is the only writable value", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.promotionAuthorized = true;
  });
  assert.ok(errors.length > 0, "a producer may write promotionAuthorized false and may never write true");
});

test("self-approval fields are REJECTED anywhere in content", async () => {
  for (const field of ["reviewedBy", "approved", "verdict", "approvedBy", "interpretation"]) {
    const errors = await errorsFor((pack) => {
      pack.content[field] = "homen";
    });
    assert.ok(errors.length > 0, `${field} must be derived by verification, never accepted as input`);
  }
});

// inputs is a binding, not a label.
test("a pack that does not bind BOTH upstream artifacts is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    pack.inputs = pack.inputs.filter((i) => i.schemaVersion !== "nodekit.story-pack/v1");
  });
  assert.ok(errors.length > 0, "LEARN consumes LaunchManifest and StoryPack; both digests must be present");
});

test("an inputs entry without a sha256 digest is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    delete pack.inputs[0].sha256;
  });
  assert.ok(errors.length > 0, "a stage that cannot digest what it consumed was handed a name");
});

// A verdict on the success condition must point at something.
test("a met/not-met success condition with no supporting observations is REJECTED", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.decideFeedback.successCondition.status = "met";
    pack.content.decideFeedback.successCondition.evidenceObservationIds = [];
  });
  assert.ok(errors.length > 0, "declaring the success condition met with nothing to point at must fail");
});

test("not-observable must name WHICH unobserved dimensions made it so", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.decideFeedback.successCondition.status = "not-observable";
    pack.content.decideFeedback.successCondition.evidenceObservationIds = [];
  });
  assert.ok(errors.length > 0, "not-observable without named unobserved dimensions is an excuse, not a report");
});

test("not-observable is expressible when it names its gap", async () => {
  const errors = await errorsFor((pack) => {
    const sc = pack.content.decideFeedback.successCondition;
    sc.status = "not-observable";
    sc.basis = "The success condition turns on error-free generation, and errors were never instrumented.";
    sc.evidenceObservationIds = [];
    sc.unobservedDimensions = ["errors"];
  });
  assert.deepEqual(errors, [], errors.join("\n"));
});

// Measured vs inferred, so a story cannot wear an observation's schema.
test("an inferred observation must name what it was inferred from", async () => {
  const errors = await errorsFor((pack) => {
    pack.content.observations[0].inferred = true;
  });
  assert.ok(errors.length > 0, "an inference with no basis is an opinion in an observation's shape");
});

// The loop: Observe -> Classify. Classification must not be a translation.
test("every observation is field-identical to the friction record friction-loop already reads", async () => {
  const pack = await fixture();
  // src/lib/friction-loop.mjs#fromBaseline reads exactly these off a friction record.
  const required = ["id", "severity", "kind", "observed", "consequence"];
  for (const observation of pack.content.observations) {
    for (const field of required) {
      assert.ok(field in observation, `observation ${observation.id} is missing ${field}; classification would be lossy`);
    }
    assert.ok(["P0", "P1", "P2", "P3"].includes(observation.severity), "severity must use the loop's own ladder");
  }
});

test("collectFriction consumes the pack's observations with an identity map, not a translation", async () => {
  const { collectFriction } = await import("../src/lib/friction-loop.mjs");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;

  const pack = await fixture();
  const dir = await mkdtemp(path.join(tmpdir(), "observation-pack-"));
  // The identity map. If this ever needs a field rename, the schema has drifted from the loop.
  await writeFile(path.join(dir, "friction.json"), JSON.stringify({ friction: pack.content.observations }), "utf8");

  const friction = await collectFriction(dir, ["friction.json"]);
  assert.equal(friction.length, pack.content.observations.length);
  // Sorted by the loop's own severity ladder, so the P0s lead.
  assert.equal(friction[0].severity, "P0");
  assert.ok(friction.every((f) => f.kind !== "unclassified"), "every observation carried its own class through");
  assert.ok(friction.every((f) => typeof f.observed === "string" && f.observed.length > 0));
});
