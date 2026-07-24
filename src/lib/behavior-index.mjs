import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// The behaviour-ownership gap: receipts answer "did this artifact pass", the Evolution Ledger
// answers "why did the architecture change", and the repository map answers "which packages exist".
// None of them answers "which code owns this behaviour, and what proves it".
//
// This index answers that, and it is GENERATED. A hand-maintained behaviour map rots exactly like
// the documentation it replaces, and a rotted map is worse than none because it teaches a false
// shape of the system. Three sources, each small:
//
//   1. Intent      — `behaviors:` in nodekit.yaml (an existing contract, not a new document type).
//   2. Ownership   — `@nodekit-behavior <id> owner|support` beside the owning symbol in src/.
//   3. Verification— `@nodekit-verifies <id>#<scenario>` beside the test that proves a scenario.
//
// Implementation and verification state are DERIVED, never hand-written, so nobody has to keep two
// status fields honest by memory.

// Ids accept a colon so a ledger invariant (`inv:repair-approval-is-signed`) can be claimed by the
// same annotation that claims a manifest behaviour. Without the colon the pattern silently stops
// matching at `inv`, and every invariant annotation reads as absent.
const OWNER_PATTERN = /@nodekit-behavior\s+([a-z][a-z0-9.:-]*)\s+(owner|support)/g;
const VERIFY_PATTERN = /@nodekit-verifies\s+([a-z][a-z0-9.:-]*)#([a-z][a-z0-9-]*)/g;

// Where owning code can live. templates/base is material NodeKit surface, not sample text: the
// generated application's certification script enforces two ledger invariants directly.
const OWNERSHIP_ROOTS = ["src", "templates/base", "scripts"];

async function fileExists(target) {
  try { await readFile(target); return true; } catch { return false; }
}

async function walk(root, dir, extensions) {
  const out = [];
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, rel, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(rel);
  }
  return out;
}

// The annotation names the behaviour. The SYMBOL is read from the next declaration line, so the
// index points at a definition rather than at a comment that could drift away from its code.
function symbolAfter(lines, index) {
  for (let i = index + 1; i < Math.min(index + 6, lines.length); i += 1) {
    const match = lines[i].match(/(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/);
    if (match) return match[1];
    // A re-export barrel has no declaration to point at: its contract IS the export list. Saying so
    // is more honest than reporting null, which reads the same as "the annotation found nothing".
    if (/^\s*export\s*\{/.test(lines[i])) return "(module exports)";
  }
  return null;
}

// An annotation only counts when it is genuinely a comment. Without this, a fixture or a document
// that merely QUOTES an annotation inside a string literal is read as a real claim of ownership,
// which is how a map starts lying. The same false-positive rule the copy audit applies to
// identifiers inside code blocks.
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

async function collect(root, dir, extensions, pattern, build) {
  const results = [];
  for (const file of await walk(root, dir, extensions)) {
    const source = await readFile(path.join(root, file), "utf8");
    if (!source.includes("@nodekit-")) continue;
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!isCommentLine(line)) return;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) results.push(build(match, file, lines, index));
    });
  }
  return results;
}

// Read the ledger's invariants and report, for each, whether a source symbol claims to own it and
// whether the files it names as verifiers still exist. A verifierRef may carry a `#scenario` anchor;
// only the path part is a file.
async function coverLedgerInvariants(root, ownership) {
  const dir = path.join(root, "evolution", "invariants");
  let files;
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return { available: false, invariants: [] };
  }

  const invariants = [];
  for (const name of files.sort()) {
    const invariant = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    const refs = invariant.verifierRefs ?? [];
    const missingRefs = [];
    for (const ref of refs) {
      const filePath = ref.split("#")[0];
      if (!(await fileExists(path.join(root, filePath)))) missingRefs.push(ref);
    }
    const owners = ownership.filter((o) => o.behaviorId === invariant.id && o.role === "owner");
    // An annotation is the strongest ownership signal because it points at a symbol. A src/ entry in
    // verifierRefs is weaker — it names a file — but it is still a claim, and treating it as none
    // would overstate the gap.
    const namedSourceFiles = refs
      .filter((ref) => OWNERSHIP_ROOTS.some((ownedDir) => ref.startsWith(`${ownedDir}/`)))
      .map((ref) => ref.split("#")[0]);

    invariants.push({
      invariantId: invariant.id,
      status: invariant.status ?? null,
      ownership: owners.length > 0 ? "annotated-symbol" : namedSourceFiles.length > 0 ? "named-file-only" : "unowned",
      owners: owners.map((o) => ({ file: o.file, symbol: o.symbol, line: o.line })),
      namedSourceFiles,
      verifierRefs: refs,
      missingVerifierRefs: missingRefs,
      gaps: [
        ...(owners.length === 0 && namedSourceFiles.length === 0
          ? ["No source file or symbol claims to own this invariant."]
          : []),
        ...missingRefs.map((ref) => `verifierRef "${ref}" does not exist; the invariant points at code that is gone.`),
      ],
    });
  }

  const counts = {
    total: invariants.length,
    annotatedSymbol: invariants.filter((i) => i.ownership === "annotated-symbol").length,
    namedFileOnly: invariants.filter((i) => i.ownership === "named-file-only").length,
    unowned: invariants.filter((i) => i.ownership === "unowned").length,
    withMissingRefs: invariants.filter((i) => i.missingVerifierRefs.length > 0).length,
  };
  return { available: true, counts, invariants };
}

/**
 * Generate the behaviour index from declarations, ownership annotations and verification annotations.
 * @param {string} repoRoot
 */
export async function buildBehaviorIndex(repoRoot) {
  const root = path.resolve(repoRoot);
  const manifest = parseYaml(await readFile(path.join(root, "nodekit.yaml"), "utf8")) ?? {};
  const declared = manifest.behaviors ?? {};

  // Ownership is not confined to src/. Two ledger invariants are enforced by the generated
  // application's own certification script under templates/base, and scanning only src/ reported
  // them as unowned — the tool under-reporting, not the repository being negligent.
  const ownership = [];
  for (const dir of OWNERSHIP_ROOTS) {
    ownership.push(
      ...(await collect(root, dir, [".mjs", ".js"], OWNER_PATTERN, (m, file, lines, i) => ({
        behaviorId: m[1],
        role: m[2],
        file,
        symbol: symbolAfter(lines, i),
        line: i + 1,
      }))),
    );
  }
  const verifications = await collect(root, "test", [".mjs"], VERIFY_PATTERN, (m, file, lines, i) => ({
    behaviorId: m[1],
    scenario: m[2],
    file,
    line: i + 1,
  }));

  const behaviors = Object.entries(declared).map(([behaviorId, spec]) => {
    const owners = ownership.filter((o) => o.behaviorId === behaviorId && o.role === "owner");
    const supporting = ownership.filter((o) => o.behaviorId === behaviorId && o.role === "support");
    const required = spec?.requiredScenarios ?? [];
    const proven = verifications.filter((v) => v.behaviorId === behaviorId);
    const provenScenarios = [...new Set(proven.map((v) => v.scenario))];
    const missingScenarios = required.filter((s) => !provenScenarios.includes(s));
    // A scenario proved by a test that names a scenario nobody declared is a real signal: either
    // the declaration is stale or the test is testing something else under a borrowed name.
    const undeclaredScenarios = provenScenarios.filter((s) => !required.includes(s));

    const implementationState = owners.length === 0 ? "unmapped" : "mapped";
    const verificationState =
      required.length === 0 || provenScenarios.length === 0
        ? "unverified"
        : missingScenarios.length === 0
          ? "verified"
          : "partial";

    return {
      behaviorId,
      statement: spec?.statement ?? null,
      implementationState,
      verificationState,
      owners: owners.map((o) => ({ file: o.file, symbol: o.symbol, line: o.line })),
      supporting: supporting.map((o) => ({ file: o.file, symbol: o.symbol, line: o.line })),
      requiredScenarios: required,
      provenScenarios,
      verifiedBy: proven.map((v) => ({ scenario: v.scenario, file: v.file, line: v.line })),
      implementationGaps: owners.length === 0 ? ["No source symbol claims ownership of this behavior."] : [],
      verificationGaps: [
        ...missingScenarios.map((s) => `Scenario "${s}" is required but no test claims to prove it.`),
        ...undeclaredScenarios.map((s) => `A test proves scenario "${s}", which this behavior does not declare.`),
      ],
    };
  });

  // The Evolution Ledger already carries the repository's human-reviewed invariants, each naming the
  // files that verify it. Those ARE declared behaviour for the whole system, attested rather than
  // invented. Cross-checking them is what makes "which code owns this" answerable beyond the handful
  // of behaviours declared in the manifest.
  //
  // Deliberately NOT copied into `behaviors`: the ledger owns invariant statements, and duplicating
  // them here would create a second place to keep honest. This reports coverage over them instead.
  const invariantCoverage = await coverLedgerInvariants(root, ownership);

  // Annotated but never declared. This is drift in the other direction: code claiming to own a
  // behaviour nothing declares. A ledger invariant counts as declared — it is the repository's own
  // human-reviewed statement — so claiming one is legitimate, not an orphan.
  const declaredIds = new Set([
    ...Object.keys(declared),
    ...invariantCoverage.invariants.map((i) => i.invariantId),
  ]);
  const orphanAnnotations = [...ownership, ...verifications]
    .filter((a) => !declaredIds.has(a.behaviorId))
    .map((a) => ({ behaviorId: a.behaviorId, file: a.file, line: a.line }));

  return {
    schemaVersion: "nodekit.behavior-index/v1",
    generatedBy: "src/lib/behavior-index.mjs",
    regenerate: "npm run behavior:index",
    counts: {
      declared: behaviors.length,
      mapped: behaviors.filter((b) => b.implementationState === "mapped").length,
      unmapped: behaviors.filter((b) => b.implementationState === "unmapped").length,
      verified: behaviors.filter((b) => b.verificationState === "verified").length,
      partial: behaviors.filter((b) => b.verificationState === "partial").length,
      unverified: behaviors.filter((b) => b.verificationState === "unverified").length,
      orphanAnnotations: orphanAnnotations.length,
    },
    behaviors,
    invariantCoverage,
    orphanAnnotations,
    boundary:
      "This index reports declared behaviors only. It does not claim the repository has no other behavior, and an ownership annotation asserts ownership rather than proving it.",
  };
}
