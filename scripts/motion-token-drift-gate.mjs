#!/usr/bin/env node
/**
 * motion-token-drift-gate — refuse to let one motion token name mean two things.
 *
 * The defect this exists for, measured 2026-07-28 (docs/MOTION_TOKEN_DRIFT.md):
 *
 *     nodeslide / parity-studio   --duration-fast: 180ms
 *     noderoom                    --duration-fast: 120ms
 *
 * and noderoom's `--duration-fast` is exactly nodeslide's `--duration-faster`. The same name means
 * two things; the same value has two names. It fails silently in the one operation the design
 * stack encourages — copying a reviewed recipe between repositories — where it runs 33% fast or
 * 50% slow and nothing reports it.
 *
 * A document describing that state does not stop it recurring. This does.
 *
 * ── Design notes, each one paid for ──────────────────────────────────────────────────────────
 *
 * REPORTS ITS DENOMINATOR. Every run prints repositories scanned, files read, and tokens compared.
 * A gate that prints only PASS cannot be audited for vacuity (docs/VACUOUS_PASS.md): a reader who
 * expected three repositories learns immediately if only one was reachable.
 *
 * AN UNREACHABLE REPOSITORY IS NOT_RUN, NEVER PASS. A missing path means the comparison did not
 * happen, and "no repositories, therefore no conflicts, therefore green" is the exact vacuous
 * shape this repository spent a day cataloguing. Fewer than two readable repositories exits 3.
 *
 * VALUES ARE NORMALISED BEFORE COMPARISON, so `.12s` and `120ms` are the same duration and
 * `cubic-bezier(.16,1,.3,1)` matches `cubic-bezier(0.16, 1, 0.3, 1)`. Reporting those as conflicts
 * would produce noise, and a noisy gate gets switched off — which is how gates die.
 *
 * Exit codes:
 *   0  every shared token name resolves to one value everywhere it appears
 *   1  at least one name means different things in different repositories
 *   3  fewer than two repositories were readable — NOT RUN, and not-run is never a pass
 *
 * Usage:
 *   node scripts/motion-token-drift-gate.mjs <repoA> <repoB> [repoC ...] [--json]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const repos = argv.filter((a) => !a.startsWith("--"));

/** Custom properties whose names indicate they carry motion semantics. */
const MOTION_NAME = /^--(?:motion|duration|dur|ease|transition|spring|rd-dur|rd-ease)[a-z0-9-]*$/i;
const DECL = /(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;

/** Normalise so equivalent values compare equal and only real disagreements are reported. */
function normalise(raw) {
  let v = raw.trim().toLowerCase().replace(/\s+/g, "");
  const seconds = v.match(/^(\d*\.?\d+)s$/);
  if (seconds) return `${Math.round(parseFloat(seconds[1]) * 1000)}ms`;
  const ms = v.match(/^(\d*\.?\d+)ms$/);
  if (ms) return `${Math.round(parseFloat(ms[1]))}ms`;
  const bezier = v.match(/^cubic-bezier\(([^)]+)\)$/);
  if (bezier) {
    const nums = bezier[1].split(",").map((n) => String(parseFloat(n)));
    return `cubic-bezier(${nums.join(",")})`;
  }
  return v;
}

function cssFiles(root) {
  const found = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".css")) found.push(abs);
    }
  })(root);
  return found;
}

const scanned = [];
const unreadable = [];
/** name -> normalisedValue -> [{repo, file}] */
const table = new Map();

for (const repo of repos) {
  let ok = false;
  try { ok = statSync(repo).isDirectory(); } catch { ok = false; }
  if (!ok) { unreadable.push(repo); continue; }
  const label = path.basename(path.resolve(repo));
  const files = cssFiles(repo);
  let tokenCount = 0;
  for (const file of files) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const [, name, rawValue] of text.matchAll(DECL)) {
      if (!MOTION_NAME.test(name)) continue;
      if (/var\(/i.test(rawValue)) continue; // an alias to another token is not an independent claim
      tokenCount += 1;
      const value = normalise(rawValue);
      if (!table.has(name)) table.set(name, new Map());
      const byValue = table.get(name);
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push({ repo: label, file: path.relative(repo, file).replaceAll("\\", "/") });
    }
  }
  scanned.push({ repo: label, files: files.length, tokens: tokenCount });
}

// NOT RUN, never pass.
if (scanned.length < 2) {
  const reason = `only ${scanned.length} readable repository(ies) — a drift comparison needs at least 2. NOT RUN.`;
  if (asJson) console.log(JSON.stringify({ ok: false, code: 3, reason, scanned, unreadable }, null, 2));
  else {
    console.error(`NOT_RUN  ${reason}`);
    if (unreadable.length) console.error(`         unreadable: ${unreadable.join(", ")}`);
  }
  process.exit(3);
}

const conflicts = [];
for (const [name, byValue] of [...table].sort()) {
  const distinct = [...byValue.keys()];
  if (distinct.length < 2) continue;
  const reposFor = (value) => [...new Set(byValue.get(value).map((o) => o.repo))];
  // Sites, not just repositories. A conflict INSIDE one repository names the same repo on both
  // rows, which tells the reader nothing about where to look — the file is the actionable unit.
  const sitesFor = (value) => byValue.get(value).map((o) => `${o.repo}:${o.file}`);
  conflicts.push({
    name,
    scope: new Set(distinct.flatMap(reposFor)).size === 1 ? "within-one-repository" : "cross-repository",
    values: distinct.map((v) => ({ value: v, repos: reposFor(v), sites: sitesFor(v) })),
  });
}

const result = {
  ok: conflicts.length === 0,
  code: conflicts.length === 0 ? 0 : 1,
  repositoriesScanned: scanned,
  unreadable,
  distinctTokenNames: table.size,
  conflicts,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.code);
}

// Always print the denominator, pass or fail.
console.log(`${conflicts.length === 0 ? "PASS" : "FAIL"}  motion token drift`);
for (const s of scanned) console.log(`      scanned ${s.repo}: ${s.files} css file(s), ${s.tokens} motion token declaration(s)`);
if (unreadable.length) console.log(`      UNREADABLE (not counted): ${unreadable.join(", ")}`);
console.log(`      ${table.size} distinct motion token name(s) compared`);

if (conflicts.length) {
  console.log("");
  for (const c of conflicts) {
    console.log(`      ${c.name} means ${c.values.length} different things (${c.scope}):`);
    for (const v of c.values) {
      const where = c.scope === "within-one-repository" ? v.sites.join(", ") : v.repos.join(", ");
      console.log(`          ${v.value.padEnd(12)} ${where}`);
    }
  }
  console.log("");
  console.log("      A recipe copied between these repositories changes speed silently.");
  console.log("      Canonical scale and behaviour-preserving aliases: docs/MOTION_TOKEN_DRIFT.md");
}

process.exit(result.code);
