import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GRAPH_DIR,
  GRAPH_FILE,
  evaluateCodeGraphFreshness,
  formatCodeGraphFreshness,
} from "../src/lib/code-graph-freshness.mjs";

// Real repositories, built per test, because the whole check is a git question and a mocked git
// would be testing the mock. The case being reproduced is this repository's own: a graph pinned to
// a commit from 2026-07-21 while HEAD had moved 201 commits and 1,698 files, with nothing anywhere
// mentioning it until somebody happened to run `nodekit graph import`.

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function repoWithGraph({ commits = 0, graphAt = "HEAD", nodes = 3, sourceCommits = 0 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "codegraph-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  await writeFile(path.join(root, "README.md"), "start\n", "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "initial"]);
  const firstCommit = git(root, ["rev-parse", "HEAD"]);

  for (let i = 0; i < commits; i += 1) {
    const dir = i < sourceCommits ? "src" : "docs";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, `f${i}.mjs`), `export const v = ${i};\n`, "utf8");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", `change ${i}`]);
  }

  const pinned = graphAt === "HEAD" ? git(root, ["rev-parse", "HEAD"]) : graphAt === "FIRST" ? firstCommit : graphAt;
  await mkdir(path.join(root, GRAPH_DIR), { recursive: true });
  await writeFile(
    path.join(root, GRAPH_DIR, GRAPH_FILE),
    JSON.stringify({
      project: { gitCommitHash: pinned, lastAnalyzedAt: "2026-07-22T07:06:59.448Z" },
      nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, kind: "function" })),
      edges: [],
    }),
    "utf8",
  );
  return root;
}

test("a graph pinned to HEAD is current", async () => {
  const root = await repoWithGraph({ commits: 3 });
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "current");
  assert.equal(verdict.commitsBehind, 0);
  assert.match(formatCodeGraphFreshness(verdict), /current at/);
});

test("the real case: a graph left behind reports how far, and how much of it was source", async () => {
  const root = await repoWithGraph({ commits: 12, graphAt: "FIRST", sourceCommits: 5 });
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "stale");
  assert.equal(verdict.commitsBehind, 12);
  assert.equal(verdict.sourceFilesChanged, 5);
  const message = formatCodeGraphFreshness(verdict);
  assert.match(message, /12 commits behind HEAD/);
  // Source churn is the number that matters: docs moving does not invalidate a call graph.
  assert.match(message, /5 of them under source/);
});

test("the remedy names the external analyser, because NodeKit cannot rebuild this graph", async () => {
  // A remedy pointing at a NodeKit command would repeat a mistake already made once today, where
  // the fix named a command that could not run on the projects that would read it.
  const root = await repoWithGraph({ commits: 12, graphAt: "FIRST" });
  const message = formatCodeGraphFreshness(await evaluateCodeGraphFreshness(root));

  assert.match(message, /Re-run the Understand Anything analyser/);
  assert.match(message, /NodeKit consumes this graph and cannot rebuild it/);
});

test("a few commits of drift is tolerated but is NOT reported as pinned at HEAD", async () => {
  // Was asserting "current" here, which pinned a conflation Codex found: the formatter then printed
  // "current at HEAD" about a graph three commits behind. Tolerated and pinned-at-HEAD are different
  // facts and the one-line summary is exactly where the difference matters.
  const root = await repoWithGraph({ commits: 3, graphAt: "FIRST" });
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "tolerated-drift");
  assert.equal(verdict.commitsBehind, 3);
  const message = formatCodeGraphFreshness(verdict);
  assert.match(message, /within the 5-commit tolerance, but not pinned at HEAD/);
  assert.doesNotMatch(message, /current at/);
});

// --- what the adversarial review reproduced, kept as cases ---------------------------------------

test("a graph pinned to a DESCENDANT of HEAD is not current, however many commits rev-list counts", async () => {
  // The false pass Codex found. `cat-file -e` proves the object exists; `rev-list graph..HEAD`
  // returns 0 for a descendant. So a graph describing code this checkout does not have reported
  // current with zero commits behind — the single worst answer available here.
  const root = await repoWithGraph({ commits: 2, graphAt: "HEAD" });
  git(root, ["checkout", "-q", "HEAD~1"]);
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "unrelated");
  assert.equal(verdict.commitsBehind, null);
  assert.match(formatCodeGraphFreshness(verdict), /not an ancestor of HEAD/);
});

test("a graph with zero nodes is not a fresh graph; it measured nothing", async () => {
  const root = await repoWithGraph({ commits: 1, nodes: 0 });
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "empty");
  assert.match(formatCodeGraphFreshness(verdict), /an empty graph is not a fresh one/);
});

test("no graph at all is distinguishable from a fresh one", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codegraph-none-"));
  git(root, ["init", "-q"]);
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "absent");
  assert.equal(verdict.commitsBehind, null);
  assert.match(formatCodeGraphFreshness(verdict), /nothing to check/);
});

test("a pinned commit not in this history yields no count rather than a confident wrong one", async () => {
  // Rebased away, or a graph carried in from another repository. `git rev-list A..HEAD` on an
  // unknown A does not mean zero, and reporting zero would read as current.
  const root = await repoWithGraph({ commits: 2, graphAt: "0".repeat(40) });
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "unrelated");
  assert.equal(verdict.commitsBehind, null);
  assert.match(formatCodeGraphFreshness(verdict), /not in this repository's history/);
});

test("a graph with no pinned commit is unknown, never current", async () => {
  const root = await repoWithGraph({ commits: 1 });
  await writeFile(
    path.join(root, GRAPH_DIR, GRAPH_FILE),
    JSON.stringify({ project: { lastAnalyzedAt: "2026-07-22T00:00:00.000Z" }, nodes: [], edges: [] }),
    "utf8",
  );
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "unknown");
  assert.match(formatCodeGraphFreshness(verdict), /unknown rather than fine/);
});

test("an EMPTY graph pinned to a descendant reports unrelated, not empty", async () => {
  // A defect introduced by the previous fix: ordering the zero-node check before ancestry meant an
  // empty graph on an unrelated commit reported `empty`, masking the larger fact that its commit is
  // not in this checkout's history at all.
  const root = await repoWithGraph({ commits: 2, graphAt: "HEAD", nodes: 0 });
  git(root, ["checkout", "-q", "HEAD~1"]);
  const verdict = await evaluateCodeGraphFreshness(root);

  assert.equal(verdict.status, "unrelated");
});

test("an empty graph pinned at HEAD is still empty", async () => {
  const root = await repoWithGraph({ commits: 1, nodes: 0 });
  assert.equal((await evaluateCodeGraphFreshness(root)).status, "empty");
});
