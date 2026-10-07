#!/usr/bin/env node
/**
 * List the modules under src/ that no runnable path reaches.
 *
 * WHY
 *
 * The worst bug this repository has shipped is a module that is correct, tested, documented, and
 * called by nothing — `src/lib/tenancy.py`'s equivalent here was a per-tenant cache credited with
 * closing a measured timing channel, with zero callers. Tests passing is not the same as code
 * running, and a unit test is not evidence of reachability because the test is itself the caller.
 *
 * So reachability is measured from the paths a USER can actually take: the `bin` entry, every
 * subpath in `exports`, and every file named by an `npm run` script. Test files are deliberately
 * NOT roots. A module that only its own test reaches is exactly the finding.
 *
 * Exit code is 0 always. This reports; `docs/codebase/CONCERNS.md` decides what to do about it.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const roots = new Set();
const addRoot = (value) => {
  if (typeof value === "string" && /\.(mjs|cjs|js|ts)$/.test(value)) roots.add(path.resolve(root, value));
};
const walkExports = (value) => {
  if (typeof value === "string") addRoot(value);
  else if (value && typeof value === "object") Object.values(value).forEach(walkExports);
};

Object.values(pkg.bin ?? {}).forEach(addRoot);
walkExports(pkg.exports);
for (const command of Object.values(pkg.scripts ?? {})) {
  for (const match of String(command).matchAll(/(?:src|scripts)\/[\w./-]+\.(?:mjs|cjs|js)/g)) addRoot(match[0]);
}
// src/cli.mjs picks its target inside a ternary, which no static scan of an import specifier sees.
addRoot("src/cli-main.mjs");
addRoot("src/reference-cli.mjs");

const reached = new Set();
const pending = [...roots];
while (pending.length > 0) {
  const file = pending.pop();
  if (reached.has(file) || !existsSync(file)) continue;
  reached.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']+)["']/g)) {
    let target = path.resolve(path.dirname(file), match[1]);
    if (!existsSync(target)) {
      for (const extension of [".mjs", ".cjs", ".js", ".ts", "/index.mjs"]) {
        if (existsSync(target + extension)) { target += extension; break; }
      }
    }
    pending.push(target);
  }
}

const modules = [];
const collect = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(mjs|cjs)$/.test(entry.name)) modules.push(full);
  }
};
collect(path.join(root, "src"));

const unreached = modules.filter((file) => !reached.has(file)).sort();
const relative = (file) => path.relative(root, file).replace(/\\/g, "/");
const lineCount = (file) => readFileSync(file, "utf8").split(/\r?\n/).length;

console.log(`${roots.size} runnable entry points reach ${reached.size} files.`);
console.log(`${modules.length} modules under src/, ${unreached.length} unreached by any of them.\n`);
for (const file of unreached) console.log(`  ${String(lineCount(file)).padStart(5)}  ${relative(file)}`);
if (unreached.length > 0) {
  console.log(`\n  ${unreached.reduce((total, file) => total + lineCount(file), 0)}  total lines`);
  console.log("\nEach of these is reachable only from its own test, if at all.");
  console.log("docs/codebase/CONCERNS.md records the decision for each one.");
}
