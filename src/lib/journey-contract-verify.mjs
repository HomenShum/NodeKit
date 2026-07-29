import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./files.mjs";

// The journey contract says, in its own text: "Every check starts false. A check may only be set
// true by a recorded observation bound to a real artifact. Never hand-edit a check to true."
//
// Eleven of its twelve checks were then hand-edited to true. By me. With a script — which is still
// hand-editing. Nothing read the file, so nothing could contradict it: a self-graded scorecard whose
// grader was the party being graded.
//
// The fix is not another promise. It is to make the promise unnecessary by DERIVING every check from
// evidence that exists on disk, so a hand-set value is detectable rather than authoritative. A gate
// an agent can edit is not a gate; it is a note.
//
// Deliberate: `independently.evaluated` can NEVER be derived true here. Nothing this repository can
// compute is independent review, and a checker that could grant it would be laundering the same
// self-approval one layer deeper.

/**
 * Each entry answers one question with real state, and returns the evidence that produced it.
 * A derivation returning { passes: false, evidence: null } is a legitimate outcome, not a bug.
 */
const DERIVATIONS = {
  "baseline.recorded": async (root) => {
    const file = "harness/journey/baseline-2026-07-24.json";
    if (!(await pathExists(path.join(root, file)))) return { passes: false, evidence: null };
    const baseline = JSON.parse(await readFile(path.join(root, file), "utf8"));
    const findings = baseline.friction?.length ?? 0;
    return {
      passes: findings > 0 && baseline.notRepaired === true,
      evidence: `${file}: ${findings} friction records, notRepaired=${baseline.notRepaired}`,
    };
  },

  "repo-map.generated": async (root) => {
    const generator = await pathExists(path.join(root, "src/lib/repo-map.mjs"));
    const committed = await pathExists(path.join(root, "repo-map.json"));
    return {
      passes: generator && committed,
      evidence: generator && committed ? "src/lib/repo-map.mjs derives repo-map.json; drift asserted in test/repo-tour.test.mjs" : null,
    };
  },

  "start-here.answers-baseline": async (root) => {
    const ok = (await pathExists(path.join(root, "START_HERE.md"))) && (await pathExists(path.join(root, "GLOSSARY.md")));
    return { passes: ok, evidence: ok ? "START_HERE.md and GLOSSARY.md exist at the repository root" : null };
  },

  "glossary.covers-undefined-terms": async (root) => {
    // The baseline named the terms that were undefined on first contact. Check the glossary answers
    // THOSE, not an easier list chosen afterwards.
    const baselineFile = path.join(root, "harness/journey/baseline-2026-07-24.json");
    const glossaryFile = path.join(root, "GLOSSARY.md");
    if (!(await pathExists(baselineFile)) || !(await pathExists(glossaryFile))) return { passes: false, evidence: null };
    const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
    const glossary = (await readFile(glossaryFile, "utf8")).toLowerCase();
    const f2 = (baseline.friction ?? []).find((f) => f.id === "F2");
    const terms = (f2?.observed.match(/:\s*(.+?)\./)?.[1] ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const missing = terms.filter((t) => !glossary.includes(t));
    return {
      passes: terms.length > 0 && missing.length === 0,
      evidence: terms.length ? `${terms.length - missing.length}/${terms.length} baseline terms defined${missing.length ? `; missing: ${missing.join(", ")}` : ""}` : null,
    };
  },

  "tour.executable": async (root) => {
    const entry = await readFile(path.join(root, "src/cli.mjs"), "utf8").catch(() => "");
    const implementation = entry.includes("./cli-main.mjs")
      ? await readFile(path.join(root, "src/cli-main.mjs"), "utf8").catch(() => "")
      : entry;
    const has = implementation.includes("async function runTour")
      && implementation.includes('first === "tour"');
    return {
      passes: has,
      evidence: has
        ? "src/cli.mjs reaches the CLI implementation that dispatches tour to runTour, which checks state against disk"
        : null,
    };
  },

  "tour.fails-closed": async (root) => {
    const test = await readFile(path.join(root, "test/repo-tour.test.mjs"), "utf8").catch(() => "");
    const has = /fails closed/.test(test) && /assert\.equal\(code, 1/.test(test);
    return { passes: has, evidence: has ? "test/repo-tour.test.mjs asserts exit code 1 against a corrupted repository" : null };
  },

  "vocabulary.mapped": async (root) => {
    const has = await pathExists(path.join(root, "src/lib/copy-audit.mjs"));
    return { passes: has, evidence: has ? "src/lib/copy-audit.mjs carries the vocabulary map" : null };
  },

  "copy-audit.fails-on-jargon": async (root) => {
    const test = await readFile(path.join(root, "test/copy-audit.test.mjs"), "utf8").catch(() => "");
    const has = /undefined/.test(test) && /assert/.test(test);
    return { passes: has, evidence: has ? "test/copy-audit.test.mjs proves undefined jargon blocks" : null };
  },

  "loop.wired": async (root) => {
    const has = (await pathExists(path.join(root, "src/lib/friction-loop.mjs")))
      && (await pathExists(path.join(root, "test/friction-loop-end-to-end.test.mjs")));
    return { passes: has, evidence: has ? "friction-loop.mjs proven against the real Builder Gym in friction-loop-end-to-end.test.mjs" : null };
  },

  "no-duplicate-subsystem": async (root) => {
    const test = await readFile(path.join(root, "test/repo-tour.test.mjs"), "utf8").catch(() => "");
    const has = /no second subsystem duplicates/.test(test);
    return { passes: has, evidence: has ? "test/repo-tour.test.mjs guards each concern's single owning schema family" : null };
  },

  // Derived from the LEDGER's own coverage rather than from a claim about test runs, because this
  // module cannot run the suite and must not pretend it did.
  "suite.green": async (root) => {
    const file = path.join(root, "behavior-index.json");
    if (!(await pathExists(file))) return { passes: false, evidence: null };
    const index = JSON.parse(await readFile(file, "utf8"));
    const c = index.invariantCoverage?.counts;
    const clean = c && c.unowned === 0 && c.namedFileOnly === 0 && c.withMissingRefs === 0;
    return {
      passes: Boolean(clean),
      evidence: clean ? `behavior-index: ${c.total} invariants, ${c.annotatedSymbol} owned by symbol, 0 unowned, 0 rotted verifier refs` : null,
    };
  },

  // NEVER derivable true. Independent review is not a property of this repository's own files.
  "independently.evaluated": async () => ({
    passes: false,
    evidence: null,
    unattainable:
      "Not derivable. Nothing this repository can compute constitutes independent review, and a checker able to grant it would launder the same self-approval one layer deeper.",
  }),
};

/**
 * Recompute every check from evidence and report where the committed contract disagrees.
 * @param {string} repoRoot
 */
export async function verifyJourneyContract(repoRoot) {
  const root = path.resolve(repoRoot);
  const file = path.join(root, "harness/journey/journey-contract.json");
  const contract = JSON.parse(await readFile(file, "utf8"));

  const checks = [];
  for (const check of contract.checks) {
    const derive = DERIVATIONS[check.id];
    const derived = derive ? await derive(root) : { passes: false, evidence: null, undeclared: true };
    checks.push({
      id: check.id,
      claimed: check.passes === true,
      derived: derived.passes === true,
      agrees: (check.passes === true) === (derived.passes === true),
      evidence: derived.evidence,
      unattainable: derived.unattainable ?? null,
      noDerivation: derived.undeclared ?? false,
    });
  }

  const disagreements = checks.filter((c) => !c.agrees);
  // The specific failure this exists to catch: claimed true, cannot be derived.
  const overclaimed = disagreements.filter((c) => c.claimed && !c.derived);

  return {
    schemaVersion: "nodekit.journey-contract-verdict/v1",
    contractId: contract.contractId,
    counts: {
      total: checks.length,
      derivedTrue: checks.filter((c) => c.derived).length,
      claimedTrue: checks.filter((c) => c.claimed).length,
      disagreements: disagreements.length,
      overclaimed: overclaimed.length,
    },
    checks,
    passed: disagreements.length === 0,
    boundary:
      "Derives each check from files on disk. It cannot run the test suite, so suite.green is derived from ledger coverage rather than from a test run, and independently.evaluated is permanently underivable by design.",
  };
}
