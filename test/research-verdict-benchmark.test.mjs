import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCorpus, scoreResearchVerdicts, VERDICTS } from "../src/lib/research-verdict-benchmark.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The benchmark exists because NodeKit's research phase read an incumbent as a reason not to build.
// These tests prove the benchmark can actually detect that defect AND its opposite — a benchmark
// that only catches one direction would have licensed the over-correction.

test("the corpus can detect both error directions, or it cannot do its job", async () => {
  const corpus = await loadCorpus(REPO);
  const expected = corpus.cases.map((c) => c.expected);

  assert.ok(expected.includes("do-not-build"), "without do-not-build cases, over-correction is undetectable");
  assert.ok(expected.some((e) => e !== "do-not-build"), "and without the others, the original defect is undetectable");

  for (const c of corpus.cases) {
    assert.ok(VERDICTS.includes(c.expected), `${c.id} has an unknown expected verdict`);
    assert.ok(c.why && c.why.length > 40, `${c.id} must state WHY, since these are judgements not observations`);
    assert.ok(c.incumbents?.length, `${c.id} must name incumbents — that is the variable under test`);
  }
});

// The observed 2026-07-25 defect, reproduced as a predictor.
test("a procedure that treats any incumbent as disqualifying is caught by direction, not by accuracy", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, () => "do-not-build");

  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.candidate.falseDoNotBuild.length > 0,
    "every case names an incumbent, so a blanket do-not-build must register in this direction",
  );
  assert.equal(verdict.candidate.falseBuildOrCompose.length, 0, "and must not register in the other");
  // It scores >0 accuracy purely from corpus skew. That is exactly why accuracy is not the score.
  assert.ok(verdict.candidate.accuracyPoints > 0, "it gets the do-not-build cases right by accident");
});

// The over-correction: incumbent is always validation, so the procedure can never say no.
test("a procedure that can never say no is caught, even though it scores well", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, (c) => (c.family === "adjacent-incumbent" ? "build-new" : "compose-existing"));

  assert.ok(verdict.candidate.falseBuildOrCompose.length > 0, "it must be caught in this direction");
  assert.equal(verdict.passed, false, "and must not pass, whatever its accuracy");
});

// @nodekit-verifies inv:research-verdict-beats-constant#constant-cannot-pass
test("no constant predictor can pass, by construction", async () => {
  const corpus = await loadCorpus(REPO);
  for (const constant of VERDICTS) {
    const verdict = scoreResearchVerdicts(corpus, () => constant);
    assert.equal(verdict.passed, false, `constant "${constant}" must not pass`);
    // A constant IS a baseline, so its margin over the best baseline can never reach the bar.
    assert.ok(verdict.marginPoints <= 0, `constant "${constant}" cannot beat the best constant`);
  }
});

// A procedure must be compared against the best constant, not a conveniently weak one.
test("the baseline reported is the strongest constant, not an easy one", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, () => "build-new");
  const best = verdict.baselines[verdict.bestBaselineName].accuracyPoints;
  for (const b of Object.values(verdict.baselines)) {
    assert.ok(best >= b.accuracyPoints, "bestBaselineName must name the highest-scoring constant");
  }
});

// Declining a case must never improve the score.
test("an unusable answer is scored wrong, not skipped", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, (c) => (c.expected === "do-not-build" ? "unsure" : c.expected));

  assert.equal(verdict.candidate.unusable, corpus.cases.filter((c) => c.expected === "do-not-build").length);
  assert.ok(verdict.candidate.accuracyPoints < 100, "declining the hard cases must not yield a perfect score");
  assert.equal(verdict.passed, false);
});

// A thrown predictor must not crash the run or silently pass.
test("a procedure that throws is recorded as wrong and does not take the harness down", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, (c) => {
    if (c.id === "rv05") throw new Error("boom");
    return c.expected;
  });
  const row = verdict.candidate.rows.find((r) => r.id === "rv05");
  assert.equal(row.correct, false);
  assert.match(row.error, /boom/);
});

// The oracle: a procedure reproducing the corpus's own deciding inputs scores perfectly and clean.
// If this cannot pass, the bar is unreachable and the benchmark is theatre.
test("an oracle following the corpus reasoning passes both gates", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, (c) => c.expected);

  assert.equal(verdict.candidate.accuracyPoints, 100);
  assert.equal(verdict.bothDirectionsClean, true);
  assert.equal(verdict.beatsBaseline, true, "a perfect score must clear the margin over the best constant");
  assert.equal(verdict.passed, true);
});

test("the verdict states what it does not establish", async () => {
  const corpus = await loadCorpus(REPO);
  const verdict = scoreResearchVerdicts(corpus, (c) => c.expected);
  assert.match(verdict.boundary, /does not establish|not evidence/i);
});
