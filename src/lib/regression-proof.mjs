import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

// A regression test that never failed on the old code proves nothing.
//
// The rule comes from a real day: after a P0 fix landed, three existing tests failed — because they
// had pinned the buggy behaviour. `assert "query.intr" in params` was written alongside the bug and
// had become its guardian. Tests written next to a defect protect the defect, and they are
// indistinguishable from tests that protect against it. Both are green.
//
// So the claim "I fixed it and added a test" has two halves and only one of them is ever checked.
// This checks the other: build a worktree at the pre-fix commit, copy TODAY's test files into it,
// and require the named tests to FAIL there. A test that passes on both sides is recorded as
// UNPROVEN — not as a failure of the fix, and never as a pass.
//
// Verified on this repository before the module existed: thirteen tests written for eight bypasses
// an adversarial review found all failed at the pre-fix commit and all pass at HEAD.
//
// What it deliberately does NOT do: judge whether the fix is correct. It establishes that the test
// could have caught the bug, which is the half nobody checks and the half that decays silently.

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

/** Parse node:test TAP into { name -> passed }. */
export function parseTapResults(output) {
  const results = new Map();
  for (const line of String(output ?? "").split("\n")) {
    const match = /^(not ok|ok)\s+\d+\s+-\s+(.*)$/.exec(line.trim());
    if (match) results.set(match[2].trim(), match[1] === "ok");
  }
  return results;
}

/**
 * Prove that today's tests would have failed against a baseline commit.
 *
 * @param repoRoot     repository under test
 * @param baseline     commit predating the fix
 * @param testFiles    repo-relative test paths, taken from the WORKING TREE and copied in
 * @param worktreeDir  where to build the throwaway checkout
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

  const head = git(root, ["rev-parse", "HEAD"]);
  // `--verify <rev>^{commit}` rather than plain rev-parse: rev-parse accepts any 40-character hex
  // as valid SYNTAX and echoes it back whether or not the object exists, so a typo'd baseline
  // sailed past this check and failed later as a worktree error — reported as not-run, which reads
  // as an environment problem rather than as the caller's mistake it actually is.
  const base = git(root, ["rev-parse", "--verify", "--quiet", `${baseline}^{commit}`]);
  if (!base.ok || base.out === "") {
    throw new RegressionProofRefusal([`baseline ${baseline} is not a commit in this repository`]);
  }
  // Proving a test fails at HEAD against itself is not a proof, it is a tautology dressed as one.
  if (base.out === head.out) {
    throw new RegressionProofRefusal([`baseline ${baseline} resolves to HEAD; a test cannot demonstrate it would have caught a bug against the code that already contains the fix`]);
  }

  const target = path.resolve(worktreeDir);
  rmSync(target, { recursive: true, force: true });
  const added = git(root, ["worktree", "add", "-q", "--detach", target, base.out]);
  if (!added.ok) {
    // Could not build the baseline. That is NOT_RUN — it must never read as proven, and it must
    // never read as a failed fix either.
    return {
      status: "not-run",
      baseline: base.out.slice(0, 9),
      head: head.out.slice(0, 9),
      proven: [],
      unproven: [],
      missing: [],
      detail: `could not create a worktree at ${base.out.slice(0, 9)}: ${added.err || "unknown error"}`,
    };
  }

  try {
    // Today's tests, against yesterday's source. Copying the tests in is the whole trick: checking
    // out the baseline alone would run the baseline's tests, which of course pass.
    for (const file of testFiles) {
      const from = path.join(root, file);
      if (!existsSync(from)) throw new RegressionProofRefusal([`test file not found in the working tree: ${file}`]);
      cpSync(from, path.join(target, file), { force: true });
    }
    const modules = path.join(root, "node_modules");
    if (existsSync(modules) && !existsSync(path.join(target, "node_modules"))) {
      cpSync(modules, path.join(target, "node_modules"), { recursive: true, force: true });
    }

    // TAP demanded, not assumed, and the parent runner's environment scrubbed. node:test sets
    // NODE_TEST_CONTEXT for child processes, which switches the child to a different reporter — so
    // this returned "no TAP results" whenever it was itself invoked from a test, which is exactly
    // where it will most often run. Inheriting a runner's env and then parsing its output format is
    // a dependency nobody declared.
    const { NODE_TEST_CONTEXT: _context, NODE_OPTIONS: _options, ...cleanEnv } = process.env;
    // A file usually holds both the new regression tests and the ones that predate the fix. The
    // latter pass on both sides by construction, and reporting them as UNPROVEN drowns the real
    // finding in noise a reader learns to skip. --name scopes the run to what is being proven.
    const nameArgs = namePattern ? ["--test-name-pattern", namePattern] : [];
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...nameArgs, ...testFiles], {
      cwd: target,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      env: cleanEnv,
    });
    const results = parseTapResults(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
    if (results.size === 0) {
      return {
        status: "not-run",
        baseline: base.out.slice(0, 9),
        head: head.out.slice(0, 9),
        proven: [],
        unproven: [],
        missing: [],
        detail: "the baseline run produced no TAP results; the suite did not execute, so nothing was demonstrated",
      };
    }

    const proven = [];
    const unproven = [];
    for (const [name, passed] of results) {
      if (passed) unproven.push(name);
      else proven.push(name);
    }

    return {
      status: proven.length > 0 && unproven.length === 0 ? "proven" : "unproven",
      namePattern: namePattern ?? null,
      baseline: base.out.slice(0, 9),
      head: head.out.slice(0, 9),
      proven: proven.sort(),
      unproven: unproven.sort(),
      missing: [],
      checked: results.size,
    };
  } finally {
    if (!keepWorktree) {
      rmSync(target, { recursive: true, force: true });
      git(root, ["worktree", "prune"]);
    }
  }
}

export function formatRegressionProof(verdict) {
  if (verdict.status === "not-run") {
    return `REGRESSION PROOF NOT RUN: ${verdict.detail}. Nothing was demonstrated — this is not a passed check.`;
  }
  const head = `REGRESSION PROOF ${verdict.status === "proven" ? "PROVEN" : "INCOMPLETE"} against ${verdict.baseline}: `
    + `${verdict.proven.length} of ${verdict.checked} test(s) failed on the pre-fix code, as a regression test must.`;
  if (verdict.status === "proven") return head;
  return [
    head,
    ...verdict.unproven.map((name) => `  UNPROVEN: "${name}" passes on both sides — it does not demonstrate it would have caught anything`),
  ].join("\n");
}
