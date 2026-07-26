#!/usr/bin/env node
/**
 * recall.mjs — read the second brain before claiming anything about it.
 *
 * WHY THIS EXISTS
 *
 * In one session an agent reported eight things as not existing. Every one of
 * them existed. The data was never missing and no store was wrong. The probe
 * was wrong, and it was wrong the same way every time:
 *
 *     ls -d "D:/VSCode Projects"/*\/node-platform     ->  0 matches, exit 0
 *
 * node-platform sits at depth 2. The glob covered depth 1. It found nothing,
 * said "does not exist", and exited successfully. Nothing in that output tells
 * you the search could not have found the thing.
 *
 * That is the whole defect. Not missing knowledge — an unverified coverage
 * claim, delivered with confidence.
 *
 * THE RULE
 *
 * This tool CANNOT return "absent". There is no code path that prints it.
 * It returns either matches, or "no match, and here is exactly what I read":
 * every root, whether the root existed, how many files were opened, and which
 * roots failed. A caller can then judge whether absence was even provable.
 *
 * An unreadable root is reported as UNREADABLE, never silently skipped. A
 * skipped root is the depth-1 bug wearing a different coat.
 *
 * USAGE
 *
 *   node scripts/recall.mjs "copy as proof surface"
 *   node scripts/recall.mjs humanizer --json
 *   node scripts/recall.mjs nodekit --root "D:/other/place"
 *
 * Exit codes: 0 matches found, 3 no match (NOT an error — a coverage report).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, NOT url.pathname. On the first run this used .pathname, which
// percent-encodes the space in "VSCode Projects". Every engineering root
// resolved to a path that does not exist, and the tool searched only the two
// reasoning roots. It reported "7 roots MISSING, absence is unprovable" rather
// than "not found", which is the entire reason it prints coverage.
const PLATFORM = dirname(dirname(fileURLToPath(import.meta.url)));

const HOME = process.env.USERPROFILE || process.env.HOME || "";

/**
 * The stores that make up the second brain. Both halves are here on purpose.
 * The reasoning half and the engineering half never referenced each other,
 * which is how a decision could live in a thread and a draft event on disk
 * while the work was reported as unstarted.
 */
// The product repositories. Added 2026-07-25 after this tool answered
// `recall.mjs "pptx import"` with "FOUND 1 across 399 files" — one hit in a
// skills doc — while parity-studio/src/domains/nodeslide/slidelang/pptxImport.ts
// was 2,330 lines and wired at NodeSlideStudio.tsx:2721. Every engineering root
// pointed inside node-platform, so the two repositories where the application
// code actually lives were invisible. That is the same defect the comments above
// describe, one level up: not a probe that resolved wrongly, but a probe aimed at
// a place the answer could not be.
//
// This is not hypothetical. It is the mechanical cause of nine "that does not
// exist" claims made in a single session on 2026-07-25, eight of which were wrong.
const WORKSPACE = dirname(dirname(dirname(PLATFORM)));
const PARITY = join(WORKSPACE, "parity-studio");
const SLIDE = join(WORKSPACE, "nodeslide");
// NodeRoom, and this tool's own directory. Added 2026-07-25 after multi-word
// queries returned NO MATCH across 1498 files in 19 roots while the answer sat
// in roots the tool had not been told to look at: node-platform/scripts holds
// the broker and the ease harness, and NodeRoom holds the lane ledgers.
//
// Widening roots took the corpus from 1498 files to 4374.
//
// CORRECTION, same day. This comment first cited `"model routing broker
// cheaper"` and named run-agent-provider-broker.mjs and cost-ledger.json as
// where the answer sat. That does not reproduce: the broker file contains
// "model" and "broker" but neither "routing" nor "cheaper", and no cost-ledger
// or model-matrix exists at the path claimed. The example was asserted, not
// run. Writing an unverified worked example into the tool built to stop
// unverified claims is the defect wearing the fix's clothes, so it is replaced
// with one that reproduces (see the search() docblock below).
//
// The tool behaved correctly throughout — it refused to call a miss a proof of
// absence and said to widen with --root. But a probe that must be widened by
// hand every time is a coverage claim resting on the caller remembering, and
// the whole point of this file is that such claims are the defect.
const NODEROOM = join(dirname(PLATFORM), "noderoom");

const ROOTS = [
  { id: "repositories", path: join(PLATFORM, "repositories.yaml"), half: "engineering" },
  { id: "repo-map", path: join(PLATFORM, "repo-map.json"), half: "engineering" },
  { id: "ownership", path: join(PLATFORM, "ownership.yaml"), half: "engineering" },
  { id: "behavior-index", path: join(PLATFORM, "behavior-index.json"), half: "engineering" },
  { id: "evolution", path: join(PLATFORM, "evolution"), half: "engineering" },
  { id: "architecture", path: join(PLATFORM, "architecture.yaml"), half: "engineering" },
  { id: "nodekit", path: join(PLATFORM, "nodekit.yaml"), half: "engineering" },
  // Source, contracts and gates for the product. Scoped to the directories that
  // hold decisions rather than the whole checkout, so a search stays fast and
  // does not drown in build output.
  { id: "parity-shared", path: join(PARITY, "shared"), half: "engineering" },
  { id: "parity-src", path: join(PARITY, "src"), half: "engineering" },
  { id: "parity-convex", path: join(PARITY, "convex"), half: "engineering" },
  { id: "parity-scripts", path: join(PARITY, "scripts"), half: "engineering" },
  { id: "parity-docs", path: join(PARITY, "docs"), half: "reasoning" },
  { id: "slide-shared", path: join(SLIDE, "shared"), half: "engineering" },
  { id: "slide-src", path: join(SLIDE, "src"), half: "engineering" },
  { id: "slide-convex", path: join(SLIDE, "convex"), half: "engineering" },
  { id: "slide-skills", path: join(SLIDE, "skills"), half: "engineering" },
  { id: "noderoom-src", path: join(NODEROOM, "src"), half: "engineering" },
  { id: "noderoom-convex", path: join(NODEROOM, "convex"), half: "engineering" },
  // The lane ledgers: model-matrix.json and cost-ledger.json live here and are
  // what decide which model route is used and what it costs.
  { id: "noderoom-proofloop", path: join(NODEROOM, ".proofloop"), half: "engineering" },
  // This tool's own neighbours. The broker, the ease harness and the graph
  // extractors were all invisible to a search run from inside this directory.
  { id: "platform-scripts", path: join(PLATFORM, "scripts"), half: "engineering" },
  { id: "memory", path: join(HOME, ".claude", "projects"), half: "reasoning", only: "memory" },
  { id: "skills", path: join(HOME, ".claude", "skills"), half: "reasoning" },
  // The ChatGPT thread ledger was also absent. Decisions reached in a thread and
  // summarised here were unreachable from the tool whose stated purpose is to
  // stop a decision living in a thread while the work is reported unstarted.
  { id: "thread-ledger", path: join(HOME, ".claude", "graph-hop", "ledger"), half: "reasoning" },
];

// The allowlist is itself a coverage claim. An earlier version omitted .py,
// so a root containing only Python reported "0 files" instead of MISSING and
// looked searched. Same defect as the depth-1 glob: a probe that could not
// have found the target, reporting as though it had looked.
const TEXT = new Set([".json", ".yaml", ".yml", ".md", ".mjs", ".ts", ".txt",
                      ".jsonl", ".py", ".js", ".tsx", ".jsx", ".toml", ".sh",
                      ".sql", ".html", ".css", ".rs", ".go", ".ipynb", ".cfg"]);
const SKIP = new Set(["node_modules", ".git", "dist", "outputs", ".next", "coverage"]);
const MAX_BYTES = 2_000_000;

/** Recursive walk with NO depth limit, and it counts what it opened. */
function walk(dir, acc, cov, filter) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    cov.unreadable.push(`${dir} (${e.code})`);
    return;
  }
  cov.dirs++;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) { cov.skippedDirs.push(p); continue; }
      if (filter && !p.includes(filter) && !dir.includes(filter)) {
        // still descend: the filter names a subtree we want, not a prune
      }
      walk(p, acc, cov, filter);
    } else if (e.isFile() && TEXT.has(extname(e.name))) {
      if (filter && !p.includes(filter)) continue;
      acc.push(p);
    }
  }
}

function collect(root) {
  const cov = { id: root.id, half: root.half, path: root.path, exists: false,
                files: 0, dirs: 0, unreadable: [], skippedDirs: [] };
  const files = [];
  if (!existsSync(root.path)) return { cov, files };
  cov.exists = true;
  const st = statSync(root.path);
  if (st.isFile()) files.push(root.path);
  else walk(root.path, files, cov, root.only);
  cov.files = files.length;
  return { cov, files };
}

/**
 * Matching is ALL-TERMS, not whole-phrase.
 *
 * The first version tested `body.includes(entireQuery)`, so a multi-word question
 * only matched a file containing that exact string. The coverage report looked
 * healthy the whole time, because every root really had been read.
 *
 * Worked example, verified by running both versions:
 *
 *     recall.mjs "builder gym promotion"
 *       before   NO MATCH in 1498 files across 19 roots      exit=3
 *       after    FOUND 16 across 4374 files                  exit=0
 *                evolution/artifacts/gym-proven-friction-loop.md, and 15 more
 *
 * Expect 17, not 16, when you run it: platform-scripts is a registered root, so
 * this file is in its own corpus and this comment matches its own query. Cite a
 * count here and you change it. That is not a bug, it is what indexing yourself
 * means, and it is the reason the before/after above is stated as two runs of
 * two different versions rather than as one absolute number.
 *
 * That is the worst version of this defect. A missing root announces itself;
 * a matcher that cannot match reports full coverage and finds nothing, which
 * reads as proof of absence rather than a broken probe.
 *
 * A file now matches when EVERY term appears somewhere in it. Whitespace,
 * underscores and hyphens are also collapsed, so "cost-ledger" finds costLedger.
 */
function search(term) {
  const needle = term.toLowerCase();
  const loose = needle.replace(/[\s_-]+/g, "");
  const terms = needle.split(/\s+/).filter(Boolean);
  const looseTerms = terms.map((t) => t.replace(/[_-]+/g, ""));
  const hasAll = (flat, flatter) =>
    terms.every((t, i) => flat.includes(t) || flatter.includes(looseTerms[i]));
  const hits = [];
  const coverage = [];

  for (const root of ROOTS) {
    const { cov, files } = collect(root);
    coverage.push(cov);
    for (const f of files) {
      let body;
      try {
        if (statSync(f).size > MAX_BYTES) { cov.unreadable.push(`${f} (too large)`); continue; }
        body = readFileSync(f, "utf8");
      } catch (e) { cov.unreadable.push(`${f} (${e.code})`); continue; }

      const flat = body.toLowerCase();
      const flatter = flat.replace(/[\s_-]+/g, "");
      const phrase = flat.includes(needle) || flatter.includes(loose);
      if (!phrase && !hasAll(flat, flatter)) continue;

      // Prefer lines carrying the whole phrase; fall back to lines carrying the
      // rarest term, so a hit on a common word does not decide what is shown.
      const rarest = terms.slice().sort((a, b) =>
        (flat.split(a).length) - (flat.split(b).length))[0] ?? needle;
      const lines = body.split(/\r?\n/);
      const where = [];
      for (const [i, ln] of lines.entries()) {
        const l = ln.toLowerCase();
        const lf = l.replace(/[\s_-]+/g, "");
        if (l.includes(needle) || lf.includes(loose) || l.includes(rarest)) {
          if (where.length < 3) where.push({ n: i + 1, text: ln.trim().slice(0, 150) });
        }
      }
      hits.push({ root: root.id, half: root.half, file: f, where });
    }
  }
  return { hits, coverage };
}

function report(term, { hits, coverage }, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ term, found: hits.length, hits, coverage }, null, 2));
    return hits.length ? 0 : 3;
  }

  console.log(`\n  RECALL  "${term}"`);
  console.log(`  ${"=".repeat(68)}`);

  if (hits.length) {
    const byHalf = { engineering: [], reasoning: [] };
    for (const h of hits) byHalf[h.half].push(h);
    for (const half of ["engineering", "reasoning"]) {
      if (!byHalf[half].length) continue;
      console.log(`\n  ${half.toUpperCase()} HALF  (${byHalf[half].length})`);
      for (const h of byHalf[half]) {
        console.log(`\n    ${relative(PLATFORM, h.file) || h.file}   [${h.root}]`);
        for (const w of h.where) console.log(`      ${String(w.n).padStart(5)}: ${w.text}`);
      }
    }
  }

  // The coverage report prints whether or not anything was found. When
  // something IS found it is still the thing that tells you what was not read.
  console.log(`\n  ${"-".repeat(68)}`);
  console.log(`  COVERAGE - what was actually read`);
  let files = 0, missing = 0, bad = 0, empty = 0;
  for (const c of coverage) {
    files += c.files;
    // A root that exists but yielded nothing is NOT the same as a root that
    // was searched. It usually means the extension allowlist excluded
    // everything in it, which is silent non-coverage.
    const state = !c.exists ? "  MISSING ROOT"
      : c.files === 0 ? "  0 files - NOT COVERED"
      : `${String(c.files).padStart(5)} files`;
    if (!c.exists) missing++;
    else if (c.files === 0) empty++;
    if (c.unreadable.length) bad++;
    console.log(`    ${c.id.padEnd(16)} ${c.half.padEnd(12)} ${state}   ${c.path}`);
    for (const u of c.unreadable.slice(0, 3)) console.log(`      UNREADABLE ${u}`);
    if (c.unreadable.length > 3) console.log(`      UNREADABLE +${c.unreadable.length - 3} more`);
  }

  console.log(`\n  ${"-".repeat(68)}`);
  if (hits.length) {
    console.log(`  FOUND ${hits.length} across ${files} files.`);
    if (missing || empty || bad)
      console.log(`  Coverage was INCOMPLETE - there may be more. ` +
                  `${missing} missing, ${empty} not covered, ${bad} with read errors.`);
  } else {
    console.log(`  NO MATCH in ${files} files across ${coverage.length} roots.`);
    console.log(`  This is NOT a claim that it does not exist.`);
    if (missing) console.log(`  ${missing} root(s) were missing entirely - absence is unprovable.`);
    if (empty) console.log(`  ${empty} root(s) existed but matched no file type - silent non-coverage.`);
    if (bad) console.log(`  ${bad} root(s) had unreadable files - coverage is incomplete.`);
    console.log(`  Widen with --root <path>, or try a shorter term, before concluding.`);
  }
  console.log();
  return hits.length ? 0 : 3;
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--root" && argv[i + 1]) {
    ROOTS.push({ id: `extra:${argv[i + 1]}`, path: argv[i + 1], half: "engineering" });
    argv.splice(i, 2); i--;
  }
}
const term = argv.filter(a => !a.startsWith("--")).join(" ").trim();
if (!term) {
  console.error("usage: node scripts/recall.mjs \"<term>\" [--json] [--root <path>]");
  process.exit(2);
}
process.exit(report(term, search(term), asJson));
