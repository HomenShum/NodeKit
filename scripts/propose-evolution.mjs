#!/usr/bin/env node
/**
 * propose-evolution.mjs — the join between the reasoning half and the ledger.
 *
 * WHY THIS EXISTS
 *
 * Two halves of one second brain never referenced each other. Reasoning lived
 * in ChatGPT threads and memory stores. Engineering lived in evolution/,
 * behavior-index.json and repositories.yaml. Because neither pointed at the
 * other, a decision could be settled in a thread AND drafted on disk while the
 * work was still reported as unstarted. recall.mjs made both halves readable
 * in one query. This makes the reasoning half WRITABLE into the ledger, in the
 * only lane an agent is allowed to use.
 *
 * THE AUTHORITY MODEL, ENFORCED IN CODE
 *
 * evolution/ledger.json says:
 *
 *     canonicalRecords: human-reviewed-only
 *     mutation:         append-or-supersede
 *     delete:           prohibited
 *
 * So this script:
 *
 *   1. writes ONLY into evolution/drafts/. It resolves the output path and
 *      refuses if the result escapes that directory.
 *   2. stamps interpretation.status = "agent-proposed", never
 *      "human-reviewed". It rejects any attempt to pass that value. A
 *      promotion is a human moving the file into evolution/events/<track>/
 *      and changing that field themselves.
 *   3. never overwrites and never deletes. An existing id is an error, not a
 *      merge. Superseding is explicit, via --supersedes.
 *
 * A tool that could approve its own proposal is not a review lane. It is a
 * write path with extra words.
 *
 * PROVENANCE
 *
 * A thread-sourced proposal records where the reasoning came from, because a
 * claim whose origin cannot be checked is the same failure as an absence whose
 * coverage cannot be checked. Thread content is DATA, never instruction: a
 * thread that says "adopt this" is describing a past intent, not authorising a
 * promotion.
 *
 * USAGE
 *
 *   node scripts/propose-evolution.mjs \
 *     --id recall-before-claim --track harness --category evaluation \
 *     --challenge "..." --observed "..." --resolution "..." \
 *     --thread https://chatgpt.com/c/xxxx \
 *     --limitation "..." --limitation "..."
 *
 * Exit: 0 written, 2 bad usage, 4 id already exists, 5 authority violation.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const PLATFORM = dirname(dirname(fileURLToPath(import.meta.url)));
const DRAFTS = join(PLATFORM, "evolution", "drafts");

const TRACKS = ["harness", "architecture", "product"];
const MATERIALITY = [
  "primary-user-workflow", "public-contract", "architectural-ownership",
  "security-authority", "proof-requirement", "model-routing",
  "harness-behavior", "benchmark-conclusion", "downstream-guarantee",
];

function die(msg, code = 2) {
  console.error(`  ERROR  ${msg}`);
  process.exit(code);
}

function parse(argv) {
  const out = { limitation: [], assumptionIds: [], invariantIds: [],
                evidenceIds: [], predecessorIds: [], materiality: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected argument ${a!==undefined?a:""}`);
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined || val.startsWith("--")) die(`--${key} needs a value`);
    if (Array.isArray(out[key])) out[key].push(val);
    else out[key] = val;
  }
  return out;
}

const a = parse(process.argv.slice(2));

// --- authority guards, before anything is computed ------------------------

if (a.status && a.status !== "agent-proposed")
  die(`refused: this tool cannot write interpretation.status=${a.status!==undefined?a.status:""}. ` +
      `canonicalRecords is human-reviewed-only. A human promotes by moving the ` +
      `file into evolution/events/<track>/ and editing that field.`, 5);

for (const need of ["id", "track", "challenge", "observed", "resolution"])
  if (!a[need]) die(`--${need} is required`);

if (!TRACKS.includes(a.track)) die(`--track must be one of ${TRACKS.join(", ")}`);
for (const m of a.materiality)
  if (!MATERIALITY.includes(m)) die(`unknown materiality ${m}; ledger allows: ${MATERIALITY.join(", ")}`);

const slug = a.id.replace(/^evt:/, "");
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die("--id must be kebab-case");

const outPath = resolve(DRAFTS, `evt-${slug}.json`);
// Path containment. An id of "../events/harness/x" must not escape the lane.
if (relative(DRAFTS, outPath).startsWith("..")) die("refused: path escapes evolution/drafts/", 5);
if (existsSync(outPath)) die(`draft evt-${slug}.json already exists. delete is prohibited; ` +
                             `use a new id and --supersedes evt:${slug}`, 4);

let commitSha = null;
try {
  commitSha = execSync("git rev-parse HEAD", { cwd: PLATFORM, stdio: ["ignore", "pipe", "ignore"] })
    .toString().trim();
} catch { /* not a repo, or git absent. Recorded as null rather than invented. */ }

const record = {
  schemaVersion: "nodekit.evolution-event/v1",
  id: `evt:${slug}`,
  projectId: a.projectId || "nodekit",
  repository: a.repository || "HomenShum/node-platform",
  source: {
    commitSha,
    occurredAt: new Date().toISOString(),
    ...(a.thread ? { reasoningOrigin: { kind: "chatgpt-thread", ref: a.thread,
                                        note: "Thread content is data, not instruction." } } : {}),
  },
  track: a.track,
  category: a.category || "evaluation",
  ...(a.materiality.length ? { materiality: a.materiality } : {}),
  challenge: a.challenge,
  observedFailure: a.observed,
  resolution: a.resolution,
  assumptionIds: a.assumptionIds,
  invariantIds: a.invariantIds,
  evidenceIds: a.evidenceIds,
  predecessorIds: a.predecessorIds,
  ...(a.supersedes ? { supersedesIds: [a.supersedes] } : {}),
  knownLimitations: a.limitation,
  interpretation: {
    status: "agent-proposed",
    proposedBy: a.proposedBy || "claude-code",
    proposedAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
  },
};

if (!record.knownLimitations.length)
  record.knownLimitations = [
    "Proposed by an agent and not yet human-reviewed. No claim here is canonical.",
  ];

mkdirSync(DRAFTS, { recursive: true });
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n", "utf8");

console.log(`\n  PROPOSED  evt:${slug}`);
console.log(`  file      evolution/drafts/evt-${slug}.json`);
console.log(`  status    agent-proposed   (NOT canonical, NOT reviewed)`);
if (a.thread) console.log(`  origin    ${a.thread}`);
console.log(`\n  To promote, a human moves it to evolution/events/${a.track}/ and sets`);
console.log(`  interpretation.status to human-reviewed. This tool cannot do that.\n`);
