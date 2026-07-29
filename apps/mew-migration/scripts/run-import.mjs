import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { importExport } from "../src/importer.mjs";
import { saveStore, emptyStore } from "../src/store.mjs";

// Run the importer over one export file, write the store and the import manifest.
//
//   node scripts/run-import.mjs <export.json> [--data-dir .data] [--manifest <out.json>]
//
// The manifest records the sha256 of the exact input bytes, so "which file produced these rows"
// is a digest, not a memory. When the input is the labeled fixture, the manifest says so — the
// fixtureLabeled flag is read from the file's own _label, never assumed.

const args = process.argv.slice(2);
const exportPath = args.find((a) => !a.startsWith("--"));
if (!exportPath) {
  console.error("usage: node scripts/run-import.mjs <export.json> [--data-dir .data] [--manifest <out.json>]");
  process.exit(2);
}
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const dataDir = opt("--data-dir", ".data");
const manifestOut = opt("--manifest", path.join(dataDir, "import-manifest.json"));

const raw = await readFile(exportPath);
const doc = JSON.parse(raw.toString("utf8"));
const { rows, manifest } = importExport(doc);
const full = {
  ...manifest,
  source: {
    path: exportPath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(raw).digest("hex"),
    byteLength: raw.byteLength,
    fixtureLabeled: typeof doc._label === "string" && doc._label.startsWith("fixture:"),
  },
};
await saveStore(dataDir, { ...emptyStore(), ...rows });
await mkdir(path.dirname(manifestOut), { recursive: true });
await writeFile(manifestOut, `${JSON.stringify(full, null, 2)}\n`, "utf8");
console.log(`import manifest written: ${manifestOut}`);
console.log(`  in ${full.counts.notesIn} = imported ${full.counts.notesImported} + refused ${full.counts.notesRefused}  closes: ${full.closes}`);
console.log(`  links ${full.counts.linksImported} (dangling ${full.counts.danglingLinks}), tags ${full.counts.tagsImported}`);
console.log(`  source sha256 ${full.source.sha256}  fixtureLabeled: ${full.source.fixtureLabeled}`);
process.exit(full.closes ? 0 : 1);
