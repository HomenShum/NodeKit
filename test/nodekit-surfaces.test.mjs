// An inverse index is only useful while it is true, and a hand-maintained table of what a package
// offers is exactly the artifact that rots first: the code moves, the table keeps describing the
// package as it was, and it is still confident prose. So the entries that name a real entry point
// are resolved against package.json, and every surface must be classified for every stack.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { explainFor, formatExplanation, STACKS, SURFACES } from "../src/lib/nodekit-surfaces.mjs";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(platformRoot, "package.json"), "utf8"));

test("a surface that does not apply says why, because that is the sentence worth reading", () => {
  assert.ok(SURFACES.length > 0);
  for (const surface of SURFACES) {
    assert.ok(surface.appliesTo.length > 0, `${surface.id} applies to nothing`);
    assert.ok(surface.offers, `${surface.id} does not say what it offers`);
    for (const stack of surface.appliesTo) {
      assert.ok(STACKS.includes(stack), `${surface.id} names unknown stack ${stack}`);
    }
    // "any" surfaces are never excluded, so they alone owe no exclusion reason.
    if (!surface.appliesTo.includes("any")) {
      assert.ok(surface.doesNotApply, `${surface.id} is stack-limited but never says who should skip it`);
    }
  }
});

test("every entry point the index advertises actually exists in this package", () => {
  const exported = new Set(Object.keys(pkg.exports ?? {}).map((key) => key.replace(/^\./, "@homenshum/nodekit")));
  const binaries = new Set(Object.keys(pkg.bin ?? {}));
  let resolved = 0;

  for (const surface of SURFACES) {
    const entry = surface.entry;
    if (entry.startsWith("@homenshum/nodekit")) {
      // Take the bare specifier; trailing prose like "build/story/launch evidence packs" is a
      // description, not a path, and only the specifier is resolvable.
      const specifier = entry.split(/\s/)[0];
      if (!exported.has(specifier)) continue;
      resolved += 1;
    } else if (entry.startsWith("npx ")) {
      for (const word of entry.split(/[\s/]+/)) {
        if (!word.startsWith("nodekit-")) continue;
        assert.ok(binaries.has(word), `${surface.id} advertises ${word}, which is not a bin in package.json`);
        resolved += 1;
      }
    } else if (entry.startsWith("schemas/")) {
      assert.doesNotThrow(
        () => readFileSync(path.join(platformRoot, entry)),
        `${surface.id} advertises ${entry}, which is not a file in this package`,
      );
      resolved += 1;
    }
  }
  assert.ok(resolved >= 6, `only ${resolved} entry points were resolvable; this check is not measuring the index`);
});

test("every export this package ships is either indexed or deliberately internal", () => {
  // The failure being caught is the original one: a surface exists, nothing points at it for the
  // reader's stack, and they conclude the package is not for them.
  const INTERNAL = new Set([
    ".", "./package.json", "./test", "./_generated/component.js", "./_generated/component",
    // ./convex.config.js is the file alias of ./convex.config, which the convex-component surface
    // already indexes; it is one surface with two spellings, not an unlisted one.
    "./convex.config.js", "./convex-caseflow", "./native-agent-identity", "./execution-graph",
    "./workspace-reference-index", "./evidence-snapshots", "./research-collector",
    "./skill-evaluation", "./submission-evidence-finalizer", "./consumer-package-preparation",
    "./managed-evidence-capture", "./adapters/postgres/migration.sql",
    "./adapters/postgres/knowledge-migration.sql", "./adapters/postgres/knowledge",
    "./adapters/supabase/workers.sql",
  ]);
  const indexed = new Set(SURFACES.map((s) => s.entry.split(/\s/)[0].replace("@homenshum/nodekit", ".")));
  const unclassified = Object.keys(pkg.exports ?? {}).filter((key) => !indexed.has(key) && !INTERNAL.has(key));
  assert.deepEqual(unclassified, [], `these exports are invisible to every stack: ${unclassified.join(", ")}`);
});

test("explain names the gates first and tells a python project what to skip", () => {
  const python = explainFor("python");
  assert.ok(python.relevant.length > 0 && python.notRelevant.length > 0, "a view that excludes nothing is not a filter");

  // Gates are what a skim misses, so they must not be buried under the conveniences.
  const firstNonGate = python.relevant.findIndex((s) => !s.gate);
  const lastGate = python.relevant.map((s) => Boolean(s.gate)).lastIndexOf(true);
  assert.ok(firstNonGate === -1 || firstNonGate > lastGate, "a gate is listed after a non-gate");

  // The specific miss this exists to prevent.
  const ids = python.relevant.map((s) => s.id);
  assert.ok(ids.includes("reference-loop"), "the surface a reader once skipped entirely must be visible to python");
  assert.ok(python.notRelevant.some((s) => s.id === "convex-component"), "convex must be excluded for python");

  const text = formatExplanation(python);
  assert.match(text, /DOES NOT APPLY \(\d+\) — you can stop reading these/);

  assert.throws(() => explainFor("cobol"), /unknown stack/);
});

test("the CLI exposes explain, and refuses an unknown stack rather than guessing", () => {
  const run = (args) => spawnSync(process.execPath, [path.join(platformRoot, "src/cli.mjs"), ...args], { cwd: platformRoot, encoding: "utf8" });

  const ok = run(["explain", "--for", "python", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.stack, "python");
  assert.ok(parsed.relevant.some((s) => s.id === "reference-loop"));

  const bad = run(["explain", "--for", "cobol"]);
  assert.notEqual(bad.status, 0, "an unknown stack must not exit 0 with a plausible-looking answer");
  assert.match(`${bad.stdout}${bad.stderr}`, /unknown stack/);
});
