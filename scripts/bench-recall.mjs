#!/usr/bin/env node
/**
 * bench-recall.mjs — does recall.mjs actually prevent the failure it was built for?
 *
 * THE GOLDEN SET IS NOT INVENTED
 *
 * Every PRESENT case below is something an agent claimed did not exist during one
 * session on 2026-07-25, or something it built from scratch because it never
 * checked. Each is paired with a path fragment that MUST appear in a hit, so the
 * test measures "found the right thing", not "found something". A benchmark that
 * accepts any hit would pass on noise.
 *
 * WHAT IS MEASURED
 *
 *   recall     of the things that exist, how many are found, in the right file
 *   precision  of the things that do not exist, how many are correctly not found
 *   honesty    does any output ever assert absence  (must be zero, always)
 *   latency    p50 / p95 wall time per query
 *
 * Honesty is the one that cannot be traded. A faster tool that says "does not
 * exist" is worse than no tool, because it converts a missing probe into a
 * confident false claim — which is exactly what happened eight times.
 *
 *     node scripts/bench-recall.mjs
 *     node scripts/bench-recall.mjs --json
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECALL = join(HERE, "recall.mjs");

// term -> a path fragment the correct answer must contain.
const PRESENT = [
  ["copy as proof surface", "evolution", "reported not-started; was already promoted with evidence"],
  ["repo-contract", "ownership", "claimed nothing defined this contract"],
  ["knowledge-evolution", "nodekit", "built a rival graph schema without checking"],
  ["provider broker", "scripts", "invisible from inside its own directory"],
  ["cost ledger", "convex", "invented a model chain instead of reading this"],
  ["free-auto", "noderoom", "the free-first route, missed entirely"],
  ["draftEvolutionEvent", "evolution-ledger", "hand-wrote 3 invalid records instead"],
  ["KNOWLEDGE_LAYERS", "knowledge-evolution", "re-derived proposal/canonical by hand"],
  ["frontend-specialist", "nodekit", "mobile views already declared as a contract"],
  ["evolution ledger", "evolution", "multi-word: the case that broke phrase matching"],
  ["graph patch", "knowledge-evolution", "multi-word, two common words"],
  ["idempotent retries", "invariant", "NodeRoom's caseflow invariant"],
];

// GENERATED AT RUNTIME, never written down.
//
// The first version hardcoded control terms like "zzq nonexistent widget". Every
// one of them then FAILED, because those exact strings had been written into
// evolution/artifacts/recall-before-claim.md — the evidence artifact that
// documents the control test — and scripts/ is a search root. The fixture
// contaminated the corpus it was measuring. Precision read 0/4 for a tool that
// was working correctly.
//
// Terms are now assembled from random bytes at run time, so they cannot exist in
// any file, including this one.
const nonce = () => randomBytes(4).toString("hex");
const ABSENT = [
  `zq${nonce()} wg${nonce()}`,
  `fb${nonce()} qx${nonce()} bz${nonce()}`,
  `un${nonce()} dp${nonce()} xy${nonce()}`,
  `qt${nonce()} bc${nonce()} sy${nonce()}`,
];

function run(term) {
  const t0 = process.hrtime.bigint();
  let out = "", code = 0;
  try {
    out = execFileSync("node", [RECALL, term], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    out = String(e.stdout ?? "");
    code = e.status ?? 1;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { out, code, ms };
}

const pct = (arr, p) => {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// The invariant: recall.mjs must never assert that something does not exist.
//
// SCOPED TO THE TOOL'S OWN VOICE. The first version scanned the entire output and
// flagged a breach whenever a MATCHED FILE happened to discuss absence —
// evolution/artifacts/recall-before-claim.md contains "Does not and cannot prove
// a thing does not exist", which is this tool's own doctrine being quoted back at
// it. Judging a tool by text it faithfully quoted is a broken test, not a broken
// tool, and it reported 1 breach against a tool doing exactly the right thing.
//
// Only the final verdict block is examined — after the last horizontal rule is
// where recall.mjs speaks for itself rather than reproducing a file.
const assertsAbsence = (out) => {
  const parts = out.split(/-{20,}/);
  const verdict = (parts[parts.length - 1] ?? "")
    .replace(/This is NOT a claim that it does not exist\./g, "");
  return /\b(does not exist|is absent|not found|no such)\b/i.test(verdict);
};

const rows = [];
const latencies = [];
let recallHits = 0, wrongFile = 0, honestyBreaches = 0;

for (const [term, mustContain, why] of PRESENT) {
  const { out, ms } = run(term);
  latencies.push(ms);
  const found = /FOUND \d+ across/.test(out);
  // Only the hit lines name files; the coverage block also contains paths.
  const hitBlock = out.split("COVERAGE")[0].toLowerCase();
  const right = found && hitBlock.includes(mustContain.toLowerCase());
  if (right) recallHits++;
  else if (found) wrongFile++;
  if (assertsAbsence(out)) honestyBreaches++;
  rows.push({ kind: "present", term, ok: right, found, ms: Math.round(ms), why });
}

let precisionOk = 0;
for (const term of ABSENT) {
  const { out, ms } = run(term);
  latencies.push(ms);
  const clean = /NO MATCH in \d+ files/.test(out) && !/FOUND \d+ across/.test(out);
  if (clean) precisionOk++;
  if (assertsAbsence(out)) honestyBreaches++;
  rows.push({ kind: "absent", term, ok: clean, ms: Math.round(ms) });
}

const result = {
  recall: { hit: recallHits, total: PRESENT.length, wrongFile },
  precision: { ok: precisionOk, total: ABSENT.length },
  honestyBreaches,
  latencyMs: {
    p50: Math.round(pct(latencies, 50)),
    p95: Math.round(pct(latencies, 95)),
    max: Math.round(Math.max(...latencies)),
  },
  rows,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n  RECALL BENCHMARK — golden set from real false-absent claims\n  ${"=".repeat(66)}`);
  console.log(`\n  PRESENT — must be found, in the right file`);
  for (const r of rows.filter((x) => x.kind === "present")) {
    console.log(`    ${r.ok ? "PASS" : r.found ? "WRONG FILE" : "MISS"}  ${String(r.ms).padStart(5)}ms  ${r.term}`);
    if (!r.ok) console.log(`          was: ${r.why}`);
  }
  console.log(`\n  ABSENT — must find nothing`);
  for (const r of rows.filter((x) => x.kind === "absent"))
    console.log(`    ${r.ok ? "PASS" : "FALSE POSITIVE"}  ${String(r.ms).padStart(5)}ms  ${r.term}`);

  console.log(`\n  ${"=".repeat(66)}`);
  console.log(`  recall     ${result.recall.hit}/${result.recall.total}` +
    (wrongFile ? `   (${wrongFile} found something, but not the right file)` : ""));
  console.log(`  precision  ${result.precision.ok}/${result.precision.total}`);
  console.log(`  honesty    ${honestyBreaches === 0 ? "0 breaches — never asserted absence" : `${honestyBreaches} BREACHES`}`);
  console.log(`  latency    p50 ${result.latencyMs.p50}ms   p95 ${result.latencyMs.p95}ms   max ${result.latencyMs.max}ms`);
  console.log();
}

// Honesty is the only hard failure. A miss is a coverage gap worth knowing about;
// asserting absence is the defect this whole tool exists to make impossible.
process.exitCode = honestyBreaches > 0 ? 1 : 0;
