#!/usr/bin/env node
/**
 * Split the test files into a fast lane and a slow lane, and print one lane's files.
 *
 * WHY
 *
 * `node --test test/*.test.mjs` runs ~31 files concurrently on a 32-core machine, so the suite's
 * wall-clock is set by the SINGLE SLOWEST FILE, not by the sum. Measured 2026-07-26:
 *
 *   agent-ease verdict binds all 15 trials ...   236 seconds, in one test
 *   every other test in that file               under 3 seconds
 *   the next 61 files                           finish while it runs
 *
 * So the whole suite waited on one 15-trial acceptance proof. Adding cores would not have helped;
 * splitting the other 61 files would not have helped. Only moving that one file helps.
 *
 * The slow lane is NOT deleted or weakened. It is a real gate and still runs — in CI, in
 * `npm run test:all`, and on demand. What changes is that a developer running `npm test` no longer
 * waits four minutes for an acceptance proof to re-verify a 15-trial matrix.
 *
 * The list is explicit rather than a duration threshold, because a threshold measured on one machine
 * silently reclassifies files on another, and a test quietly moving out of the default lane is how
 * coverage disappears.
 */

const SLOW = [
  // Measured 2026-07-26, after the fixture-encoding fix: 500s (8m20s), 6/6 tests pass.
  //
  // Before that fix the same lane could not finish at all — killed at a 20-minute ceiling with only
  // 4 of its 6 tests reached and one failing. The cause was pngjs decoding 1-bit fixture PNGs
  // through its per-pixel path: 275s of 366s profiled self time, 75.1%. See
  // test/submission-fixtures.mjs browserPng.
  //
  // Still the slowest file by a wide margin, so it stays in this lane. It evaluates a 15-trial
  // protected matrix through a spawned evaluator, several times.
  "test/agent-ease-matrix.test.mjs",
  // Measured 2026-07-28 after the source-bound submission work landed: a clean fast-lane run still
  // exceeded eight minutes, and this was the only surviving test child. The file deliberately
  // creates, packs, hashes, and reopens exact candidates across many adversarial cases; that is
  // acceptance proof, not a tight edit-loop check. CI and test:all retain it unchanged.
  "test/submission-preparation.test.mjs",
  // The next clean run isolated submission-gate as the only surviving child after more than four
  // minutes. It reconstructs and reopens full decisive evidence sets across adversarial cases, so
  // it belongs beside submission-preparation in the unchanged acceptance lane.
  "test/submission-gate.test.mjs",
  // Remote CI measured the all-gates finalizer case at 103s. The file materializes complete
  // externally observed evidence contracts and therefore stays decisive in CI, not in the edit loop.
  "test/submission-evidence-finalizer.test.mjs",
  // Its isolated preview/package/service captures total roughly a minute per file on CI. They are
  // real managed-evidence acceptance checks and remain in test:all without delaying every unit edit.
  "test/managed-evidence-capture.test.mjs",
];

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lane = process.argv[2];
if (!["fast", "slow", "all"].includes(lane)) {
  console.error("usage: test-files.mjs fast|slow|all [--print]");
  process.exit(2);
}

const all = readdirSync(path.join(repoRoot, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `test/${name}`)
  .sort();

// A slow entry that no longer exists means the list has rotted and the file is silently in neither
// lane. Fail rather than print a quietly smaller suite.
const missing = SLOW.filter((entry) => !all.includes(entry));
if (missing.length > 0) {
  console.error(`test-files.mjs: these slow-lane entries do not exist: ${missing.join(", ")}`);
  process.exit(1);
}

const slowSet = new Set(SLOW);
const chosen = lane === "all" ? all
  : lane === "slow" ? all.filter((entry) => slowSet.has(entry))
  : all.filter((entry) => !slowSet.has(entry));

if (process.argv.includes("--print")) {
  process.stdout.write(chosen.join(" "));
  process.exit(0);
}

// Spawn the runner here rather than emitting a list for the shell to expand. `node --test $(...)`
// works in bash and does NOT work in npm's default Windows shell, where the literal string
// "$(node scripts/test-files.mjs fast)" arrives as a filename — node --test then treats the script
// itself as the only test and reports one failure, which looks like a broken test rather than a
// broken script.
const forwarded = process.argv.slice(3).filter((arg) => arg !== "--print");
const result = spawnSync(process.execPath, ["--test", ...forwarded, ...chosen], {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
