// The reference corpus gate had no test, which is the specific way a gate rots: it is run once by
// the person who wrote it, passes, and is never again observed doing the thing it exists to do.
// A gate only ever seen passing is not known to work — it is known to exit 0, which an empty
// function also does.
//
// So the load-bearing tests here are the FAILING ones. `test/fixtures/reference-corpus/malformed`
// carries five deliberate defects, one per check, and each test below names the defect and requires
// the gate to have caught that specific one. If a future edit weakens a check, the corresponding
// test stops finding its line and fails — rather than the corpus quietly passing with less measured.
//
// The passing direction is still checked, along with the gate's denominators, because a PASS over
// zero records is the failure docs/VACUOUS_PASS.md is named for.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = path.join(platformRoot, "scripts/reference-corpus-gate.mjs");
const shippedCorpus = "atlas/references";
const malformedCorpus = "test/fixtures/reference-corpus/malformed";

function runGate(corpusDir, { cwd = platformRoot, args = [] } = {}) {
  const result = spawnSync(process.execPath, [gate, ...args, corpusDir], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function loadJson(relative) {
  return JSON.parse(readFileSync(path.join(platformRoot, relative), "utf8"));
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("the shipped corpus passes, and says how much it measured while passing", () => {
  const { status, out } = runGate(shippedCorpus);
  assert.equal(status, 0, `gate failed on the shipped corpus:\n${out}`);
  assert.match(out, /^PASS/m);

  // The denominators are the audit. A PASS line with zeroes behind it measured nothing.
  const [, recordCount, validatedCount] = out.match(/(\d+) record\(s\) read from \S+; (\d+) validated/) ?? [];
  const [, factCount, citationCount, scoreCount] =
    out.match(/(\d+) fact\(s\) recorded; (\d+) citation\(s\) checked; (\d+) criterion score\(s\) checked/) ?? [];
  assert.ok(Number(recordCount) >= 3, "expected the three corpus layers to be read");
  assert.equal(recordCount, validatedCount, "every record read must have been validated against a declared schema");
  assert.ok(Number(factCount) > 0 && Number(citationCount) > 0 && Number(scoreCount) > 0, out);
});

test("an empty corpus directory exits 3 — not-run is never a pass", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "empty-corpus-"));
  const { status, out } = runGate(empty);
  assert.equal(status, 3, out);
  assert.match(out, /NOT_RUN/);
});

// One test per deliberate defect. Each asserts the gate caught THAT defect, so a weakened check
// cannot hide behind another check's violation still being reported.
const defects = [
  {
    name: "check 1 — a prose appearance judgement standing where an atomic fact belongs",
    pattern: /appearance adjective "sleek"/,
  },
  {
    name: "check 4 — a fact kind the schema does not enumerate",
    pattern: /schema nodekit\.reference-observation\/v1 .*facts\/1\/kind must be equal to one of the allowed values/,
  },
  {
    name: "check 5 — a criterion citing a fact id that does not exist in its observation",
    pattern: /criterion c1-fabricated-citation cites obs-fixture-bad\/f9, which resolves to no recorded fact/,
  },
  {
    name: "check 5 — a criterion scoring outside the scale the same record declared",
    pattern: /criterion c2-mislabelled-derivation scores 7, outside its own declared scale 0\.\.4/,
  },
  {
    name: "check 5 — withinRuleDerivation asserted rather than earned",
    pattern: /claims withinRuleDerivation true, but recomputing against rule-fixture gives false/,
  },
];

test("the malformed corpus fails, and fails for every reason it was built to fail for", () => {
  const { status, out } = runGate(malformedCorpus);
  assert.equal(status, 1, `the malformed corpus must not pass:\n${out}`);
  assert.match(out, /^FAIL/m);
  for (const defect of defects) {
    assert.match(out, defect.pattern, `gate did not catch ${defect.name}:\n${out}`);
  }
});

test("the malformed fixtures stay out of the shipped corpus", () => {
  const { out } = runGate(shippedCorpus);
  assert.doesNotMatch(out, /fixture/i, "a fixture leaked into atlas/references");
});

// The gate resolves citations across whatever files share a directory. These assertions bind the
// shipped receipt to the shipped observations directly, so the chain is checked even if the gate
// were pointed somewhere else.
test("every fact the shipped receipt cites exists by id in the observations record", () => {
  const observations = loadJson("atlas/references/absence-vs-zero.observations.json");
  const receipt = loadJson("atlas/references/absence-vs-zero.trial1-arm-a.score-receipt.json");
  const known = new Set(
    observations.observations.flatMap((observation) => observation.facts.map((fact) => `${observation.id}/${fact.id}`)),
  );
  const citedByCriteria = receipt.criteria.flatMap((criterion) =>
    criterion.citations.flatMap((citation) => citation.factIds.map((id) => `${citation.observationId}/${id}`)),
  );
  assert.ok(citedByCriteria.length > 0, "a receipt whose criteria cite nothing is a score with no reference behind it");
  for (const cited of citedByCriteria) assert.ok(known.has(cited), `receipt cites ${cited}, which no observation records`);
  assert.deepEqual(
    [...new Set(citedByCriteria)].sort(),
    [...receipt.derivedFrom.factIds].sort(),
    "derivedFrom must be exactly what the criteria spend — no padding, no omissions",
  );
});

test("the shipped receipt scores a subject the cited rule actually governs", () => {
  const rule = loadJson("atlas/references/absence-vs-zero.rule.json");
  const receipt = loadJson("atlas/references/absence-vs-zero.trial1-arm-a.score-receipt.json");
  assert.equal(receipt.ruleId, rule.ruleId);

  // Every one of the rule's exclusion clauses must be answered, verbatim, and none may fire.
  const answered = receipt.ruleApplicability.doesNotApplyWhenChecked.map((entry) => entry.clause);
  assert.deepEqual(answered.sort(), [...rule.doesNotApplyWhen].sort(), "an unanswered exclusion clause is an unchecked applicability claim");
  for (const entry of receipt.ruleApplicability.doesNotApplyWhenChecked) assert.equal(entry.fires, false);
});

test("a citation reaching past the rule's own evidence is marked, not hidden", () => {
  const rule = loadJson("atlas/references/absence-vs-zero.rule.json");
  const receipt = loadJson("atlas/references/absence-vs-zero.trial1-arm-a.score-receipt.json");
  const ruleFacts = new Set(rule.derivedFrom.factIds);
  const outside = [];
  for (const criterion of receipt.criteria) {
    for (const citation of criterion.citations) {
      const within = citation.factIds.every((id) => ruleFacts.has(`${citation.observationId}/${id}`));
      assert.equal(citation.withinRuleDerivation, within, `${criterion.id} mislabels its citation of ${citation.observationId}`);
      if (!within) outside.push(criterion.id);
    }
  }
  // The human override exists to dispute exactly this. If nothing is marked outside, the override
  // is disputing something the record does not show, and the disagreement is unauditable.
  for (const disputed of receipt.humanReview.disputedCriterionIds) {
    assert.ok(outside.includes(disputed), `humanReview disputes ${disputed}, but that criterion cites nothing outside the rule's derivation`);
  }
});

test("the schema refuses an override that does not say what it revised the score to", async () => {
  const receipt = loadJson("atlas/references/absence-vs-zero.trial1-arm-a.score-receipt.json");
  assert.deepEqual(await validateSchema("nodekit.score-receipt.v1.schema.json", receipt, "receipt"), []);

  const silent = clone(receipt);
  delete silent.humanReview.revisedScore;
  assert.ok(
    (await validateSchema("nodekit.score-receipt.v1.schema.json", silent, "receipt")).length > 0,
    "an override with no revised score is a disagreement with no content",
  );

  const affirmedButRescored = clone(receipt);
  affirmedButRescored.humanReview.decision = "affirm";
  assert.ok(
    (await validateSchema("nodekit.score-receipt.v1.schema.json", affirmedButRescored, "receipt")).length > 0,
    "affirming the score while also revising it must not be expressible",
  );

  const uncited = clone(receipt);
  uncited.criteria[0].citations = [];
  assert.ok(
    (await validateSchema("nodekit.score-receipt.v1.schema.json", uncited, "receipt")).length > 0,
    "a criterion with no citations is a score with no reference behind it",
  );
});

// check 6 — a rule that terminates in nothing checkable. Per-rule this is legal (an advisory rule
// says so and gives a reason); it is the RATIO the corpus rejects, and only the corpus can see it.
// Built by copying the shipped corpus so citations still resolve: the ratio must be the sole
// violation, otherwise this test would pass on an unrelated failure.
test("a corpus whose rules mostly terminate in nothing is decoration, not requirements", () => {
  const decorated = mkdtempSync(path.join(tmpdir(), "decorated-corpus-"));
  for (const entry of readdirSync(path.join(platformRoot, shippedCorpus))) {
    if (!entry.endsWith(".json")) continue;
    const doc = loadJson(path.join(shippedCorpus, entry));
    if (doc.schemaVersion === "nodekit.design-rule/v1") {
      doc.boundToGate = { kind: "none", reason: "deliberately unbound, to prove the ratio gate bites" };
    }
    writeFileSync(path.join(decorated, entry), JSON.stringify(doc, null, 2));
  }

  const { status, out } = runGate(decorated);
  assert.equal(status, 1, `the ratio gate did not bite:\n${out}`);
  assert.match(out, /terminate in nothing checkable .*decorated contract, not requirements/);

  // The shipped corpus is the other half of the check: the gate must distinguish, not just reject.
  const shipped = runGate(shippedCorpus);
  assert.equal(shipped.status, 0, shipped.out);
  assert.match(shipped.out, /rule\(s\) checked for termination; 0 terminate in nothing checkable/);
});

// A ref is only a termination if it resolves. Each case below is a different way a rule keeps
// pointing at an artifact after the artifact stops being there — the schema cannot see any of them,
// because to the schema they are all well-formed strings.
test("a rule pointing at an artifact that does not exist is not a termination", () => {
  const cases = [
    {
      name: "a JSON pointer into a schema that no longer has that node",
      ref: "schemas/nodekit.story-pack.v1.schema.json#/$defs/noSuchDef/properties/contentBinding",
      pattern: /resolves to nothing at/,
    },
    { name: "a file that is not in the repository", ref: "schemas/does-not-exist.schema.json#/a", pattern: /is not a file in this repository/ },
    { name: "a symbol that is not in the file it names", ref: "src/lib/reference-loop.mjs:noSuchSymbol", pattern: /does not appear in/ },
  ];

  for (const { name, ref, pattern } of cases) {
    const corpus = mkdtempSync(path.join(tmpdir(), "dangling-ref-corpus-"));
    for (const entry of readdirSync(path.join(platformRoot, shippedCorpus))) {
      if (!entry.endsWith(".json")) continue;
      const doc = loadJson(path.join(shippedCorpus, entry));
      if (doc.schemaVersion === "nodekit.design-rule/v1") doc.boundToGate = { ...doc.boundToGate, ref };
      writeFileSync(path.join(corpus, entry), JSON.stringify(doc, null, 2));
    }
    const { status, out } = runGate(corpus);
    assert.equal(status, 1, `${name}: gate accepted a dangling ref:\n${out}`);
    assert.match(out, pattern, name);
  }

  // And the shipped corpus resolves, so the check is known to distinguish rather than just reject.
  // fable-judge caught this as a weakened assertion: it was pinned to exactly 1, the corpus grew to
  // 4, and I relaxed it to "at least one" — which passes if 1 of 4 resolves. Assert the number that
  // SHOULD resolve instead: every rule that terminates in an artifact rather than a consumer.
  const shippedRules = readdirSync(path.join(platformRoot, shippedCorpus))
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadJson(path.join(shippedCorpus, f)))
    .filter((d) => d.schemaVersion === "nodekit.design-rule/v1");
  const shouldResolve = shippedRules.filter((r) => !["none", "delegated"].includes(r.boundToGate?.kind)).length;
  assert.ok(shouldResolve > 0, "no rule terminates in a resolvable ref, so this asserts nothing");
  assert.ok(
    runGate(shippedCorpus).out.includes(`${shouldResolve} ref(s) resolved to a real artifact`),
    `expected exactly ${shouldResolve} resolved ref(s) — one per rule that terminates in an artifact`,
  );
});

// This gate ships in the package, so it runs from inside somebody else's node_modules. The rules
// belong to the project being gated, and deriving the repository root from this file's own location
// silently pointed every ref at NodeKit — the consumer's own artifacts read as missing while the
// gate still printed a full denominator. A check answering the wrong question looks exactly like a
// check answering the right one.
test("refs resolve against the project being gated, not the package the gate ships in", () => {
  const consumer = mkdtempSync(path.join(tmpdir(), "consumer-repo-"));
  mkdirSync(path.join(consumer, "refs"));
  mkdirSync(path.join(consumer, "app"));
  // An artifact that exists in the consumer and does NOT exist in node-platform.
  writeFileSync(path.join(consumer, "app", "render.py"), "def assert_no_pie_when_overlapping(buckets):\n    raise ValueError('overlapping')\n");
  for (const entry of readdirSync(path.join(platformRoot, shippedCorpus))) {
    if (!entry.endsWith(".json")) continue;
    const doc = loadJson(path.join(shippedCorpus, entry));
    if (doc.schemaVersion === "nodekit.design-rule/v1") {
      doc.boundToGate = { kind: "renderer-assertion", ref: "app/render.py:assert_no_pie_when_overlapping" };
    }
    writeFileSync(path.join(consumer, "refs", entry), JSON.stringify(doc, null, 2));
  }

  const fromConsumer = runGate("refs", { cwd: consumer });
  assert.equal(fromConsumer.status, 0, `the consumer's own artifact was not found:\n${fromConsumer.out}`);
  assert.match(fromConsumer.out, /[1-9]\d* ref\(s\) resolved to a real artifact/);

  // Explicit root, so the gate is usable from a working directory that is neither.
  const explicit = runGate(path.join(consumer, "refs"), { cwd: platformRoot, args: ["--repo-root", consumer] });
  assert.equal(explicit.status, 0, explicit.out);

  // And the negative control: resolved against the wrong project, the same corpus must fail.
  const wrongRoot = runGate(path.join(consumer, "refs"), { cwd: platformRoot });
  assert.equal(wrongRoot.status, 1, "resolving against the wrong project must not quietly pass");
  assert.match(wrongRoot.out, /app\/render\.py, which is not a file in this repository/);
});

// `none` was conflating two different states: "nothing checks this rule" and "the assertion belongs
// to a consuming app". Only the first is decoration. A rule derived in the platform and enforced in
// the app that consumes it is doing its job — but it must name the consumer, or "delegated" becomes
// decoration wearing a forwarding address.
test("a rule delegated to a consumer is not decoration, but must name one", async () => {
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  const rule = loadJson("atlas/references/note-surface.stream-not-chrome.rule.json");
  assert.equal(rule.boundToGate.kind, "delegated");
  assert.ok(rule.boundToGate.consumer, "a delegated rule must say who enforces it");
  assert.deepEqual(await validateSchema("nodekit.design-rule.v1.schema.json", rule, "rule"), []);

  const orphaned = clone(rule);
  delete orphaned.boundToGate.consumer;
  assert.ok(
    (await validateSchema("nodekit.design-rule.v1.schema.json", orphaned, "rule")).length > 0,
    "delegating to nobody must not be expressible",
  );

  // And the ratio gate must count delegated separately from undone.
  const { out } = runGate(shippedCorpus);
  assert.match(out, /0 terminate in nothing checkable; 2 delegated to a consumer/);
});
