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

const OWNER_PATTERN = /@nodekit-behavior\s+([a-z][a-z0-9.-]*)\s+(owner|support)/g;
const VERIFY_PATTERN = /@nodekit-verifies\s+([a-z][a-z0-9.-]*)#([a-z][a-z0-9-]*)/g;

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

/**
 * Generate the behaviour index from declarations, ownership annotations and verification annotations.
 * @param {string} repoRoot
 */
export async function buildBehaviorIndex(repoRoot) {
  const root = path.resolve(repoRoot);
  const manifest = parseYaml(await readFile(path.join(root, "nodekit.yaml"), "utf8")) ?? {};
  const declared = manifest.behaviors ?? {};

  const ownership = await collect(root, "src", [".mjs", ".js"], OWNER_PATTERN, (m, file, lines, i) => ({
    behaviorId: m[1],
    role: m[2],
    file,
    symbol: symbolAfter(lines, i),
    line: i + 1,
  }));
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

  // Annotated but never declared. This is drift in the other direction: code claiming to own a
  // behaviour the contract does not know about.
  const declaredIds = new Set(Object.keys(declared));
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
    orphanAnnotations,
    boundary:
      "This index reports declared behaviors only. It does not claim the repository has no other behavior, and an ownership annotation asserts ownership rather than proving it.",
  };
}
