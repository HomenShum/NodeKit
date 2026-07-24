import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { builderGymContext, createBuilderGymLock, sealNodeTraceTrajectory } from "../../src/lib/builder-gym.mjs";
import { initializeHarness } from "../../src/lib/model-intelligence.mjs";
import { createProject } from "../../src/lib/scaffold.mjs";

// Shared Builder Gym laboratory. Extracted so more than one suite can drive a REAL gym comparison
// without a second copy of the setup drifting away from the first. The gym is strict on purpose —
// a pinned lock, change-set evidence bound to that lock, and fixed inputs identical across arms —
// so building a valid pair by hand in each suite would be both slow and a source of divergence.

export const HASH_A = "a".repeat(64);
const fixtureRoot = path.resolve("test", "fixtures", "builder-gym");

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceFixtureHashes(value, replacements) {
  let serialized = JSON.stringify(value);
  for (const [from, to] of Object.entries(replacements)) serialized = serialized.replaceAll(from, to);
  return JSON.parse(serialized);
}

/**
 * Prepare a real gym with a protected lock, a baseline trajectory, and a candidate.
 * @param {import("node:test").TestContext} t
 * @param {{ candidateScores?: object }} [options] override candidate verdict scores to steer the outcome
 */
export async function preparedBuilderGym(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-builder-gym-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await createProject({ git: false, install: false, name: "gym-lab", target: root });
  const initialized = await initializeHarness(root);
  assert.equal(initialized.builder.automaticPromotion, false);

  const taskIndex = JSON.parse(await readFile(path.join(fixtureRoot, "protected-task-index.json"), "utf8"));
  await writeFile(path.join(root, "harness", "tasks", "heldout", "index.json"), `${JSON.stringify(taskIndex, null, 2)}\n`);
  const evidenceContent = "deterministic Builder Gym evidence\n";
  await mkdir(path.join(root, "proof", "builder-gym"), { recursive: true });
  await writeFile(path.join(root, "proof", "builder-gym", "evidence.txt"), evidenceContent);

  const baselineChangeSet = { schemaVersion: "nodekit.builder-change-set/v1", generatedBy: "external-orchestrator", baseRevision: "repository-parent", candidateRevision: "repository-baseline", lockHash: null, changedPaths: [] };
  const baselineChangeSetBytes = `${JSON.stringify(baselineChangeSet, null, 2)}\n`;
  await writeFile(path.join(root, "proof", "builder-gym", "baseline-change-set.json"), baselineChangeSetBytes);

  const context = await builderGymContext(root);
  const raw = JSON.parse(await readFile(path.join(fixtureRoot, "trajectory-template.json"), "utf8"));
  const baseline = sealNodeTraceTrajectory(replaceFixtureHashes(raw, {
    ["b".repeat(64)]: context.protectedTaskSetHash,
    ["e".repeat(64)]: context.evaluator.hash,
    ["f".repeat(64)]: digest(evidenceContent),
    ["8".repeat(64)]: digest(baselineChangeSetBytes),
  }));
  const lock = await createBuilderGymLock(root, baseline);

  const candidateInput = structuredClone(baseline);
  delete candidateInput.trajectoryId;
  delete candidateInput.trajectoryHash;
  candidateInput.arm = "candidate";
  candidateInput.runId = "builder-run-candidate";
  candidateInput.candidateId = "builder-h1-candidate";
  candidateInput.harness.builderHash = HASH_A;
  candidateInput.changedPaths = ["AGENTS.md"];

  const candidateChangeSet = { schemaVersion: "nodekit.builder-change-set/v1", generatedBy: "external-orchestrator", baseRevision: "repository-baseline", candidateRevision: "repository-candidate", lockHash: lock.lockHash, changedPaths: ["AGENTS.md"] };
  const candidateChangeSetBytes = `${JSON.stringify(candidateChangeSet, null, 2)}\n`;
  const candidateChangeSetHash = digest(candidateChangeSetBytes);
  await writeFile(path.join(root, "proof", "builder-gym", "candidate-change-set.json"), candidateChangeSetBytes);
  const { schemaVersion: _schemaVersion, ...candidateChangeSetBinding } = candidateChangeSet;
  candidateInput.changeSet = { ...candidateChangeSetBinding, evidencePath: "proof/builder-gym/candidate-change-set.json", evidenceHash: candidateChangeSetHash };
  candidateInput.evidence.push({ kind: "trace", path: "proof/builder-gym/candidate-change-set.json", sha256: candidateChangeSetHash });

  // A better candidate by default. Callers may steer these to produce a genuinely regressed arm,
  // which is how the refusal path gets tested against a REAL verdict rather than a synthetic one.
  const scores = { task: 0.9, artifact: 0.9, ui: 0.85, efficiency: 0.9, durationMs: 50000, tokensOut: 800, ...(options.candidateScores ?? {}) };
  candidateInput.verdicts.task.score = scores.task;
  candidateInput.verdicts.artifact.score = scores.artifact;
  candidateInput.verdicts.ui.score = scores.ui;
  candidateInput.verdicts.efficiency.score = scores.efficiency;
  candidateInput.verdicts.efficiency.metrics.durationMs = scores.durationMs;
  candidateInput.verdicts.efficiency.metrics.tokensOut = scores.tokensOut;
  candidateInput.proofReceiptId = "nodeproof-builder-candidate";

  const candidate = sealNodeTraceTrajectory(candidateInput);
  return { baseline, candidate, context, lock, root };
}
