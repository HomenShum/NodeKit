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

// WHAT THIS DOES NOT ESTABLISH, stated because the distinction is easy to lose: it compares the
// graph's pinned COMMIT against HEAD. It does not read the graph's nodes against the source tree, so
// a graph pinned exactly at HEAD whose nodes name files that do not exist reports `current` — that
// is a correctness question about the analyser's output, and answering it here would mean
// reimplementing the analyser. Freshness and accuracy are different claims and only the first is
// made.
//
// Its verdict is also REPORTED, never fatal to preflight. A project legitimately pins an old graph,
// and failing preflight over drift would train people to skip preflight, which costs more than the
// drift it catches.

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
    // Emptiness is checked here rather than before the commit comparison. Ordering it first was a
    // defect introduced by the previous fix: an empty graph pinned to a DESCENDANT reported `empty`
    // and masked that its commit was unrelated to this checkout, which is the larger fact.
    return nodes === 0
      ? { ...base, status: "empty", commitsBehind: null, filesChanged: null, sourceFilesChanged: null }
      : { ...base, status: "current", commitsBehind: 0, filesChanged: 0, sourceFilesChanged: 0 };
  }

  // A pinned commit that is not an ANCESTOR of HEAD. Two different situations reach here and both
  // must refuse to produce a number:
  //
  //   the object is absent   rebased away, or a graph carried in from another repository
  //   the object exists but  the graph is pinned to a DESCENDANT of HEAD — a checkout that has been
  //   is not an ancestor     rolled back, or a graph built on a branch this checkout is behind
  //
  // The second was a live false pass: `cat-file -e` proves only that the object exists, and
  // `rev-list graph..HEAD` returns 0 for a descendant, so a graph describing code this checkout does
  // NOT have reported current with zero commits behind. Codex reproduced it. Ancestry is the actual
  // question, so ask it directly.
  const exists = git(root, ["cat-file", "-e", `${graphCommit}^{commit}`]) !== null;
  const isAncestor = exists
    && spawnSync("git", ["merge-base", "--is-ancestor", graphCommit, "HEAD"], { cwd: root }).status === 0;
  if (!isAncestor) {
    return {
      ...base,
      status: "unrelated",
      commitsBehind: null,
      filesChanged: null,
      sourceFilesChanged: null,
      reason: exists
        ? "the pinned commit exists but is not an ancestor of HEAD; the graph describes a checkout this one does not contain"
        : "the pinned commit is not in this repository's history",
    };
  }

  if (nodes === 0) {
    return { ...base, status: "empty", commitsBehind: null, filesChanged: null, sourceFilesChanged: null };
  }

  const behind = Number.parseInt(git(root, ["rev-list", "--count", `${graphCommit}..HEAD`]) ?? "", 10);
  const changed = (git(root, ["diff", "--name-only", `${graphCommit}..HEAD`]) ?? "").split("\n").filter(Boolean);
  const sourceChanged = changed.filter((file) => file.startsWith(sourcePrefix));

  return {
    ...base,
    // Tolerated drift is NOT the same as pinned at HEAD. Calling both "current" let the formatter
    // print "current at HEAD" about a graph several commits behind, which is a small lie in the one
    // line a reader actually reads.
    status: !Number.isInteger(behind) ? "unknown" : behind > STALE_COMMIT_THRESHOLD ? "stale" : "tolerated-drift",
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
    case "empty":
      return `CODE GRAPH: present but contains no nodes — nothing was measured, and an empty graph is not a fresh one.`;
    case "unrelated":
      return `CODE GRAPH: pinned to ${verdict.graphCommit.slice(0, 9)} — ${verdict.reason ?? "not an ancestor of HEAD"}. `
        + "Its answers describe code this checkout does not have.";
    case "tolerated-drift":
      return `CODE GRAPH: pinned to ${verdict.graphCommit.slice(0, 9)}, ${verdict.commitsBehind} commit(s) behind HEAD `
        + `(${verdict.sourceFilesChanged} source file(s) changed) — within the ${STALE_COMMIT_THRESHOLD}-commit tolerance, but not pinned at HEAD.`;
    case "stale":
      return `CODE GRAPH STALE: pinned to ${verdict.graphCommit.slice(0, 9)}${verdict.analyzedAt ? ` (analysed ${verdict.analyzedAt.slice(0, 10)})` : ""}, `
        + `${verdict.commitsBehind} commits behind HEAD — ${verdict.filesChanged} files changed since, ${verdict.sourceFilesChanged} of them under source. `
        + "Its call and import edges describe code that has moved. Re-run the Understand Anything analyser to regenerate "
        + `${GRAPH_DIR}/${GRAPH_FILE} at HEAD; NodeKit consumes this graph and cannot rebuild it.`;
    default:
      return `CODE GRAPH: current at ${verdict.head?.slice(0, 9) ?? "HEAD"}, ${verdict.nodes} node(s).`;
  }
}
