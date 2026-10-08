import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { devNull } from "node:os";
import { promisify } from "node:util";
import { createSchemaAjv } from "./schema-validation.mjs";

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

// Read the contract that actually authored an immutable claim. This is not an
// admission waiver: new records still use the current schema and signed authority.
const DIMENSIONS_EPOCH = "9c321f94861000a45a9eddb50e50c8e77ada8c70";
const AUTHORED_SCHEMA_SHA256 = "4d2998bf89b4eb2c1caf3cf5b2a95b600f68ed1565b0cb87a4aca2837526922f";
const MAX_ORIGIN_RECORDS = 2048;

async function qualifyHistoricalAssumption(git, head, file, introducedIn, original) {
  if (original.schemaVersion !== "nodekit.assumption/v1"
    || !["supported", "scope-limited"].includes(original.status)
    || Object.hasOwn(original, "dimensionsTested")) return null;
  try {
    if ((await git(["rev-parse", "--is-shallow-repository"])).stdout.trim() !== "false") return null;
    // A deletion/readdition or moved path cannot borrow an earlier authored contract.
    const history = (await git(["log", "--full-history", "--no-renames", "--format=commit:%H", "--name-status", head, "--", file])).stdout;
    let commit;
    const additions = [];
    for (const line of history.split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith("commit:")) { commit = line.slice(7); continue; }
      const [status, changedPath, ...extra] = line.split("\t");
      if (!/^[AM]$/.test(status) || changedPath !== file || extra.length || !/^[a-f0-9]{40}$/.test(commit ?? "")) return null;
      if (status === "A") additions.push(commit);
    }
    if (additions.length !== 1 || additions[0] !== introducedIn || introducedIn === DIMENSIONS_EPOCH) return null;
    await git(["merge-base", "--is-ancestor", introducedIn, DIMENSIONS_EPOCH]);
    await git(["merge-base", "--is-ancestor", DIMENSIONS_EPOCH, head]);
    const schemaBytes = (await git(["show", `${introducedIn}:schemas/nodekit.assumption.v1.schema.json`])).stdout;
    if (createHash("sha256").update(schemaBytes).digest("hex") !== AUTHORED_SCHEMA_SHA256) return null;
    if (!createSchemaAjv().compile(JSON.parse(schemaBytes))(original)) return null;
    return {
      id: original.id, file, introducedIn, observedHead: head,
      originalSchemaSha256: AUTHORED_SCHEMA_SHA256,
      currentDimensionsCertified: false,
    };
  } catch {
    // Unknown provenance owes the current contract. No date, version, id or caller
    // flag can turn an unavailable history read into a historical qualification.
    return null;
  }
}

/**
 * @param {string} repoRoot
 * @param {Array<{file: string, record: object}>} loaded repo-relative path plus the record
 *   AS VERIFY READ IT FROM DISK. Comparing against `HEAD:<file>` instead would miss the
 *   case that motivated this check: an uncommitted edit to a committed record. Verify
 *   reports on the bytes on disk, so immutability has to be judged on those same bytes.
 */
export async function detectLedgerMutations(repoRoot, loaded) {
  if (loaded.length > MAX_ORIGIN_RECORDS) throw new Error(`ledger origin inspection exceeds ${MAX_ORIGIN_RECORDS} records`);
  const deadline = Date.now() + 30000;
  const git = (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("ledger origin inspection budget exhausted");
    // Native replacement refs and legacy graft files must not rewrite the origin
    // view. The flag covers refs; Git reads grafts separately, so bind that file
    // to the standard null device in this child's environment only.
    return run("git", ["--no-replace-objects", ...args], {
      cwd: repoRoot, maxBuffer: 2 * 1024 * 1024, timeout: Math.min(5000, remaining),
      env: { ...process.env, GIT_GRAFT_FILE: devNull },
    });
  };
  const historicalQualifications = [];
  const inspectionIssues = [];
  let observedHead;

  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
    observedHead = (await git(["rev-parse", "HEAD^{commit}"])).stdout.trim();
  } catch (error) {
    const notRepository = error?.code === 128 && !error.killed && !error.signal
      && /^fatal: not a git repository \(or any of the parent directories\): \.git\r?\n$/.test(error.stderr ?? "");
    if (!notRepository) inspectionIssues.push("ledger origin inspection failed before its Git history could be pinned");
    return { gitAvailable: false, checked: 0, mutations: [], bindingRepairs: [], historicalQualifications, inspectionIssues };
  }

  const mutations = [];
  const bindingRepairs = [];
  let checked = 0;

  for (const { file, record: current } of loaded) {
    let introducedIn;
    try {
      // The oldest commit touching this path is where it entered the ledger.
      const { stdout } = await git(["log", "--diff-filter=A", "--format=%H", observedHead, "--", file]);
      introducedIn = stdout.trim().split("\n").filter(Boolean).pop();
    } catch { inspectionIssues.push(`${current.id ?? file} ledger origin history could not be inspected`); continue; }
    if (!introducedIn) continue;                       // untracked, or never committed

    let original;
    try {
      const { stdout } = await git(["show", `${introducedIn}:${file}`]);
      original = JSON.parse(stdout);
    } catch { inspectionIssues.push(`${current.id ?? file} original ledger payload could not be inspected`); continue; }

    checked += 1;
    const changes = diffPaths(original, current);
    if (changes.length === 0) {
      const qualification = await qualifyHistoricalAssumption(git, observedHead, file, introducedIn, original);
      if (qualification) historicalQualifications.push(qualification);
      continue;
    }

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

  return { gitAvailable: true, checked, mutations, bindingRepairs, historicalQualifications, inspectionIssues };
}

/** Human-readable issue lines for the verify report. */
export function describeMutations(result) {
  if (!result.gitAvailable) {
    return { issues: result.inspectionIssues ?? [], warnings: result.inspectionIssues?.length ? []
      : ["ledger immutability was NOT checked: not a git repository, so no record could be compared against the revision that introduced it"] };
  }
  const issues = [...(result.inspectionIssues ?? []), ...result.mutations.map((m) => {
    const detail = m.claimChanges
      .map((c) => `${c.path}: ${short(c.from)} -> ${short(c.to)}`)
      .join("; ");
    return `${m.id} was edited after it was committed in ${m.introducedIn}; ledger authority is append-or-supersede, so supersede instead of rewriting the claim [${detail}]`;
  })];
  const warnings = result.bindingRepairs.map((m) =>
    `${m.id} had its binding repaired after ${m.introducedIn} (${m.bindingChanges.map((c) => c.path).join(", ")}); allowed, because a record cannot name the commit that will contain it`);
  return { issues, warnings };
}
