import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// The repository map is DERIVED from source, never hand-maintained. A hand-written map rots the
// first time a command is renamed, and a rotted map is worse than none: it teaches a newcomer a
// false shape of the system. Generating it means the drift check (regenerate, diff, fail) is the
// only thing that has to stay honest.

// The parts a newcomer must be able to name after the tour. Each is defined by what it OWNS, not
// by a directory listing, so the map explains the system rather than restating the file tree.
const ARCHITECTURE = [
  {
    id: "contracts",
    title: "Contracts",
    owns: "The typed shapes every other part agrees on: what an application is, what a case is, what a receipt proves.",
    rootGlob: "schemas/",
  },
  {
    id: "factory",
    title: "Factory",
    owns: "Turning an empty directory or an existing repository into a working application (create, adopt, compile).",
    rootGlob: "src/lib/scaffold.mjs",
  },
  {
    id: "runtime",
    title: "Caseflow runtime",
    owns: "The universal lifecycle a generated application runs: Case, Run, Stage, Artifact, Proposal, Approval, Receipt.",
    rootGlob: "src/lib/caseflow.mjs",
  },
  {
    id: "proof",
    title: "Proof and evaluation",
    owns: "Deciding whether a result is real: evaluators generate evidence and bind it to an artifact rather than accepting a claim.",
    rootGlob: "src/lib/frontend-render-contract.mjs",
  },
  {
    id: "ledger",
    title: "Evolution Ledger",
    owns: "Recording why the system changed: observed failure, resolution, invariant, evidence, and a human-reviewed interpretation.",
    rootGlob: "src/lib/evolution-ledger.mjs",
  },
];

async function listDir(root, rel, filter = () => true) {
  try {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && filter(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

// Top-level commands are read from the dispatch itself so a renamed command cannot leave a stale
// entry behind. Both dispatch spellings are covered: `first === "x"` and inclusion lists.
function commandsFromDispatch(source) {
  const found = new Set();
  for (const m of source.matchAll(/first === "([a-z][a-z-]*)"/g)) found.add(m[1]);
  for (const m of source.matchAll(/\[((?:\s*"[a-z][a-z-]*"\s*,?)+)\]\.includes\(first\)/g)) {
    for (const q of m[1].matchAll(/"([a-z][a-z-]*)"/g)) found.add(q[1]);
  }
  return [...found].sort();
}

/**
 * Derive the repository map from source.
 * @param {string} repoRoot
 * @returns {Promise<object>}
 */
export async function buildRepoMap(repoRoot) {
  const root = path.resolve(repoRoot);
  const cli = await readFile(path.join(root, "src", "cli.mjs"), "utf8");
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  const schemas = await listDir(root, "schemas", (n) => n.endsWith(".schema.json"));
  const modules = await listDir(root, path.join("src", "lib"), (n) => n.endsWith(".mjs"));
  const tests = await listDir(root, "test", (n) => n.endsWith(".test.mjs"));

  return {
    schemaVersion: "nodekit.repo-map/v1",
    generatedBy: "src/lib/repo-map.mjs",
    regenerate: "npm run repo:map",
    driftCheck: "Regenerate and diff. A stale map fails CI the same way evolution projections do.",
    counts: { schemas: schemas.length, modules: modules.length, tests: tests.length },
    architecture: ARCHITECTURE,
    commands: {
      description: "Top-level `nodekit <command>` verbs, derived from the CLI dispatch.",
      topLevel: commandsFromDispatch(cli),
      lifecycleNote:
        "dev, demo, check, and proof are lifecycle commands declared per application in nodekit.yaml. The platform repository declares only a subset; a generated application declares all of them.",
    },
    scripts: {
      description: "npm scripts, derived from package.json.",
      names: Object.keys(pkg.scripts ?? {}).sort(),
    },
    schemas,
    modules,
    tests,
  };
}
