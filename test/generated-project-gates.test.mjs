// A contract a generated project never runs is the same shape as a schema nothing emits — the
// failure this repository spent a day closing at the platform layer while leaving it open one layer
// out, where the actual product is. These assertions bind the template, not a generated tree, so
// they run in milliseconds; the end-to-end proof was done by hand against a real `nodekit create`.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(platformRoot, rel), "utf8");

// The template is source with substitution tokens, so it cannot be imported as-is. Substituting
// them here runs the generated workflow's real behaviour without paying for a `nodekit create`.
function importGeneratedWorkflow() {
  const source = read("templates/base/agent/workflow.mjs")
    .replace("__NODEKIT_RUNTIME_IMPORT__", pathToFileURL(path.join(platformRoot, "src", "lib", "caseflow.mjs")).href)
    .replace("__BRIEF_JSON__", JSON.stringify("triage inbound support tickets"))
    .replaceAll("__APP_TITLE__", "Generated App");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "nodekit-workflow-")), "workflow.mjs");
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}

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

// Promotion defect D1: after Reject the run stayed parked on the review stage, so `run.nextAction`
// — which the page prints verbatim as "Current action" — still read "Approve or reject the proposed
// change" while the review panel said the proposal was gone. Two regions instructing a user to
// decide on a proposal that no longer exists is the steering journey failing.
test("rejecting a proposal moves the run off the review stage", async () => {
  const { createGuidedDemo } = await importGeneratedWorkflow();
  const demo = createGuidedDemo();
  const initial = demo.start();
  const proposal = demo.propose({ artifactId: initial.artifact.artifactId, runId: initial.run.runId });
  assert.equal(demo.runtime.snapshot().runs[0].nextAction, "Approve or reject the proposed change");

  demo.decide({ decision: "rejected", proposalId: proposal.proposalId, runId: initial.run.runId });
  const run = demo.runtime.snapshot().runs[0];
  assert.doesNotMatch(run.nextAction, /approve or reject/i, "the page still tells the user to decide on a withdrawn proposal");
  assert.equal(run.currentStageId, "working", "the stage rail still highlights Review");
  assert.equal(demo.runtime.snapshot().artifacts[0].canonicalVersion, 1, "a rejection must not become canonical");
});

// The stage banner is a second, independent writer: the server holds its own `presentation`, and
// only the accepted branch updated it. Symmetry between the two branches is the invariant.
test("the generated server gives a rejected decision its own presentation", () => {
  const server = read("templates/base/apps/web/server.mjs");
  const decide = server.slice(server.indexOf('url.pathname === "/api/decide"'));
  const accepted = decide.indexOf('input.decision === "accepted"');
  assert.ok(accepted >= 0, "the decide route no longer branches on the decision");
  assert.match(decide.slice(accepted, accepted + 600), /else setPresentation\(/, "a rejection leaves the stage banner on the review copy");
});
