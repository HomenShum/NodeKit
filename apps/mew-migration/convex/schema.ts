// Convex schema for the mew notebook migration — derived from the REAL Mew data model.
//
// Source of truth: D:/VSCode Projects/Ideaflow/personal-dev-mew/mew/src/db/schema.ts
// (sha256 d79b2bd01699089c09f61a28493a72a4c66ca488a73eba8a7f112cfa79d3f41e, commit 3013c596),
// read read-only during local recon (proof/mew-migration/local-recon.json). Mew is a typed
// property graph in Postgres: graph_node / graph_relation / relation_type / relation_lists.
// There is NO tag table — hashtags are content tokens and relations — so the earlier
// notes/links/tags schema (guessed from public docs) is replaced by this one.
//
// HAND-ADDED, not scaffolded: `nodekit create` supports `--backend` only as a template
// substitution (src/lib/scaffold.mjs stamps the string; there is no convex adapter), so the
// scaffold ran with `--backend filesystem` and this schema is the by-hand Convex half.
//
// Every table carries the provenance triple (sourceId, sourceDigest, importedAt) and every table
// is enumerable for erasure by sourceId. `src/store.mjs#enumerateForErasure` implements the same
// contract over the filesystem store, column for column, and is unit-tested.
//
// Not migrated (explicit drops, disclosed in the OpportunityContract and the import manifest):
// mew_user (identity stays in the auth domain; author_id strings are carried), notification
// (ephemeral), expansion_state (UI state), data (legacy blob), content_tsvector (derived index,
// recomputable), pk (storage surrogate; Mew identity is (id, authorId) and sourceId carries id).

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const provenance = {
  // The Mew object's own `id` (unique per (id, authorId) in the source); the erasure key.
  sourceId: v.string(),
  // sha256 of the canonical JSON of the source record as exported. Recomputable from the export.
  sourceDigest: v.string(),
  // When this row was written by the importer (ISO-8601 UTC).
  importedAt: v.string(),
};

export default defineSchema({
  nodes: defineTable({
    ...provenance,
    authorId: v.string(),
    version: v.number(),
    content: v.union(v.string(), v.null()),
    createdAt: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.optional(v.union(v.string(), v.null())),
    isPublic: v.optional(v.union(v.boolean(), v.null())),
    isNewRelatedObjectsPublic: v.optional(v.union(v.boolean(), v.null())),
    canonicalRelationId: v.optional(v.union(v.string(), v.null())),
    isChecked: v.optional(v.union(v.boolean(), v.null())),
    slug: v.optional(v.union(v.string(), v.null())),
    accessMode: v.number(),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_sourceDigest", ["sourceDigest"])
    .index("by_authorId", ["authorId"]),

  relations: defineTable({
    ...provenance,
    authorId: v.string(),
    version: v.number(),
    fromId: v.union(v.string(), v.null()),
    toId: v.union(v.string(), v.null()),
    relationTypeId: v.union(v.string(), v.null()),
    createdAt: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.optional(v.union(v.string(), v.null())),
    isPublic: v.optional(v.union(v.boolean(), v.null())),
    canonicalRelationId: v.optional(v.union(v.string(), v.null())),
    // True when fromId/toId names an object absent from the same export. Recorded, never dropped.
    dangling: v.boolean(),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_fromId", ["fromId"])
    .index("by_toId", ["toId"]),

  relationTypes: defineTable({
    ...provenance,
    authorId: v.string(),
    version: v.number(),
    label: v.union(v.string(), v.null()),
    reverseLabel: v.union(v.string(), v.null()),
    isPublic: v.optional(v.union(v.boolean(), v.null())),
  }).index("by_sourceId", ["sourceId"]),

  relationLists: defineTable({
    ...provenance,
    authorId: v.string(),
    nodeId: v.union(v.string(), v.null()),
    relationId: v.union(v.string(), v.null()),
    type: v.string(), // "pinned" | "noteContent" | "all" (pgEnum in the source)
    positionInt: v.optional(v.union(v.number(), v.null())),
    positionFrac: v.optional(v.union(v.string(), v.null())),
    isPublic: v.optional(v.union(v.boolean(), v.null())),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_nodeId", ["nodeId"])
    .index("by_relationId", ["relationId"]),
});

// Erasure enumerability contract: erasing one graph object (sourceId) enumerates
//   nodes.by_sourceId ∪ relations.by_sourceId ∪ relations.by_fromId ∪ relations.by_toId
//   ∪ relationTypes.by_sourceId ∪ relationLists.by_sourceId ∪ by_nodeId ∪ by_relationId.
// Every table carries a by_sourceId index, so erasure is an index walk, never a scan.
