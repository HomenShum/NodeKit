import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runGate } from "../scripts/tool-placement-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "scripts", "tool-placement-gate.mjs");
const FIXTURES = path.join(ROOT, "test", "fixtures", "tool-registry");
const REAL_REGISTRY = path.join(ROOT, "tools.yaml");
const REAL_PACKAGE_JSON = path.join(ROOT, "package.json");

function runCli(args) {
  const result = spawnSync(process.execPath, [GATE, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Scenario: the maintainer runs the gate on the real registry against the real platform
// package.json — the shipped state must PASS, with a visible denominator, or the gate is noise.
test("real registry against the real package.json passes with a denominator (exit 0)", () => {
  const { status, stdout } = runCli([REAL_REGISTRY, "--package-json", REAL_PACKAGE_JSON]);
  assert.equal(status, 0, `expected exit 0, got ${status}\n${stdout}`);
  assert.match(stdout, /tool-placement-gate PASS/);
  assert.match(stdout, /entries read: \d+, checks run: \d+/);
  const entries = Number(stdout.match(/entries read: (\d+)/)[1]);
  assert.ok(entries >= 80, `expected the full inventory (>=80 entries), gate saw ${entries}`);
});

// Scenario: a future contributor adds gsap to the platform's own dependencies while the
// registry still places it APP — the dependency-free-core rule must fire and name the package.
test("APP library injected into package.json dependencies fails (exit 1) naming the package", () => {
  const { status, stdout, stderr } = runCli([
    REAL_REGISTRY,
    "--package-json",
    path.join(FIXTURES, "package-with-app-dep.json"),
  ]);
  assert.equal(status, 1, `expected exit 1, got ${status}\n${stdout}${stderr}`);
  assert.match(stderr, /gsap: APP-placed package "gsap" appears in the platform's own package\.json dependencies/);
  assert.match(stdout, /tool-placement-gate FAIL/);
});

// Scenario: a registry drifts — unknown placement, rung-gated lib without the ladder,
// stageless entry that never declared unresolved, benchmark claiming build. Each rule
// must produce its own named violation, not one generic failure.
test("bad registry fixture fails every rule by name (exit 1)", () => {
  const { status, stderr } = runCli([
    path.join(FIXTURES, "bad-registry.tools.yaml"),
    "--package-json",
    REAL_PACKAGE_JSON,
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /unknown-placement-tool: placement "PLUGIN" is outside the closed enum/);
  assert.match(stderr, /gsap: rung-gated motion library must carry a constraint naming the motion-ladder/);
  assert.match(stderr, /stageless-tool: no journeyStages and not declared unresolved/);
  assert.match(stderr, /benchmark-claiming-build: placed only as BENCHMARK\/DOMAIN and may not claim the build stage/);
  assert.match(stderr, /unresolved-but-guessing: declares unresolved: true but also claims journeyStages/);
});

// Scenario: the registry file is absent (fresh clone of a repo that never adopted it, or a
// typo'd path). Absence is NOT_RUN, never a pass — distinct exit code 3.
test("missing tools.yaml is NOT_RUN (exit 3), never a pass", () => {
  const { status, stdout } = runCli([
    path.join(FIXTURES, "does-not-exist.tools.yaml"),
    "--package-json",
    REAL_PACKAGE_JSON,
  ]);
  assert.equal(status, 3);
  assert.match(stdout, /tool-placement-gate NOT_RUN/);
  assert.doesNotMatch(stdout, /PASS/);
});

// Unit: unresolved entries are legal only with empty stages, and an unresolved entry that
// also claims stages is rejected — a declared unknown may not smuggle a guess.
test("runGate reports the registry's declared-unresolved entries by id", () => {
  const result = runGate({ toolsPath: REAL_REGISTRY, packageJsonPath: REAL_PACKAGE_JSON });
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.unresolved.sort(), ["nodegraph", "noderl"]);
});
