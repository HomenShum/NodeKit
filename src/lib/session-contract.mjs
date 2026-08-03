// Who may write what, when more than one agent session runs at once.
//
// From a real collision that was visible in advance and shipped anyway: two sessions launched with
// clean, non-overlapping file ownership — and `pyproject.toml` and `uv.lock` belonged to neither.
// Both sessions were going to add dependencies. Lockfile conflicts resolve badly, and the ownership
// plan looked complete because every file anybody had thought about was assigned.
//
// That is the failure mode. Not sloppy ownership — ownership that is careful about the files the
// work is about, and silent about the files the work incidentally touches. Manifests, lockfiles and
// generated indexes are nobody's feature and everybody's write.
//
// So the gate is a coverage check, not a taste check: enumerate the mutable manifests that actually
// exist in the repository, and reject a plan that leaves any of them unclassified. An unlisted
// manifest is the default failure, so silence must be the thing that fails.

export const SESSION_CONTRACT_SCHEMA_VERSION = "nodekit.session-contract/v1";

/**
 * Files that more than one session will write without either one intending to. Matched by basename
 * because that is what makes them recognisable across ecosystems, and the list is deliberately about
 * shared state rather than about any language.
 */
export const CONTENDED_MANIFESTS = Object.freeze([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "pyproject.toml", "uv.lock", "poetry.lock", "requirements.txt",
  "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "Gemfile.lock",
  "deferred.yaml", "harness.yaml",
]);

/** How a shared file's writes get serialised. */
export const ARBITERS = Object.freeze(["parent", "single-session", "regenerated"]);

const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", "Cargo.lock", "go.sum", "Gemfile.lock"]);

/**
 * What actually goes wrong for this file, rather than one sentence about lockfiles applied to
 * everything. A gate that describes a `deferred.yaml` collision as a lockfile conflict is wrong in
 * the detail a reader checks first, and being wrong there costs the rest of the message its credit.
 */
function consequenceOf(file) {
  const base = file.split("/").pop();
  if (LOCKFILES.has(base)) return "a lockfile conflict resolves badly, often by silently dropping one session's dependency";
  if (base === "deferred.yaml" || base === "harness.yaml") {
    return "a last-write-wins merge drops one session's entries, which is precisely the record that exists so nothing is silently dropped";
  }
  return "concurrent edits to a shared manifest resolve last-write-wins, and neither session sees the other's change";
}

export class SessionContractRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`session contract refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "SessionContractRefusal";
    this.refusals = list;
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/** Separators normalised, because a Windows-shaped path must not slip past a POSIX-shaped rule. */
const posix = (value) => String(value ?? "").split("\\").join("/");

/**
 * Does a declared pattern cover this file?
 *
 * `/**` is recursive and `/*` is ONE level. Treating them the same was a real hole: `app/*` claimed
 * `app/nested/package.json`, so a session declared ownership of a directory's files and silently
 * acquired every manifest beneath it. Codex reproduced it through the CLI. A trailing `/` is a
 * directory prefix, which is what people mean when they write it.
 */
function covers(pattern, filePath) {
  if (!isNonEmptyString(pattern)) return false;
  const rule = posix(pattern);
  const file = posix(filePath);
  if (rule === file) return true;
  if (rule.endsWith("/**")) return file.startsWith(`${rule.slice(0, -3)}/`);
  if (rule.endsWith("/*")) {
    const prefix = rule.slice(0, -2);
    // One level: inside this directory, and no further separator after it.
    return file.startsWith(`${prefix}/`) && !file.slice(prefix.length + 1).includes("/");
  }
  if (rule.endsWith("/")) return file.startsWith(rule);
  return false;
}

export function parseSessionContract(contract) {
  if (!contract || typeof contract !== "object") throw new SessionContractRefusal(["a session contract must be an object"]);
  const refusals = [];
  if (contract.schemaVersion !== SESSION_CONTRACT_SCHEMA_VERSION) {
    refusals.push(`schemaVersion must be ${SESSION_CONTRACT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(contract.sessions) || contract.sessions.length === 0) {
    refusals.push("needs at least one session; a contract describing no sessions constrains nothing");
  }
  const seen = new Set();
  for (const [i, session] of (contract.sessions ?? []).entries()) {
    if (!isNonEmptyString(session?.id)) refusals.push(`sessions[${i}] needs an id`);
    else if (seen.has(session.id)) refusals.push(`two sessions share the id ${session.id}`);
    else seen.add(session.id);
    if (!Array.isArray(session?.owns) || session.owns.length === 0) {
      refusals.push(`sessions[${session?.id ?? i}] owns nothing; give it paths or do not launch it`);
    }
  }
  // The default must be stated. An unstated default is read as "do whatever", and the session that
  // needed one small change to a shared module made it silently.
  if (contract.defaults?.outsideOwnedPaths !== "read-only") {
    refusals.push("defaults.outsideOwnedPaths must be read-only; anything else lets a session edit a file another session owns without either one noticing");
  }
  for (const [i, entry] of (contract.sharedWrite ?? []).entries()) {
    if (!isNonEmptyString(entry?.path)) refusals.push(`sharedWrite[${i}] needs a path`);
    if (!ARBITERS.includes(entry?.arbiter)) refusals.push(`sharedWrite[${i}] arbiter must be one of ${ARBITERS.join(", ")}`);
  }
  if (refusals.length > 0) throw new SessionContractRefusal(refusals);
  return contract;
}

/**
 * Two sessions must not own the same path, and every contended manifest present in the repository
 * must be classified.
 *
 * @param contract        a parsed session contract
 * @param repoFiles       every tracked file path, POSIX-relative
 */
export function evaluateSessionContract(contract, repoFiles = []) {
  parseSessionContract(contract);
  // An empty file list is not a repository with no manifests. It is a repository nobody listed, and
  // the manifest coverage check — the entire reason this gate exists — did not run. Reporting a
  // pass there is the vacuous pass, and it passed.
  if (!Array.isArray(repoFiles) || repoFiles.length === 0) {
    return {
      passed: false,
      insufficient: true,
      faults: ["no repository file list was supplied, so the contended-manifest check did not run; an unrun check is not a passed one"],
      sessions: contract.sessions.length,
      contendedManifestsPresent: 0,
      unclassified: [],
    };
  }
  const faults = [];
  const sessions = contract.sessions;
  const shared = new Map((contract.sharedWrite ?? []).map((entry) => [entry.path, entry]));

  // Two owners is the collision the plan was supposed to prevent.
  for (let a = 0; a < sessions.length; a += 1) {
    for (let b = a + 1; b < sessions.length; b += 1) {
      for (const left of sessions[a].owns) {
        for (const right of sessions[b].owns) {
          if (left === right || covers(left, right) || covers(right, left)) {
            faults.push(`sessions ${sessions[a].id} and ${sessions[b].id} both own ${left === right ? left : `${left} / ${right}`}`);
          }
        }
      }
    }
  }

  // The real finding. A manifest that exists and is claimed by nobody will be written by everybody.
  const present = repoFiles.filter((file) => CONTENDED_MANIFESTS.includes(posix(file).split("/").pop()));
  const unclassified = present.filter((file) => {
    if (shared.has(file)) return false;
    return !sessions.some((session) => session.owns.some((pattern) => covers(pattern, file)));
  });
  for (const file of unclassified) {
    faults.push(
      `${file} is a contended manifest owned by no session and not declared sharedWrite — `
        + `every session will write it, and ${consequenceOf(file)}`,
    );
  }

  // A handback that does not return facts returns only files, and the next session pays again for
  // every discovery this one made.
  const required = contract.handback?.required ?? [];
  if (!required.includes("discoveredFacts")) {
    faults.push("handback.required must include discoveredFacts; findings that cost real time to discover otherwise die in a context nobody can read");
  }

  return {
    passed: faults.length === 0,
    insufficient: false,
    faults,
    sessions: sessions.length,
    contendedManifestsPresent: present.length,
    unclassified,
  };
}

export function formatSessionContract(verdict) {
  if (verdict.insufficient) return `SESSION CONTRACT: ${verdict.faults[0]}`;
  const head = `SESSION CONTRACT ${verdict.passed ? "PASS" : "BLOCKED"}: ${verdict.sessions} session(s), `
    + `${verdict.contendedManifestsPresent} contended manifest(s) present, ${verdict.unclassified.length} unclassified.`;
  return verdict.passed ? head : [head, ...verdict.faults.map((entry) => `  ${entry}`)].join("\n");
}
