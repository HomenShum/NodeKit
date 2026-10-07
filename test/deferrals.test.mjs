// The ledger's whole value is that `open` blocks. If it can be satisfied by writing a reassuring
// word with nothing behind it, it is a worse artifact than no file at all — it converts an
// unanswered question into a recorded answer without anyone having answered it.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFERRAL_FILE, evaluateDeferrals, formatDeferrals, readDeferrals } from "../src/lib/deferrals.mjs";

const entry = (overrides = {}) => ({
  id: "mobbin-reverification",
  what: "Provenance for direction D was never re-verified after the provider recovered.",
  why: "The provider errored three times and the work could not wait.",
  deferredAt: "2026-08-02",
  status: "open",
  ...overrides,
});

async function ledgerDir(doc) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deferrals-"));
  if (doc !== undefined) await writeFile(path.join(dir, DEFERRAL_FILE), doc, "utf8");
  return dir;
}

const yamlFor = (entries) => `deferred:\n${entries.map((e) => Object.entries(e)
  .map(([k, v], i) => `${i === 0 ? "  - " : "    "}${k}: ${JSON.stringify(v)}`).join("\n")).join("\n")}\n`;

test("a missing ledger is an empty one, not an error", async () => {
  const dir = await ledgerDir();
  try {
    const ledger = await readDeferrals(dir);
    assert.deepEqual(ledger.entries, []);
    assert.equal(ledger.present, false);
    assert.equal(evaluateDeferrals(ledger).passed, true, "a project with nothing deferred must not be blocked");
    assert.match(formatDeferrals(ledger, evaluateDeferrals(ledger)), /none recorded/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an open deferral blocks, and closing one requires saying what closed it", async () => {
  const open = await ledgerDir(yamlFor([entry()]));
  try {
    const verdict = evaluateDeferrals(await readDeferrals(open));
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.open, ["mobbin-reverification"]);
  } finally {
    await rm(open, { recursive: true, force: true });
  }

  // The failure this exists to catch: "resolved" as a word rather than an event.
  for (const status of ["resolved", "accepted-risk"]) {
    const bare = await ledgerDir(yamlFor([entry({ status })]));
    try {
      await assert.rejects(() => readDeferrals(bare), /does not say what closed it/, `${status} with no outcome must be refused`);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }

    const closed = await ledgerDir(yamlFor([entry({ status, outcome: "Re-ran the probe; provenance now verified." })]));
    try {
      const verdict = evaluateDeferrals(await readDeferrals(closed));
      assert.equal(verdict.passed, true, `${status} with an outcome is a real answer and must not block`);
    } finally {
      await rm(closed, { recursive: true, force: true });
    }
  }
});

test("the ledger refuses shapes that would read as valid", async () => {
  const cases = [
    { doc: yamlFor([entry({ status: "later" })]), pattern: /expected one of/ },
    { doc: yamlFor([entry({ why: "" })]), pattern: /non-empty why/ },
    { doc: yamlFor([entry(), entry()]), pattern: /repeats id/ },
    { doc: yamlFor([entry({ outcome: "done" })]), pattern: /open but records an outcome/ },
    { doc: "deferred: not-a-list\n", pattern: /must be a list/ },
  ];
  for (const { doc, pattern } of cases) {
    const dir = await ledgerDir(doc);
    try {
      await assert.rejects(() => readDeferrals(dir), pattern, doc);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("this repository's own ledger is valid, and every entry says something checkable", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const ledger = await readDeferrals(repoRoot);
  assert.equal(ledger.present, true, "node-platform ships a ledger; a deleted one must fail loudly");
  assert.ok(ledger.entries.length > 0, "an empty ledger here would mean nothing was ever deferred, which is not true");
  const raw = await readFile(path.join(repoRoot, DEFERRAL_FILE), "utf8");
  assert.match(raw, /status: open \| resolved \| accepted-risk/, "the file must explain its own states to a reader");
});

// The first wiring of this printed the human-readable ledger to stdout, straight after the JSON,
// and broke every caller that parses this script's output. stdout is the machine channel; the
// report belongs on stderr. Also: `submissionReady: false` is how this script already refuses, so
// the deferrals gate must not invent a second signal that can disagree with the first.
test("submission preparation keeps stdout machine-readable and refuses through submissionReady", async () => {
  const { spawnSync } = await import("node:child_process");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "prepare-submission.mjs"), "--output", path.join(os.tmpdir(), "deferral-probe-manifest.json")],
    { cwd: repoRoot, encoding: "utf8" },
  );

  const summary = JSON.parse(result.stdout);
  assert.ok(summary.deferrals, "the verdict must reach a machine reader, not only a human one");

  const ledger = await readDeferrals(repoRoot);
  const expected = evaluateDeferrals(ledger);
  assert.equal(summary.deferrals.passed, expected.passed);
  if (!expected.passed) {
    assert.equal(summary.submissionReady, false, "an open deferral must make the submission not ready");
  }

  assert.match(result.stderr, /DEFERRALS:/, "the list itself must be printed, not just counted");
  assert.doesNotMatch(result.stdout, /DEFERRALS:/, "prose in the machine channel breaks every caller that parses it");
});
