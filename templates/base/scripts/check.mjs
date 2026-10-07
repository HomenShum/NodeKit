import { spawnSync } from "node:child_process";
import path from "node:path";
import { recordFriction } from "./lib/friction.mjs";

const started = Date.now();
const nodekit = path.resolve("node_modules", "@homenshum", "nodekit", "src", "cli.mjs");
// The gates that ship with NodeKit are only worth having if this project runs them. Both are quiet
// by default — no deferred.yaml is an empty ledger, no harness.yaml is nothing declared — so they
// cost nothing until you actually use them, and they cannot be forgotten once you do.
for (const [command, args] of [
  [process.execPath, [nodekit, "compile", "--repo-root", ".", "--check"]],
  [process.execPath, [nodekit, "deferrals", "check", "--repo-root", "."]],
  [process.execPath, [nodekit, "preflight", "--repo-root", "."]],
  // Scoped to this project's own tests. A bare `node --test` walks the whole tree including
  // vendor/nodekit, collects the vendored TypeScript component tests, and fails on a missing convex
  // import — so a freshly generated project failed `npm run check` before it had written a line.
  // The glob rather than a bare directory: `--test test` and `--test ./test/` both resolve the
  // directory itself as a test file here and report a failure that is not one.
  [process.execPath, ["--test", "test/**/*.test.mjs"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    await recordFriction("tests_failed", { command, status: result.status }, Date.now() - started);
    throw new Error(`${command} exited ${result.status}`);
  }
}
await recordFriction("tests_passed", { compileHashCurrent: true }, Date.now() - started);
