import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Detect canonical evolution records that were EDITED after they were committed.
 *
 * WHY THIS EXISTS
 *
 * evolution/ledger.json declares `mutation: "append-or-supersede"`, and
 * evolution-ledger.mjs enforces it — but only inside `recordEvolutionEvent`,
 * which compares the incoming record against the one on disk and refuses to
 * overwrite. Nothing writes evidence records through that function. They are
 * produced by scripts and by hand, so every real mutation in this repository's
 * history reached the file directly and the rule never ran.
 *
 * Demonstrated 2026-07-25: a committed evidence record was edited in place from
 * `result: "partial"` to `result: "pass"`, with its evidenceBoundary replaced by
 * "Everything passed. No limitations." `evolution verify` returned EVOLUTION
 * PASS. Git saw the change instantly; the ledger did not see it at all.
 *
 * A rule enforced only on the path nobody takes is a note.
 *
 * BINDING REPAIR IS NOT A CLAIM CHANGE
 *
 * Two mutation classes are not alike, and collapsing them would either block
 * legitimate work or wave through falsification.
 *
 *   binding  artifactRef, sha256, sourceCommit — pointers at immutable objects.
 *            These CANNOT be correct at authoring time: a record cannot name the
 *            sha of the commit that will contain it, so the pointer is repaired
 *            after the fact by construction. Commit d3229a01 ("bind evolution
 *            evidence to committed bytes") did exactly this to three records and
 *            changed nothing else.
 *
 *   claim    result, evidenceBoundary, kind, status, verifiesInvariantIds, and
 *            everything else — what the record ASSERTS. Changing one of these
 *            rewrites history. The ledger's answer is to supersede, not edit.
 *
 * So binding repairs are reported and allowed; claim changes are issues.
 *
 * WHAT THIS DOES NOT DO
 *
 * It compares each record against the revision that introduced it. It cannot
 * see edits made before the first commit, and it is silent outside a git
 * repository — reported as `gitAvailable: false` rather than as a clean pass,
 * because "nothing detected" and "nothing looked" must not read the same.
 */

/** Pointer fields, repairable after commit because they cannot be known before it. */
const BINDING_FIELDS = new Set(["artifactRef", "sha256", "sourceCommit", "generatedAt"]);

function classify(fieldPath) {
  const leaf = fieldPath.split(".").pop();
  return BINDING_FIELDS.has(leaf) ? "binding" : "claim";
}

/** Every leaf path whose value differs between two records. */
function diffPaths(before, after, prefix = "", out = []) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before?.[key];
    const b = after?.[key];
    const bothObjects = a && b && typeof a === "object" && typeof b === "object"
      && !Array.isArray(a) && !Array.isArray(b);
    if (bothObjects) { diffPaths(a, b, path, out); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path, from: a, to: b, class: classify(path) });
    }
  }
  return out;
}

const short = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "(absent)" : text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

/**
 * @param {string} repoRoot
 * @param {Array<{file: string, record: object}>} loaded repo-relative path plus the record
 *   AS VERIFY READ IT FROM DISK. Comparing against `HEAD:<file>` instead would miss the
 *   case that motivated this check: an uncommitted edit to a committed record. Verify
 *   reports on the bytes on disk, so immutability has to be judged on those same bytes.
 */
export async function detectLedgerMutations(repoRoot, loaded) {
  const git = (args) => run("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { gitAvailable: false, checked: 0, mutations: [], bindingRepairs: [] };
  }

  const mutations = [];
  const bindingRepairs = [];
  let checked = 0;

  for (const { file, record: current } of loaded) {
    let introducedIn;
    try {
      // The oldest commit touching this path is where it entered the ledger.
      const { stdout } = await git(["log", "--diff-filter=A", "--format=%H", "--", file]);
      introducedIn = stdout.trim().split("\n").filter(Boolean).pop();
    } catch { continue; }
    if (!introducedIn) continue;                       // untracked, or never committed

    let original;
    try {
      const { stdout } = await git(["show", `${introducedIn}:${file}`]);
      original = JSON.parse(stdout);
    } catch { continue; }                              // unreadable or not JSON at that rev

    checked += 1;
    const changes = diffPaths(original, current);
    if (changes.length === 0) continue;

    const entry = {
      id: current.id ?? file,
      file,
      introducedIn: introducedIn.slice(0, 8),
      claimChanges: changes.filter((c) => c.class === "claim"),
      bindingChanges: changes.filter((c) => c.class === "binding"),
    };
    if (entry.claimChanges.length > 0) mutations.push(entry);
    else bindingRepairs.push(entry);
  }

  return { gitAvailable: true, checked, mutations, bindingRepairs };
}

/** Human-readable issue lines for the verify report. */
export function describeMutations(result) {
  if (!result.gitAvailable) {
    return { issues: [], warnings: ["ledger immutability was NOT checked: not a git repository, so no record could be compared against the revision that introduced it"] };
  }
  const issues = result.mutations.map((m) => {
    const detail = m.claimChanges
      .map((c) => `${c.path}: ${short(c.from)} -> ${short(c.to)}`)
      .join("; ");
    return `${m.id} was edited after it was committed in ${m.introducedIn}; ledger authority is append-or-supersede, so supersede instead of rewriting the claim [${detail}]`;
  });
  const warnings = result.bindingRepairs.map((m) =>
    `${m.id} had its binding repaired after ${m.introducedIn} (${m.bindingChanges.map((c) => c.path).join(", ")}); allowed, because a record cannot name the commit that will contain it`);
  return { issues, warnings };
}
