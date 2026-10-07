import path from "node:path";
import { prepareSubmissionManifest } from "../src/lib/submission-preparation.mjs";
import { evaluateSubmissionManifest } from "../src/lib/submission-gate.mjs";
import { parseTrustedAttestationKeysJson } from "../src/lib/submission-attestation.mjs";
import { evaluateDeferrals, formatDeferrals, readDeferrals } from "../src/lib/deferrals.mjs";

function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!["candidate", "repo-root", "output"].includes(name)) {
      throw new Error(`unknown option --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return { options, positional };
}

const { options, positional } = parseArguments(process.argv.slice(2));
const candidateRef = options.candidate ?? positional[0] ?? "HEAD";
const repoRoot = path.resolve(options["repo-root"] ?? positional[1] ?? ".");
const outputPath = options.output ?? positional[2] ?? "proof/submission-manifest.json";
const trustedAttestationKeys = parseTrustedAttestationKeysJson(process.env.NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON ?? "{}");

// Read before the manifest work, so a malformed ledger fails immediately rather than after the
// expensive gates have already printed a reassuring number.
const deferrals = await readDeferrals(repoRoot);
const deferralVerdict = evaluateDeferrals(deferrals);

const result = await prepareSubmissionManifest({ candidateRef, outputPath, repoRoot, trustedAttestationKeys });
const passedGates = result.manifest.gates.filter((gate) => gate.passed).length;
let evaluation;
try {
  evaluation = await evaluateSubmissionManifest(repoRoot, result.outputPath, { trustedAttestationKeys });
} catch (error) {
  evaluation = { errors: [error.message], passed: false };
}
console.log(JSON.stringify({
  candidateCommit: result.manifest.candidateCommit,
  outputPath: result.outputPath,
  passedGates,
  requiredGates: result.manifest.gates.length,
  sourceChanges: result.sourceChanges,
  sourceIsExact: result.sourceIsExact,
  // This status comes from the full evaluator, including cross-gate identity,
  // attestation, evidence-closure, and signed-candidate consistency checks.
  // Per-gate preparation booleans alone are never a publication decision.
  // An open deferral is an unanswered question about this very submission, so it is part of ready.
  submissionReady: evaluation.passed === true && deferralVerdict.passed,
  evaluationErrors: evaluation.errors ?? [],
  deferrals: deferralVerdict,
}, null, 2));

// Printed rather than only counted: the list is the deliverable, and a number nobody reads is how
// these went missing in the first place. It goes to stderr because stdout is the machine channel
// here, and a caller parsing this output should not have to strip prose out of it.
//
// No separate exit code: `submissionReady: false` is already how this script refuses, and adding a
// second signal for one class of refusal would make the two disagree the first time a caller
// checked only one of them.
console.error("");
console.error(formatDeferrals(deferrals, deferralVerdict));
