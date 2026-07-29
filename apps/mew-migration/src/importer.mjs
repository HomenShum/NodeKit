import { createHash } from "node:crypto";

// The mew importer: an Ideaflow-export-shaped JSON in, rows + an import manifest out.
//
// The manifest is the artifact everything downstream cites: it must CLOSE — every note in the
// export is either imported or refused with a reason, and notesIn === notesImported + notesRefused
// is checked by the deterministic scorecard, not asserted here.
//
// Contract decisions this code implements (all defaulted-with-disclosure in the
// OpportunityContract, none owner-countersigned):
//   - dedup: by sourceId first; exact-content-digest for id-less notes. Never fuzzy text.
//   - drops: none. A note field outside the documented mapping REFUSES that note loudly;
//     silently discarding an unknown field would be a silent drop of unknown information.
//   - hashtag-plus: the raw token is preserved on the tag row; no interpretation.
//   - backlinks: direction preserved exactly as exported; dangling targets recorded, not dropped.
//
// The expected export shape is derived from Ideaflow's PUBLIC data model (notes, hashtags, links,
// timestamps, completion state). No real export has been seen from this machine (wave-0B kill
// receipt); the shape is falsifiable the moment one exists, and the manifest records which shape
// was assumed.

export const IMPORT_MANIFEST_SCHEMA = "mew.import-manifest/v1";
export const EXPECTED_EXPORT_SHAPE = "ideaflow-export-shaped/v1 (derived from Ideaflow's public data model; unverified against a real export)";

const NOTE_FIELDS = new Set(["id", "text", "hashtags", "links", "createdAt", "updatedAt", "completed"]);
const LINK_FIELDS = new Set(["targetId", "direction"]);
const LINK_DIRECTIONS = new Set(["forward", "backlink"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** Canonical JSON digest: keys sorted at every level, no insignificant whitespace. */
export function noteDigest(note) {
  return createHash("sha256").update(JSON.stringify(canonicalize(note)), "utf8").digest("hex");
}

function isIso(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function refusalFor(note, index) {
  if (!note || typeof note !== "object" || Array.isArray(note)) return "note is not an object";
  const unknown = Object.keys(note).filter((key) => !NOTE_FIELDS.has(key));
  if (unknown.length > 0) {
    return `unmapped field(s) [${unknown.sort().join(", ")}]: importing would silently discard information the mapping does not cover`;
  }
  if (typeof note.text !== "string") return "note.text is absent or not a string; a note with no readable body cannot be migrated as a note";
  if (note.createdAt !== undefined && !isIso(note.createdAt)) return `note.createdAt "${note.createdAt}" is not an ISO-8601 instant`;
  if (note.updatedAt !== undefined && !isIso(note.updatedAt)) return `note.updatedAt "${note.updatedAt}" is not an ISO-8601 instant`;
  if (note.completed !== undefined && typeof note.completed !== "boolean") return "note.completed is present but not a boolean";
  if (note.hashtags !== undefined) {
    if (!Array.isArray(note.hashtags)) return "note.hashtags is present but not an array";
    for (const tag of note.hashtags) {
      if (typeof tag !== "string" || !tag.startsWith("#")) return `hashtag ${JSON.stringify(tag)} is not a "#"-prefixed string`;
    }
  }
  if (note.links !== undefined) {
    if (!Array.isArray(note.links)) return "note.links is present but not an array";
    for (const link of note.links) {
      if (!link || typeof link !== "object" || Array.isArray(link)) return "a link entry is not an object";
      const extra = Object.keys(link).filter((key) => !LINK_FIELDS.has(key));
      if (extra.length > 0) return `link carries unmapped field(s) [${extra.sort().join(", ")}]`;
      if (typeof link.targetId !== "string" || link.targetId === "") return "link.targetId is absent or empty";
      if (!LINK_DIRECTIONS.has(link.direction)) return `link.direction "${link.direction}" is not "forward" or "backlink"`;
    }
  }
  return null;
}

function tagName(rawToken) {
  return rawToken.replace(/^#/, "").replace(/\+$/, "");
}

/**
 * Import one export document.
 *
 * @param {object} exportDoc parsed export JSON: { notes: [...] }
 * @param {object} [options]
 * @param {Date|Function} [options.now]
 * @returns {{ rows: { notes: object[], links: object[], tags: object[] }, manifest: object }}
 */
export function importExport(exportDoc, { now } = {}) {
  const importedAt = (typeof now === "function" ? now() : now instanceof Date ? now : new Date()).toISOString();
  if (!exportDoc || typeof exportDoc !== "object" || Array.isArray(exportDoc) || !Array.isArray(exportDoc.notes)) {
    throw new Error("export document must be an object with a notes array; refusing to import an unrecognized shape");
  }

  const rows = { notes: [], links: [], tags: [] };
  const refusals = [];
  const seenSourceIds = new Set();
  const seenDigests = new Set();
  const acceptedIds = new Set();

  // Pass 1: acceptance, dedup, digesting.
  const accepted = [];
  exportDoc.notes.forEach((note, index) => {
    const reason = refusalFor(note, index);
    if (reason) {
      refusals.push({ index, sourceId: typeof note?.id === "string" ? note.id : null, reason });
      return;
    }
    const digest = noteDigest(note);
    if (typeof note.id === "string" && note.id !== "") {
      if (seenSourceIds.has(note.id)) {
        refusals.push({ index, sourceId: note.id, reason: `duplicate sourceId "${note.id}": dedup policy keeps the first occurrence and refuses the rest, loudly` });
        return;
      }
      seenSourceIds.add(note.id);
    } else if (seenDigests.has(digest)) {
      refusals.push({ index, sourceId: null, reason: "duplicate content digest on an id-less note: dedup policy keeps the first occurrence" });
      return;
    }
    seenDigests.add(digest);
    accepted.push({ note, index, digest, sourceId: typeof note.id === "string" && note.id !== "" ? note.id : `digest:${digest.slice(0, 16)}` });
  });
  for (const entry of accepted) acceptedIds.add(entry.sourceId);

  // Pass 2: rows.
  let linksIn = 0;
  let danglingLinks = 0;
  let tagsIn = 0;
  for (const { note, digest, sourceId } of accepted) {
    const provenance = { sourceId, sourceDigest: digest, importedAt };
    rows.notes.push({
      ...provenance,
      text: note.text,
      ...(note.createdAt !== undefined ? { createdAt: note.createdAt } : {}),
      ...(note.updatedAt !== undefined ? { updatedAt: note.updatedAt } : {}),
      ...(note.completed !== undefined ? { completed: note.completed } : {}),
    });
    for (const link of note.links ?? []) {
      linksIn += 1;
      const dangling = !acceptedIds.has(link.targetId) && !seenSourceIds.has(link.targetId);
      if (dangling) danglingLinks += 1;
      rows.links.push({ ...provenance, targetSourceId: link.targetId, direction: link.direction, dangling });
    }
    for (const rawToken of note.hashtags ?? []) {
      tagsIn += 1;
      rows.tags.push({ ...provenance, rawToken, name: tagName(rawToken) });
    }
  }

  const manifest = {
    schemaVersion: IMPORT_MANIFEST_SCHEMA,
    importedAt,
    expectedShape: EXPECTED_EXPORT_SHAPE,
    counts: {
      notesIn: exportDoc.notes.length,
      notesImported: rows.notes.length,
      notesRefused: refusals.length,
      linksIn,
      linksImported: rows.links.length,
      danglingLinks,
      tagsIn,
      tagsImported: rows.tags.length,
    },
    closes: exportDoc.notes.length === rows.notes.length + refusals.length,
    refusals,
    notes: rows.notes.map(({ sourceId, sourceDigest }) => ({ sourceId, sourceDigest })),
  };
  return { rows, manifest };
}
