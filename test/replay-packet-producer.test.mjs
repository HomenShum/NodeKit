// The contract shipped with no producer, so it could only be exercised by a fixture. These tests
// hold the constraint that shapes the module: writing a packet earns PROMPT_REPLAYABLE and nothing
// more, and BUILD_REPLAYABLE has to be earned by actually replaying in a fresh worktree.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { produceReplayPacket, reproduce } from "../src/lib/replay-packet-producer.mjs";
import { evaluateReplayPacket } from "../src/lib/replay-packet.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = (over = {}) => ({
  repoRoot,
  runId: "run-test",
  originalPrompt: "make the phase chart honest about overlapping buckets",
  agent: "claude-code",
  model: "claude-opus-5",
  ...over,
});

test("producing a packet earns exactly one rung, and says what that leaves unshown", async () => {
  const packet = await produceReplayPacket(args());
  assert.equal(packet.reproduction.levelClaimed, "PROMPT_REPLAYABLE");
  assert.match(packet.baseline.commit, /^[0-9a-f]{40}$/);
  assert.ok(packet.reproduction.notReproduced.length > 0, "a packet with no stated limit never considered one");
  assert.match(packet.reproduction.notReproduced.join(" "), /was not re-run/);

  // A producer must never emit something its own evaluator rejects.
  assert.equal(evaluateReplayPacket(packet).passed, true, JSON.stringify(evaluateReplayPacket(packet).faults));
});

test("the original prompt is captured verbatim and digest-bound", async () => {
  const packet = await produceReplayPacket(args({ originalPrompt: "  keep  the  spacing  " }));
  assert.equal(packet.prompts.original.text, "  keep  the  spacing  ", "the exact instruction, not a cleaned one");

  // Tampering after capture is detectable, which is the point of storing the digest.
  const edited = JSON.parse(JSON.stringify(packet));
  edited.prompts.original.text = "quietly reworded";
  assert.ok(evaluateReplayPacket(edited).faults.some((f) => /edited since capture/.test(f)));
});

test("a dirty tree is disclosed, because the baseline commit then under-describes the run", async () => {
  const packet = await produceReplayPacket(args());
  const stated = packet.reproduction.notReproduced.join(" ");
  if (packet.baseline.worktreeClean === false) {
    assert.match(stated, /working tree was dirty/);
  } else {
    assert.doesNotMatch(stated, /working tree was dirty/);
  }
});

test("replaying in a fresh worktree earns BUILD_REPLAYABLE; a failed replay does not", async () => {
  const packet = await produceReplayPacket(args());

  const passed = await reproduce({ repoRoot, packet, command: "node --version" });
  assert.equal(passed.outcome, "pass");
  assert.equal(passed.packet.reproduction.levelClaimed, "BUILD_REPLAYABLE");
  const build = passed.packet.reproduction.evidence.find((e) => e.level === "BUILD_REPLAYABLE");
  assert.equal(build.freshWorktree, true, "a replay outside a fresh worktree replayed nothing");
  assert.equal(passed.verdict.passed, true, JSON.stringify(passed.verdict.faults));

  // A failed replay is an observation, not an exception — and it must not promote the rung.
  const failed = await reproduce({ repoRoot, packet, command: "node --this-flag-does-not-exist" });
  assert.equal(failed.outcome, "fail");
  assert.equal(failed.packet.reproduction.levelClaimed, "PROMPT_REPLAYABLE", "a failed replay must not earn a rung");
  assert.match(failed.packet.reproduction.notReproduced.join(" "), /did not succeed/);
});

test("the producer refuses inputs it cannot honestly record", async () => {
  await assert.rejects(() => produceReplayPacket(args({ runId: "" })), /needs a runId/);
  await assert.rejects(() => produceReplayPacket(args({ originalPrompt: "" })), /exactly as given/);
  await assert.rejects(() => produceReplayPacket(args({ model: "" })), /agent and model/);
});

// A producer nobody can invoke is the same shape as a contract nobody produces.
test("the CLI reproduces, and --command is what earns the rung rather than asserting it", async () => {
  const { spawnSync } = await import("node:child_process");
  const cli = (args) => spawnSync(process.execPath, [path.join(repoRoot, "src/cli.mjs"), "reproduce", ...args], { cwd: repoRoot, encoding: "utf8" });

  const captured = cli(["--prompt", "close the last deferral", "--run", "cli-test", "--json"]);
  assert.equal(captured.status, 0, captured.stderr);
  const packet = JSON.parse(captured.stdout);
  assert.equal(packet.reproduction.levelClaimed, "PROMPT_REPLAYABLE", "capture alone cannot earn more");

  const replayed = cli(["--prompt", "close the last deferral", "--run", "cli-test", "--command", "node --version", "--json"]);
  assert.equal(replayed.status, 0, replayed.stderr);
  assert.equal(JSON.parse(replayed.stdout).reproduction.levelClaimed, "BUILD_REPLAYABLE");
});
