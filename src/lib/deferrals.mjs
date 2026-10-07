// Deferring work is almost always correct. A session that refused to defer anything would ship its
// first idea and nothing else. What turns a good deferral into a surprise is that it lives in chat
// scrollback: the decision was deliberate, the reasoning was sound, and three weeks later nobody
// can name the three things that were consciously left undone.
//
// So deferrals are a file, and submission reads it. `open` is not a failure state — it is an
// unanswered question, and the gate's whole job is to make someone answer it out loud before a
// submission goes out claiming to be finished. `accepted-risk` is a perfectly good answer.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const DEFERRAL_FILE = "deferred.yaml";
export const DEFERRAL_STATUSES = Object.freeze(["open", "resolved", "accepted-risk"]);

function fail(message) {
  const error = new Error(message);
  error.code = "DEFERRAL_LEDGER_INVALID";
  throw error;
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Read and validate the ledger. A missing file is an empty ledger rather than an error: a project
 * with nothing deferred is a real state, and forcing a placeholder file would teach people to
 * create empty ones.
 */
export async function readDeferrals(repoRoot = ".") {
  let raw;
  try {
    raw = await readFile(path.join(repoRoot, DEFERRAL_FILE), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { entries: [], present: false };
    throw error;
  }

  const parsed = parse(raw) ?? {};
  const entries = parsed.deferred ?? [];
  if (!Array.isArray(entries)) fail(`${DEFERRAL_FILE}: "deferred" must be a list`);

  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const at = `${DEFERRAL_FILE}: deferred[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${at} must be a mapping`);
    for (const field of ["id", "what", "why", "deferredAt", "status"]) {
      if (!isNonEmptyString(entry[field])) fail(`${at} needs a non-empty ${field}`);
    }
    if (seen.has(entry.id)) fail(`${at} repeats id "${entry.id}"`);
    seen.add(entry.id);
    if (!DEFERRAL_STATUSES.includes(entry.status)) {
      fail(`${at} has status "${entry.status}"; expected one of ${DEFERRAL_STATUSES.join(", ")}`);
    }
    // A closed entry has to say what closed it. "resolved" with no outcome is the same silence the
    // ledger exists to break, just wearing a reassuring word.
    if (entry.status !== "open" && !isNonEmptyString(entry.outcome)) {
      fail(`${at} is ${entry.status} but does not say what closed it; record the outcome`);
    }
    if (entry.status === "open" && isNonEmptyString(entry.outcome)) {
      fail(`${at} is open but records an outcome; set status to resolved or accepted-risk`);
    }
  }
  return { entries, present: true };
}

/** open entries block; everything else is an answer someone gave on purpose. */
export function evaluateDeferrals({ entries }) {
  const open = entries.filter((entry) => entry.status === "open");
  return {
    passed: open.length === 0,
    total: entries.length,
    open: open.map((entry) => entry.id),
    resolved: entries.filter((entry) => entry.status === "resolved").length,
    acceptedRisk: entries.filter((entry) => entry.status === "accepted-risk").length,
  };
}

export function formatDeferrals({ entries }, verdict) {
  if (entries.length === 0) return "DEFERRALS: none recorded.";
  const lines = [
    `DEFERRALS: ${verdict.total} recorded — ${verdict.open.length} open, ${verdict.resolved} resolved, ${verdict.acceptedRisk} accepted-risk.`,
  ];
  for (const entry of entries) {
    lines.push(`  [${entry.status}] ${entry.id} (deferred ${entry.deferredAt})`);
    lines.push(`      ${entry.what}`);
    lines.push(`      why: ${entry.why}`);
    if (entry.outcome) lines.push(`      outcome: ${entry.outcome}`);
  }
  if (!verdict.passed) {
    lines.push("", `Mark each open entry resolved or accepted-risk before submitting: ${verdict.open.join(", ")}`);
  }
  return lines.join("\n");
}
