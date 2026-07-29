#!/usr/bin/env node
/**
 * reference-corpus-gate — the checks a reference record may not perform on itself.
 *
 * Written 2026-07-28, immediately after the first corpus record failed its own compliance claim.
 * That record carried a `bannedTagCheck` field asserting it used no appearance adjectives, and the
 * only place those adjectives appeared in the entire corpus was inside that assertion. The claim
 * was the violation.
 *
 * That is the journey contract's authority rule reaching a place it was not written for: **a record
 * may not assert its own compliance.** `bannedTagCheck` is `reviewedBy` in different clothing —
 * a field where the party being graded writes the grade. The check belongs in an instrument that
 * is not the subject.
 *
 * Three checks, all of which a record could have faked about itself:
 *
 *   1. NO APPEARANCE ADJECTIVES. "clean", "beautiful", "modern", "premium", "polished",
 *      "delightful", "good UX" — banned because they are unretrievable. A corpus you cannot query
 *      by problem is a scrapbook. This is the design-dna skill's rule, enforced rather than stated.
 *
 *   2. EVERY CITED FACT RESOLVES. A DesignRule cites `observationId/factId`. A citation pointing at
 *      nothing is the reference-corpus form of a fabricated digest — it looks like evidence and
 *      binds to none.
 *
 *   3. NO SELF-GRADING FIELDS. Anything shaped like `reviewedBy`, `approved`, `verified`,
 *      `bannedTagCheck`, `compliant` — refused by name, so the failure says what it is.
 *
 * Reports its denominator on every run: records read, facts recorded, citations checked. A gate
 * printing only PASS cannot be audited for having measured nothing (docs/VACUOUS_PASS.md).
 *
 * Exit codes:
 *   0  every record passes every check
 *   1  at least one violation
 *   3  no records found — NOT RUN, and not-run is never a pass
 *
 * Usage: node scripts/reference-corpus-gate.mjs [corpusDir]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const corpusDir = process.argv[2] ?? "atlas/references";
const BANNED = /\b(clean|beautiful|modern|premium|polished|delightful|good UX|elegant|sleek)\b/i;
const SELF_GRADING = /^(reviewedBy|approved|verified|bannedTagCheck|compliant|passesChecks|selfCheck)$/i;

let files = [];
try {
  files = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(corpusDir, f))
    .filter((f) => statSync(f).isFile());
} catch {
  files = [];
}

if (files.length === 0) {
  console.error(`NOT_RUN  no reference records found under ${corpusDir}; not-run is never a pass.`);
  process.exit(3);
}

const violations = [];
let factsRecorded = 0;
let citationsChecked = 0;
const factIndex = new Set();
const records = [];

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    violations.push(`${path.basename(file)}: unparseable — ${error.message}`);
    continue;
  }
  records.push({ file, doc });
  for (const observation of doc.observations ?? []) {
    for (const fact of observation.facts ?? []) {
      factIndex.add(`${observation.id}/${fact.id}`);
      factsRecorded += 1;
    }
  }
}

// Walk every string value and every key, so a banned word cannot hide in a nested field.
function walk(node, keyPath, onString, onKey) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${keyPath}[${i}]`, onString, onKey));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      onKey(key, `${keyPath}.${key}`);
      walk(value, `${keyPath}.${key}`, onString, onKey);
    }
  } else if (typeof node === "string") {
    onString(node, keyPath);
  }
}

for (const { file, doc } of records) {
  const name = path.basename(file);
  walk(
    doc,
    "",
    (value, at) => {
      const hit = value.match(BANNED);
      if (hit) violations.push(`${name}${at}: appearance adjective "${hit[0]}" — unretrievable, name the problem instead`);
    },
    (key, at) => {
      if (SELF_GRADING.test(key)) {
        violations.push(`${name}${at}: self-grading field "${key}" — a record may not assert its own compliance`);
      }
    },
  );
  for (const cited of doc.derivedFrom?.factIds ?? []) {
    citationsChecked += 1;
    if (!factIndex.has(cited)) violations.push(`${name}: cites ${cited}, which resolves to no recorded fact`);
  }
}

console.log(`${violations.length === 0 ? "PASS" : "FAIL"}  reference corpus`);
console.log(`      ${records.length} record(s) read from ${corpusDir}`);
console.log(`      ${factsRecorded} fact(s) recorded; ${citationsChecked} citation(s) checked`);
for (const v of violations) console.log(`      ${v}`);
process.exit(violations.length === 0 ? 0 : 1);
