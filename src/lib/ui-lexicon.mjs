// "If a button says delete on one screen and remove on another, you have created friction. Users
// will never report this. They'll just find your app annoying."
//
// That is the whole reason this exists. Every other UI defect gets reported: a broken button, a
// wrong number, a layout that collapses. Synonym drift never does. The user re-reads, absorbs a
// half-second of doubt about whether these two buttons do the same thing, and files nothing. It
// accumulates into "this feels amateur" with no bug report anywhere pointing at it.
//
// Which makes it exactly the class worth checking mechanically, because no amount of dogfooding
// surfaces it and no user will ever tell you.
//
// Scope note: this checks the LEXICON, not taste. Motion belongs to motion-ladder, destructive
// confirmation to trust-surfaces, reference provenance to design-dna. Adding a fourth opinionated
// design gate would be the ceremony those three exist to avoid.

// Each set is one user-facing action. Pick one verb per set and use it everywhere.
export const ACTION_SYNONYMS = Object.freeze([
  { canonical: "Delete", variants: ["Remove", "Trash", "Discard", "Erase", "Destroy"] },
  { canonical: "Save", variants: ["Store", "Keep", "Apply", "Commit"] },
  { canonical: "Edit", variants: ["Modify", "Change", "Update", "Amend"] },
  { canonical: "Create", variants: ["Add", "New", "Make"] },
  { canonical: "Cancel", variants: ["Dismiss", "Close", "Abort", "Back out"] },
  { canonical: "Send", variants: ["Submit", "Post", "Share"] },
]);

// Emoji used as an icon. A real icon set holds size, weight and colour; an emoji is a picture from
// somebody else's font that renders differently on every platform the user might be on.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;

/**
 * Labels are supplied by the caller rather than scraped, because "what is a button label" is a
 * per-framework question and guessing it wrong would produce a linter that is confidently noisy —
 * which is how a gate stops being run at all.
 */
export function checkLexicon(labels) {
  const findings = [];
  const seen = new Map();
  let examined = 0;

  for (const { text, where } of labels) {
    if (typeof text !== "string" || !text.trim()) continue;
    examined += 1;
    const normalized = text.trim().toLowerCase();

    if (EMOJI.test(text)) {
      findings.push({
        kind: "emoji-in-label",
        where,
        detail: `"${text}" uses an emoji as an icon; a real icon set holds size, weight and colour across platforms`,
      });
    }

    for (const set of ACTION_SYNONYMS) {
      const all = [set.canonical, ...set.variants].map((v) => v.toLowerCase());
      const hit = all.find((verb) => normalized === verb || normalized.startsWith(`${verb} `));
      if (!hit) continue;
      const bucket = seen.get(set.canonical) ?? new Map();
      const uses = bucket.get(hit) ?? [];
      uses.push(where);
      bucket.set(hit, uses);
      seen.set(set.canonical, bucket);
    }
  }

  for (const [canonical, bucket] of seen) {
    if (bucket.size < 2) continue;
    const spellings = [...bucket.keys()];
    findings.push({
      kind: "synonym-drift",
      where: [...bucket.values()].flat().join(", "),
      detail: `${spellings.map((s) => `"${s}"`).join(" and ")} are the same action spelled differently; pick one (${canonical}) and use it everywhere`,
    });
  }

  // A gate that passes having measured nothing is the failure this repo is named after. `checked`
  // counts labels actually examined, not labels handed in, and zero of them is never a pass.
  return { passed: findings.length === 0 && examined > 0, findings, checked: examined, supplied: labels.length };
}

/**
 * One accent hue, carried only by elements that encode meaning. Chrome stays achromatic. This is
 * the same assertion from two directions: the community advice that a dashboard full of coloured
 * buttons looks cheap while colour reserved for data looks expensive, and the observed convention
 * that a single accent lets the eye use colour as a retrieval signal. A second accent destroys
 * both — it stops being a signal the moment it means two things.
 */
export function checkAccentBudget(elements) {
  const accents = new Map();
  for (const { color, meaningful, where } of elements) {
    if (typeof color !== "string" || !color.trim()) continue;
    const key = color.trim().toLowerCase();
    const entry = accents.get(key) ?? { meaningful: 0, chrome: [] };
    if (meaningful === true) entry.meaningful += 1;
    else if (meaningful === false) entry.chrome.push(where);
    else continue;
    accents.set(key, entry);
  }

  const findings = [];
  const hues = [...accents.keys()];
  if (hues.length > 1) {
    findings.push({
      kind: "multiple-accents",
      detail: `${hues.length} accent hues (${hues.join(", ")}); one accent is a retrieval signal, two are decoration`,
    });
  }
  for (const [hue, entry] of accents) {
    if (entry.chrome.length > 0) {
      findings.push({
        kind: "accent-on-chrome",
        detail: `${hue} is carried by chrome (${entry.chrome.join(", ")}); colour on a surface that encodes nothing spends the signal`,
      });
    }
  }
  return { passed: findings.length === 0 && accents.size > 0, findings, hues: hues.length, checked: accents.size, supplied: elements.length };
}

export function formatLexicon(verdict) {
  if (verdict.checked === 0) return "UI LEXICON: no labels supplied — nothing was checked.";
  if (verdict.passed) return `UI LEXICON PASS: ${verdict.checked} label(s), one verb per action.`;
  return [
    `UI LEXICON: ${verdict.findings.length} finding(s) across ${verdict.checked} label(s).`,
    ...verdict.findings.map((f) => `  [${f.kind}] ${f.where}\n      ${f.detail}`),
  ].join("\n");
}
