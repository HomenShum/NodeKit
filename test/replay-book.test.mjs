// PROMPT_BOOK.md and RECREATE.md are the two documents a person actually opens, which is why they
// are the dangerous ones: a hand-written RECREATE.md drifts from its packet and then reads with
// more authority than the receipt it contradicts.

import assert from "node:assert/strict";
import test from "node:test";
import { IMPROVEMENT_KINDS, parsePromptImprovement, renderPromptBook, renderRecreate } from "../src/lib/replay-book.mjs";
import { promptDigest } from "../src/lib/replay-packet.mjs";

const prompt = (t) => ({ text: t, digest: promptDigest(t) });
const packet = (over = {}) => ({
  schemaVersion: "nodekit.replay-packet/v1",
  runId: "run-1",
  baseline: { commit: "0123456789abcdef0123456789abcdef01234567", worktreeClean: true },
  prompts: { original: prompt("make it honest"), resolvedExecution: prompt("bound: repo=x tests=y") },
  environment: { agent: "codex", model: "gpt-5.6", deterministic: false },
  reproduction: {
    levelClaimed: "PROMPT_REPLAYABLE",
    evidence: [{ level: "PROMPT_REPLAYABLE", observed: "the prompt and context exist", artifact: "proof/p.json" }],
    notReproduced: ["The workflow was not re-run."],
  },
  ...over,
});

test("RECREATE leads with the rung earned, not with a step list", () => {
  const md = renderRecreate(packet());
  const head = md.split("\n").slice(0, 4).join("\n");
  assert.match(head, /What this establishes: `PROMPT_REPLAYABLE`/);
  // The four rungs above it must be named as NOT established.
  assert.match(md, /\*\*Not established:\*\*.*BUILD_REPLAYABLE.*BYTE_IDENTICAL/);
  assert.match(md, /Prompt text alone does not recreate an application/);
  // Steps appear, but below the caveat — never as the opening claim.
  assert.ok(md.indexOf("What this establishes") < md.indexOf("## Steps"));
});

test("a packet at the top rung names nothing as unestablished", () => {
  const top = renderRecreate(packet({
    environment: { agent: "a", model: "m", deterministic: true },
    reproduction: { levelClaimed: "BYTE_IDENTICAL", evidence: [{ level: "BYTE_IDENTICAL", observed: "identical", artifact: "p" }], notReproduced: [] },
  }));
  assert.doesNotMatch(top, /\*\*Not established:\*\*/);
});

test("the prompt book prints the original verbatim and never substitutes the cleaned one", () => {
  const p = packet({
    prompts: {
      original: prompt("make it honest"),
      resolvedExecution: prompt("bound: repo=x"),
      recommendedReplay: prompt("make the phase chart refuse a pie when buckets overlap"),
    },
  });
  const md = renderPromptBook(p);
  assert.match(md, /## A\. Original prompt[\s\S]*make it honest/);
  assert.match(md, /is \*\*not\*\* what happened/);
  // Original appears before the improved one, and its digest is printed.
  assert.ok(md.indexOf("make it honest") < md.indexOf("refuse a pie"));
  assert.match(md, new RegExp(promptDigest("make it honest")));
});

test("human interventions are surfaced, because a steered run is not prompt-reproducible", () => {
  const steered = renderPromptBook(packet({
    prompts: {
      original: prompt("a"), resolvedExecution: prompt("b"),
      humanInterventions: [{ at: "2026-08-03T01:00:00.000Z", instruction: "stop, wrong file", reason: "scope" }],
    },
  }));
  assert.match(steered, /steered 1 time\(s\) by a human is not reproducible by prompt A alone/);
  assert.match(steered, /stop, wrong file/);
  assert.match(renderPromptBook(packet()), /## Human interventions\n\nNone recorded/);
});

test("an improvement record must name what changed and what taught it", () => {
  const base = {
    schemaVersion: "nodekit.prompt-improvement/v1",
    originalPromptDigest: promptDigest("a"),
    improvedPromptDigest: promptDigest("b"),
    changes: [{ kind: "added-invariant", detail: "buckets may overlap", learnedFrom: "the pie chart double-counted" }],
  };
  assert.doesNotThrow(() => parsePromptImprovement(base));

  // Identical digests: nothing was learned, so there is no improvement to record.
  assert.throws(() => parsePromptImprovement({ ...base, improvedPromptDigest: base.originalPromptDigest }), /byte-identical/);
  assert.throws(() => parsePromptImprovement({ ...base, changes: [] }), /cannot name what it changed/);
  assert.throws(
    () => parsePromptImprovement({ ...base, changes: [{ kind: "added-invariant", detail: "x" }] }),
    /needs learnedFrom/,
    "an improvement with no origin in the run is taste",
  );
  assert.throws(() => parsePromptImprovement({ ...base, changes: [{ kind: "vibes", detail: "x", learnedFrom: "y" }] }), /kind must be one of/);
  assert.equal(IMPROVEMENT_KINDS.length, 6);
});
