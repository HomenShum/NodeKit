// The defect nobody reports. Every other UI bug gets filed; synonym drift just accumulates into
// "this feels amateur" with no ticket anywhere pointing at it — which is why it has to be checked
// by a machine rather than found by dogfooding.

import assert from "node:assert/strict";
import test from "node:test";
import { checkLexicon, formatLexicon } from "../src/lib/ui-lexicon.mjs";

const at = (text, where) => ({ text, where });

test("the same action spelled two ways is caught, with both sites named", () => {
  const verdict = checkLexicon([
    at("Delete", "ProjectRow.tsx"),
    at("Remove", "TeamMember.tsx"),
    at("Save", "Settings.tsx"),
  ]);
  assert.equal(verdict.passed, false);
  const drift = verdict.findings.find((f) => f.kind === "synonym-drift");
  assert.match(drift.detail, /"delete" and "remove" are the same action/);
  assert.match(drift.where, /ProjectRow\.tsx/);
  assert.match(drift.where, /TeamMember\.tsx/);
});

test("one verb used consistently passes, however many times it appears", () => {
  const verdict = checkLexicon([
    at("Delete", "a.tsx"), at("Delete project", "b.tsx"), at("Delete", "c.tsx"), at("Save", "d.tsx"),
  ]);
  assert.equal(verdict.passed, true, formatLexicon(verdict));
  assert.match(formatLexicon(verdict), /one verb per action/);
});

test("an emoji standing in for an icon is caught", () => {
  const verdict = checkLexicon([at("🗑️ Delete", "Toolbar.tsx"), at("Save", "Toolbar.tsx")]);
  assert.ok(verdict.findings.some((f) => f.kind === "emoji-in-label"));
  assert.match(verdict.findings[0].detail, /across platforms/);
});

test("a word that merely contains a verb is not a false positive", () => {
  // "Removed 3 items" is a status, not a Remove button; a noisy gate is one nobody runs.
  const verdict = checkLexicon([at("Delete", "a.tsx"), at("Removed 3 items", "toast.tsx")]);
  assert.equal(verdict.passed, true, formatLexicon(verdict));
});

test("nothing supplied is reported as nothing checked, not as a pass", () => {
  // This asserted only the formatted string, so it passed while verdict.passed was true — a test
  // that named the right rule and pinned the wrong thing.
  const empty = checkLexicon([]);
  assert.equal(empty.passed, false, "a scan of nothing is not a pass");
  assert.equal(empty.checked, 0);
  assert.match(formatLexicon(empty), /nothing was checked/);

  // Entries that are skipped must not inflate the denominator either.
  const skipped = checkLexicon([{ text: "" }, {}]);
  assert.equal(skipped.passed, false, "two unusable labels measured nothing");
});
