import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Whether the code graph an agent is about to trust still describes this repository.
//
// The graph is deliberately read-only and commit-pinned — NODEKIT_MASTER_PLAN calls it exactly that
// — and the pinning works: `nodekit graph import` refuses outright when the graph's commit is not
// HEAD. What was missing is that the refusal only happens if somebody runs import. Nothing else ever
// mentioned it, so the graph simply aged:
//
//   graph pinned to  c701819f0  2026-07-21   343 files analysed, 656 nodes, 702 edges
//   HEAD             73cd772e0  2026-08-03
//   between them     201 commits, 1,698 files changed, 90 of them in src/lib
//
// Thirteen days, and src/lib is precisely what an implementation-phase agent queries it about. An
// agent asking "what calls this function?" got an answer about code that had since moved, with
// nothing marking it as historical.
//
// This is the third surface today with the same shape — contracts the skill never routed to,
// projected skills that froze, and now a graph that aged — so the check is deliberately the same
// shape as the skill one: a comparison anybody can rerun, reported rather than fatal.
//
// The remedy names the external producer. NodeKit consumes this graph and cannot regenerate it;
// nothing in this repository writes knowledge-graph.json. Telling a caller to run a NodeKit command
// would repeat the mistake already made once today, where the fix pointed at a command that could
// not run.

export const GRAPH_DIR = ".understand-anything";
export const GRAPH_FILE = "knowledge-graph.json";

/** Commits worth tolerating. Beyond this the graph is describing code that has moved. */
export const STALE_COMMIT_THRESHOLD = 5;

function git(repoRoot, args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * @param repoRoot  repository to check
 * @returns { status, commitsBehind, filesChanged, sourceFilesChanged, graphCommit, head, analyzedAt }
 */
export async function evaluateCodeGraphFreshness(repoRoot, { sourcePrefix = "src/" } = {}) {
  const root = path.resolve(repoRoot);
  let graph;
  try {
    graph = JSON.parse(await readFile(path.join(root, GRAPH_DIR, GRAPH_FILE), "utf8"));
  } catch {
    // No graph is not staleness. A repository that never had one is a different situation from one
    // whose graph rotted, and collapsing them would report a problem nobody has.
    return { status: "absent", commitsBehind: null, filesChanged: null, sourceFilesChanged: null, graphCommit: null, head: null };
  }

  const graphCommit = graph?.project?.gitCommitHash ?? null;
  const head = git(root, ["rev-parse", "HEAD"]);
  const analyzedAt = graph?.project?.lastAnalyzedAt ?? null;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
  const base = { graphCommit, head, analyzedAt, nodes };

  if (!graphCommit || !head) {
    return { ...base, status: "unknown", commitsBehind: null, filesChanged: null, sourceFilesChanged: null };
  }
  if (graphCommit === head) {
    return { ...base, status: "current", commitsBehind: 0, filesChanged: 0, sourceFilesChanged: 0 };
  }

  // A pinned commit that is not in this history at all — rebased away, or a graph from another
  // repository. Counting commits from it would produce a confident wrong number, so it does not.
  if (git(root, ["cat-file", "-e", `${graphCommit}^{commit}`]) === null) {
    return { ...base, status: "unrelated", commitsBehind: null, filesChanged: null, sourceFilesChanged: null };
  }

  const behind = Number.parseInt(git(root, ["rev-list", "--count", `${graphCommit}..HEAD`]) ?? "", 10);
  const changed = (git(root, ["diff", "--name-only", `${graphCommit}..HEAD`]) ?? "").split("\n").filter(Boolean);
  const sourceChanged = changed.filter((file) => file.startsWith(sourcePrefix));

  return {
    ...base,
    status: Number.isInteger(behind) && behind > STALE_COMMIT_THRESHOLD ? "stale" : "current",
    commitsBehind: Number.isInteger(behind) ? behind : null,
    filesChanged: changed.length,
    sourceFilesChanged: sourceChanged.length,
  };
}

export function formatCodeGraphFreshness(verdict) {
  switch (verdict.status) {
    case "absent":
      return "CODE GRAPH: none in this repository — nothing to check.";
    case "unknown":
      return "CODE GRAPH: present, but its pinned commit or this repository's HEAD could not be read, so whether it is current is unknown rather than fine.";
    case "unrelated":
      return `CODE GRAPH: pinned to ${verdict.graphCommit.slice(0, 9)}, which is not in this repository's history — `
        + "rebased away, or built from a different repository. Its answers describe code this checkout does not have.";
    case "stale":
      return `CODE GRAPH STALE: pinned to ${verdict.graphCommit.slice(0, 9)}${verdict.analyzedAt ? ` (analysed ${verdict.analyzedAt.slice(0, 10)})` : ""}, `
        + `${verdict.commitsBehind} commits behind HEAD — ${verdict.filesChanged} files changed since, ${verdict.sourceFilesChanged} of them under source. `
        + "Its call and import edges describe code that has moved. Re-run the Understand Anything analyser to regenerate "
        + `${GRAPH_DIR}/${GRAPH_FILE} at HEAD; NodeKit consumes this graph and cannot rebuild it.`;
    default:
      return `CODE GRAPH: current at ${verdict.head?.slice(0, 9) ?? "HEAD"}, ${verdict.nodes} node(s).`;
  }
}
