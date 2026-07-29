import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slowFiles = [
  "test/agent-ease-matrix.test.mjs",
  "test/managed-evidence-capture.test.mjs",
  "test/submission-evidence-finalizer.test.mjs",
  "test/submission-preparation.test.mjs",
  "test/submission-gate.test.mjs",
];

function lane(name) {
  const result = spawnSync(process.execPath, ["scripts/test-files.mjs", name, "--print"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return new Set(result.stdout.trim().split(/\s+/).filter(Boolean));
}

test("the developer lane excludes acceptance-volume suites while the complete gate retains them", () => {
  const fast = lane("fast");
  const slow = lane("slow");
  const all = lane("all");

  for (const file of slowFiles) {
    assert.equal(fast.has(file), false, `${file} leaked into the developer lane`);
    assert.equal(slow.has(file), true, `${file} is missing from the acceptance lane`);
    assert.equal(all.has(file), true, `${file} is missing from the complete gate`);
  }
  assert.deepEqual(new Set([...fast, ...slow]), all);
});
