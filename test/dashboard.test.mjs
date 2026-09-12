import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderDashboard, renderDashboardJson } from "../src/lib/dashboard.mjs";

const CLI = fileURLToPath(new URL("../src/cli-main.mjs", import.meta.url));

function makeResult({ name, passed = true, drift = false, proof = true, noKey = "certified" }) {
  return {
    name,
    passed,
    checks: [{ id: "command:build", passed: true }],
    contractFindings: [{ declared: !drift }],
    sourceFindings: [{ excepted: true }],
    manifest: {
      repository: `HomenShum/${name}`,
      lifecycle: "released",
      support: "active",
      canonicalFor: [],
      noKey: { status: noKey },
      proof: proof ? { receiptSchema: "some.schema/v1" } : {},
    },
  };
}

const registry = {
  root: "/tmp/registry",
  repositoryCatalog: {
    repositories: [
      { name: "alpha", lifecycle: "released", role: "core" },
      { name: "beta", lifecycle: "preview", role: "extension" },
    ],
  },
  ownership: { concepts: {} },
};

const results = [
  makeResult({ name: "alpha" }),
  makeResult({ name: "beta", drift: true, proof: false, noKey: "not-applicable" }),
];

const meta = { generatedAt: "2026-09-12T00:00:00.000Z", generatorCommit: "deadbeef" };

test("renderDashboardJson has the declared envelope", () => {
  const json = renderDashboardJson(results, registry, meta);
  assert.equal(json.schemaVersion, "nodekit.dashboard/v1");
  assert.equal(json.generatedAt, meta.generatedAt);
  assert.equal(json.generatorCommit, meta.generatorCommit);
  assert.equal(json.rows.length, 2);
});

test("renderDashboardJson rows match the markdown table row-for-row", () => {
  const markdown = renderDashboard(results, registry);
  const json = renderDashboardJson(results, registry, meta);
  const tableLines = markdown.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Repo") && !line.includes("---"));

  assert.equal(tableLines.length, json.rows.length);
  for (const [index, row] of json.rows.entries()) {
    const cells = tableLines[index].split("|").map((cell) => cell.trim()).filter(Boolean);
    const [name, lifecycle, role, , noKey, proofSchema, drift, p0] = cells;
    assert.equal(row.repo, name);
    assert.equal(row.lifecycle, lifecycle);
    assert.equal(row.role, role);
    assert.equal(row.noKey, noKey);
    assert.equal(row.proofSchema, proofSchema);
    assert.equal(String(row.drift), drift);
    assert.equal(`${row.p0.met}/${row.p0.total}`, p0);
  }
});

test("nodekit dashboard --json --write is rejected before touching the filesystem", () => {
  const run = spawnSync(process.execPath, [CLI, "dashboard", "--json", "--write"], {
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--json cannot be combined with --write/);
});
