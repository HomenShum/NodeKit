// Generated user-facing copy is a proof surface. A rendered interface can pass every visual check
// while its text lies: claiming a task completed that never ran, claiming an authority the agent
// does not have, or asserting a capability nothing evidences.
//
// The rule that keeps this honest is a split, and the split is the whole design:
//
//   HARD FAIL — statements that are objectively false or unactionable. Fabricated entities,
//   unsupported capability claims, false completion status, authority the agent does not hold,
//   and failure messages with no recovery. These block.
//
//   ADVISORY — style. Em dashes, rule of three, Title Case, emoji, rhythm. These NEVER block,
//   because a supplied voice sample can legitimately require any of them. Gating taste produces
//   a checker people learn to route around, which then fails to stop the lies as well.
//
// Gate the lies, not the taste.

// A claim of capability that means nothing without evidence behind it.
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bbank[- ]level (?:security|encryption)\b/i,
  /\bmilitary[- ]grade\b/i,
  /\b(?:100%|fully) (?:secure|accurate|reliable|private)\b/i,
  /\bguaranteed\b/i,
  /\benterprise[- ]grade\b/i,
  /\bzero[- ]knowledge\b/i,
  /\bnever (?:loses|fails|breaks)\b/i,
];

// Words that assert a finished, verified outcome. Legitimate only when a receipt backs them.
const STATUS_ASSERTIONS = [/\bcomplete[d]?\b/i, /\bverified\b/i, /\bcertified\b/i, /\bpassed\b/i, /\bproven\b/i];

// Verbs that claim the agent CHANGED canonical state. If the agent only proposed, this is a lie
// about authority, and it is the failure most likely to make a user trust something they should not.
const MUTATION_VERBS = [
  /\b(?:updated|deleted|sent|paid|transferred|charged|published|approved|submitted)\s+your\b/i,
  /\bwe (?:updated|deleted|sent|paid|transferred|charged|published)\b/i,
];

// A message that reports failure without telling the reader what to do next is a dead end.
//
// Recovery must be an ACTION OFFERED TO THE READER, and it is only recovery if it comes AFTER the
// failure. The first version listed bare nouns like "upload", so "Upload failed." matched its own
// subject as its own remedy and the check went silent on the exact dead end it exists to catch.
// A word's presence is not its role — same trap as counting a quoted annotation as a claim.
const FAILURE_MARKERS = [/\bfailed\b/i, /\berror\b/i, /\bcould not\b/i, /\bunable to\b/i, /\bwent wrong\b/i];
const RECOVERY_MARKERS = [
  /\btry again\b/i, /\bretry\b/i, /\bcheck\b/i, /\bcontact\b/i, /\breconnect\b/i, /\bsign in\b/i,
  /\bupload (?:a|an|the|your)\b/i, /\bopen (?:a|an|the|your)\b/i, /\brun\b/i, /\bwait\b/i, /\brefresh\b/i,
];

// Recovery must live in a sentence of its OWN. Position alone is not enough: "We could not open
// the file" contains "open the", which reads as an action only if you ignore that it sits inside
// the failure clause being reported. An instruction to the reader is a separate statement, so
// require a sentence that offers an action and does not itself report the failure.
function offersRecovery(text) {
  // Clause, not sentence. "Upload failed — try again" is one sentence and two clauses, and the
  // recovery is real. Sentence granularity called that a dead end; clause granularity does not.
  const clauses = text.split(/(?<=[.!?])\s+|\n+|\s*[—–;]\s*|,\s+(?=(?:then|and)?\s*\b)/i).filter((s) => s.trim());
  const reportsFailure = (s) => FAILURE_MARKERS.some((p) => p.test(s));
  if (!clauses.some(reportsFailure)) return true; // nothing failed, nothing to recover from
  return clauses.some((s) => !reportsFailure(s) && RECOVERY_MARKERS.some((p) => p.test(s)));
}

// Style. Detected and REPORTED, never fatal.
const STYLE_PATTERNS = [
  { id: "em-dash", test: /[—–]/, note: "em or en dash" },
  { id: "emoji", test: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, note: "emoji" },
  { id: "curly-quote", test: /[‘’“”]/, note: "curly quote" },
  { id: "signposting", test: /\b(?:let's dive in|here's what you need to know|at its core)\b/i, note: "signposting opener" },
  { id: "sycophancy", test: /\b(?:great question|absolutely right|happy to help)\b/i, note: "sycophantic opener" },
];

// Entities a rewrite must not invent: numbers with meaning, URLs, dates, and capitalised names.
// Deliberately conservative — over-flagging trains people to ignore the check, which is the same
// failure as a rot detector that cries wolf.
function entitiesOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s)"']+/gi)) out.add(`url:${m[0].toLowerCase().replace(/[.,]$/, "")}`);
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) out.add(`date:${m[0]}`);
  // Money and percentages carry meaning; bare small integers usually do not.
  for (const m of text.matchAll(/(?:[$£€]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%)/g)) out.add(`num:${m[0].replace(/\s/g, "")}`);
  return out;
}

/**
 * Audit generated user-facing copy for claims that are objectively wrong.
 *
 * @param {{ text: string, source?: string, hasReceipt?: boolean, agentMayMutate?: boolean, glossaryTerms?: string[] }} input
 *   text          the generated copy
 *   source        the approved source material; when supplied, entities absent from it are fabrication
 *   hasReceipt    whether a receipt backs a completion claim
 *   agentMayMutate whether the agent actually holds authority to change canonical state
 */
// @nodekit-behavior inv:copy-claims-gate-lies-not-taste owner
export function auditCopyClaims({ text, source = null, hasReceipt = false, agentMayMutate = false } = {}) {
  if (typeof text !== "string") throw new Error("auditCopyClaims requires the generated copy as text");
  const hard = [];
  const advisory = [];

  // 1. Fabrication — only checkable against a source. Saying so is better than guessing.
  if (source === null) {
    advisory.push({ kind: "fabrication-unchecked", detail: "No source supplied, so invented entities cannot be detected." });
  } else {
    const known = entitiesOf(source);
    for (const entity of entitiesOf(text)) {
      if (!known.has(entity)) {
        hard.push({ kind: "fabrication", entity, detail: `"${entity.split(":").slice(1).join(":")}" appears in the copy but not in the source` });
      }
    }
  }

  // 2. Unsupported capability claims.
  for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
    const m = text.match(pattern);
    if (m) hard.push({ kind: "unsupported-claim", detail: `"${m[0]}" asserts a capability nothing here evidences` });
  }

  // 3. False status — a finished verdict with no receipt behind it.
  if (!hasReceipt) {
    for (const pattern of STATUS_ASSERTIONS) {
      const m = text.match(pattern);
      if (m) {
        hard.push({ kind: "false-status", detail: `"${m[0]}" asserts a finished outcome but no receipt backs it` });
        break;
      }
    }
  }

  // 4. Authority error — claiming a mutation the agent may not perform.
  if (!agentMayMutate) {
    for (const pattern of MUTATION_VERBS) {
      const m = text.match(pattern);
      if (m) hard.push({ kind: "authority-error", detail: `"${m[0].trim()}" claims the agent changed canonical state, which it may not` });
    }
  }

  // 5. Missing recovery — a failure with no next action.
  if (!offersRecovery(text)) {
    hard.push({ kind: "missing-recovery", detail: "The copy reports a failure but names no safe next action after it" });
  }

  // 6. Style. Reported, never fatal.
  for (const style of STYLE_PATTERNS) {
    if (style.test.test(text)) advisory.push({ kind: `style:${style.id}`, detail: `contains ${style.note}` });
  }

  return {
    schemaVersion: "nodekit.copy-claims-audit/v1",
    hardFailures: hard,
    advisory,
    // Only hard failures decide. Style can never flip this, by construction.
    passed: hard.length === 0,
    boundary:
      "Checks claims that are objectively wrong. It cannot judge whether copy is GOOD, and style findings are advisory because a supplied voice sample may legitimately require them.",
  };
}
