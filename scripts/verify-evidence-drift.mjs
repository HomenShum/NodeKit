#!/usr/bin/env node
/**
 * verify-evidence-drift.mjs — does every receipt still bind the bytes it claims?
 *
 * THE GAP THIS CLOSES
 *
 * An evidence record pins an artifact by sha256. `verifyEvolutionLedger` checks
 * that a record is internally consistent — it cannot tell you that the FILE ON
 * DISK has changed since the record was written, because it never re-hashes the
 * file and compares.
 *
 * That happened here. evd:recall-before-claim was cut at 20:35 and its artifact
 * was amended at 20:43 to add a section admitting the control test had destroyed
 * itself. Honest edit; the receipt still read `result: "pass"` and pointed at a
 * hash no file had. Nothing in the repository noticed for a day.
 *
 * A receipt that no longer binds its bytes is worse than no receipt: it is a
 * claim of proof whose proof has silently moved.
 *
 *     node scripts/verify-evidence-drift.mjs
 *
 * Exit 0 all bound, 1 drift found, 2 artifact missing.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCE = join(PLATFORM, "evolution", "evidence");

const rows = [];
let drift = 0, missing = 0, unbound = 0;

let files = [];
try { files = (await readdir(EVIDENCE)).filter((f) => f.endsWith(".json")); }
catch (e) {
  console.error(`  cannot read ${EVIDENCE} (${e.code}) — coverage is zero, not clean`);
  process.exit(2);
}

for (const f of files) {
  let rec;
  try { rec = JSON.parse(await readFile(join(EVIDENCE, f), "utf8")); }
  catch (e) { rows.push({ id: f, state: "UNREADABLE", detail: e.code }); continue; }

  // TWO SCHEMES ARE IN USE, and only knowing one produced a false absence.
  //
  //   git:<sha>:<repo-relative-path>     written by this session
  //   file:<repo-relative-path>          written earlier, 3 records
  //
  // The first version handled only `git:` and passed "file:evolution/..." to
  // join() verbatim, producing a path that cannot exist. It then reported
  // ARTIFACT MISSING for three artifacts that were sitting on disk — a probe
  // that could not reach its target announcing absence, which is the exact
  // defect this repository's tooling exists to prevent, committed inside the
  // tool written to detect it.
  const ref = String(rec.artifactRef ?? "");
  const rel = ref.startsWith("git:") ? ref.split(":").slice(2).join(":")
            : ref.startsWith("file:") ? ref.slice(5)
            : ref;
  if (!rel) { rows.push({ id: rec.id, state: "NO ARTIFACT REF", detail: ref }); unbound++; continue; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) {
    // An unknown scheme is UNCHECKABLE, not missing. Saying "missing" would
    // assert an absence the probe never established.
    rows.push({ id: rec.id, state: "UNKNOWN SCHEME", detail: ref.slice(0, 40) });
    unbound++; continue;
  }

  const abs = join(PLATFORM, rel);
  try { await stat(abs); }
  catch { rows.push({ id: rec.id, state: "ARTIFACT MISSING", detail: rel }); missing++; continue; }

  const actual = createHash("sha256").update(await readFile(abs)).digest("hex");
  if (actual === rec.sha256) {
    rows.push({ id: rec.id, state: "bound", detail: `${rec.result}` });
  } else {
    drift++;
    rows.push({
      id: rec.id, state: "DRIFT",
      detail: `recorded ${String(rec.sha256).slice(0, 12)}… actual ${actual.slice(0, 12)}… (result still "${rec.result}")`,
    });
  }
}

console.log(`\n  EVIDENCE DRIFT — ${files.length} record(s) in evolution/evidence\n  ${"-".repeat(64)}`);
for (const r of rows) {
  const tag = r.state === "bound" ? "  bound " : `  ${r.state}`;
  console.log(`  ${tag.padEnd(20)} ${String(r.id).padEnd(34)} ${r.detail}`);
}
console.log(`  ${"-".repeat(64)}`);
console.log(`  ${rows.filter((r) => r.state === "bound").length} bound, ${drift} drifted, ` +
            `${missing} artifact missing, ${unbound} with no artifact ref`);
if (drift || missing) {
  console.log(`\n  A drifted receipt cannot be edited — records are immutable and delete is`);
  console.log(`  prohibited. Write a superseding record with the current hash and say why.`);
}
console.log();

process.exitCode = drift ? 1 : missing ? 2 : 0;
