import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importExport, recordDigest } from "../src/importer.mjs";
import { emptyStore, enumerateForErasure } from "../src/store.mjs";
import { answer } from "../src/serve.mjs";

// Scenario suite for the importer, against the REAL Mew export shape (scripts/export-database.ts
// in personal-dev-mew: {data, users, graphNodes, graphRelations, relationTypes, relationLists}).
// The persona in every scenario is the notebook owner handing the exporter's output to the
// migration and needing one guarantee: nothing is dropped silently — per-record refusals are loud,
// and whole-table drops (users, data) are counted and disclosed. All data is labeled fixture data
// (ids prefixed "fixture:"); none of it is, or resembles a claim about, the owner's database.

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXED_NOW = new Date("2026-07-29T12:00:00.000Z");

async function fixtureExport() {
  return JSON.parse(await readFile(path.join(here, "..", "fixtures", "ideaflow-export.fixture.json"), "utf8"));
}

test("scenario: owner imports a well-formed export — every table closes, provenance on every row", async () => {
  const doc = await fixtureExport();
  const { rows, manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.graphNodes.in, 3);
  assert.equal(manifest.counts.graphNodes.imported, 3);
  assert.equal(manifest.counts.graphRelations.imported, 2);
  assert.equal(manifest.counts.relationTypes.imported, 2);
  assert.equal(manifest.counts.relationLists.imported, 1);
  assert.equal(manifest.counts.danglingRelations, 1);
  assert.equal(manifest.closes, true);
  for (const table of [rows.nodes, rows.relations, rows.relationTypes, rows.relationLists]) {
    for (const row of table) {
      assert.match(row.sourceId, /^fixture:/);
      assert.match(row.sourceDigest, /^[0-9a-f]{64}$/);
      assert.equal(row.importedAt, FIXED_NOW.toISOString());
    }
  }
  // isChecked (completion state) survives; canonicalRelationId survives; null content survives.
  const beta = rows.nodes.find((n) => n.sourceId === "fixture:node-beta");
  assert.equal(beta.isChecked, true);
  assert.equal(beta.canonicalRelationId, "fixture:rel-alpha-beta");
  const gamma = rows.nodes.find((n) => n.sourceId === "fixture:node-gamma");
  assert.equal(gamma.content, null);
});

test("scenario: whole-table drops (users, data) are counted and disclosed, never silent", async () => {
  const doc = await fixtureExport();
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  const users = manifest.droppedTables.find((d) => d.table === "users");
  assert.equal(users.rowsDropped, 1);
  assert.match(users.reason, /identity domain/);
  assert.ok(manifest.fieldDrops.some((d) => d.field === "contentTsvector"));
  assert.ok(manifest.fieldDrops.some((d) => d.field === "pk"));
});

test("scenario: export contains a duplicate node id — second occurrence refused loudly, table still closes", async () => {
  const doc = await fixtureExport();
  doc.graphNodes.push({ ...doc.graphNodes[0] });
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.graphNodes.in, 4);
  assert.equal(manifest.counts.graphNodes.imported, 3);
  assert.equal(manifest.counts.graphNodes.refused, 1);
  assert.equal(manifest.counts.graphNodes.closes, true);
  assert.match(manifest.refusals[0].reason, /duplicate id/);
});

test("scenario: schema drift from another branch (contentText from latest-main) — record refused, drift named", async () => {
  const doc = await fixtureExport();
  doc.graphNodes.push({ ...doc.graphNodes[0], id: "fixture:node-drift", pk: "00000000-0000-4000-8000-000000000099", contentText: "drifted", relationCount: 2 });
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.graphNodes.refused, 1);
  assert.match(manifest.refusals[0].reason, /unmapped field\(s\) \[contentText, relationCount\]/);
  assert.match(manifest.refusals[0].reason, /schema drift/);
  assert.equal(manifest.closes, true);
});

test("scenario: malformed records (no id, bad timestamp, bad relationLists.type) — each refused with its own reason", async () => {
  const doc = await fixtureExport();
  doc.graphNodes.push({ pk: "00000000-0000-4000-8000-000000000098", authorId: "fixture:user-owner" });
  doc.graphRelations.push({ ...doc.graphRelations[0], id: "fixture:rel-bad-time", pk: "x", createdAt: "yesterday-ish" });
  doc.relationLists.push({ id: "fixture:rlist-bad", authorId: "fixture:user-owner", nodeId: null, relationId: null, type: "sideways", positionInt: null, positionFrac: null, isPublic: false });
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  const reasons = manifest.refusals.map((r) => r.reason).join("\n");
  assert.equal(manifest.refusals.length, 3);
  assert.match(reasons, /id is absent or empty/);
  assert.match(reasons, /not null\/absent\/parseable/);
  assert.match(reasons, /outside the source pgEnum/);
  assert.equal(manifest.closes, true);
});

test("scenario: empty export — zero everything, closes, nothing fabricated", () => {
  const doc = { data: [], users: [], graphNodes: [], graphRelations: [], relationTypes: [], relationLists: [] };
  const { rows, manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.graphNodes.in, 0);
  assert.equal(manifest.closes, true);
  assert.deepEqual(rows, { nodes: [], relations: [], relationTypes: [], relationLists: [] });
});

test("scenario: unrecognized top-level shape — the whole import refuses rather than guessing", () => {
  assert.throws(() => importExport({ notes: [] }), /refusing to import an unrecognized shape/);
  assert.throws(() => importExport(null), /refusing to import an unrecognized shape/);
});

test("scenario: determinism — the same export digests identically across runs", async () => {
  const doc = await fixtureExport();
  const a = importExport(doc, { now: FIXED_NOW });
  const b = importExport(doc, { now: FIXED_NOW });
  assert.deepEqual(a.manifest, b.manifest);
  assert.equal(recordDigest(doc.graphNodes[0]), recordDigest(JSON.parse(JSON.stringify(doc.graphNodes[0]))));
});

test("scenario: erasure — enumerating one node returns every touching row across every table", async () => {
  const doc = await fixtureExport();
  const { rows } = importExport(doc, { now: FIXED_NOW });
  const store = { ...emptyStore(), ...rows };
  const erasure = enumerateForErasure(store, "fixture:node-alpha");
  assert.equal(erasure.nodes.length, 1);
  assert.equal(erasure.relations.length, 1); // rel-alpha-beta touches alpha as fromId
  assert.equal(erasure.relationLists.length, 1); // rlist-1 orders alpha
  const rel = enumerateForErasure(store, "fixture:rel-alpha-beta");
  assert.equal(rel.relations.length, 1); // by its own sourceId
  assert.equal(rel.relationLists.length, 1); // rlist-1 references the relation
});

test("scenario: agent surface over an EMPTY store — every answer renders unbound, with the reason", () => {
  const result = answer(emptyStore(), "what did I write about provenance?");
  assert.equal(result.unbound, true);
  assert.equal(result.bindings.length, 0);
  assert.match(result.unboundReason, /zero nodes/);
});

test("scenario: agent surface over fixture rows — answers carry node id + digest bindings; unmatched questions stay unbound", async () => {
  const doc = await fixtureExport();
  const { rows } = importExport(doc, { now: FIXED_NOW });
  const store = { ...emptyStore(), ...rows };
  const hit = answer(store, "provenance migration");
  assert.equal(hit.unbound, false);
  assert.ok(hit.bindings.length >= 1);
  for (const binding of hit.bindings) {
    assert.match(binding.noteId, /^fixture:/);
    assert.match(binding.digest, /^[0-9a-f]{64}$/);
  }
  const miss = answer(store, "zzz-nothing-matches-this");
  assert.equal(miss.unbound, true);
  assert.match(miss.unboundReason, /no stored node matches/);
});
