import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

// A regression test that never failed on the old code proves nothing.
//
// The rule comes from a real day: after a P0 fix landed, three existing tests failed — because they
// had pinned the buggy behaviour. `assert "query.intr" in params` was written alongside a defect and
// had become its guardian. From HEAD the two kinds are indistinguishable; both are green.
//
// So the claim "I fixed it and added a test" has two halves and only one is ever checked. This
// checks the other: run the test at HEAD, then at the pre-fix commit, and require PASS then FAIL.
//
// THE FIRST VERSION OF THIS MODULE WAS REFUTED, and the way it failed is the reason the evidence
// model below is shaped as it is. It reduced TAP to Map<displayName, boolean> and treated every
// remaining `false` as proof, which discarded the four distinctions that carry all the meaning:
//
//   FAILED VERSUS DID-NOT-RUN. A test file that cannot IMPORT at the baseline — because the module
//   under test does not exist there yet, which is the normal state for a new module — emits
//   `not ok 1 - test/foo.test.mjs` and was counted as a caught regression. The single most likely
//   input to this tool produced a false proof.
//
//   BASELINE VERSUS HEAD. It only ever ran the baseline, so a test broken at HEAD too failed at the
//   baseline and read as proven, while the formatter said "passes on both sides" about a side it
//   had never run.
//
//   FILE IDENTITY. Results were keyed by display name alone, so two tests sharing a name across
//   files overwrote each other and the verdict depended on TAP ordering.
//
//   NESTING. Lines were trimmed before matching, so an indented subtest counted as a top-level
//   result and one real failure inflated into two.
//
// Every one of those is now a distinct state, and none of them can read as proven.

export const PROOF_STATUS = Object.freeze(["proven", "unproven", "not-run"]);

export class RegressionProofRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`regression proof refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "RegressionProofRefusal";
    this.refusals = list;
  }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

/**
 * Parse node:test TAP into top-level results only.
 *
 * NOT trimmed before matching: node:test indents nested subtests, and a trimmed match promotes a
 * child to a top-level result so one failure counts twice. Column zero is the whole discriminator.
 */
export function parseTapResults(output) {
  const results = [];
  for (const line of String(output ?? "").split("\n")) {
    const clean = line.replace(/\r$/, "");
    const match = /^(not ok|ok) \d+ - (.*)$/.exec(clean);
    if (!match) continue;
    // Directives (# SKIP, # TODO) are not outcomes and must not be counted as either.
    const name = match[2].replace(/\s+#\s+(SKIP|TODO)\b.*$/i, "").trim();
    const skipped = /#\s+(SKIP|TODO)\b/i.test(match[2]);
    results.push({ name, passed: match[1] === "ok", skipped });
  }
  return results;
}

/**
 * Run one test file and classify what came back.
 *
 * `fileLevel` is the state that mattered most: node:test reports a file that failed to load as a
 * single result named after the file itself. That is not a test outcome, it is the suite failing to
 * start, and it must never be counted as a regression caught.
 */
function runTestFile(cwd, file, namePattern) {
  // TAP demanded, not assumed, and the parent runner's env scrubbed — node:test sets
  // NODE_TEST_CONTEXT for children, which switches the reporter and made this return nothing
  // whenever it was itself invoked from a test.
  const { NODE_TEST_CONTEXT: _c, NODE_OPTIONS: _o, ...env } = process.env;
  const args = ["--test", "--test-reporter=tap", ...(namePattern ? ["--test-name-pattern", namePattern] : []), file];
  const run = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const parsed = parseTapResults(output);

  const posixFile = file.split(path.sep).join("/");
  // A result named after the file is the suite failing to start, not a test failing.
  const fileLevel = parsed.filter((entry) => {
    const asPosix = entry.name.split("\\").join("/");
    return asPosix === posixFile || asPosix.endsWith(`/${path.basename(file)}`) || asPosix === path.basename(file);
  });
  const tests = parsed.filter((entry) => !fileLevel.includes(entry) && !entry.skipped);

  return {
    tests,
    loadFailed: tests.length === 0 && fileLevel.some((entry) => !entry.passed),
    output,
  };
}

/**
 * Prove that today's tests fail against a baseline commit and pass at HEAD.
 *
 * @param repoRoot     repository under test
 * @param baseline     commit predating the fix
 * @param testFiles    repo-relative test paths, taken from the WORKING TREE and copied in
 * @param worktreeDir  where to build the throwaway checkout; must not already exist
 */
export function proveRegression(repoRoot, { baseline, testFiles = [], namePattern, worktreeDir, keepWorktree = false } = {}) {
  const root = path.resolve(repoRoot);
  const refusals = [];
  if (!baseline) refusals.push("a baseline commit is required");
  if (testFiles.length === 0) {
    refusals.push("no test files named; a proof over zero tests would report success having checked nothing");
  }
  if (!worktreeDir) refusals.push("a worktree directory is required");
  if (refusals.length > 0) throw new RegressionProofRefusal(refusals);

  const target = path.resolve(worktreeDir);
  // Deleting a caller-supplied path before validating it is how a tool becomes dangerous. The
  // earlier version recursively removed `target` as its first real action, so a mistyped path or a
  // nested --repo-root destroyed whatever sat there. Refuse instead: this directory is ours to
  // create, never ours to reclaim.
  if (existsSync(target)) {
    throw new RegressionProofRefusal([`worktree directory ${target} already exists; this tool creates its own scratch checkout and will not delete a directory it did not make`]);
  }
  const inside = path.relative(root, target);
  if (inside !== "" && !inside.startsWith("..") && !path.isAbsolute(inside)) {
    throw new RegressionProofRefusal([`worktree directory ${target} is inside the repository; a scratch checkout there would be picked up by the very tests it is meant to isolate`]);
  }

  const head = git(root, ["rev-parse", "HEAD"]);
  // `--verify <rev>^{commit}`: plain rev-parse accepts any 40-character hex as valid SYNTAX and
  // echoes it back whether the object exists or not.
  const base = git(root, ["rev-parse", "--verify", "--quiet", `${baseline}^{commit}`]);
  if (!base.ok || base.out === "") {
    throw new RegressionProofRefusal([`baseline ${baseline} is not a commit in this repository`]);
  }
  if (base.out === head.out) {
    throw new RegressionProofRefusal([`baseline ${baseline} resolves to HEAD; a test cannot demonstrate it would have caught a bug against the code that already contains the fix`]);
  }
  for (const file of testFiles) {
    if (!existsSync(path.join(root, file))) {
      throw new RegressionProofRefusal([`test file not found in the working tree: ${file}`]);
    }
  }

  // HEAD FIRST. A test that fails at HEAD proves nothing about the baseline — it is simply broken,
  // and the earlier version would have called its baseline failure a caught regression.
  const atHead = new Map();
  for (const file of testFiles) {
    const result = runTestFile(root, file, namePattern);
    if (result.loadFailed) {
      return notRun(base, head, `${file} does not load at HEAD, so it cannot demonstrate anything about the baseline`, result.output);
    }
    if (result.tests.length === 0) {
      return notRun(base, head, namePattern
        ? `no test in ${file} matched --name "${namePattern}" at HEAD; a pattern selecting nothing proves nothing`
        : `${file} produced no test results at HEAD`, result.output);
    }
    for (const entry of result.tests) {
      if (!entry.passed) {
        return notRun(base, head, `"${entry.name}" (${file}) already fails at HEAD; fix it before asking whether it would have caught anything`, result.output);
      }
      atHead.set(`${file}::${entry.name}`, entry);
    }
  }

  const added = git(root, ["worktree", "add", "-q", "--detach", target, base.out]);
  if (!added.ok) {
    return notRun(base, head, `could not create a worktree at ${base.out.slice(0, 9)}: ${added.err || "unknown error"}`);
  }

  try {
    // Today's tests, against yesterday's source. Checking out the baseline alone would run the
    // baseline's own tests, which of course pass.
    for (const file of testFiles) {
      cpSync(path.join(root, file), path.join(target, file), { force: true });
    }
    const modules = path.join(root, "node_modules");
    if (existsSync(modules) && !existsSync(path.join(target, "node_modules"))) {
      cpSync(modules, path.join(target, "node_modules"), { recursive: true, force: true });
    }

    const proven = [];
    const unproven = [];
    for (const file of testFiles) {
      const result = runTestFile(target, file, namePattern);
      // THE defect that refuted the first version. A test file that cannot import at the baseline —
      // the normal state when the module under test is new — emits one file-level `not ok`, which
      // was counted as a caught regression. It is the suite failing to start.
      if (result.loadFailed) {
        return notRun(
          base,
          head,
          `${file} does not load at ${base.out.slice(0, 9)} — most likely the module it imports did not exist yet. `
            + "That is the suite failing to start, not a regression being caught, and the two are indistinguishable in a bare exit code",
          result.output,
        );
      }
      // Keyed by FILE plus name: display name alone let two same-named tests in different files
      // overwrite each other, so the verdict depended on TAP ordering.
      for (const entry of result.tests) {
        const key = `${file}::${entry.name}`;
        if (!atHead.has(key)) continue;         // not selected at HEAD; nothing to compare
        if (entry.passed) unproven.push(key);
        else proven.push(key);
      }
    }

    if (proven.length === 0 && unproven.length === 0) {
      return notRun(base, head, "no test ran at the baseline that also ran at HEAD; there was nothing to compare");
    }

    return {
      status: unproven.length === 0 ? "proven" : "unproven",
      namePattern: namePattern ?? null,
      baseline: base.out.slice(0, 9),
      head: head.out.slice(0, 9),
      proven: proven.sort(),
      unproven: unproven.sort(),
      checked: proven.length + unproven.length,
    };
  } finally {
    if (!keepWorktree) {
      rmSync(target, { recursive: true, force: true });
      git(root, ["worktree", "prune"]);
    }
  }
}

function notRun(base, head, detail, output = "") {
  return {
    status: "not-run",
    baseline: base.out.slice(0, 9),
    head: head.out.slice(0, 9),
    proven: [],
    unproven: [],
    checked: 0,
    detail,
    // Kept so a caller can see WHY rather than take the sentence on trust.
    output: output.slice(0, 4000),
  };
}

export function formatRegressionProof(verdict) {
  if (verdict.status === "not-run") {
    return `REGRESSION PROOF NOT RUN: ${verdict.detail}. Nothing was demonstrated — this is not a passed check.`;
  }
  const head = `REGRESSION PROOF ${verdict.status === "proven" ? "PROVEN" : "INCOMPLETE"} against ${verdict.baseline}: `
    + `${verdict.proven.length} of ${verdict.checked} test(s) passed at HEAD and failed on the pre-fix code, as a regression test must.`;
  if (verdict.status === "proven") return head;
  return [
    head,
    ...verdict.unproven.map((key) => `  UNPROVEN: "${key}" passes at HEAD and at the baseline — it does not demonstrate it would have caught anything`),
  ].join("\n");
}
