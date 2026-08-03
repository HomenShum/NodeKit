import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RegressionProofRefusal,
  formatRegressionProof,
  parseTapResults,
  proveRegression,
} from "../src/lib/regression-proof.mjs";

// Real repositories with a real bug and a real fix, because the whole mechanism is a git-and-process
// question. A mocked worktree would prove the mock builds.
//
// The scenario is the one that produced the rule: a function has a bug, a test is written next to
// it, and the test passes. Whether that test protects against the bug or protects the bug is
// invisible from HEAD — both are green — and only running it against the pre-fix code tells them
// apart.

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const BUGGY = "export const classify = (n) => (n < 0 ? 'negative' : 'positive');\n";
const FIXED = "export const classify = (n) => (n < 0 ? 'negative' : n === 0 ? 'zero' : 'positive');\n";

/** A test that would catch the bug: zero must not be positive. */
const CATCHING_TEST = `
import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "../src/classify.mjs";
test("zero is its own case, not positive", () => {
  assert.equal(classify(0), "zero");
});
`;

/** A test that passes either way. Green, and proves nothing about the fix. */
const GUARDIAN_TEST = `
import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "../src/classify.mjs";
test("a negative number is negative", () => {
  assert.equal(classify(-1), "negative");
});
`;

async function repoWithFix({ testBody = CATCHING_TEST } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "regproof-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "src", "classify.mjs"), BUGGY, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "the bug"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);

  await writeFile(path.join(root, "src", "classify.mjs"), FIXED, "utf8");
  await writeFile(path.join(root, "test", "classify.test.mjs"), testBody, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "the fix and its test"]);
  return { root, baseline };
}

const worktreeFor = (root) => path.join(root, "..", `${path.basename(root)}-probe`);

test("a real regression test is proven: it fails on the pre-fix code", async () => {
  const { root, baseline } = await repoWithFix();
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "proven", JSON.stringify(verdict));
  assert.deepEqual(verdict.proven, ["zero is its own case, not positive"]);
  assert.deepEqual(verdict.unproven, []);
  assert.match(formatRegressionProof(verdict), /failed on the pre-fix code, as a regression test must/);
});

test("a test that passes on both sides is UNPROVEN, and named", async () => {
  // The guardian. Green at HEAD, green at the baseline, and it demonstrates nothing — which is
  // indistinguishable from a real regression test until you run it against the old code.
  const { root, baseline } = await repoWithFix({ testBody: GUARDIAN_TEST });
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "unproven");
  assert.deepEqual(verdict.unproven, ["a negative number is negative"]);
  assert.match(formatRegressionProof(verdict), /passes on both sides/);
});

test("a baseline that resolves to HEAD is refused as a tautology", async () => {
  const { root } = await repoWithFix();
  assert.throws(
    () => proveRegression(root, { baseline: "HEAD", testFiles: ["test/classify.test.mjs"], worktreeDir: worktreeFor(root) }),
    (error) => error instanceof RegressionProofRefusal && /already contains the fix/.test(error.message),
  );
});

test("naming no tests is refused; a proof over zero tests reports success having checked nothing", async () => {
  const { root, baseline } = await repoWithFix();
  assert.throws(
    () => proveRegression(root, { baseline, testFiles: [], worktreeDir: worktreeFor(root) }),
    (error) => /checked nothing/.test(error.message),
  );
});

test("a baseline that is not a commit is refused rather than guessed at", async () => {
  const { root } = await repoWithFix();
  assert.throws(
    () => proveRegression(root, { baseline: "0".repeat(40), testFiles: ["test/classify.test.mjs"], worktreeDir: worktreeFor(root) }),
    (error) => /not a commit in this repository/.test(error.message),
  );
});

test("a test file absent from the working tree is refused, not skipped", async () => {
  const { root, baseline } = await repoWithFix();
  assert.throws(
    () => proveRegression(root, { baseline, testFiles: ["test/nope.test.mjs"], worktreeDir: worktreeFor(root) }),
    (error) => /test file not found in the working tree/.test(error.message),
  );
});

test("a mixed set reports proven and unproven separately rather than averaging them", async () => {
  const { root, baseline } = await repoWithFix();
  await writeFile(path.join(root, "test", "guardian.test.mjs"), GUARDIAN_TEST, "utf8");
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs", "test/guardian.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  // One real regression and one guardian must not net out to "mostly fine".
  assert.equal(verdict.status, "unproven");
  assert.deepEqual(verdict.proven, ["zero is its own case, not positive"]);
  assert.deepEqual(verdict.unproven, ["a negative number is negative"]);
});

test("TAP with no results is not-run, never proven", () => {
  assert.equal(parseTapResults("").size, 0);
  assert.equal(parseTapResults("some noise\nno tap here").size, 0);
});

test("TAP parsing keeps not-ok and ok apart, including names containing dashes", () => {
  const results = parseTapResults("ok 1 - a - b\nnot ok 2 - c - d\n");
  assert.equal(results.get("a - b"), true);
  assert.equal(results.get("c - d"), false);
});
