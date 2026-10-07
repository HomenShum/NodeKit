// scripts/ui-gates/ held the only gate in the repo with a self-test proving it can PASS, FAIL and
// abstain — "an audit that cannot fail is not a gate" — and no npm script or test reached it, so it
// never ran in a normal verification pass. A gate nobody runs is a vacuous pass about vacuous
// passes, which is the exact doctrine the gate exists to enforce. This is the caller.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the trust-surface gate is probed in all three directions, on every run", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(platformRoot, "scripts/ui-gates/trust-surface-selftest.mjs")],
    { cwd: platformRoot, encoding: "utf8" },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, out);

  // The three outcomes are the point. A gate observed only passing is known to exit 0, which an
  // empty function also does.
  assert.match(out, /expected PASS, got PASS/, out);
  assert.match(out, /expected FAIL, got FAIL/, out);
  assert.match(out, /expected NOT_RUN, got NOT_RUN/, out);
  assert.match(out, /GATE PROBED IN BOTH DIRECTIONS/, out);
});

test("every ui-gate is reachable from npm, so none can quietly stop running", () => {
  const pkg = JSON.parse(readFileSync(path.join(platformRoot, "package.json"), "utf8"));
  const scripts = Object.values(pkg.scripts ?? {}).join(" ");
  assert.match(scripts, /ui-gates/, "no npm script invokes scripts/ui-gates — the gate is unreachable by hand");
});
