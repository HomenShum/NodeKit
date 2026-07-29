import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// The LaunchManifest exists because "pushed" reads identically to "shipped" in every artifact this
// repository produced before it. These tests probe BOTH directions: the honest not-observed fixture
// must validate, and every shortcut to a green claim must fail. A schema only checked in the
// direction it was authored for is the vacuous pass wearing a different hat.

const SCHEMA = "nodekit.launch-manifest.v1.schema.json";

async function fixture() {
  return JSON.parse(
    await readFile(new URL("./fixtures/builder-journey/salon.launch-manifest.json", import.meta.url), "utf8"),
  );
}

/** Mutate a deep clone so each case starts from the same known-good document. */
async function mutated(fn) {
  const doc = await fixture();
  fn(doc);
  return doc;
}

async function rejects(doc, label) {
  const errors = await validateSchema(SCHEMA, doc, label);
  assert.ok(errors.length > 0, `${label}: expected rejection, schema accepted the document`);
  return errors;
}

test("the salon LaunchManifest — a deploy whose DOM signal was NOT observed — validates", async () => {
  const doc = await fixture();
  assert.deepEqual(await validateSchema(SCHEMA, doc, "salon-launch"), []);
  // The case this schema exists for: deployed, honestly not live.
  assert.equal(doc.content.liveness.claim, "deployed-signal-not-observed");
});

test("a green claim is REJECTED when no rendered-DOM probe observed the signal", async () => {
  // Everything else untouched: same 200, same title match, same deployment. Only the claim moves.
  const doc = await mutated((d) => { d.content.liveness.claim = "live-signal-observed-in-rendered-dom"; });
  await rejects(doc, "green-without-observation");
});

test("a raw-HTTP observation cannot reach the green claim, however clean the fetch", async () => {
  // title-grep observed its signal over raw HTTP with a 200. That is the 1310-byte shell trap.
  const doc = await mutated((d) => {
    d.content.liveness.claim = "live-signal-observed-in-rendered-dom";
    d.content.liveness.probes = d.content.liveness.probes.filter((p) => p.method === "raw-http");
    d.content.liveness.promisedSignals = d.content.liveness.promisedSignals.filter(
      (s) => s.probeIds.every((id) => id === "raw-shell-grep" || id === "title-grep"),
    );
  });
  await rejects(doc, "raw-http-only-green");
});

test("a rendered-DOM observation DOES reach green — but only with a shell baseline that excludes it", async () => {
  const green = await mutated((d) => {
    const probe = d.content.liveness.probes.find((p) => p.probeId === "rendered-boot");
    probe.observation = "observed";
    probe.observedValue = "<span data-testid=\"salon-week-total\">$4,180.00</span>";
    delete probe.failureDetail;
    d.content.liveness.claim = "live-signal-observed-in-rendered-dom";
    delete d.content.liveness.notObservedDisclosure;
  });
  assert.deepEqual(await validateSchema(SCHEMA, green, "earned-green"), []);

  // Same observation, but the gutted shell contained the signal too — it discriminates nothing.
  const shellAlsoHadIt = structuredClone(green);
  shellAlsoHadIt.content.liveness.probes.find((p) => p.probeId === "rendered-boot")
    .shellBaselineComparison.baselineContainedSignal = true;
  await rejects(shellAlsoHadIt, "green-with-shell-present-signal");

  // Same observation, but nobody compared against a baseline at all.
  const noBaseline = structuredClone(green);
  const probe = noBaseline.content.liveness.probes.find((p) => p.probeId === "rendered-boot");
  probe.shellBaselineComparison = { performed: false, notPerformedReason: "ran out of build minutes" };
  await rejects(noBaseline, "green-without-baseline");
});

test("a non-green claim must disclose why, and an observed probe must carry generated evidence", async () => {
  await rejects(await mutated((d) => { delete d.content.liveness.notObservedDisclosure; }), "silent-not-observed");
  await rejects(
    await mutated((d) => { d.content.liveness.probes.find((p) => p.probeId === "title-grep").evidence = []; }),
    "observed-without-evidence",
  );
});

test("a promised signal cannot be left unprobed", async () => {
  await rejects(
    await mutated((d) => { d.content.liveness.promisedSignals[0].probeIds = []; }),
    "promised-but-never-looked-for",
  );
});

test("no self-approval: promotionAuthorized true and reviewer fields are unwritable", async () => {
  await rejects(await mutated((d) => { d.promotionAuthorized = true; }), "self-authorized");
  await rejects(await mutated((d) => { d.reviewedBy = "homen"; }), "self-reviewed");
  await rejects(await mutated((d) => { d.approved = true; }), "self-approved");
  await rejects(await mutated((d) => { d.verdict = "human-reviewed"; }), "self-verdict");
});

test("H1 is a policy statement, not human presence — and an agent-readable key cannot buy H2", async () => {
  await rejects(await mutated((d) => { d.content.authority.humanPresenceProven = true; }), "h1-claims-presence");
  await rejects(await mutated((d) => { d.content.authority.trustLevel = "H2"; }), "agent-key-claims-h2");
  await rejects(
    await mutated((d) => { d.content.authority.mode = "standing-grant"; delete d.content.authority.grant; }),
    "grant-mode-without-grant",
  );
  await rejects(
    await mutated((d) => { d.content.authority.withinGrant = "outside"; }),
    "outside-grant-without-disclosure",
  );
});

test("spend cannot present an estimate as a bill, a free tier as paid, or an overrun as clean", async () => {
  await rejects(
    await mutated((d) => { d.content.spend.meteringBasis = "estimated"; }),
    "estimate-without-method",
  );
  await rejects(
    await mutated((d) => { d.content.spend.meteringBasis = "free-tier-no-charge"; }),
    "free-tier-with-charge",
  );
  await rejects(
    await mutated((d) => { d.content.spend.capExceeded = true; }),
    "overrun-without-disclosure",
  );
  await rejects(
    await mutated((d) => { d.content.spend.thisLaunchMinorUnits = 3.2; }),
    "money-as-float",
  );
});

test("the manifest must bind its BuildEvidencePack by digest, not consume a name", async () => {
  await rejects(
    await mutated((d) => { d.inputs[0].schemaVersion = "nodekit.story-pack/v1"; }),
    "wrong-upstream-stage",
  );
  await rejects(
    await mutated((d) => { delete d.inputs[0].sha256; }),
    "input-without-digest",
  );
});

test("the frozen envelope is not negotiable", async () => {
  await rejects(await mutated((d) => { d.schemaVersion = "nodekit.launch-manifest/v2"; }), "wrong-schema-version");
  await rejects(await mutated((d) => { d.stage = "build"; }), "wrong-stage");
  await rejects(await mutated((d) => { delete d.completeness.notRun; }), "no-notRun");
  await rejects(await mutated((d) => { delete d.content.target.deploymentId; }), "target-without-deployment-id");
});
