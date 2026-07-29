import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOOL = path.join(ROOT, "scripts", "propose-evolution.mjs");
const EVIDENCE_ID = "evd:cli-authority-bypass-and-repair";

function run(id, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    "--id", id,
    "--track", "harness",
    "--category", "evaluation",
    "--challenge", "A release maintainer needs a bounded legal proposal lane",
    "--observed", "The old wrapper could not bind required evidence",
    "--resolution", "Bind canonical evidence and preserve causal references",
    ...extra,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function draftPath(id) {
  return path.join(ROOT, "evolution", "drafts", `evt-${id}.json`);
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("release maintainer can draft an evidence-bound supersession without gaining review authority", async (t) => {
  const id = `proposal-cli-happy-${process.pid}`;
  const target = draftPath(id);
  t.after(() => rm(target, { force: true }));

  const result = run(id, [
    "--evidence", EVIDENCE_ID,
    "--supersedes", "evt:older-release-decision",
    "--predecessor", "evt:prior-observation",
    "--limitation", "Production adoption remains separately verified",
  ]);
  assert.equal(result.status, 0, output(result));

  const event = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(event.evidenceIds, [EVIDENCE_ID]);
  assert.deepEqual(event.supersedesIds, ["evt:older-release-decision"]);
  assert.deepEqual(event.predecessorIds, ["evt:prior-observation"]);
  assert.equal(event.interpretation.status, "agent-proposed");
  assert.equal("reviewedBy" in event.interpretation, false);
});

test("degraded and adversarial proposal inputs fail closed without writing a draft", async () => {
  const cases = [
    {
      id: `proposal-cli-no-evidence-${process.pid}`,
      extra: [],
      code: 2,
      message: /--evidence is required/,
    },
    {
      id: `proposal-cli-missing-evidence-${process.pid}`,
      extra: ["--evidence", "evd:does-not-exist"],
      code: 2,
      message: /does not exist in evolution\/evidence/,
    },
    {
      id: `proposal-cli-unknown-flag-${process.pid}`,
      extra: ["--evidence", EVIDENCE_ID, "--materiality", "proof-requirement"],
      code: 2,
      message: /unknown flag --materiality/,
    },
    {
      id: `proposal-cli-self-review-${process.pid}`,
      extra: ["--evidence", EVIDENCE_ID, "--reviewed-by", "agent"],
      code: 5,
      message: /cannot name reviewedBy=agent/,
    },
    {
      id: `proposal-cli-duplicate-evidence-${process.pid}`,
      extra: ["--evidence", EVIDENCE_ID, "--evidence", EVIDENCE_ID],
      code: 2,
      message: /duplicate --evidence value/,
    },
  ];

  for (const scenario of cases) {
    const result = run(scenario.id, scenario.extra);
    assert.equal(result.status, scenario.code, `${scenario.id}\n${output(result)}`);
    assert.match(output(result), scenario.message);
    await assert.rejects(readFile(draftPath(scenario.id), "utf8"), { code: "ENOENT" });
  }
});

test("sustained repeatable input is bounded before state can accumulate", async () => {
  const id = `proposal-cli-bounded-${process.pid}`;
  const evidenceArgs = Array.from(
    { length: 65 },
    (_, index) => ["--evidence", `evd:bounded-${index}`],
  ).flat();
  const result = run(id, evidenceArgs);
  assert.equal(result.status, 2, output(result));
  assert.match(output(result), /--evidence exceeds the 64-value limit/);
  await assert.rejects(readFile(draftPath(id), "utf8"), { code: "ENOENT" });
});
