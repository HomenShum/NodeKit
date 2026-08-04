import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BRANCHES,
  buildWorkspaceIndex,
  renderWorkspaceMd,
  checkWorkspace,
  WORKSPACE_MD,
  WORKSPACE_JSON,
  WORKSPACE_SCHEMA_VERSION,
} from "../src/lib/workspace-index.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// The scenario: an agent lands in a repository mid-project — a launch brief, a settled capability
// bet, an open deferral, a session contract, an integration note — and has thirty seconds to know
// what was decided, what is open, and who already learned what. The fixture is that repository.
function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "wsix-"));
  mkdirSync(path.join(root, "contracts"), { recursive: true });
  mkdirSync(path.join(root, "integrations"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(path.join(root, "contracts", "graph.capability.json"), JSON.stringify({ schemaVersion: "nodekit.capability-contract/v1", capability: "graph" }));
  writeFileSync(path.join(root, "contracts", "agent.production.json"), JSON.stringify({ schemaVersion: "nodekit.production-agent/v1", application: "desk" }));
  writeFileSync(path.join(root, "contracts", "team.session.json"), JSON.stringify({ schemaVersion: "nodekit.session-contract/v1" }));
  writeFileSync(path.join(root, "deferred.yaml"), "threads: []\n");
  writeFileSync(path.join(root, "hackathon.yaml"), "brief: demo\n");
  writeFileSync(path.join(root, "integrations", "convex.yaml"), "resolvedVersion: 1.0.0\n");
  // decoy: contract-shaped JSON buried in node_modules must not be scanned
  writeFileSync(path.join(root, "node_modules", "junk", "x.json"), JSON.stringify({ schemaVersion: "nodekit.capability-contract/v1" }));
  return root;
}

test("the fixture repo files under the right questions, validates, and node_modules stays invisible", async () => {
  const root = fixtureRepo();
  try {
    const index = buildWorkspaceIndex(root, { now: "2026-08-04T12:00:00.000Z" });
    assert.deepEqual(await validateSchema("nodekit.workspace.v1.schema.json", index, "ws"), []);
    assert.equal(index.schemaVersion, WORKSPACE_SCHEMA_VERSION);
    const paths = (b) => index.branches[b].map((i) => i.path);
    assert.deepEqual(paths("record").sort(), ["contracts/agent.production.json", "contracts/graph.capability.json"]);
    assert.deepEqual(paths("openThreads"), ["deferred.yaml"]);
    assert.deepEqual(paths("agents"), ["contracts/team.session.json"]);
    assert.deepEqual(paths("connections"), ["integrations/convex.yaml"]);
    assert.deepEqual(paths("journey"), ["hackathon.yaml"]);
    assert.deepEqual(index.unfiled, []);
    assert.ok(!JSON.stringify(index).includes("node_modules"));
    const md = renderWorkspaceMd(index);
    for (const question of Object.values(BRANCHES)) assert.ok(md.includes(question), question);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an unrecognized contract-shaped file is UNFILED — listed, never dropped", () => {
  const root = fixtureRepo();
  try {
    writeFileSync(path.join(root, "contracts", "mystery.json"), JSON.stringify({ schemaVersion: "nodekit.brand-new-thing/v1" }));
    const index = buildWorkspaceIndex(root);
    assert.deepEqual(index.unfiled.map((i) => i.kind), ["nodekit.brand-new-thing/v1"]);
    assert.match(renderWorkspaceMd(index), /UNFILED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("check refuses a repo with artifacts and no map, passes after index, refuses again when the repo moves on", () => {
  const root = fixtureRepo();
  try {
    assert.match(checkWorkspace(root).join(" "), /no WORKSPACE\.md/);
    const index = buildWorkspaceIndex(root);
    writeFileSync(path.join(root, WORKSPACE_JSON), JSON.stringify(index, null, 2));
    writeFileSync(path.join(root, WORKSPACE_MD), renderWorkspaceMd(index));
    assert.deepEqual(checkWorkspace(root), []);
    // the repo grows an artifact the committed map has never seen
    writeFileSync(path.join(root, "contracts", "late.capability.json"), JSON.stringify({ schemaVersion: "nodekit.capability-contract/v1", capability: "late" }));
    const refusals = checkWorkspace(root);
    assert.match(refusals.join(" "), /no longer matches/);
    assert.match(refusals.join(" "), /late\.capability\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a truthful map with an UNFILED artifact still refuses — visibility is not a pass", () => {
  const root = fixtureRepo();
  try {
    writeFileSync(path.join(root, "contracts", "mystery.json"), JSON.stringify({ schemaVersion: "nodekit.brand-new-thing/v1" }));
    const index = buildWorkspaceIndex(root);
    writeFileSync(path.join(root, WORKSPACE_JSON), JSON.stringify(index, null, 2));
    writeFileSync(path.join(root, WORKSPACE_MD), renderWorkspaceMd(index));
    const refusals = checkWorkspace(root);
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /UNFILED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bulk evidence aggregates to one counted row, and new receipts still trip freshness", async () => {
  const root = fixtureRepo();
  try {
    mkdirSync(path.join(root, "proof", "shots"), { recursive: true });
    for (let i = 0; i < 30; i += 1) {
      writeFileSync(path.join(root, "proof", "shots", `s${i}.json`), JSON.stringify({ schemaVersion: "nodekit.screenshot-proof/v1", i }));
    }
    const index = buildWorkspaceIndex(root);
    assert.deepEqual(await validateSchema("nodekit.workspace.v1.schema.json", index, "ws"), []);
    const shot = index.branches.record.find((i) => i.kind === "nodekit.screenshot-proof/v1");
    assert.deepEqual(shot, { path: "proof/shots/", kind: "nodekit.screenshot-proof/v1", count: 30 });
    assert.match(renderWorkspaceMd(index), /30 files/);
    // commit the map, add one more receipt: the COUNT must make check refuse
    writeFileSync(path.join(root, WORKSPACE_JSON), JSON.stringify(index, null, 2));
    writeFileSync(path.join(root, WORKSPACE_MD), renderWorkspaceMd(index));
    assert.deepEqual(checkWorkspace(root), []);
    writeFileSync(path.join(root, "proof", "shots", "s30.json"), JSON.stringify({ schemaVersion: "nodekit.screenshot-proof/v1" }));
    assert.match(checkWorkspace(root).join(" "), /no longer matches/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an empty repository needs no map — nothing to navigate is not a refusal", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wsix-empty-"));
  try {
    assert.deepEqual(checkWorkspace(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
