#!/usr/bin/env node
/**
 * tool-placement-gate — enforces the machine-checkable part of the tool operating model.
 *
 * The operating model lives in tools.yaml (source: the owner thread "NodeKit tool inventory
 * and use plan", thread-2026-07-29). This gate checks DECLARATIONS, not runtime usage:
 *
 *   1. Every placement value is inside the closed enum
 *      CORE | CONNECTOR | ADAPTER | APP | REFERENCE | BENCHMARK | DOMAIN.
 *      An unknown placement fails naming the entry.
 *   2. Dependency-free core, made structural: no APP-placed library's npm package may appear
 *      in the platform's own package.json dependencies or devDependencies. APP entries carry
 *      a `packages` list of the npm names they would land under; the scan is over that list.
 *   3. Rung-gated motion libraries (gsap, threejs, lenis, vanta, animejs, motion-framer-motion)
 *      must carry a `constraint` naming the motion-ladder.
 *   4. Every entry has >=1 journeyStage from the closed stage enum, unless it honestly declares
 *      `unresolved: true` with `journeyStages: []`. A tool placed ONLY as DOMAIN and/or
 *      BENCHMARK may not claim the build stage.
 *
 * Reports its denominator on every run (entries read, checks run) — a gate printing only PASS
 * cannot be audited for having measured nothing (docs/VACUOUS_PASS.md).
 *
 * Exit codes:
 *   0  every check passed
 *   1  at least one violation
 *   3  tools.yaml missing — NOT_RUN, and not-run is never a pass
 *
 * Usage: node scripts/tool-placement-gate.mjs [toolsYamlPath] [--package-json <path>]
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PLACEMENT_ENUM = new Set([
  "CORE",
  "CONNECTOR",
  "ADAPTER",
  "APP",
  "REFERENCE",
  "BENCHMARK",
  "DOMAIN",
]);
const STAGE_ENUM = new Set(["decide", "reference", "build", "prove", "launch", "learn"]);
const RUNG_GATED_IDS = new Set([
  "gsap",
  "threejs",
  "lenis",
  "vanta",
  "animejs",
  "motion-framer-motion",
]);

function parseArgs(argv) {
  const args = { toolsPath: path.join(ROOT, "tools.yaml"), packageJsonPath: path.join(ROOT, "package.json") };
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--package-json") {
      const value = rest.shift();
      if (!value) throw new Error("--package-json requires a path");
      args.packageJsonPath = path.resolve(value);
    } else {
      args.toolsPath = path.resolve(arg);
    }
  }
  return args;
}

export function runGate({ toolsPath, packageJsonPath }) {
  if (!existsSync(toolsPath)) {
    return {
      verdict: "NOT_RUN",
      exitCode: 3,
      violations: [],
      entriesRead: 0,
      checksRun: 0,
      reason: `registry not found: ${toolsPath}`,
    };
  }

  const registry = parseYaml(readFileSync(toolsPath, "utf8"));
  const tools = Array.isArray(registry?.tools) ? registry.tools : [];
  if (tools.length === 0) {
    return {
      verdict: "NOT_RUN",
      exitCode: 3,
      violations: [],
      entriesRead: 0,
      checksRun: 0,
      reason: `registry has no tools: ${toolsPath}`,
    };
  }

  const violations = [];
  let checksRun = 0;
  const seenIds = new Set();

  // package.json dependency scan setup (check 2)
  let declaredDeps = new Map();
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    for (const section of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        declaredDeps.set(name, section);
      }
    }
  } else {
    violations.push(`package.json not found at ${packageJsonPath}; dependency-free-core check cannot run`);
  }

  for (const tool of tools) {
    const id = typeof tool?.id === "string" && tool.id.length > 0 ? tool.id : "<missing id>";
    if (seenIds.has(id)) violations.push(`${id}: duplicate id`);
    seenIds.add(id);
    if (id === "<missing id>") violations.push("entry with no id");

    // 1. closed placement enum
    checksRun += 1;
    const placement = Array.isArray(tool?.placement) ? tool.placement : [];
    if (placement.length === 0) {
      violations.push(`${id}: no placement declared`);
    }
    for (const value of placement) {
      if (!PLACEMENT_ENUM.has(value)) {
        violations.push(`${id}: placement "${value}" is outside the closed enum [${[...PLACEMENT_ENUM].join(", ")}]`);
      }
    }

    // 2. dependency-free core — APP-placed packages must not be platform deps
    if (placement.includes("APP")) {
      checksRun += 1;
      for (const pkgName of Array.isArray(tool?.packages) ? tool.packages : []) {
        if (declaredDeps.has(pkgName)) {
          violations.push(
            `${id}: APP-placed package "${pkgName}" appears in the platform's own package.json ${declaredDeps.get(pkgName)} — the core must stay dependency-free of app-layer libraries`,
          );
        }
      }
    }

    // 3. rung-gated motion libraries name the ladder
    if (RUNG_GATED_IDS.has(id)) {
      checksRun += 1;
      const constraint = typeof tool?.constraint === "string" ? tool.constraint : "";
      if (!/motion-ladder/.test(constraint)) {
        violations.push(`${id}: rung-gated motion library must carry a constraint naming the motion-ladder (got: "${constraint}")`);
      }
    }

    // 4. journey stages
    checksRun += 1;
    const stages = Array.isArray(tool?.journeyStages) ? tool.journeyStages : [];
    for (const stage of stages) {
      if (!STAGE_ENUM.has(stage)) {
        violations.push(`${id}: journeyStage "${stage}" is outside the closed enum [${[...STAGE_ENUM].join(", ")}]`);
      }
    }
    if (stages.length === 0 && tool?.unresolved !== true) {
      violations.push(`${id}: no journeyStages and not declared unresolved — declare a stage or "unresolved: true"`);
    }
    if (stages.length > 0 && tool?.unresolved === true) {
      violations.push(`${id}: declares unresolved: true but also claims journeyStages [${stages.join(", ")}] — pick one`);
    }
    const placementSet = new Set(placement);
    const passiveOnly =
      placement.length > 0 && [...placementSet].every((p) => p === "DOMAIN" || p === "BENCHMARK");
    if (passiveOnly && stages.includes("build")) {
      violations.push(`${id}: placed only as ${placement.join("/")} and may not claim the build stage`);
    }
  }

  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    exitCode: violations.length === 0 ? 0 : 1,
    violations,
    entriesRead: tools.length,
    checksRun,
    unresolved: tools.filter((t) => t?.unresolved === true).map((t) => t.id),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runGate(args);
  const denominator = `entries read: ${result.entriesRead}, checks run: ${result.checksRun}`;
  if (result.verdict === "NOT_RUN") {
    console.log(`tool-placement-gate NOT_RUN — ${result.reason} (${denominator})`);
  } else {
    for (const violation of result.violations) console.error(`VIOLATION ${violation}`);
    if (result.unresolved.length > 0) {
      console.log(`unresolved journey stages (declared, not guessed): ${result.unresolved.join(", ")}`);
    }
    console.log(`tool-placement-gate ${result.verdict} — ${denominator}, violations: ${result.violations.length}`);
  }
  process.exit(result.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
