import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importExport, noteDigest } from "../src/importer.mjs";
import { emptyStore, enumerateForErasure } from "../src/store.mjs";
import { answer } from "../src/serve.mjs";

// Scenario suite for the importer. The persona in every scenario is the notebook owner handing an
// EXPORT COPY to the migration and needing one guarantee: nothing is dropped silently. All data is
// labeled fixture data (ids prefixed "fixture:"); none of it is, or resembles a claim about, the
// owner's actual notebook.

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXED_NOW = new Date("2026-07-29T12:00:00.000Z");

async function fixtureExport() {
  return JSON.parse(await readFile(path.join(here, "..", "fixtures", "ideaflow-export.fixture.json"), "utf8"));
}

test("scenario: owner imports a well-formed export — manifest closes, provenance on every row", async () => {
  const doc = await fixtureExport();
  const { rows, manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.notesIn, 3);
  assert.equal(manifest.counts.notesImported, 3);
  assert.equal(manifest.counts.notesRefused, 0);
  assert.equal(manifest.closes, true);
  assert.equal(manifest.counts.linksImported, 3);
  assert.equal(manifest.counts.danglingLinks, 1);
  assert.equal(manifest.counts.tagsImported, 3);
  for (const table of [rows.notes, rows.links, rows.tags]) {
    for (const row of table) {
      assert.match(row.sourceId, /^fixture:/);
      assert.match(row.sourceDigest, /^[0-9a-f]{64}$/);
      assert.equal(row.importedAt, FIXED_NOW.toISOString());
    }
  }
  // hashtag-plus raw token preserved, uninterpreted.
  const plus = rows.tags.find((t) => t.rawToken === "#provenance+");
  assert.ok(plus);
  assert.equal(plus.name, "provenance");
  // backlink direction preserved as exported.
  assert.ok(rows.links.some((l) => l.direction === "backlink"));
});

test("scenario: export contains a duplicate sourceId — second occurrence refused loudly, manifest still closes", async () => {
  const doc = await fixtureExport();
  doc.notes.push({ ...doc.notes[0] });
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.notesIn, 4);
  assert.equal(manifest.counts.notesImported, 3);
  assert.equal(manifest.counts.notesRefused, 1);
  assert.equal(manifest.closes, true);
  assert.match(manifest.refusals[0].reason, /duplicate sourceId/);
});

test("scenario: a note carries a field outside the mapping — refused, never silently narrowed", async () => {
  const doc = await fixtureExport();
  doc.notes.push({ id: "fixture:note-extra", text: "has a mystery field", ideaflowInternalRank: 7 });
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.notesRefused, 1);
  assert.match(manifest.refusals[0].reason, /unmapped field\(s\) \[ideaflowInternalRank\]/);
  assert.equal(manifest.closes, true);
});

test("scenario: malformed notes (no text, bad timestamp, bad link) — each refused with its own reason", async () => {
  const doc = {
    notes: [
      { id: "fixture:no-text", hashtags: ["#x"] },
      { id: "fixture:bad-time", text: "t", createdAt: "yesterday-ish" },
      { id: "fixture:bad-link", text: "t", links: [{ targetId: "fixture:x", direction: "sideways" }] },
    ],
  };
  const { manifest } = importExport(doc, { now: FIXED_NOW });
  assert.equal(manifest.counts.notesImported, 0);
  assert.equal(manifest.counts.notesRefused, 3);
  assert.equal(manifest.closes, true);
  const reasons = manifest.refusals.map((r) => r.reason).join("\n");
  assert.match(reasons, /no readable body/);
  assert.match(reasons, /not an ISO-8601 instant/);
  assert.match(reasons, /not "forward" or "backlink"/);
});

test("scenario: empty export — zero everything, closes, nothing fabricated", () => {
  const { rows, manifest } = importExport({ notes: [] }, { now: FIXED_NOW });
  assert.equal(manifest.counts.notesIn, 0);
  assert.equal(manifest.closes, true);
  assert.deepEqual(rows, { notes: [], links: [], tags: [] });
});

test("scenario: unrecognized top-level shape — the whole import refuses rather than guessing", () => {
  assert.throws(() => importExport({ items: [] }), /refusing to import an unrecognized shape/);
  assert.throws(() => importExport(null), /refusing to import an unrecognized shape/);
});

test("scenario: determinism — the same export digests identically across runs", async () => {
  const doc = await fixtureExport();
  const a = importExport(doc, { now: FIXED_NOW });
  const b = importExport(doc, { now: FIXED_NOW });
  assert.deepEqual(a.manifest, b.manifest);
  assert.equal(noteDigest(doc.notes[0]), noteDigest(JSON.parse(JSON.stringify(doc.notes[0]))));
});

test("scenario: erasure — enumerating one sourceId returns every row across every table", async () => {
  const doc = await fixtureExport();
  const { rows } = importExport(doc, { now: FIXED_NOW });
  const store = { ...emptyStore(), ...rows };
  const erasure = enumerateForErasure(store, "fixture:note-alpha");
  assert.equal(erasure.notes.length, 1);
  assert.equal(erasure.links.length, 1);
  assert.equal(erasure.tags.length, 2);
  const gamma = enumerateForErasure(store, "fixture:note-gamma");
  assert.equal(gamma.notes.length, 1);
  assert.equal(gamma.links.length + gamma.tags.length, 0);
});

test("scenario: agent surface over an EMPTY store — every answer renders unbound, with the reason", () => {
  const result = answer(emptyStore(), "what did I write about provenance?");
  assert.equal(result.unbound, true);
  assert.equal(result.bindings.length, 0);
  assert.match(result.unboundReason, /zero notes/);
});

test("scenario: agent surface over fixture rows — answers carry note id + digest bindings; unmatched questions stay unbound", async () => {
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
  assert.match(miss.unboundReason, /no stored note matches/);
});
