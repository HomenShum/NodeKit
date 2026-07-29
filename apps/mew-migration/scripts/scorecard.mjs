import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadStore } from "../src/store.mjs";

// The two-column scorecard, never blended.
//
//   deterministic — mechanical checks of the import manifest against the store it produced.
//                   Runs whenever a manifest exists. On fixture input the column says so.
//   semantic      — owner-authored acceptance cases ("asking about X surfaces the note about Y").
//                   ZERO cases exist (wave-0A NOT_RUN receipt); this column is NOT_RUN awaiting
//                   owner input #3 and is never estimated, sampled, or synthesized.
//
// There is deliberately no combined score, no average, and no field where one could live.
//
//   node scripts/scorecard.mjs [--data-dir .data] [--manifest <path>] [--out <scorecard.json>]

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const dataDir = opt("--data-dir", ".data");
const outPath = opt("--out", path.join(dataDir, "scorecard.json"));

const manifestPath = opt("--manifest", path.join(dataDir, "import-manifest.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const store = await loadStore(dataDir);

const checks = [];
function check(id, detail, pass) {
  checks.push({ id, detail, pass: Boolean(pass) });
}

const tableMap = { graphNodes: "nodes", graphRelations: "relations", relationTypes: "relationTypes", relationLists: "relationLists" };
for (const [exportTable, storeTable] of Object.entries(tableMap)) {
  const c = manifest.counts[exportTable];
  check(`${exportTable}-closes`, `in ${c.in} === imported ${c.imported} + refused ${c.refused}`,
    c.closes === true && c.in === c.imported + c.refused);
  check(`store-matches-manifest-${exportTable}`, `store holds ${store[storeTable].length}, manifest claims ${c.imported}`,
    store[storeTable].length === c.imported);
}
check("every-row-carries-provenance", "sourceId + 64-hex sourceDigest + importedAt on every row of every table",
  Object.values(tableMap).every((storeTable) =>
    store[storeTable].every((row) => typeof row.sourceId === "string" && /^[0-9a-f]{64}$/.test(row.sourceDigest ?? "") && typeof row.importedAt === "string")));
check("manifest-digests-match-store", "every manifest node digest appears on exactly one store node",
  manifest.nodes.every((entry) => store.nodes.filter((row) => row.sourceDigest === entry.sourceDigest && row.sourceId === entry.sourceId).length === 1));
check("every-refusal-has-reason", `${manifest.refusals.length} refusal(s), each with a non-empty table + reason`,
  manifest.refusals.every((r) => typeof r.reason === "string" && r.reason.length > 0 && typeof r.table === "string"));
check("dangling-relations-declared", `manifest declares ${manifest.counts.danglingRelations} dangling; store carries ${store.relations.filter((l) => l.dangling).length}`,
  store.relations.filter((l) => l.dangling).length === manifest.counts.danglingRelations);
check("dropped-tables-disclosed", `droppedTables covers data + users with counts and reasons (${manifest.droppedTables.map((d) => `${d.table}:${d.rowsDropped}`).join(", ")})`,
  ["data", "users"].every((t) => manifest.droppedTables.some((d) => d.table === t && typeof d.rowsDropped === "number" && d.reason.length > 0)));
check("field-drops-disclosed", "fieldDrops names pk and contentTsvector with reasons",
  ["pk", "contentTsvector"].every((f) => manifest.fieldDrops.some((d) => d.field === f && d.reason.length > 0)));

const failed = checks.filter((c) => !c.pass);
const scorecard = {
  schemaVersion: "mew.scorecard/v1",
  producedAt: new Date().toISOString(),
  blended: false,
  deterministic: {
    verdict: failed.length === 0 ? "PASS" : "FAIL",
    checksRun: checks.length,
    checksFailed: failed.length,
    dataOrigin: manifest.source?.fixtureLabeled
      ? "fixture: labeled importer unit fixtures only — no user data exists; these checks prove the machinery, not the notebook"
      : "export copy (see manifest.source.sha256)",
    manifestSourceSha256: manifest.source?.sha256 ?? null,
    checks,
  },
  semantic: {
    verdict: "NOT_RUN",
    reason: "3 owner-authored cases now exist (harness/mew-migration/notion-cases.json, harvested from Notion page 21b9539b-8f9a-8026-a57b-d8f4042c7c78 after the ground-truth correction superseded wave-0A's ruling). All 3 are NOT_RUN: they exercise agent CRUD orchestration (research/create, find/organize/move, find/link) absent from this retrieval-only slice, and require a populated graph — the owner's export (owner input #1) does not exist yet. Nothing was invented or paraphrased into testability.",
    casesHarvested: 3,
    casesEvaluated: 0,
    casesFile: "harness/mew-migration/notion-cases.json",
  },
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
console.log(`scorecard written: ${outPath}`);
console.log(`  deterministic: ${scorecard.deterministic.verdict} (${checks.length - failed.length}/${checks.length} checks) on ${manifest.source?.fixtureLabeled ? "LABELED FIXTURES" : "export data"}`);
console.log(`  semantic:      ${scorecard.semantic.verdict} — ${scorecard.semantic.casesHarvested} cases harvested, ${scorecard.semantic.casesEvaluated} evaluated (CRUD toolset + owner export absent)`);
console.log("  blended:       never");
process.exit(failed.length === 0 ? 0 : 1);
