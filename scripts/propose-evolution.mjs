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
 *   2. never asserts review. draftEvolutionEvent stamps "agent-proposed" itself
 *      and refuses a caller-supplied reviewer. Promotion derives human-reviewed
 *      by verifying a signed approval at record time — no field, anywhere, can
 *      be edited to fake it.
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
 *     --evidence evd:cli-authority-bypass-and-repair \
 *     --supersedes evt:older-decision \
 *     --thread https://chatgpt.com/c/xxxx \
 *     --limitation "..." --limitation "..."
 *
 * Repeat --evidence, --assumption, --invariant, --predecessor, --supersedes,
 * and --limitation to bind more than one record.
 *
 * Exit: 0 written, 2 bad usage, 4 id already exists, 5 authority violation.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = dirname(dirname(fileURLToPath(import.meta.url)));
const DRAFTS = join(PLATFORM, "evolution", "drafts");
const EVIDENCE = join(PLATFORM, "evolution", "evidence");

const TRACKS = ["harness", "architecture", "product"];
const CATEGORIES = ["workflow", "schema", "runtime", "agent", "ui", "evaluation", "security", "release"];
const MAX_ARGUMENT_TOKENS = 256;
const MAX_REPEATABLE_VALUES = 64;
const MAX_VALUE_LENGTH = 16_384;
const MAX_EVIDENCE_RECORD_BYTES = 1024 * 1024;

const FLAGS = Object.freeze({
  id: { target: "id" },
  track: { target: "track" },
  category: { target: "category" },
  challenge: { target: "challenge" },
  observed: { target: "observed" },
  resolution: { target: "resolution" },
  thread: { target: "thread" },
  status: { target: "status" },
  "reviewed-by": { target: "reviewedBy" },
  limitation: { target: "limitation", repeatable: true },
  assumption: { target: "assumptionIds", repeatable: true },
  invariant: { target: "invariantIds", repeatable: true },
  evidence: { target: "evidenceIds", repeatable: true },
  predecessor: { target: "predecessorIds", repeatable: true },
  supersedes: { target: "supersedesIds", repeatable: true },
});

function die(msg, code = 2) {
  console.error(`  ERROR  ${msg}`);
  process.exit(code);
}

function parse(argv) {
  if (argv.length > MAX_ARGUMENT_TOKENS) {
    die(`too many arguments; at most ${MAX_ARGUMENT_TOKENS} tokens are accepted`);
  }
  const out = { limitation: [], assumptionIds: [], invariantIds: [],
                evidenceIds: [], predecessorIds: [], supersedesIds: [] };
  const seenScalars = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected argument ${a!==undefined?a:""}`);
    const key = a.slice(2);
    const spec = FLAGS[key];
    if (!spec) die(`unknown flag --${key}`);
    const val = argv[++i];
    if (val === undefined || val.startsWith("--")) die(`--${key} needs a value`);
    if (val.length > MAX_VALUE_LENGTH) {
      die(`--${key} exceeds the ${MAX_VALUE_LENGTH}-character input limit`);
    }
    if (spec.repeatable) {
      const values = out[spec.target];
      if (values.length >= MAX_REPEATABLE_VALUES) {
        die(`--${key} exceeds the ${MAX_REPEATABLE_VALUES}-value limit`);
      }
      if (values.includes(val)) die(`duplicate --${key} value ${val}`);
      values.push(val);
    } else {
      if (seenScalars.has(spec.target)) die(`--${key} may be supplied only once`);
      seenScalars.add(spec.target);
      out[spec.target] = val;
    }
  }
  return out;
}

function validateEvidenceReference(id) {
  if (!/^evd:[a-z0-9][a-z0-9._-]*$/.test(id)) {
    die(`--evidence must be a canonical evd: identifier; received ${id}`);
  }
  const recordPath = join(EVIDENCE, `${id.replaceAll(":", "-")}.json`);
  if (!existsSync(recordPath)) {
    die(`--evidence ${id} does not exist in evolution/evidence/`);
  }
  if (statSync(recordPath).size > MAX_EVIDENCE_RECORD_BYTES) {
    die(`--evidence ${id} exceeds the ${MAX_EVIDENCE_RECORD_BYTES}-byte record limit`);
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (error) {
    die(`--evidence ${id} is unreadable JSON: ${error.message}`);
  }
  if (record.schemaVersion !== "nodekit.evolution-evidence/v1" || record.id !== id) {
    die(`--evidence ${id} does not resolve to a matching nodekit.evolution-evidence/v1 record`);
  }
}

const a = parse(process.argv.slice(2));

// --- authority guards, before anything is computed ------------------------

if (a.status && a.status !== "agent-proposed")
  die(`refused: this tool cannot write interpretation.status=${a.status!==undefined?a.status:""}. ` +
      `canonicalRecords is human-reviewed-only. human-reviewed is DERIVED from a ` +
      `verified signed approval at record time — it is not a field anyone can set.`, 5);
if (a.reviewedBy)
  die(`refused: this tool cannot name reviewedBy=${a.reviewedBy}. The reviewer identity is ` +
      `derived from a verified signed approval at record time.`, 5);

for (const need of ["id", "track", "challenge", "observed", "resolution"])
  if (!a[need]) die(`--${need} is required`);
if (a.evidenceIds.length === 0)
  die("--evidence is required; bind at least one canonical evolution evidence record");

if (!TRACKS.includes(a.track)) die(`--track must be one of ${TRACKS.join(", ")}`);
if (a.category && !CATEGORIES.includes(a.category))
  die(`--category must be one of ${CATEGORIES.join(", ")}`);
for (const id of a.evidenceIds) validateEvidenceReference(id);

const slug = a.id.replace(/^evt:/, "");
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die("--id must be kebab-case");

const outPath = resolve(DRAFTS, `evt-${slug}.json`);
// Path containment. An id of "../events/harness/x" must not escape the lane.
if (relative(DRAFTS, outPath).startsWith("..")) die("refused: path escapes evolution/drafts/", 5);
if (existsSync(outPath)) die(`draft evt-${slug}.json already exists. delete is prohibited; ` +
                             `use a new id and --supersedes evt:${slug}`, 4);

// DELEGATES TO NODEKIT. It no longer builds the record itself.
//
// This script used to assemble the JSON by hand, having reverse-engineered the
// shape from a single example file. Every record it produced was schema-INVALID
// — 7, 9 and 8 errors — and they looked entirely official. It invented a root
// field (materiality), invented categories, invented interpretation properties,
// and left evidenceIds empty where the schema requires at least one receipt.
//
// node-platform is declared canonicalFor nodekit.evolution-ledger and ships
// draftEvolutionEvent, which validates and THROWS rather than writing a bad
// record. The CLI ergonomics and the authority guards above are worth keeping;
// the record construction never was.
//
// A tool that writes invalid records which look valid is worse than no tool.
const { draftEvolutionEvent } = await import("../src/lib/evolution-ledger.mjs");

// The schema defect this used to work around is FIXED upstream. draftEvolutionEvent
// now stamps status "agent-proposed" itself and REFUSES a caller-supplied
// reviewedBy — the reviewer identity is derived from a verified signed approval at
// record time, never from a field. So the caveat that used to be appended here is
// obsolete, and passing reviewedBy is now an error rather than an honest marker.
const limitations = a.limitation.length ? a.limitation : [];
limitations.push(
  "Drafted by an agent. Not canonical: promotion derives human-reviewed from a " +
  "verified signed approval, which this tool cannot produce.",
);

try {
  const { output, event } = await draftEvolutionEvent(PLATFORM, {
    id: `evt:${slug}`,
    track: a.track,
    category: a.category || "evaluation",
    challenge: a.challenge,
    observedFailure: a.observed,
    resolution: a.resolution,
    assumptionIds: a.assumptionIds,
    invariantIds: a.invariantIds,
    evidenceIds: a.evidenceIds,
    predecessorIds: a.predecessorIds,
    supersedesIds: a.supersedesIds,
    knownLimitations: limitations,
    status: a.status,
  });
  console.log(`\n  DRAFTED   ${event.id}`);
  console.log(`  file      ${relative(PLATFORM, output).replace(/\\/g, "/")}`);
  console.log(`  validated against nodekit.evolution-event.v1.schema.json`);
  if (a.thread) {
    console.log(`\n  NOTE: --thread ${a.thread} was NOT written. The schema forbids`);
    console.log(`  extra properties on source, so provenance belongs in the resolution`);
    console.log(`  text or an evidence record — not in an invented field.`);
  }
  console.log(`\n  Not canonical. A human promotes it by moving it into`);
  console.log(`  evolution/events/${a.track}/ via recordEvolutionRecord. This tool cannot.\n`);
} catch (err) {
  if (err?.code === "EEXIST") {
    die(`draft evt-${slug}.json already exists. delete is prohibited; ` +
        `use a new id and --supersedes evt:${slug}`, 4);
  }
  console.error(`\n  REFUSED — the record would not have been valid:\n`);
  for (const line of String(err.message).split("\n")) console.error(`    ${line}`);
  console.error(`\n  Nothing was written. Fix the input rather than the schema.\n`);
  process.exit(6);
}
