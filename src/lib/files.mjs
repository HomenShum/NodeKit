import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// `yaml` costs 223ms to load, and this file is imported by nearly every module in src/lib, so every
// `nodekit` invocation paid it — including the ones that never read a YAML file. That was the single
// largest component of a 708ms startup against a 137ms bare-node baseline, and it is multiplied by
// the 32 places the test suite spawns the CLI.
//
// createRequire keeps every caller synchronous-or-async exactly as it was; only the cost moves, to
// the first actual YAML read.
const load = createRequire(import.meta.url);
let parseYaml;
const parse = (text, options) => {
  parseYaml ??= load("yaml").parse;
  return parseYaml(text, options);
};

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nodekit",
  ".proofloop",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

export async function readYaml(target) {
  return parse(await readFile(target, "utf8"));
}

export async function listSourceFiles(root) {
  const files = [];
  const resolvedRoot = path.resolve(root);

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name.startsWith(".node-platform")) continue;
      if (
        entry.isDirectory() &&
        path.resolve(directory) === resolvedRoot &&
        entry.name.startsWith(".tmp")
      ) {
        continue;
      }

      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({ absolute, relative: normalizePath(path.relative(root, absolute)) });
      }
    }
  }

  await visit(root);
  return files;
}
