// A contract a generated project never runs is the same shape as a schema nothing emits — the
// failure this repository spent a day closing at the platform layer while leaving it open one layer
// out, where the actual product is. These assertions bind the template, not a generated tree, so
// they run in milliseconds; the end-to-end proof was done by hand against a real `nodekit create`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(platformRoot, rel), "utf8");

// The template is source with substitution tokens, so it cannot be imported as-is. Substituting
// them here runs the generated workflow's real behaviour without paying for a `nodekit create`.
function generatedWorkflowSource() {
  return read("templates/base/agent/workflow.mjs")
    .replace("__NODEKIT_RUNTIME_IMPORT__", pathToFileURL(path.join(platformRoot, "src", "lib", "caseflow.mjs")).href)
    .replace("__BRIEF_JSON__", JSON.stringify("triage inbound support tickets"))
    .replaceAll("__APP_TITLE__", "Generated App");
}

function importGeneratedWorkflow() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "nodekit-workflow-")), "workflow.mjs");
  writeFileSync(file, generatedWorkflowSource());
  return import(pathToFileURL(file).href);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// The generated server imports the generated workflow by relative path, so proving what its routes
// answer means laying both files out the way `nodekit create` does and running them. A regex over
// the template source can only prove the source still contains a shape.
async function startGeneratedServer() {
  const root = mkdtempSync(path.join(tmpdir(), "nodekit-server-"));
  mkdirSync(path.join(root, "agent"), { recursive: true });
  mkdirSync(path.join(root, "apps", "web"), { recursive: true });
  writeFileSync(path.join(root, "agent", "workflow.mjs"), generatedWorkflowSource());
  writeFileSync(path.join(root, "apps", "web", "server.mjs"), read("templates/base/apps/web/server.mjs")
    .replaceAll("__APP_TITLE__", "Generated App")
    .replaceAll("__APP_NAME__", "generated-app"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, "apps", "web", "server.mjs")], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch {
      // The server starts concurrently; retry only inside this bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    close: () => child.kill(),
    post: async (pathname, payload = {}) => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return { body: await response.json(), status: response.status };
    },
  };
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

// The stage banner is a second, independent writer: the server holds its own `presentation`. D1
// closed the rejected half of that branch; D5 was that BOTH halves keyed on the decision the caller
// requested rather than the status the runtime achieved, so a stale accept the runtime contained as
// `conflicted` still announced "Completion verified" with `receipt: null`.
//
// This replaces a source regex that asserted the decide route still contained
// `input.decision === "accepted"` followed by an `else setPresentation(`. That assertion could only
// hold while the defect did — it named the broken shape — so it is replaced by running the routes
// rather than loosened. All three outcomes are asserted here, including the rejected presentation
// the old test was there to protect.
test("the generated server presents the outcome achieved, not the decision requested", async () => {
  const app = await startGeneratedServer();
  try {
    // A stale write the runtime contains. Not click-reachable (the client hides Approve unless a
    // proposal is pending) but reachable by direct POST and through `?scenario=`.
    await app.post("/api/scenario", { id: "conflict" });
    const conflicted = await app.post("/api/decide", { decision: "accepted" });
    assert.equal(conflicted.body.proposal.status, "conflicted");
    assert.equal(conflicted.body.receipt, null);
    assert.equal(conflicted.body.run.status, "active");
    assert.notEqual(conflicted.body.presentation.kind, "complete", "a completion banner over a null receipt is a false completion claim");
    assert.equal(conflicted.body.presentation.kind, "conflict");
    assert.doesNotMatch(conflicted.body.presentation.title, /completion verified/i);

    // The honest accept must still complete. A fix that simply stopped claiming completion would
    // satisfy the assertions above and destroy the product.
    await app.post("/api/reset");
    await app.post("/api/confirm", { outcome: "Route billing tickets to the billing queue" });
    await app.post("/api/propose");
    const accepted = await app.post("/api/decide", { decision: "accepted" });
    assert.equal(accepted.body.presentation.kind, "complete");
    assert.equal(accepted.body.proposal.status, "accepted");
    assert.equal(accepted.body.run.status, "completed");
    assert.ok(accepted.body.receipt, "the accepted path must still produce a receipt");

    // D1's half of the same seam, still closed.
    await app.post("/api/reset");
    await app.post("/api/confirm", { outcome: "Route billing tickets to the billing queue" });
    await app.post("/api/propose");
    const rejected = await app.post("/api/decide", { decision: "rejected" });
    assert.equal(rejected.body.proposal.status, "rejected");
    assert.equal(rejected.body.presentation.id, "proposal_rejected");
    assert.doesNotMatch(rejected.body.presentation.title, /completion verified/i);
  } finally {
    app.close();
  }
});

// The three defects below were all found by an audit, not by a test, and all three had the same
// shape: a rule enforced per-callsite instead of once, so one callsite drifted. These bind the
// rule itself, so a fourth callsite cannot reintroduce it. The full evidence is
// promotion/evidence/web-quality/ and promotion/evidence/wig-review/.

test("every lime surface pins its own foreground, because --lime does not flip in dark", () => {
  const css = read("templates/base/apps/web/public/styles.css");
  // --lime stays light in both themes while --ink flips to near-white, so text on lime that
  // inherits --ink measured 1.26:1 against a required 4.5:1 (axe color-contrast, serious).
  // The dark block used to patch three of the four lime surfaces by hand and missed .step.active.
  assert.match(css, /--on-lime:#171817/, "the pinned on-lime ink token is missing");
  const limeRules = css.match(/[^{}]*\{[^}]*background:var\(--lime\)[^}]*\}/g) ?? [];
  assert.ok(limeRules.length >= 4, `expected the lime surfaces to still exist, found ${limeRules.length}`);
  for (const rule of limeRules) {
    assert.match(rule, /color:var\(--on-lime\)/, `a lime background with no pinned foreground: ${rule.slice(0, 90)}`);
  }
  // The hand-patched dark overrides the token replaced must not come back.
  assert.doesNotMatch(css, /\.primary,\.approve\{color:#111313\}/, "the per-callsite dark patch is back");
});

test("a transport failure never reaches the user in the browser's own words", () => {
  const client = read("templates/base/apps/web/public/app.js");
  // The fetch used to reject straight through act(), so the page rendered the literal string
  // "Failed to fetch" with no retry and no sign on the stage banner that anything had happened.
  assert.match(client, /catch\s*\{[\s\S]{0,400}?Could not reach the server/, "api() does not replace the transport rejection");
  assert.match(client, /error\.retryable = true/, "the transport failure is not marked retryable");
  assert.match(client, /elements\.retry\.hidden = !retryable/, "the error region does not offer its exit");
  // One writer for the error region: a second one is how the retry control gets wiped.
  const directWrites = client.match(/elements\.error\.textContent/g) ?? [];
  assert.equal(directWrites.length, 0, "an error message is written outside showError()");
});

test("an action in flight shows itself and cannot be submitted twice", () => {
  const client = read("templates/base/apps/web/public/app.js");
  const css = read("templates/base/apps/web/public/styles.css");
  assert.match(client, /if \(inFlight\) return;/, "a second submit during a request is not guarded");
  assert.match(client, /document\.body\.dataset\.busy = "true"/, "no in-flight state is published to the DOM");
  assert.match(client, /aria-busy/, "the in-flight state is not exposed to assistive technology");
  assert.match(client, /finally\s*\{[\s\S]{0,200}?inFlight = false/, "the in-flight flag is not cleared on the failure path");
  assert.match(css, /body\[data-busy\][^{]*\{[^}]*animation:nk-busy/, "the in-flight indicator is not painted");
});
