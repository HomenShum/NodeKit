import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHAIN_SPEC,
  EDGES_EXPECTED,
  STAGES_EXPECTED,
  canonicalJson,
  canonicalSha256,
  verifyJourneyChain,
} from "../src/lib/journey-chain-gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(REPO, "test/fixtures/journey-chain");
const COMPLETE = path.join(FIXTURES, "complete");
const PARTIAL = path.join(FIXTURES, "partial");
const NOT_A_CHAIN = path.join(FIXTURES, "not-a-chain");

/** Copy the passing chain somewhere writable so a scenario can break exactly one thing in it. */
async function scratchChain() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "journey-chain-"));
  await cp(COMPLETE, dir, { recursive: true });
  return dir;
}

async function readArtifact(dir, file) {
  return JSON.parse(await readFile(path.join(dir, file), "utf8"));
}

async function writeArtifact(dir, file, doc) {
  await writeFile(path.join(dir, file), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

function deepReverseKeys(value) {
  if (Array.isArray(value)) return value.map(deepReverseKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = deepReverseKeys(value[key]);
    return out;
  }
  return value;
}

const codes = (verdict) => verdict.failures.map((entry) => entry.code).sort();

// ---------------------------------------------------------------------------------------------
// The two directions. Neither alone is sufficient: the failing direction cannot detect
// over-matching, and the passing direction cannot detect a gate nothing can trip.
// ---------------------------------------------------------------------------------------------

// Persona: the reviewer asked whether the journey actually closes. They need to see the
// denominator, not a colour, because a green over four missing stages reads identically to a real
// one. Every count below is asserted, so a gate that silently narrowed its subject fails here.
test("a complete five-stage chain PASSes with a full denominator behind the verdict", async () => {
  const verdict = await verifyJourneyChain({ chainDir: COMPLETE });

  assert.equal(verdict.schemaVersion, "nodekit.journey-chain-verdict/v1");
  assert.equal(verdict.verdict, "PASS");
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.failures, []);

  // The denominator IS the deliverable. A PASS whose stagesFound is 1 would be the vacuous pass.
  const d = verdict.denominator;
  assert.equal(d.stagesExpected, STAGES_EXPECTED);
  assert.equal(d.stagesFound, 5);
  assert.deepEqual(d.stagesMissing, []);
  assert.equal(d.edgesExpected, EDGES_EXPECTED);
  assert.equal(d.edgesBound, 6);
  assert.equal(d.digestsChecked, 6);
  assert.equal(d.digestsMatched, 6);
  assert.equal(d.digestsUnresolvable, 0);
  assert.equal(d.coverageComplete, true);
  assert.equal(verdict.caseId, "fixture-chain-2026-07-28");
});

// Persona: an agent handed a half-built tree. "Four of five stages are missing" must be loud, and
// it must not be reachable by any reading of the output as success.
test("a truncated chain FAILs and names every absent stage", async () => {
  const verdict = await verifyJourneyChain({ chainDir: PARTIAL });

  assert.equal(verdict.verdict, "FAIL");
  assert.equal(verdict.exitCode, 1);
  assert.equal(verdict.passed, false);

  assert.equal(verdict.denominator.stagesFound, 2);
  assert.deepEqual(verdict.denominator.stagesMissing, ["explain", "launch", "learn"]);
  // DECIDE -> BUILD is the only edge whose downstream stage exists, so it is the only one checkable.
  assert.equal(verdict.denominator.edgesBound, 1);
  assert.equal(verdict.denominator.digestsChecked, 1);
  assert.equal(verdict.denominator.digestsMatched, 1);

  const absent = verdict.failures.filter((entry) => entry.code === "stage-absent").map((entry) => entry.stage);
  assert.deepEqual(absent.sort(), ["explain", "launch", "learn"]);
});

// "Absence is not-run, never passed" -- and not-run is also not FAIL. A caller has to be able to
// tell "I pointed you at the wrong directory" from "the chain is broken".
test("a directory holding no chain artifact is NOT_RUN, never PASS, and never green", async () => {
  const verdict = await verifyJourneyChain({ chainDir: NOT_A_CHAIN });

  assert.equal(verdict.verdict, "NOT_RUN");
  assert.equal(verdict.exitCode, 3);
  assert.equal(verdict.passed, false);
  assert.notEqual(verdict.verdict, "PASS");
  assert.equal(verdict.denominator.stagesFound, 0);
  // The file WAS read. It simply declared nothing this gate recognises -- a visible zero, not a
  // silent one.
  assert.equal(verdict.denominator.jsonFilesScanned, 1);
  assert.deepEqual(verdict.denominator.ignoredNonChainJson, ["notes.json"]);
});

test("an unreadable chain directory is NOT_RUN and says nothing was measured", async () => {
  const verdict = await verifyJourneyChain({ chainDir: path.join(FIXTURES, "does-not-exist") });

  assert.equal(verdict.verdict, "NOT_RUN");
  assert.equal(verdict.exitCode, 3);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.denominator.stagesFound, 0);
  assert.equal(verdict.denominator.jsonFilesScanned, 0);
  assert.ok(verdict.notes.some((note) => note.code === "chain-directory-unreadable"));
});

test("the three outcomes carry three distinct exit codes", async () => {
  const pass = await verifyJourneyChain({ chainDir: COMPLETE });
  const fail = await verifyJourneyChain({ chainDir: PARTIAL });
  const notRun = await verifyJourneyChain({ chainDir: NOT_A_CHAIN });

  assert.deepEqual([pass.exitCode, fail.exitCode, notRun.exitCode], [0, 1, 3]);
  assert.equal(new Set([pass.exitCode, fail.exitCode, notRun.exitCode]).size, 3);
});

// ---------------------------------------------------------------------------------------------
// The digest rule. Canonical JSON means sorted keys and no insignificant whitespace, so two
// artifacts differing only in key order must hash identically -- otherwise the gate fails honest
// chains, which is worse than useless because it trains people to ignore it.
// ---------------------------------------------------------------------------------------------

test("canonical digests ignore key order and whitespace but not content", () => {
  const a = { zeta: 1, alpha: { nested: [1, 2], beta: "x" } };
  const b = { alpha: { beta: "x", nested: [1, 2] }, zeta: 1 };

  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalSha256(a), canonicalSha256(b));
  assert.equal(canonicalJson(a), '{"alpha":{"beta":"x","nested":[1,2]},"zeta":1}');
  // No insignificant whitespace at all.
  assert.ok(!/\n|\s{2}/.test(canonicalJson(a)));

  // Array order is significant -- it is data, not key order.
  assert.notEqual(canonicalSha256({ items: [1, 2] }), canonicalSha256({ items: [2, 1] }));
  // And a content change must move the digest, or the whole binding is decorative.
  assert.notEqual(canonicalSha256(a), canonicalSha256({ ...a, zeta: 2 }));
});

// The end-to-end version of the same rule, which is the one that actually protects real chains:
// rewrite an upstream artifact with every object's keys in reverse order, touch no downstream
// digest, and the chain must still PASS.
test("an upstream artifact rewritten in reverse key order still satisfies its downstream digests", async () => {
  const dir = await scratchChain();
  try {
    const before = await readArtifact(dir, "decide.opportunity-contract.json");
    const reversed = deepReverseKeys(before);
    assert.notDeepEqual(Object.keys(reversed), Object.keys(before), "the rewrite must actually reorder keys");
    await writeArtifact(dir, "decide.opportunity-contract.json", reversed);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "PASS", `key reordering broke an honest chain: ${JSON.stringify(verdict.failures)}`);
    assert.equal(verdict.exitCode, 0);
    assert.equal(verdict.denominator.digestsMatched, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The knockout for the test above. If the gate passed the reordered chain because it ignores
// digests entirely, this scenario would pass too -- and it must not.
test("a single changed character upstream breaks every digest that binds it", async () => {
  const dir = await scratchChain();
  try {
    const contract = await readArtifact(dir, "decide.opportunity-contract.json");
    contract.successCondition += ".";
    await writeArtifact(dir, "decide.opportunity-contract.json", contract);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.equal(verdict.exitCode, 1);

    // BUILD and EXPLAIN both bind the OpportunityContract, so both bindings must go red.
    const mismatches = verdict.failures.filter((entry) => entry.code === "digest-mismatch");
    assert.deepEqual(mismatches.map((entry) => entry.stage).sort(), ["build", "explain"]);
    assert.equal(verdict.denominator.digestsMatched, 4);
    assert.equal(verdict.denominator.digestsChecked, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a binding whose upstream artifact is absent is unresolvable, counted apart from matched", async () => {
  const dir = await scratchChain();
  try {
    await rm(path.join(dir, "explain.story-pack.json"));

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    // Removing EXPLAIN also removes its two outbound edges, so three of the six remain checkable:
    // build->decide, launch->build and learn->launch.
    assert.equal(verdict.denominator.digestsChecked, 3);
    assert.equal(verdict.denominator.digestsMatched, 3);
    // LEARN still binds the StoryPack by digest. That digest was never compared to anything, and
    // "never compared" must not be folded into "matched".
    assert.equal(verdict.denominator.digestsUnresolvable, 1);
    assert.equal(verdict.denominator.edgesBound, 4);
    assert.ok(codes(verdict).includes("digest-unresolvable"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The anti-vacuity clauses. These are the scenarios where every other check is satisfied and the
// gate would still be measuring nothing.
// ---------------------------------------------------------------------------------------------

// THE structural test. Five artifacts, correct envelopes, correct stages, nothing wrong with any
// one of them in isolation -- and no chain at all, because nothing binds anything. A gate that
// only checked presence would report a triumphant five-of-five here.
test("five present artifacts that bind nothing are not a chain and cannot PASS", async () => {
  const dir = await scratchChain();
  try {
    for (const spec of CHAIN_SPEC.filter((entry) => entry.envelope === "required")) {
      const file = {
        build: "build.build-evidence-pack.json",
        explain: "explain.story-pack.json",
        launch: "launch.launch-manifest.json",
        learn: "learn.observation-pack.json",
      }[spec.stage];
      const doc = await readArtifact(dir, file);
      doc.inputs = [];
      await writeArtifact(dir, file, doc);
    }

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.denominator.stagesFound, 5, "all five artifacts are still present");
    assert.notEqual(verdict.verdict, "PASS");
    assert.equal(verdict.verdict, "FAIL");
    assert.equal(verdict.exitCode, 1);
    assert.equal(verdict.denominator.edgesBound, 0);
    assert.equal(verdict.denominator.digestsChecked, 0);
    assert.equal(verdict.failures.filter((entry) => entry.code === "edge-unbound").length, EDGES_EXPECTED);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A stage that lists what it achieved, declares nothing unattempted and refuses nothing, is
// asserting its whole scope was covered. That is the vacuous pass at artifact scale.
test("a stage claiming everything and withholding nothing is an unshowable completeness claim", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "launch.launch-manifest.json");
    doc.completeness = { claimed: ["Everything in scope was launched and verified."], notRun: [], refused: [] };
    await writeArtifact(dir, "launch.launch-manifest.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    const fault = verdict.failures.find((entry) => entry.code === "completeness-total-claim");
    assert.ok(fault, `expected a total-claim failure, got ${codes(verdict).join(", ")}`);
    assert.equal(fault.stage, "launch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a refusal with no reason is a silent omission wearing a refusal's clothes", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "explain.story-pack.json");
    doc.completeness.refused = [{ item: "A headline figure for hours saved per week" }];
    await writeArtifact(dir, "explain.story-pack.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("completeness-refusal-without-reason"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an item listed as both claimed and notRun is a contradiction, not a nuance", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "build.build-evidence-pack.json");
    doc.completeness.claimed.push(doc.completeness.notRun[0]);
    await writeArtifact(dir, "build.build-evidence-pack.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("completeness-contradiction"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Authority, and the over-matching guard that only the PASS fixture can expose.
// ---------------------------------------------------------------------------------------------

test("a producer asserting its own approval FAILs", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "launch.launch-manifest.json");
    doc.content.authority.approved = true;
    doc.content.promotionAuthorized = true;
    await writeArtifact(dir, "launch.launch-manifest.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    const hits = verdict.failures.filter((entry) => entry.code === "self-approval-asserted");
    assert.equal(hits.length, 2, `expected both the approved key and promotionAuthorized:true, got ${hits.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The bug this is built to prevent: an enumerator that matches on substrings flags legitimate
// content and its noise hides the real miss. The passing fixture deliberately ships
// `approvalsRequestedFrom`, `reviewedByPolicy` and `promotionAuthorized: false` -- all legal, all
// near-misses for the forbidden set.
test("legitimate near-miss field names are not mistaken for self-approval", async () => {
  const manifest = await readArtifact(COMPLETE, "launch.launch-manifest.json");
  assert.ok(manifest.content.authority.approvalsRequestedFrom, "the near-miss fixture data must still be present");
  assert.equal(manifest.content.authority.reviewedByPolicy, "derived-from-attestation-never-authored");
  assert.equal(manifest.content.promotionAuthorized, false);

  const verdict = await verifyJourneyChain({ chainDir: COMPLETE });
  assert.deepEqual(
    verdict.failures.filter((entry) => entry.code === "self-approval-asserted"),
    [],
    "the authority scan matched a legal field name",
  );
  assert.equal(verdict.verdict, "PASS");
});

// ---------------------------------------------------------------------------------------------
// Scoping. Getting the boundary wrong in either direction is the same bug twice.
// ---------------------------------------------------------------------------------------------

// A chain directory legitimately holds sub-trees of supporting evidence. An evidence file that
// happens to declare a chain schemaVersion must not be promoted to a stage.
test("a nested file declaring a chain schemaVersion is not counted as a stage", async () => {
  const dir = await scratchChain();
  try {
    await rm(path.join(dir, "explain.story-pack.json"));
    await mkdir(path.join(dir, "evidence"), { recursive: true });
    await writeArtifact(dir, "evidence/story-pack-draft.json", {
      schemaVersion: "nodekit.story-pack/v1",
      caseId: "fixture-chain-2026-07-28",
      stage: "explain",
      producedAt: "2026-07-28T18:20:00Z",
      inputs: [],
      content: {},
      completeness: { claimed: [], notRun: ["everything"], refused: [] },
    });

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.denominator.stagesFound, 4, "a nested draft was promoted to a stage");
    assert.ok(verdict.failures.some((entry) => entry.code === "stage-absent" && entry.stage === "explain"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two files declaring the same stage make the chain ambiguous rather than lucky", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "launch.launch-manifest.json");
    await writeArtifact(dir, "launch.launch-manifest.copy.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("duplicate-stage"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a binding that names one artifact while pointing at another FAILs", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "launch.launch-manifest.json");
    doc.inputs[0].path = "some/other/build-evidence-pack.json";
    await writeArtifact(dir, "launch.launch-manifest.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("binding-path-mismatch"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two journeys in one directory are refused rather than silently merged", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "learn.observation-pack.json");
    doc.caseId = "a-different-journey";
    await writeArtifact(dir, "learn.observation-pack.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("case-id-conflict"));

    // Naming the case disambiguates, and the excluded artifact must be reported as excluded rather
    // than quietly dropped -- which then shows up honestly as a missing stage.
    const scoped = await verifyJourneyChain({ chainDir: dir, caseId: "fixture-chain-2026-07-28" });
    assert.equal(scoped.denominator.stagesFound, 4);
    assert.ok(scoped.notes.some((note) => note.code === "artifact-outside-requested-case"));
    assert.ok(scoped.failures.some((entry) => entry.code === "stage-absent" && entry.stage === "learn"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The exempt root is the one place a caseId claim cannot be checked. Counting it as confirmed would
// be a receipt computed from the traversal that produced it.
test("a caseId asserted about the envelope-exempt root is reported as unconfirmable, not confirmed", async () => {
  const verdict = await verifyJourneyChain({ chainDir: COMPLETE });

  // BUILD and EXPLAIN both bind the OpportunityContract, which declares no caseId of its own.
  assert.equal(verdict.denominator.caseIdsAssertedUnconfirmable, 2);
  assert.equal(verdict.denominator.caseIdsConfirmed, 4);
  assert.equal(
    verdict.notes.filter((note) => note.code === "binding-case-id-unconfirmable").length,
    2,
  );
});

test("a binding whose caseId contradicts the artifact it names FAILs", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "learn.observation-pack.json");
    doc.inputs[0].caseId = "some-other-case";
    await writeArtifact(dir, "learn.observation-pack.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("binding-case-id-mismatch"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mislabelled stage or an unparseable timestamp FAILs the envelope", async () => {
  const dir = await scratchChain();
  try {
    const doc = await readArtifact(dir, "explain.story-pack.json");
    doc.stage = "launch";
    doc.producedAt = "last Tuesday";
    await writeArtifact(dir, "explain.story-pack.json", doc);

    const verdict = await verifyJourneyChain({ chainDir: dir });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(codes(verdict).includes("stage-mislabelled"));
    assert.ok(codes(verdict).includes("produced-at-unparseable"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unparseable file in the chain directory blocks PASS instead of being skipped", async () => {
  const dir = await scratchChain();
  try {
    await writeFile(path.join(dir, "truncated.json"), '{"schemaVersion": "nodekit.story-pack', "utf8");

    const verdict = await verifyJourneyChain({ chainDir: dir });
    // Nothing is wrong with any stage, so there is no failure -- but part of the directory was
    // never read, and a green over an unread subject is the whole failure class.
    assert.deepEqual(verdict.failures, []);
    assert.equal(verdict.verdict, "NOT_RUN");
    assert.equal(verdict.exitCode, 3);
    assert.equal(verdict.denominator.coverageComplete, false);
    assert.equal(verdict.denominator.unreadableFiles.length, 1);
    assert.ok(verdict.notes.some((note) => note.code === "coverage-incomplete"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The frozen chain itself. If someone edits CHAIN_SPEC, the counts this gate reports change
// meaning, so the shape is pinned here rather than left implicit.
test("the frozen chain is five stages and six edges", () => {
  assert.equal(STAGES_EXPECTED, 5);
  assert.equal(EDGES_EXPECTED, 6);
  assert.deepEqual(
    CHAIN_SPEC.map((spec) => spec.stage),
    ["decide", "build", "explain", "launch", "learn"],
  );
  assert.deepEqual(
    CHAIN_SPEC.map((spec) => spec.schemaVersion),
    [
      "nodekit.opportunity-contract/v1",
      "nodekit.build-evidence-pack/v1",
      "nodekit.story-pack/v1",
      "nodekit.launch-manifest/v1",
      "nodekit.observation-pack/v1",
    ],
  );
  // StoryPack and LaunchManifest are the genuinely parallel pair: neither consumes the other.
  const explain = CHAIN_SPEC.find((spec) => spec.stage === "explain");
  const launch = CHAIN_SPEC.find((spec) => spec.stage === "launch");
  assert.ok(!explain.consumes.includes("nodekit.launch-manifest/v1"));
  assert.ok(!launch.consumes.includes("nodekit.story-pack/v1"));
});
