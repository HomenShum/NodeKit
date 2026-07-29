// Convex schema for the mew notebook migration.
//
// HAND-ADDED, not scaffolded: `nodekit create` supports `--backend` only as a template
// substitution (src/lib/scaffold.mjs stamps the string; there is no convex adapter), so the
// scaffold ran with `--backend filesystem` and this schema is the by-hand Convex half, exactly as
// the plan's fallback allows. It compiles only inside a Convex project (`npx convex dev`), which
// requires the credentials tested at LAUNCH.
//
// Every table carries the provenance triple (sourceId, sourceDigest, importedAt) and every table
// is enumerable for erasure by sourceId — the deck-scoped lesson: a table you cannot enumerate for
// deletion is a table you cannot honestly promise to erase. `src/store.mjs#enumerateForErasure`
// implements the same contract over the filesystem store and is unit-tested; this schema mirrors
// it column for column.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const provenance = {
  // Ideaflow's own id for the source record; the dedup key.
  sourceId: v.string(),
  // sha256 of the canonical JSON of the source record as exported. Recomputable from the export.
  sourceDigest: v.string(),
  // When this row was written by the importer (ISO-8601 UTC).
  importedAt: v.string(),
};

export default defineSchema({
  notes: defineTable({
    ...provenance,
    text: v.string(),
    createdAt: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_sourceDigest", ["sourceDigest"]),

  links: defineTable({
    ...provenance,
    // sourceId here is the OWNING note's Ideaflow id; erasing a note enumerates its links.
    targetSourceId: v.string(),
    // "forward" | "backlink" — direction preserved exactly as exported, never recomputed.
    direction: v.string(),
    // True when the target note was not present in the same export. Recorded, never dropped.
    dangling: v.boolean(),
  }).index("by_sourceId", ["sourceId"]),

  tags: defineTable({
    ...provenance,
    // sourceId is the owning note's Ideaflow id.
    // The hashtag token exactly as exported, including hashtag-plus suffixes ("#tag+").
    // Interpretation of hashtag-plus is deferred (contract decision, defaulted-with-disclosure);
    // preserving the raw token drops nothing.
    rawToken: v.string(),
    // The bare tag name with "#" and any "+" suffix stripped, for querying.
    name: v.string(),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_name", ["name"]),
});

// Erasure enumerability contract: for any sourceId, the rows to delete are
//   notes.by_sourceId(sourceId) ∪ links.by_sourceId(sourceId) ∪ tags.by_sourceId(sourceId).
// No table in this schema lacks a by_sourceId index, so erasure is a three-index walk, not a scan.
