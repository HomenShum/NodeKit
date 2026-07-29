import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Filesystem store for the migrated rows — the local mirror of convex/schema.ts, column for
// column: nodes / relations / relationTypes / relationLists (the real Mew graph model). The
// Convex deploy is gated on credentials at LAUNCH; this store is what the agent surface serves
// from in the meantime, so nothing about the surface's honesty depends on a deployment existing.

const STORE_FILE = "store.json";

export function emptyStore() {
  return { schemaVersion: "mew.store/v2", nodes: [], relations: [], relationTypes: [], relationLists: [] };
}

export async function loadStore(dataDir) {
  try {
    const raw = await readFile(path.join(dataDir, STORE_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== "mew.store/v2") throw new Error(`unrecognized store schemaVersion ${parsed?.schemaVersion}`);
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
 * Erasure enumerability: every row that must be deleted (or re-examined) to erase one graph
 * object, across every table — including relations that merely TOUCH the object as an endpoint
 * and relation-list entries that order it. The store has no table this function does not walk.
 */
export function enumerateForErasure(store, sourceId) {
  return {
    sourceId,
    nodes: store.nodes.filter((row) => row.sourceId === sourceId),
    relations: store.relations.filter(
      (row) => row.sourceId === sourceId || row.fromId === sourceId || row.toId === sourceId,
    ),
    relationTypes: store.relationTypes.filter((row) => row.sourceId === sourceId),
    relationLists: store.relationLists.filter(
      (row) => row.sourceId === sourceId || row.nodeId === sourceId || row.relationId === sourceId,
    ),
  };
}
