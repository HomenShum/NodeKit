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
//   node scripts/scorecard.mjs [--data-dir .data] [--out <scorecard.json>]

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const dataDir = opt("--data-dir", ".data");
const outPath = opt("--out", path.join(dataDir, "scorecard.json"));

const manifest = JSON.parse(await readFile(path.join(dataDir, "import-manifest.json"), "utf8"));
const store = await loadStore(dataDir);

const checks = [];
function check(id, detail, pass) {
  checks.push({ id, detail, pass: Boolean(pass) });
}

check("manifest-closes", `notesIn ${manifest.counts.notesIn} === notesImported ${manifest.counts.notesImported} + notesRefused ${manifest.counts.notesRefused}`,
  manifest.closes === true && manifest.counts.notesIn === manifest.counts.notesImported + manifest.counts.notesRefused);
check("store-matches-manifest-notes", `store holds ${store.notes.length} notes, manifest claims ${manifest.counts.notesImported}`,
  store.notes.length === manifest.counts.notesImported);
check("store-matches-manifest-links", `store holds ${store.links.length} links, manifest claims ${manifest.counts.linksImported}`,
  store.links.length === manifest.counts.linksImported);
check("store-matches-manifest-tags", `store holds ${store.tags.length} tags, manifest claims ${manifest.counts.tagsImported}`,
  store.tags.length === manifest.counts.tagsImported);
check("every-row-carries-provenance", "sourceId + 64-hex sourceDigest + importedAt on every row of every table",
  [store.notes, store.links, store.tags].every((table) =>
    table.every((row) => typeof row.sourceId === "string" && /^[0-9a-f]{64}$/.test(row.sourceDigest ?? "") && typeof row.importedAt === "string")));
check("manifest-digests-match-store", "every manifest note digest appears on exactly one store note",
  manifest.notes.every((entry) => store.notes.filter((row) => row.sourceDigest === entry.sourceDigest && row.sourceId === entry.sourceId).length === 1));
check("every-refusal-has-reason", `${manifest.refusals.length} refusal(s), each with a non-empty reason`,
  manifest.refusals.every((r) => typeof r.reason === "string" && r.reason.length > 0));
check("dangling-links-declared", `manifest declares ${manifest.counts.danglingLinks} dangling; store carries ${store.links.filter((l) => l.dangling).length}`,
  store.links.filter((l) => l.dangling).length === manifest.counts.danglingLinks);

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
    reason: "zero owner-authored acceptance cases exist (wave-0A receipt, PR #26); awaiting owner input #3. Cases are never invented, paraphrased into testability, or sampled from anywhere else.",
    casesEvaluated: 0,
  },
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
console.log(`scorecard written: ${outPath}`);
console.log(`  deterministic: ${scorecard.deterministic.verdict} (${checks.length - failed.length}/${checks.length} checks) on ${manifest.source?.fixtureLabeled ? "LABELED FIXTURES" : "export data"}`);
console.log(`  semantic:      ${scorecard.semantic.verdict} — ${scorecard.semantic.casesEvaluated} cases (awaiting owner input #3)`);
console.log("  blended:       never");
process.exit(failed.length === 0 ? 0 : 1);
