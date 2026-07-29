import { createHash } from "node:crypto";

// The mew importer: a Mew database export in (the exact JSON `scripts/export-database.ts` in the
// owner's Mew checkout writes — {data, users, graphNodes, graphRelations, relationTypes,
// relationLists}), rows + an import manifest out.
//
// The manifest is the artifact everything downstream cites. It must CLOSE per table: every record
// in the export is imported, refused with a reason, or in an explicitly dropped table whose row
// count is recorded. recordsIn === imported + refused + droppedTableRows, checked by the
// deterministic scorecard, not asserted here.
//
// Contract decisions this code implements (all defaulted-with-disclosure, none countersigned):
//   - shape: bound to the personal-dev-mew schema (src/db/schema.ts sha256 d79b2bd0…, commit
//     3013c596). Fields from other branches' schema drift (contentText, relationCount,
//     attributes, …) REFUSE the record loudly — drift is a decision for the owner, not a guess.
//   - dedup: by sourceId `id` per table, mirroring the source's unique(id, author_id) with the
//     export scoped to one author; a duplicate keeps the first occurrence and refuses the rest.
//   - drops: whole tables `data`, `users` are not migrated (identity/legacy domains) — counted,
//     never silent. Per-field: pk (storage surrogate) and contentTsvector (derived) are recorded
//     in manifest.fieldDrops with reasons; every other field is mapped.
//   - dangling relation endpoints are recorded on the row and counted, never dropped.

export const IMPORT_MANIFEST_SCHEMA = "mew.import-manifest/v2";
export const EXPECTED_EXPORT_SHAPE =
  "mew export-database.ts output (personal-dev-mew commit 3013c596, schema sha256 d79b2bd01699089c09f61a28493a72a4c66ca488a73eba8a7f112cfa79d3f41e): {data, users, graphNodes, graphRelations, relationTypes, relationLists}";

export const FIELD_DROPS = Object.freeze([
  { table: "graphNodes", field: "pk", reason: "storage-layer surrogate uuid; Mew identity is (id, authorId) and sourceId carries id" },
  { table: "graphNodes", field: "contentTsvector", reason: "derived full-text index, recomputable from content" },
  { table: "graphRelations", field: "pk", reason: "storage-layer surrogate uuid" },
  { table: "relationTypes", field: "pk", reason: "storage-layer surrogate uuid" },
]);

const DROPPED_TABLES = Object.freeze({
  data: "legacy blob table (dataTable); not part of the graph",
  users: "identity domain (mew_user); authorId strings are carried on every row, accounts are not migrated",
});

// Field sets from personal-dev-mew src/db/schema.ts, exactly.
const NODE_FIELDS = new Set(["pk", "id", "version", "authorId", "createdAt", "updatedAt", "content", "isPublic", "isNewRelatedObjectsPublic", "canonicalRelationId", "isChecked", "slug", "contentTsvector", "accessMode"]);
const RELATION_FIELDS = new Set(["pk", "id", "version", "authorId", "createdAt", "updatedAt", "fromId", "toId", "relationTypeId", "isPublic", "canonicalRelationId"]);
const RELATION_TYPE_FIELDS = new Set(["pk", "id", "authorId", "version", "label", "reverseLabel", "isPublic"]);
const RELATION_LIST_FIELDS = new Set(["id", "authorId", "nodeId", "relationId", "type", "positionInt", "positionFrac", "isPublic"]);
const RELATION_LIST_TYPES = new Set(["pinned", "noteContent", "all"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** Canonical JSON digest of one exported record: keys sorted, no insignificant whitespace. */
export function recordDigest(record) {
  return createHash("sha256").update(JSON.stringify(canonicalize(record)), "utf8").digest("hex");
}

function isOptionalInstant(value) {
  return value === undefined || value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function structuralRefusal(record, fields, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return `${label} record is not an object`;
  const unknown = Object.keys(record).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    return `unmapped field(s) [${unknown.sort().join(", ")}] — schema drift from the bound personal-dev-mew schema; migrating it silently would drop unknown information, and guessing its meaning would invent a decision`;
  }
  if (typeof record.id !== "string" || record.id === "") return `${label}.id is absent or empty; identity in Mew is (id, authorId) and a record without id cannot be re-found or erased`;
  if (typeof record.authorId !== "string" || record.authorId === "") return `${label}.authorId is absent or empty`;
  if (!isOptionalInstant(record.createdAt)) return `${label}.createdAt "${record.createdAt}" is not null/absent/parseable`;
  if (!isOptionalInstant(record.updatedAt)) return `${label}.updatedAt "${record.updatedAt}" is not null/absent/parseable`;
  return null;
}

function importTable({ records, fields, label, extraRefusal, toRow }) {
  const rows = [];
  const refusals = [];
  const seen = new Set();
  records.forEach((record, index) => {
    let reason = structuralRefusal(record, fields, label);
    if (!reason && extraRefusal) reason = extraRefusal(record);
    if (!reason && seen.has(record.id)) {
      reason = `duplicate id "${record.id}" within one export: dedup keeps the first occurrence and refuses the rest, loudly`;
    }
    if (reason) {
      refusals.push({ table: label, index, sourceId: typeof record?.id === "string" ? record.id : null, reason });
      return;
    }
    seen.add(record.id);
    rows.push({ record, digest: recordDigest(record) });
  });
  return { rows: rows.map(({ record, digest }) => toRow(record, digest)), refusals, seen };
}

/**
 * Import one Mew database export.
 *
 * @param {object} exportDoc parsed export JSON from scripts/export-database.ts
 * @param {object} [options]
 * @param {Date|Function} [options.now]
 * @returns {{ rows: object, manifest: object }}
 */
export function importExport(exportDoc, { now } = {}) {
  const importedAt = (typeof now === "function" ? now() : now instanceof Date ? now : new Date()).toISOString();
  if (!exportDoc || typeof exportDoc !== "object" || Array.isArray(exportDoc)) {
    throw new Error("export document must be an object; refusing to import an unrecognized shape");
  }
  for (const table of ["graphNodes", "graphRelations", "relationTypes", "relationLists"]) {
    if (!Array.isArray(exportDoc[table])) {
      throw new Error(`export document lacks the ${table} array of a mew database export; refusing to import an unrecognized shape`);
    }
  }

  const provenance = (record, digest) => ({ sourceId: record.id, sourceDigest: digest, importedAt });

  const nodes = importTable({
    records: exportDoc.graphNodes,
    fields: NODE_FIELDS,
    label: "graphNodes",
    extraRefusal: (r) => {
      if (r.content !== undefined && r.content !== null && typeof r.content !== "string") return "graphNodes.content is neither string nor null";
      if (r.version !== undefined && typeof r.version !== "number") return "graphNodes.version is not a number";
      return null;
    },
    toRow: (r, digest) => ({
      ...provenance(r, digest),
      authorId: r.authorId,
      version: r.version ?? 1,
      content: r.content ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
      isPublic: r.isPublic ?? null,
      isNewRelatedObjectsPublic: r.isNewRelatedObjectsPublic ?? null,
      canonicalRelationId: r.canonicalRelationId ?? null,
      isChecked: r.isChecked ?? null,
      slug: r.slug ?? null,
      accessMode: r.accessMode ?? 0,
    }),
  });

  const nodeIds = nodes.seen;

  const relations = importTable({
    records: exportDoc.graphRelations,
    fields: RELATION_FIELDS,
    label: "graphRelations",
    toRow: (r, digest) => ({
      ...provenance(r, digest),
      authorId: r.authorId,
      version: r.version ?? 1,
      fromId: r.fromId ?? null,
      toId: r.toId ?? null,
      relationTypeId: r.relationTypeId ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
      isPublic: r.isPublic ?? null,
      canonicalRelationId: r.canonicalRelationId ?? null,
      dangling: Boolean((r.fromId && !nodeIds.has(r.fromId)) || (r.toId && !nodeIds.has(r.toId))),
    }),
  });

  const relationTypes = importTable({
    records: exportDoc.relationTypes,
    fields: RELATION_TYPE_FIELDS,
    label: "relationTypes",
    toRow: (r, digest) => ({
      ...provenance(r, digest),
      authorId: r.authorId,
      version: r.version ?? 1,
      label: r.label ?? null,
      reverseLabel: r.reverseLabel ?? null,
      isPublic: r.isPublic ?? null,
    }),
  });

  const relationLists = importTable({
    records: exportDoc.relationLists,
    fields: RELATION_LIST_FIELDS,
    label: "relationLists",
    extraRefusal: (r) => (RELATION_LIST_TYPES.has(r.type) ? null : `relationLists.type "${r.type}" is outside the source pgEnum [pinned, noteContent, all]`),
    toRow: (r, digest) => ({
      ...provenance(r, digest),
      authorId: r.authorId,
      nodeId: r.nodeId ?? null,
      relationId: r.relationId ?? null,
      type: r.type,
      positionInt: r.positionInt ?? null,
      positionFrac: r.positionFrac ?? null,
      isPublic: r.isPublic ?? null,
    }),
  });

  const rows = {
    nodes: nodes.rows,
    relations: relations.rows,
    relationTypes: relationTypes.rows,
    relationLists: relationLists.rows,
  };
  const refusals = [...nodes.refusals, ...relations.refusals, ...relationTypes.refusals, ...relationLists.refusals];

  const droppedTables = Object.entries(DROPPED_TABLES).map(([table, reason]) => ({
    table,
    rowsDropped: Array.isArray(exportDoc[table]) ? exportDoc[table].length : 0,
    reason,
  }));

  const perTable = (label, inCount, imported) => ({
    in: inCount,
    imported,
    refused: refusals.filter((r) => r.table === label).length,
    closes: inCount === imported + refusals.filter((r) => r.table === label).length,
  });

  const counts = {
    graphNodes: perTable("graphNodes", exportDoc.graphNodes.length, rows.nodes.length),
    graphRelations: perTable("graphRelations", exportDoc.graphRelations.length, rows.relations.length),
    relationTypes: perTable("relationTypes", exportDoc.relationTypes.length, rows.relationTypes.length),
    relationLists: perTable("relationLists", exportDoc.relationLists.length, rows.relationLists.length),
    danglingRelations: rows.relations.filter((r) => r.dangling).length,
  };

  const manifest = {
    schemaVersion: IMPORT_MANIFEST_SCHEMA,
    importedAt,
    expectedShape: EXPECTED_EXPORT_SHAPE,
    counts,
    closes: Object.values(counts).every((entry) => typeof entry !== "object" || entry.closes),
    refusals,
    droppedTables,
    fieldDrops: [...FIELD_DROPS],
    nodes: rows.nodes.map(({ sourceId, sourceDigest }) => ({ sourceId, sourceDigest })),
  };
  return { rows, manifest };
}
