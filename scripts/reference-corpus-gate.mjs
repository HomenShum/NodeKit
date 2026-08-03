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

// The rules belong to the project being gated, not to whatever package this file was installed
// into, so a ref resolves against that project. Deriving the root from this module's own location
// works only while the gate lives in the repository it checks: from inside a consumer's
// node_modules it would resolve every ref against NodeKit and report the consumer's own files as
// missing — a check that runs, prints a denominator, and answers a question nobody asked.
const args = process.argv.slice(2);
const rootFlag = args.findIndex((a) => a === "--repo-root");
const repoRoot = path.resolve(
  rootFlag >= 0 ? (args[rootFlag + 1] ?? ".") : (args.find((a) => a.startsWith("--repo-root="))?.slice(12) ?? process.cwd()),
);
const positional = args.filter((a, i) => !a.startsWith("--") && !(rootFlag >= 0 && i === rootFlag + 1));

const corpusDir = positional[0] ?? "atlas/references";
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

// 6. A DESIGN CONTRACT IS REQUIREMENTS, NOT DECORATION. Each rule declares where it terminates
//    in something checkable; `kind: none` is a legitimate answer for an advisory rule, but a
//    contract made mostly of them is a set of paragraphs wearing citations. The schema enforces
//    per-rule honesty (none must carry a reason); only the corpus can see the ratio.
const UNCHECKED_RULE_RATIO_MAX = 0.3;
const ruleTerminations = [...rulesById.values()].map((r) => r.boundToGate?.kind ?? "none");
const uncheckedRules = ruleTerminations.filter((k) => k === "none").length;

// A ref is only a termination if it resolves. "src/render.mjs:assertNoPie" naming an assertion that
// does not exist reads exactly like one that does, and is the shape a rule takes as the code moves
// out from under it. Resolved against the repository, not the corpus, because that is where the
// artifact lives.
let refsResolved = 0;
for (const rule of rulesById.values()) {
  const { kind, ref } = rule.boundToGate ?? {};
  if (kind === "none" || !ref) continue;
  const [locator, anchor] = ref.includes("#") ? [ref.slice(0, ref.indexOf("#")), ref.slice(ref.indexOf("#") + 1)] : [ref, null];
  // A trailing :symbol is only a symbol when it is not a Windows drive or a line number.
  const symbolMatch = anchor === null ? /^(.*?):([A-Za-z_$][\w$.]*)$/.exec(locator) : null;
  const filePath = symbolMatch ? symbolMatch[1] : locator;
  const symbol = symbolMatch ? symbolMatch[2] : null;
  const absolute = path.resolve(repoRoot, filePath);

  let source;
  try {
    source = statSync(absolute).isFile() ? readFileSync(absolute, "utf8") : null;
  } catch {
    source = null;
  }
  if (source === null) {
    violations.push(`${rule.ruleId}: boundToGate.ref points at ${filePath}, which is not a file in this repository`);
    continue;
  }

  if (anchor !== null) {
    // A JSON pointer into a schema: walk it rather than trust that the path reads plausibly.
    let node;
    try {
      node = JSON.parse(source);
    } catch {
      node = undefined;
    }
    for (const rawSegment of anchor.split("/").filter(Boolean)) {
      const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      node = node && typeof node === "object" ? node[segment] : undefined;
    }
    if (node === undefined) {
      violations.push(`${rule.ruleId}: boundToGate.ref resolves to nothing at ${anchor} in ${filePath}`);
      continue;
    }
  } else if (symbol && !new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source)) {
    violations.push(`${rule.ruleId}: boundToGate.ref names ${symbol}, which does not appear in ${filePath}`);
    continue;
  }
  refsResolved += 1;
}
if (ruleTerminations.length > 0) {
  const ratio = uncheckedRules / ruleTerminations.length;
  if (ratio > UNCHECKED_RULE_RATIO_MAX) {
    violations.push(
      `${uncheckedRules}/${ruleTerminations.length} rule(s) terminate in nothing checkable ` +
        `(${(ratio * 100).toFixed(0)}% > ${UNCHECKED_RULE_RATIO_MAX * 100}%); this is a decorated contract, not requirements`,
    );
  }
}

console.log(`${violations.length === 0 ? "PASS" : "FAIL"}  reference corpus`);
console.log(`      ${records.length} record(s) read from ${corpusDir}; ${recordsValidated} validated against a declared schema`);
console.log(`      ${factsRecorded} fact(s) recorded; ${citationsChecked} citation(s) checked; ${criterionScoresChecked} criterion score(s) checked`);
console.log(`      ${ruleTerminations.length} rule(s) checked for termination; ${uncheckedRules} terminate in nothing checkable; ${refsResolved} ref(s) resolved to a real artifact`);
for (const v of violations) console.log(`      ${v}`);
process.exit(violations.length === 0 ? 0 : 1);
