import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

const worktreeFor = (root) => path.join(root, "..", `${path.basename(root)}-probe-${Math.floor(process.hrtime()[1])}`);

test("a real regression test is proven: it fails on the pre-fix code", async () => {
  const { root, baseline } = await repoWithFix();
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "proven", JSON.stringify(verdict));
  assert.deepEqual(verdict.proven, ["test/classify.test.mjs::zero is its own case, not positive"]);
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
  assert.deepEqual(verdict.unproven, ["test/classify.test.mjs::a negative number is negative"]);
  assert.match(formatRegressionProof(verdict), /passes at HEAD and at the baseline/);
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
  assert.deepEqual(verdict.proven, ["test/classify.test.mjs::zero is its own case, not positive"]);
  // Keyed by FILE plus name. The guardian lives in a different file, and keying by display name
  // alone let two same-named tests overwrite each other so the verdict followed TAP ordering.
  assert.deepEqual(verdict.unproven, ["test/guardian.test.mjs::a negative number is negative"]);
});

test("TAP with no results yields nothing to compare, never a pass", () => {
  assert.equal(parseTapResults("").length, 0);
  assert.equal(parseTapResults("some noise\nno tap here").length, 0);
});

test("TAP parsing keeps not-ok and ok apart, including names containing dashes", () => {
  const results = parseTapResults("ok 1 - a - b\nnot ok 2 - c - d\n");
  assert.equal(results.find((entry) => entry.name === "a - b").passed, true);
  assert.equal(results.find((entry) => entry.name === "c - d").passed, false);
});

test("an INDENTED subtest is not a top-level result; one failure must not inflate into two", () => {
  // Lines were trimmed before matching, so a nested subtest was promoted to a top-level result and
  // one real failure counted twice. Column zero is the whole discriminator.
  const results = parseTapResults("    not ok 1 - inner\nnot ok 1 - outer\n");
  assert.deepEqual(results.map((entry) => entry.name), ["outer"]);
});

test("a skipped test is marked skipped rather than counted as an outcome", () => {
  const results = parseTapResults("ok 1 - something # SKIP not today\n");
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].name, "something");
});

// --- what the adversarial review reproduced, and the reason this module was rewritten -------------

/** A repository where the module under test is NEW: it does not exist at the baseline at all. */
async function repoWithNewModule() {
  const root = await mkdtemp(path.join(tmpdir(), "regproof-new-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "before\n", "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "before the module existed"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);

  await writeFile(path.join(root, "src", "brand-new.mjs"), "export const answer = () => 42;\n", "utf8");
  await writeFile(
    path.join(root, "test", "brand-new.test.mjs"),
    'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { answer } from "../src/brand-new.mjs";\ntest("answers", () => assert.equal(answer(), 42));\n',
    "utf8",
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "the new module and its test"]);
  return { root, baseline };
}

test("a test that cannot IMPORT at the baseline is not-run, never proven", async () => {
  // THE defect that refuted the first version, and the most likely input this tool will ever get:
  // a new module, whose test file cannot resolve its import at the baseline. node:test reports that
  // as one file-level `not ok`, which was counted as a caught regression. The suite failing to
  // start and a regression being caught are indistinguishable in a bare exit code.
  const { root, baseline } = await repoWithNewModule();
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/brand-new.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "not-run", JSON.stringify(verdict));
  assert.deepEqual(verdict.proven, []);
  assert.match(verdict.detail, /did not exist yet/);
  assert.match(formatRegressionProof(verdict), /this is not a passed check/);
});

test("a test already failing at HEAD is not-run — it is broken, not protective", async () => {
  // It would fail at the baseline too, and the old version called that a caught regression while
  // the formatter claimed it had checked both sides.
  const { root, baseline } = await repoWithFix();
  await writeFile(
    path.join(root, "test", "classify.test.mjs"),
    'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { classify } from "../src/classify.mjs";\ntest("wrong on purpose", () => assert.equal(classify(0), "banana"));\n',
    "utf8",
  );
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs"],
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "not-run");
  assert.match(verdict.detail, /already fails at HEAD/);
});

test("a --name pattern that selects nothing is not-run, not a proof over zero tests", async () => {
  const { root, baseline } = await repoWithFix();
  const verdict = proveRegression(root, {
    baseline,
    testFiles: ["test/classify.test.mjs"],
    namePattern: "no test is called this",
    worktreeDir: worktreeFor(root),
  });

  assert.equal(verdict.status, "not-run");
  assert.match(verdict.detail, /selecting nothing proves nothing/);
});

test("a pre-existing worktree directory is refused rather than deleted", async () => {
  // The old version's first real action was rmSync(target, {recursive, force}) on a caller-supplied
  // path, before validating anything. A mistyped path destroyed whatever sat there.
  const { root, baseline } = await repoWithFix();
  const target = worktreeFor(root);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "someone-elses-work.txt"), "do not delete me\n", "utf8");

  assert.throws(
    () => proveRegression(root, { baseline, testFiles: ["test/classify.test.mjs"], worktreeDir: target }),
    (error) => error instanceof RegressionProofRefusal && /will not delete a directory it did not make/.test(error.message),
  );
  // Still there.
  assert.ok(existsSync(path.join(target, "someone-elses-work.txt")));
});

test("a worktree directory inside the repository is refused", async () => {
  const { root, baseline } = await repoWithFix();
  assert.throws(
    () => proveRegression(root, {
      baseline,
      testFiles: ["test/classify.test.mjs"],
      worktreeDir: path.join(root, "scratch-checkout"),
    }),
    (error) => /inside the repository/.test(error.message),
  );
});
