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
 * Extended the same day, when the third layer landed. ReferenceObservation and DesignRule had been
 * shipping for hours declaring `schemaVersion` strings that matched no file in `schemas/`, so the
 * one thing every other record format in this repository gets — a validator that refuses the wrong
 * shape — the corpus did not have. A declared version nothing can check is a version number, not a
 * contract. Checks 4 and 5 close that, and check 5 exists because a ScoreReceipt is the first
 * record here whose citations are load-bearing per-criterion rather than per-document.
 *
 * Five checks, all of which a record could have faked about itself:
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
 *   4. EVERY RECORD VALIDATES AGAINST THE SCHEMA ITS OWN `schemaVersion` NAMES. A record that
 *      declares a version with no schema behind it has opted out of every structural check in the
 *      repository while looking like it opted in.
 *
 *   5. A SCORE RECEIPT'S CITATIONS ARE SPECIFIC, RESOLVED AND HONESTLY LABELLED. Per criterion:
 *      the `observationId/factId` pairs resolve; they appear in the receipt's own `derivedFrom`
 *      (and `derivedFrom` carries nothing extra, so the citation list cannot be padded to look
 *      broader than the scoring); `withinRuleDerivation` is recomputed against the cited rule
 *      rather than believed; and every score sits inside the scale the receipt declared. That last
 *      one matters because a score outside its own anchors is a number with no meaning attached,
 *      which is the failure this whole layer was built to prevent.
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
import { validateSchema } from "../src/lib/schema-validation.mjs";

const corpusDir = process.argv[2] ?? "atlas/references";
const BANNED = /\b(clean|beautiful|modern|premium|polished|delightful|good UX|elegant|sleek)\b/i;
const SELF_GRADING = /^(reviewedBy|approved|verified|bannedTagCheck|compliant|passesChecks|selfCheck)$/i;

// The map is explicit rather than derived from the version string, so adding a record format is a
// deliberate edit here and an unknown version fails loudly instead of being skipped.
const SCHEMA_FOR_VERSION = new Map([
  ["nodekit.reference-observation/v1", "nodekit.reference-observation.v1.schema.json"],
  ["nodekit.design-rule/v1", "nodekit.design-rule.v1.schema.json"],
  ["nodekit.score-receipt/v1", "nodekit.score-receipt.v1.schema.json"],
]);

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
let recordsValidated = 0;
let criterionScoresChecked = 0;
const factIndex = new Set();
const rulesById = new Map();
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
  if (doc.schemaVersion === "nodekit.design-rule/v1" && doc.ruleId) rulesById.set(doc.ruleId, doc);
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

  // 4. The record is checked against the schema it names, not against the schema we assume it meant.
  const version = doc.schemaVersion;
  if (typeof version !== "string" || version.length === 0) {
    violations.push(`${name}: no schemaVersion — nothing can validate this record`);
  } else if (!SCHEMA_FOR_VERSION.has(version)) {
    violations.push(`${name}: schemaVersion "${version}" has no schema in schemas/; a declared version with no validator behind it is a version number, not a contract`);
  } else {
    const errors = await validateSchema(SCHEMA_FOR_VERSION.get(version), doc, "");
    recordsValidated += 1;
    for (const error of errors) violations.push(`${name}: schema ${version} — ${error.trim()}`);
  }
}

// 5. ScoreReceipt citations. Per criterion, not per document: the point of the layer is that one
//    criterion's score is answerable with specific facts, so checking only the document-level union
//    would leave the load-bearing claim unchecked.
for (const { file, doc } of records) {
  if (doc.schemaVersion !== "nodekit.score-receipt/v1") continue;
  const name = path.basename(file);
  const rule = rulesById.get(doc.ruleId);
  if (!rule) {
    violations.push(`${name}: scores against rule "${doc.ruleId}", which resolves to no rule in ${corpusDir}`);
  }
  const ruleFacts = new Set(rule?.derivedFrom?.factIds ?? []);
  const declared = new Set(doc.derivedFrom?.factIds ?? []);
  const citedByCriteria = new Set();
  const min = doc.scale?.min;
  const max = doc.scale?.max;
  const anchors = doc.scale?.anchors ?? {};

  for (const criterion of doc.criteria ?? []) {
    criterionScoresChecked += 1;
    if (Number.isInteger(min) && Number.isInteger(max) && (criterion.score < min || criterion.score > max)) {
      violations.push(`${name}: criterion ${criterion.id} scores ${criterion.score}, outside its own declared scale ${min}..${max}`);
    } else if (!Object.hasOwn(anchors, String(criterion.score))) {
      violations.push(`${name}: criterion ${criterion.id} scores ${criterion.score}, which the receipt's own scale describes no anchor for`);
    }
    for (const citation of criterion.citations ?? []) {
      let allWithinRule = true;
      for (const factId of citation.factIds ?? []) {
        const qualified = `${citation.observationId}/${factId}`;
        citationsChecked += 1;
        citedByCriteria.add(qualified);
        if (!factIndex.has(qualified)) {
          violations.push(`${name}: criterion ${criterion.id} cites ${qualified}, which resolves to no recorded fact`);
        }
        if (!declared.has(qualified)) {
          violations.push(`${name}: criterion ${criterion.id} cites ${qualified}, absent from the receipt's own derivedFrom.factIds`);
        }
        if (!ruleFacts.has(qualified)) allWithinRule = false;
      }
      if (rule && citation.withinRuleDerivation !== allWithinRule) {
        violations.push(
          `${name}: criterion ${criterion.id} citation of ${citation.observationId} claims withinRuleDerivation ${citation.withinRuleDerivation}, but recomputing against ${doc.ruleId} gives ${allWithinRule}`,
        );
      }
    }
  }

  for (const cited of declared) {
    if (!citedByCriteria.has(cited)) {
      violations.push(`${name}: derivedFrom lists ${cited}, which no criterion cites — a citation list padded past the scoring reads as broader evidence than was spent`);
    }
  }

  for (const score of [doc.score, doc.humanReview?.revisedScore]) {
    if (Number.isInteger(score) && Number.isInteger(min) && Number.isInteger(max) && (score < min || score > max)) {
      violations.push(`${name}: score ${score} sits outside the receipt's own declared scale ${min}..${max}`);
    }
  }
}

console.log(`${violations.length === 0 ? "PASS" : "FAIL"}  reference corpus`);
console.log(`      ${records.length} record(s) read from ${corpusDir}; ${recordsValidated} validated against a declared schema`);
console.log(`      ${factsRecorded} fact(s) recorded; ${citationsChecked} citation(s) checked; ${criterionScoresChecked} criterion score(s) checked`);
for (const v of violations) console.log(`      ${v}`);
process.exit(violations.length === 0 ? 0 : 1);
