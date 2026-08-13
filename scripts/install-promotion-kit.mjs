#!/usr/bin/env node
// Installs the promotion kit into a target repo.
//
//   node scripts/install-promotion-kit.mjs --target <dir> --repo <Name> [--variant reduced]
//   node scripts/install-promotion-kit.mjs --self-check
//
// Refuses to overwrite an existing file: a repo already running the loop has
// loop state in these files, and clobbering it is how an iteration count silently
// resets to zero.

import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "templates", "promotion");

const FILES = [
  ["PRODUCT_GOAL.template.md", "PRODUCT_GOAL.md"],
  ["PRODUCT_JOURNEYS.template.md", "PRODUCT_JOURNEYS.md"],
  ["PROMOTION_LOG.template.md", "PROMOTION_LOG.md"],
  ["SKILLS.md", "SKILLS.md"],
];

export function install(target, repo, { variant = "full", into = "promotion" } = {}) {
  const dir = join(target, into);
  mkdirSync(dir, { recursive: true });
  const written = [];
  const skipped = [];
  for (const [from, to] of FILES) {
    const dest = join(dir, to);
    if (existsSync(dest)) {
      skipped.push(to);
      continue;
    }
    let body = readFileSync(join(SRC, from), "utf8").replaceAll("{{REPO}}", repo);
    if (to === "PRODUCT_GOAL.md" && variant === "reduced") {
      body = body.replace("Gate variant: `full` | `reduced`", "Gate variant: `reduced`");
    }
    writeFileSync(dest, body);
    written.push(to);
  }
  return { dir, written, skipped };
}

function selfCheck() {
  const tmp = mkdtempSync(join(tmpdir(), "promotion-kit-"));
  try {
    const first = install(tmp, "ExampleRepo", { variant: "reduced" });
    assert.equal(first.written.length, FILES.length, "first install writes every file");
    assert.equal(first.skipped.length, 0, "first install skips nothing");

    const goal = readFileSync(join(first.dir, "PRODUCT_GOAL.md"), "utf8");
    assert.ok(goal.includes("ExampleRepo"), "repo name substituted");
    assert.ok(!goal.includes("{{REPO}}"), "no placeholder survives");
    assert.ok(goal.includes("Gate variant: `reduced`"), "reduced variant recorded");
    assert.ok(
      goal.includes("templates/promotion/GATE.md"),
      "goal links the gate rather than restating it",
    );
    assert.ok(!goal.includes("No horizontal overflow at any supported width"), "gate text not copied");

    writeFileSync(join(first.dir, "PROMOTION_LOG.md"), "iteration 7 state");
    const second = install(tmp, "ExampleRepo");
    assert.ok(second.skipped.includes("PROMOTION_LOG.md"), "existing loop state is never clobbered");
    assert.equal(
      readFileSync(join(first.dir, "PROMOTION_LOG.md"), "utf8"),
      "iteration 7 state",
      "existing file left byte-identical",
    );
    console.log("promotion-kit self-check OK");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes("--self-check")) {
  selfCheck();
} else if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("install-promotion-kit.mjs")) {
  const target = flag("target");
  const repo = flag("repo");
  if (!target || !repo) {
    console.error("usage: install-promotion-kit.mjs --target <dir> --repo <Name> [--variant reduced]");
    process.exit(2);
  }
  const { dir, written, skipped } = install(resolve(target), repo, { variant: flag("variant") ?? "full" });
  console.log(`installed into ${dir}`);
  if (written.length) console.log(`  written: ${written.join(", ")}`);
  if (skipped.length) console.log(`  kept (already present): ${skipped.join(", ")}`);
}
