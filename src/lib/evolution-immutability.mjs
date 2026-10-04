import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { validateSchema } from "./schema-validation.mjs";

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

// The public /v1 schema was tightened in place at this actual historical boundary.
// This is a read contract, never an admission schema or a record-id exception.
const DIMENSIONS_EPOCH = "9c321f94861000a45a9eddb50e50c8e77ada8c70";
const ORIGINAL_ASSUMPTION_SCHEMA_SHA256 = "4d2998bf89b4eb2c1caf3cf5b2a95b600f68ed1565b0cb87a4aca2837526922f";
const HISTORICAL_ASSUMPTION_SCHEMA = "nodekit.assumption.v1.pre-dimensions.schema.json";
const MAX_ORIGIN_RECORDS = 2048;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
const CHILD_BUDGET_MS = 5000;
const INSPECTION_BUDGET_MS = 30000;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const payloadHash = (record) => createHash("sha256").update(canonical(record)).digest("hex");
const needsHistoricalContract = (record) => record.schemaVersion === "nodekit.assumption/v1"
  && ["supported", "scope-limited"].includes(record.status)
  && !Object.hasOwn(record, "dimensionsTested");

// Only Git's bounded normal discovery failure is a confirmed nonrepository result.
// Exit 128 alone also covers operational errors. Never publish stderr or error.message.
function isNotRepositoryFailure(error) {
  return error?.code === 128 && error.killed !== true && !error.signal
    && typeof error.stdout === "string" && error.stdout.length === 0
    && typeof error.stderr === "string" && Buffer.byteLength(error.stderr, "utf8") <= 256
    && /^fatal: not a git repository \(or any (?:of the parent directories\): \.git|parent up to mount point [^\r\n]{1,128}\))\r?\n(?:Stopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.\r?\n)?$/u.test(error.stderr);
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
  const deadline = Date.now() + INSPECTION_BUDGET_MS;
  const git = async (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("ledger origin inspection budget exhausted");
    const result = await run("git", args, {
      cwd: repoRoot, maxBuffer: MAX_HISTORY_BYTES, timeout: Math.min(CHILD_BUDGET_MS, remaining),
    });
    return result.stdout;
  };
  const mutations = [];
  const bindingRepairs = [];
  const failures = [];
  const origins = loaded.map(({ file, record }) => ({
    file, id: record.id ?? file, payloadSha256: payloadHash(record),
    classification: needsHistoricalContract(record) ? "unknown" : "current",
    reason: "origin not inspected", introducedIn: null, originalPayloadSha256: null,
    originalSchemaSha256: null, claimsEqual: false,
  }));
  let gitAvailable = false;
  let observedHead = null;
  let historyComplete = false;
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
    gitAvailable = true;
    observedHead = (await git(["rev-parse", "HEAD^{commit}"])).trim();
    historyComplete = (await git(["rev-parse", "--is-shallow-repository"])).trim() === "false";
  } catch (error) {
    const notRepository = !gitAvailable && isNotRepositoryFailure(error);
    if (!notRepository) failures.push("ledger origin preflight failed before a full HEAD and history boundary could be inspected");
    for (const origin of origins) { origin.classification = "unknown"; origin.reason = "origin preflight unavailable"; }
    return { gitAvailable, observedHead, checked: 0, mutations, bindingRepairs, origins, failures };
  }
  let checked = 0;
  for (const [index, { file, record: current }] of loaded.entries()) {
    const origin = origins[index];
    try {
      // Pin every lookup to the same full HEAD. Reject ambiguous path lifecycle rather
      // than selecting an oldest A across deletion/readdition or following a renamed claim.
      if (/[\r\n\t]/u.test(file)) throw new Error("ambiguous ledger path");
      const history = await git(["log", "--full-history", "--format=commit:%H", "--name-status", "--no-renames", observedHead, "--", file]);
      const additions = new Set();
      let commit = null;
      for (const line of history.split(/\r?\n/u).filter(Boolean)) {
        if (line.startsWith("commit:")) { commit = line.slice(7); continue; }
        const [status, changedPath, ...extra] = line.split("\t");
        if (!/^[AM]$/u.test(status) || changedPath !== file || extra.length || !/^[a-f0-9]{40}$/u.test(commit ?? "")) {
          throw new Error("discontinuous or ambiguous ledger path lifecycle");
        }
        if (status === "A") additions.add(commit);
      }
      if (additions.size === 0) { origin.reason = "no committed introducing revision"; continue; }
      if (additions.size !== 1) throw new Error("ledger path was introduced more than once");
      const renamed = await git(["log", "--follow", "--diff-filter=R", "--format=%H", observedHead, "--", file]);
      if (renamed.trim()) throw new Error("moved ledger path has no unambiguous authored contract");
      const introducedIn = [...additions][0];
      const original = JSON.parse(await git(["show", `${introducedIn}:${file}`]));
      origin.introducedIn = introducedIn;
      origin.originalPayloadSha256 = payloadHash(original);
      const changes = diffPaths(original, current);
      origin.claimsEqual = changes.every((change) => change.class === "binding");
      origin.reason = "committed origin inspected";
      checked += 1;
      if (changes.length) {
        const entry = {
          id: current.id ?? file, file, introducedIn: introducedIn.slice(0, 8),
          claimChanges: changes.filter((change) => change.class === "claim"),
          bindingChanges: changes.filter((change) => change.class === "binding"),
        };
        if (entry.claimChanges.length) mutations.push(entry);
        else bindingRepairs.push(entry);
      }
      if (!needsHistoricalContract(current)) continue;
      if (!historyComplete || payloadHash(current) !== payloadHash(original)) {
        throw new Error("historical contract requires complete history and exact original claim equality");
      }
      const schemaBytes = await git(["show", `${introducedIn}:schemas/nodekit.assumption.v1.schema.json`]);
      origin.originalSchemaSha256 = createHash("sha256").update(schemaBytes).digest("hex");
      if (origin.originalSchemaSha256 !== ORIGINAL_ASSUMPTION_SCHEMA_SHA256) {
        throw new Error("authored assumption schema does not match the frozen read contract");
      }
      if (introducedIn === DIMENSIONS_EPOCH) throw new Error("assumption was introduced at the current contract epoch");
      await git(["merge-base", "--is-ancestor", introducedIn, DIMENSIONS_EPOCH]);
      await git(["merge-base", "--is-ancestor", DIMENSIONS_EPOCH, observedHead]);
      const findings = await validateSchema(HISTORICAL_ASSUMPTION_SCHEMA, original, origin.id);
      if (findings.length) throw new Error("original assumption fails its authored schema");
      origin.classification = "authored-historical-unscoped";
      origin.readSchema = HISTORICAL_ASSUMPTION_SCHEMA;
      origin.currentDimensionsCertified = false;
      origin.reason = "exact original claim under verified pre-dimensions contract";
    } catch {
      // Unavailable, malformed, moved, reintroduced, shallow, post-epoch or altered
      // provenance has one outcome. The current strict contract remains mandatory.
      origin.reason = "authored provenance unavailable or inconsistent";
      origin.classification = "unknown";
      failures.push(`${origin.id} ledger origin inspection failed; authored provenance is unavailable or inconsistent`);
    }
  }
  origins.sort((left, right) => left.file.localeCompare(right.file) || left.id.localeCompare(right.id));
  return { gitAvailable: true, observedHead, checked, mutations, bindingRepairs, origins, failures };
}

/** Human-readable issue lines for the verify report. */
export function describeMutations(result) {
  if (!result.gitAvailable) {
    const issues = [...(result.failures ?? [])];
    return { issues, warnings: issues.length === 0
      ? ["ledger immutability was NOT checked: not a git repository, so no record could be compared against the revision that introduced it"]
      : [] };
  }
  const issues = [...(result.failures ?? []), ...result.mutations.map((m) => {
    const detail = m.claimChanges
      .map((c) => `${c.path}: ${short(c.from)} -> ${short(c.to)}`)
      .join("; ");
    return `${m.id} was edited after it was committed in ${m.introducedIn}; ledger authority is append-or-supersede, so supersede instead of rewriting the claim [${detail}]`;
  })];
  const warnings = result.bindingRepairs.map((m) =>
    `${m.id} had its binding repaired after ${m.introducedIn} (${m.bindingChanges.map((c) => c.path).join(", ")}); allowed, because a record cannot name the commit that will contain it`);
  return { issues, warnings };
}
