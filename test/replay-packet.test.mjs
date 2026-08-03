// The belief this guards against: "we captured every prompt, so the build is reproducible."
// Prompt capture earns exactly one rung. Everything above it has to be shown.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReplayPacket, formatReplayVerdict, promptDigest, REPRODUCTION_LADDER } from "../src/lib/replay-packet.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const SCHEMA = "nodekit.replay-packet.v1.schema.json";
const prompt = (text) => ({ text, digest: promptDigest(text) });

const evidence = (level, freshWorktree = true) => ({
  level,
  observed: `${level} was demonstrated`,
  artifact: `proof/replay/${level.toLowerCase()}.log`,
  freshWorktree,
});

const packet = (overrides = {}) => ({
  schemaVersion: "nodekit.replay-packet/v1",
  runId: "run-clinical-trials-repair",
  baseline: { commit: "0123456789abcdef0123456789abcdef01234567", worktreeClean: true },
  prompts: {
    original: prompt("make the phase chart honest about overlapping buckets"),
    resolvedExecution: prompt("bound: repo=x authority=read-write tests=phase-buckets"),
  },
  environment: { agent: "codex", model: "gpt-5.6-sol", deterministic: false },
  reproduction: {
    levelClaimed: "PROMPT_REPLAYABLE",
    evidence: [evidence("PROMPT_REPLAYABLE")],
    notReproduced: ["No journey was re-run; this establishes only that the instruction exists."],
  },
  ...overrides,
});

test("a packet that captured prompts earns exactly one rung, and says so", async () => {
  const doc = packet();
  assert.deepEqual(await validateSchema(SCHEMA, doc, "replay packet"), []);
  const verdict = evaluateReplayPacket(doc);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.earned, "PROMPT_REPLAYABLE");
  assert.match(formatReplayVerdict(verdict), /earned/);
});

test("a rung cannot stand on a rung nobody tested", () => {
  // The exact failure: prompts captured, behaviour asserted, nothing in between re-run.
  const skipped = packet({
    reproduction: {
      levelClaimed: "BEHAVIOR_REPRODUCED",
      evidence: [evidence("PROMPT_REPLAYABLE"), evidence("BEHAVIOR_REPRODUCED")],
      notReproduced: ["UI was not compared."],
    },
  });
  const verdict = evaluateReplayPacket(skipped);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.earned, "PROMPT_REPLAYABLE", "the honest level is the tallest unbroken run from the bottom");
  assert.ok(verdict.faults.some((f) => /BUILD_REPLAYABLE, which it stands on/.test(f)), verdict.faults.join("; "));

  const complete = packet({
    reproduction: {
      levelClaimed: "BEHAVIOR_REPRODUCED",
      evidence: ["PROMPT_REPLAYABLE", "BUILD_REPLAYABLE", "BEHAVIOR_REPRODUCED"].map((l) => evidence(l)),
      notReproduced: ["UI was not compared."],
    },
  });
  assert.equal(evaluateReplayPacket(complete).passed, true);
});

test("a replay in the directory that already holds the result replayed nothing", () => {
  const inPlace = packet({
    reproduction: {
      levelClaimed: "BUILD_REPLAYABLE",
      evidence: [evidence("PROMPT_REPLAYABLE"), evidence("BUILD_REPLAYABLE", false)],
      notReproduced: ["Behaviour was not checked."],
    },
  });
  assert.ok(
    evaluateReplayPacket(inPlace).faults.some((f) => /fresh worktree/.test(f)),
    "replaying where the artifact already exists proves only that it exists",
  );
});

test("the original prompt is immutable, and the improved one never replaces it", () => {
  const edited = packet();
  edited.prompts.original.text = "quietly reworded after the fact";
  assert.ok(evaluateReplayPacket(edited).faults.some((f) => /edited since capture/.test(f)));

  const lost = packet();
  delete lost.prompts.original;
  assert.ok(evaluateReplayPacket(lost).faults.some((f) => /original prompt is missing/.test(f)));

  const noLesson = packet();
  noLesson.prompts.recommendedReplay = prompt(noLesson.prompts.original.text);
  assert.ok(evaluateReplayPacket(noLesson).faults.some((f) => /no lesson was recorded/.test(f)));
});

test("the schema refuses claims the packet cannot support", async () => {
  // Identical bytes out of a non-deterministic process is luck, not reproduction.
  const bytes = packet({
    environment: { agent: "codex", model: "gpt-5.6-sol", deterministic: false },
    reproduction: {
      levelClaimed: "BYTE_IDENTICAL",
      evidence: REPRODUCTION_LADDER.map((l) => evidence(l)),
      notReproduced: [],
    },
  });
  assert.ok((await validateSchema(SCHEMA, bytes, "replay packet")).length > 0);

  // Anything short of byte-identical must state its limit.
  const silent = packet();
  silent.reproduction.notReproduced = [];
  assert.ok(
    (await validateSchema(SCHEMA, silent, "replay packet")).length > 0,
    "a packet with no stated limit is one whose limit was never considered",
  );
});
