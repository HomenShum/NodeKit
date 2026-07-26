import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Score a research-phase procedure on how it handles INCUMBENTS.
 *
 * WHY THIS EXISTS
 *
 * On 2026-07-25 NodeKit's research phase was given a McKinsey associate case, found that McKinsey
 * already runs Lilli, and concluded that NodeKit should therefore avoid building a broad consulting
 * product. The owner rejected the inference: an incumbent at that scale is category VALIDATION, and
 * the right output was to compose NodeRoom and NodeSlide.
 *
 * The correction carries its own failure. If an incumbent is always validation, the research phase
 * can never output do-not-build, and a rule that cannot say no carries no information. The first
 * inference was wrong; the correction can be wrong in the opposite direction.
 *
 * So accuracy is not the score. This reports the two error DIRECTIONS separately:
 *
 *   incumbentAsDisqualifier      predicted do-not-build where the corpus says build or compose.
 *                                The observed 2026-07-25 defect.
 *   incumbentAsAlwaysValidation  predicted build or compose where the corpus says do-not-build.
 *                                The over-correction. Only the foreclosing-incumbent and
 *                                commodity-floor cases can detect it, which is why they exist.
 *
 * A procedure can post good accuracy while being maximally wrong in one direction, if the corpus
 * leans the other way. Reporting one number would hide exactly the thing being measured.
 *
 * THE BASELINE IS NOT OPTIONAL
 *
 * Every run scores three constant predictors alongside the real one. A procedure that does not beat
 * the best constant by `requiredMarginPoints` is not carrying information — it is agreeing with the
 * corpus skew. This is the structured-baseline discipline already applied to the Atlas ranker,
 * where a fielded ranker had to beat a structured baseline by >=10 points or come out of production.
 *
 * WHAT THIS DOES NOT MEASURE
 *
 * Whether the verdicts in the corpus are correct. They are authored judgements with stated reasons,
 * not observations. The corpus is falsifiable by argument, not by running it. A procedure scoring
 * 10/10 has matched an opinion, and the honest claim is "agrees with the recorded corpus", never
 * "makes correct product decisions".
 */

export const VERDICTS = Object.freeze(["build-new", "compose-existing", "do-not-build"]);

/** Constants a real procedure has to beat. Named so a report can say which one won. */
const BASELINES = Object.freeze({
  "always-compose": () => "compose-existing",
  "always-build": () => "build-new",
  "always-do-not-build": () => "do-not-build",
});

export async function loadCorpus(repoRoot, file = "benchmarks/research-verdict-v1.json") {
  return JSON.parse(await readFile(path.join(repoRoot, file), "utf8"));
}

function scoreOne(cases, predict) {
  const rows = [];
  for (const c of cases) {
    let predicted = null;
    let reason = null;
    let error = null;
    try {
      const out = predict(c);
      predicted = typeof out === "string" ? out : out?.verdict ?? null;
      reason = typeof out === "string" ? null : out?.decidingInput ?? null;
    } catch (cause) {
      error = cause?.message ?? String(cause);
    }
    // An unusable answer is scored as wrong, never skipped. Skipping would let a procedure
    // improve its percentage by declining the cases it finds hard.
    const usable = VERDICTS.includes(predicted);
    rows.push({
      id: c.id,
      family: c.family,
      expected: c.expected,
      expectedReason: c.decidingInput ?? null,
      predicted: usable ? predicted : null,
      reason,
      // Right verdict, different reason. Not scored as wrong — the corpus's deciding-input
      // vocabulary is not the procedure's — but surfaced, because agreement reached by another
      // route is not confirmation and must not read as one. The first version of this file
      // classified error DIRECTION from the verdict alone, and mislabelled a procedure that
      // returned do-not-build for want of evidence as one that treats incumbents as disqualifying.
      // A verdict's value is not its reason.
      agreesForDifferentReason: usable && predicted === c.expected && Boolean(reason) && reason !== c.decidingInput,
      correct: usable && predicted === c.expected,
      unusable: !usable,
      error,
    });
  }

  const correct = rows.filter((r) => r.correct).length;
  const asDisqualifier = rows.filter((r) => r.predicted === "do-not-build" && r.expected !== "do-not-build");
  // Abstention counts as failing to say no. A procedure that answers every case EXCEPT the
  // do-not-build ones has not avoided the defect, it has hidden it: functionally it still never
  // says no. Scoring those as merely "unusable" let such a procedure pass with both directions
  // reported clean, which the harness's own test caught.
  const asAlwaysValidation = rows.filter((r) =>
    r.expected === "do-not-build" && (r.unusable || (r.predicted && r.predicted !== "do-not-build")));

  return {
    total: rows.length,
    correct,
    accuracyPoints: rows.length ? Math.round((correct / rows.length) * 1000) / 10 : 0,
    unusable: rows.filter((r) => r.unusable).length,
    // Counting and attributing are separate jobs, and conflating them is what made the first
    // version of this file wrong. The counts are reason-agnostic: a wrong verdict is wrong
    // however it was reached, and both gate the pass. The attribution is only claimed when the
    // procedure actually said the incumbent decided it.
    falseDoNotBuild: asDisqualifier.map((r) => r.id),
    falseBuildOrCompose: asAlwaysValidation.map((r) => r.id),
    attributedToIncumbent: [...asDisqualifier, ...asAlwaysValidation]
      .filter((r) => r.reason === "incumbent").map((r) => r.id),
    reasonNotStated: [...asDisqualifier, ...asAlwaysValidation]
      .filter((r) => !r.reason).map((r) => r.id),
    agreesForDifferentReason: rows.filter((r) => r.agreesForDifferentReason).map((r) => r.id),
    byFamily: Object.fromEntries(
      [...new Set(cases.map((c) => c.family))].map((f) => {
        const sub = rows.filter((r) => r.family === f);
        return [f, `${sub.filter((r) => r.correct).length}/${sub.length}`];
      }),
    ),
    rows,
  };
}

/**
 * @param {object} corpus loaded corpus
 * @param {(testCase: object) => string|{verdict: string}} predict the procedure under test
 * @param {{requiredMarginPoints?: number}} options
 */
export function scoreResearchVerdicts(corpus, predict, { requiredMarginPoints = 10 } = {}) {
  const cases = corpus.cases ?? [];
  const candidate = scoreOne(cases, predict);

  const baselines = Object.fromEntries(
    Object.entries(BASELINES).map(([name, fn]) => [name, scoreOne(cases, fn)]),
  );
  const bestBaselineName = Object.keys(baselines)
    .sort((a, b) => baselines[b].accuracyPoints - baselines[a].accuracyPoints)[0];
  const bestBaseline = baselines[bestBaselineName];
  const margin = Math.round((candidate.accuracyPoints - bestBaseline.accuracyPoints) * 10) / 10;

  // Both directions must be clean AND the constant baseline must be beaten. Either alone is
  // insufficient: a rule can beat the baseline while still never saying no, and a rule can say no
  // in the right places while otherwise being noise.
  const beatsBaseline = margin >= requiredMarginPoints;
  const bothDirectionsClean = candidate.falseDoNotBuild.length === 0
    && candidate.falseBuildOrCompose.length === 0;

  return {
    schemaVersion: "nodekit.research-verdict-score/v1",
    corpusId: corpus.id,
    candidate,
    baselines,
    bestBaselineName,
    marginPoints: margin,
    requiredMarginPoints,
    beatsBaseline,
    bothDirectionsClean,
    passed: beatsBaseline && bothDirectionsClean,
    boundary:
      "Scores agreement with an authored corpus of product judgements. It does not establish that those judgements are right, and a perfect score is not evidence of correct product decisions. It measures one thing: whether a procedure reads an incumbent as validation, as disqualification, or as neither, in cases where the corpus says which applies.",
  };
}
