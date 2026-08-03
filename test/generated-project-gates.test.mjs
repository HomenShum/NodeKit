// A contract a generated project never runs is the same shape as a schema nothing emits — the
// failure this repository spent a day closing at the platform layer while leaving it open one layer
// out, where the actual product is. These assertions bind the template, not a generated tree, so
// they run in milliseconds; the end-to-end proof was done by hand against a real `nodekit create`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(platformRoot, rel), "utf8");

test("a generated project runs the gates, not merely ships them", () => {
  const check = read("templates/base/scripts/check.mjs");
  for (const verb of ["deferrals", "preflight"]) {
    assert.match(check, new RegExp(`"${verb}"`), `generated check.mjs never invokes ${verb}`);
  }
});

test("the generated test run is scoped to the project's own tests", () => {
  const check = read("templates/base/scripts/check.mjs");
  // A bare `node --test` walks vendor/nodekit and collects its TypeScript component tests, so a
  // freshly generated project failed `npm run check` before its author wrote a line.
  assert.doesNotMatch(check, /\["--test"\]/, "a bare --test collects the vendored tests and fails");
  assert.match(check, /--test", "test\/\*\*\/\*\.test\.mjs/, "must target the project's own tests explicitly");
  // A bare directory arg resolves the directory itself as a test file on this platform.
  assert.doesNotMatch(check, /"--test", "\.?\/?test\/?"/, "a directory arg reports a failure that is not one");
});

test("the scaffolded ledger is valid, empty, and explains its own states", () => {
  const raw = read("templates/base/deferred.yaml");
  const parsed = parse(raw);
  assert.deepEqual(parsed.deferred, [], "seeding entries nobody verified is what this file exists to prevent");
  assert.match(raw, /status: open \| resolved \| accepted-risk/, "a scaffolded file must teach its own contract");
  assert.match(raw, /refuses while anything here is still `open`/);
});
