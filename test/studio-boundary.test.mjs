import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as studio from "../src/studio.mjs";
import { STUDIO_LOOP, studioCapability } from "../src/studio.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Persona: someone who wants ONLY the UI job — "my app works, the interface looks generic, help my
// coding agent make it good." They should be able to consume Studio without taking the founder
// planning, launch packaging or monitoring they do not need. That is what a boundary is for.
test("the Studio surface is importable as one package entrypoint and every export resolves", async () => {
  const surface = Object.keys(studio);
  assert.ok(surface.length > 25, "a boundary that exports almost nothing is not a boundary");
  for (const name of surface) {
    assert.notEqual(studio[name], undefined, `${name} is exported but resolves to undefined`);
  }
  // The four capabilities the boundary claims to cover must each be reachable.
  for (const required of ["atlasSearch", "createFrontendDirections", "evaluateFrontendTournament", "evaluateFrontendRenderContract", "compileOpportunityToBuild"]) {
    assert.equal(typeof studio[required], "function", `${required} must be part of the Studio surface`);
  }

  const pkg = JSON.parse(await readFile(path.join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.exports["./studio"], "./src/studio.mjs", "the boundary must be a declared package export, not just a file");
});

// The whole reason this boundary exists is that the same capability kept being re-proposed as new.
// Studio must RE-EXPORT the shipped implementations, never fork them.
test("the boundary re-exports existing implementations instead of forking them", async () => {
  const source = await readFile(path.join(REPO, "src", "studio.mjs"), "utf8");
  // Every capability line must be an `export ... from`, i.e. a re-export of an existing module.
  const forked = source
    .split(/\r?\n/)
    .filter((line) => /^\s*export\s+(async\s+)?function\s/.test(line))
    .map((line) => line.trim());
  // studioCapability is the one function the boundary itself owns; anything else is a fork.
  assert.deepEqual(
    forked.map((l) => l.replace(/^export\s+/, "").replace(/\s*\(.*$/, "").replace(/^function\s+/, "")),
    ["studioCapability"],
    "Studio must not reimplement capability that already ships elsewhere in the repository",
  );
  assert.match(source, /from "\.\/lib\/atlas\.mjs"/);
  assert.match(source, /from "\.\/lib\/frontend-specialist\.mjs"/);
});

// THE honesty property. A boundary that advertises only what it can do is marketing. This one must
// report what it cannot do, and must not be able to claim readiness while a step is missing.
test("the capability report names its own gaps and cannot claim standalone readiness while one is open", () => {
  const report = studioCapability();
  assert.equal(report.steps, STUDIO_LOOP.length);
  assert.ok(report.gaps.length > 0, "Studio has real gaps today; a report showing none is wrong");
  assert.equal(report.standaloneReady, false, "readiness must be false while any loop step is unimplemented");
  assert.equal(report.implementedSteps, STUDIO_LOOP.filter((s) => s.implemented).length);

  // Readiness is DERIVED from the gaps, so it cannot be hand-set to true while a gap remains.
  const openSteps = STUDIO_LOOP.filter((s) => !s.implemented).map((s) => s.step);
  assert.deepEqual(report.gaps.map((g) => g.step), openSteps);
  for (const gap of report.gaps) {
    assert.ok(gap.gap && gap.gap.length > 20, `${gap.step} must say WHAT is missing, not just that something is`);
  }
  // Unproven claims are carried separately from missing capability. Both must be stated.
  assert.ok(report.notProven.some((n) => /benchmark/i.test(n)), "the unrun A/B/C/D benchmark must be disclosed");
});

// The two gaps are specific factual claims about this repository. If someone implements direct
// editing, this test must fail so the loop declaration gets updated rather than silently rotting.
test("the declared gaps match the repository: edit and reference ingestion genuinely have no implementation", async () => {
  const editStep = STUDIO_LOOP.find((s) => s.step === "edit");
  assert.equal(editStep.implemented, false);
  assert.equal(editStep.surface, null, "an unimplemented step must not name a surface");

  // Grep the real source. If an edit capability appears, this fails and forces the declaration to move.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  let found = "";
  try {
    const { stdout } = await run("git", ["grep", "-lE", "visualEdit|directEdit|applyEdit"], { cwd: REPO });
    found = stdout.trim();
  } catch {
    found = ""; // git grep exits non-zero when there are no matches
  }
  assert.equal(found, "", `edit capability now exists (${found}); update STUDIO_LOOP rather than leaving the gap declared`);

  // Every implemented step must name the surface that implements it, or the claim is unfalsifiable.
  for (const step of STUDIO_LOOP.filter((s) => s.implemented)) {
    assert.ok(step.surface, `${step.step} claims implemented but names no surface`);
  }
});
