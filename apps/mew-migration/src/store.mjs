import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Filesystem store for the migrated rows — the local mirror of convex/schema.ts, column for
// column. The Convex deploy is gated on credentials at LAUNCH; this store is what the agent
// surface serves from in the meantime, so nothing about the surface's honesty depends on a
// deployment existing.

const STORE_FILE = "store.json";

export function emptyStore() {
  return { schemaVersion: "mew.store/v1", notes: [], links: [], tags: [] };
}

export async function loadStore(dataDir) {
  try {
    const raw = await readFile(path.join(dataDir, STORE_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== "mew.store/v1") throw new Error(`unrecognized store schemaVersion ${parsed?.schemaVersion}`);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    throw error;
  }
}

export async function saveStore(dataDir, store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, STORE_FILE), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/**
 * Erasure enumerability: every row that must be deleted to erase one source note, across every
 * table. The store has no table this function does not walk — the same three-index contract
 * convex/schema.ts documents.
 */
export function enumerateForErasure(store, sourceId) {
  return {
    sourceId,
    notes: store.notes.filter((row) => row.sourceId === sourceId),
    links: store.links.filter((row) => row.sourceId === sourceId),
    tags: store.tags.filter((row) => row.sourceId === sourceId),
  };
}
