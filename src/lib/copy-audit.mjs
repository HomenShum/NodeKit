import { readFile } from "node:fs/promises";
import path from "node:path";

// The vocabulary map is the one piece of the human-journey work with no existing analog in this
// repository (interaction-flow, human-study-event, builder-gym and fresh-user-study already cover
// the rest). It binds an INTERNAL term to the words a reader actually understands.
//
// The audit exists because the cold-start baseline found 11 NodeKit-specific terms in the first
// five lines of README.md and none of them defined anywhere (F2). Documentation drifts back toward
// jargon unless something fails.

/** Internal term -> what a reader is told instead. */
export const VOCABULARY = Object.freeze({
  "figured-out": "the product decisions are already made and encoded",
  "domain-blank": "knows how to run a workflow but nothing about your industry",
  "conformance layer": "the checks an application must keep passing",
  "proof-carrying": "ships the evidence for its own claims",
  "guided lifecycle": "the fixed path every generated application runs",
  "compiled definition": "your configuration, validated and frozen",
  "deterministic fixtures": "fixed sample inputs that produce identical output every run",
  "browser proof": "evidence from actually driving a real browser",
  receipt: "a record binding a result to the exact inputs that produced it",
  caseflow: "the runtime that moves one case through its stages",
  "evolution ledger": "the record of why the system changed",
  "material change": "a change to a path that requires a reviewed ledger entry",
  invariant: "a property that must always hold, with a verifier that enforces it",
  nodeproof: "the authority that decides whether a result passed",
  ease: "the external certification standard NodeKit targets",
  opportunitycontract: "the approved boundary a coding agent builds against",
  "fail-closed": "missing evidence means blocked, never probably fine",
});

// Surfaces a newcomer reads before they have any context. These are held to the vocabulary rule.
export const AUDITED_FILES = Object.freeze(["START_HERE.md", "GLOSSARY.md", "README.md"]);

const DEFINING_FILE = "GLOSSARY.md";

function stripCode(markdown) {
  // Fenced blocks, inline code and link targets are not prose; jargon inside them is a real
  // identifier (a path, a command, a schema id) and must not be flagged.
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/^\s*>\s?/gm, " ");
}

/**
 * Audit user-facing copy for NodeKit terms that are used before they are defined.
 * @param {string} repoRoot
 * @param {{ files?: string[] }} [options]
 */
// @nodekit-behavior language.copy-audit owner
export async function auditCopy(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const files = options.files ?? AUDITED_FILES;

  const glossaryRaw = await readFile(path.join(root, DEFINING_FILE), "utf8").catch(() => "");
  const glossary = glossaryRaw.toLowerCase();

  // A term counts as defined only if the glossary gives it a body, not merely mentions it.
  const undefinedTerms = Object.keys(VOCABULARY).filter((term) => !glossary.includes(term.toLowerCase()));

  const findings = [];
  for (const file of files) {
    if (file === DEFINING_FILE) continue;
    const raw = await readFile(path.join(root, file), "utf8").catch(() => null);
    if (raw === null) {
      findings.push({ file, term: null, kind: "missing-file", detail: `${file} does not exist` });
      continue;
    }
    const prose = stripCode(raw).toLowerCase();
    const pointsToGlossary = /glossary\.md/i.test(raw);
    for (const term of Object.keys(VOCABULARY)) {
      if (!prose.includes(term.toLowerCase())) continue;
      if (!glossary.includes(term.toLowerCase())) {
        findings.push({ file, term, kind: "undefined-term", detail: `"${term}" is used but ${DEFINING_FILE} does not define it` });
      } else if (!pointsToGlossary) {
        findings.push({ file, term, kind: "no-glossary-pointer", detail: `${file} uses "${term}" but never points a reader to ${DEFINING_FILE}` });
      }
    }
  }

  return {
    schemaVersion: "nodekit.copy-audit/v1",
    auditedFiles: files,
    vocabularySize: Object.keys(VOCABULARY).length,
    undefinedTerms,
    findings,
    passed: findings.length === 0 && undefinedTerms.length === 0,
  };
}
