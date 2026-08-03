// The contract shipped this morning with no producer, which meant nodekit.replay-packet/v1 could
// only ever be exercised by a test fixture. A schema nothing emits is a validated opinion.
//
// The honest constraint shapes the whole module: a producer that merely WRITES a packet can only
// establish PROMPT_REPLAYABLE, because recording a prompt proves the instruction survived and
// nothing else. Every rung above that has to be earned by doing the thing — so `reproduce` creates
// a real worktree at the baseline commit and runs the recorded command there, and the packet
// records what was observed rather than what was hoped.
//
// This is why the producer cannot simply take a level as an argument. That was the exact defect
// Codex refuted in the trust gate: a level is a conclusion, so it must not also be an input.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { evaluateReplayPacket, promptDigest } from "./replay-packet.mjs";

const run = promisify(execFile);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

function fail(message, code = "REPLAY_PRODUCER_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function git(repoRoot, args) {
  const { stdout } = await run("git", args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Build a packet from a real run. Claims PROMPT_REPLAYABLE and nothing more, and states in
 * notReproduced exactly what that leaves unestablished — because the gap between "we kept the
 * prompts" and "we can rebuild this" is where the belief that a run is reproducible stops being
 * true, and the packet is the only place that gap can be written down.
 */
export async function produceReplayPacket({ repoRoot, runId, originalPrompt, resolvedPrompt, agent, model, deterministic = false, humanInterventions = [], artifactDir = "proof/replay" }) {
  if (!isNonEmptyString(runId)) fail("needs a runId");
  if (!isNonEmptyString(originalPrompt)) fail("needs the original prompt, exactly as given");
  if (!isNonEmptyString(agent) || !isNonEmptyString(model)) fail("needs the agent and model that ran");

  const commit = await git(repoRoot, ["rev-parse", "HEAD"]);
  const status = await git(repoRoot, ["status", "--porcelain"]);
  const worktreeClean = status.length === 0;

  const packet = {
    schemaVersion: "nodekit.replay-packet/v1",
    runId,
    baseline: { commit, worktreeClean },
    prompts: {
      original: { text: originalPrompt, digest: promptDigest(originalPrompt) },
      resolvedExecution: {
        text: resolvedPrompt ?? originalPrompt,
        digest: promptDigest(resolvedPrompt ?? originalPrompt),
      },
      ...(humanInterventions.length > 0 ? { humanInterventions } : {}),
    },
    environment: { agent, model, deterministic },
    reproduction: {
      levelClaimed: "PROMPT_REPLAYABLE",
      evidence: [{
        level: "PROMPT_REPLAYABLE",
        observed: `the original prompt and the resolved execution prompt were captured at ${commit}`,
        artifact: `${artifactDir}/${runId}.json`,
      }],
      notReproduced: [
        "The recorded workflow was not re-run, so nothing here shows the same baseline still produces this result.",
        "No user journey was replayed and no UI state was compared.",
        ...(worktreeClean ? [] : ["The working tree was dirty at capture, so the baseline commit does not fully describe the state this ran against."]),
      ],
    },
  };

  // A producer must not emit a packet its own evaluator would reject.
  const verdict = evaluateReplayPacket(packet);
  if (!verdict.passed) fail(`produced a packet that fails its own evaluator: ${verdict.faults.join("; ")}`, "REPLAY_PRODUCER_SELF_INVALID");
  return packet;
}

/**
 * Earn BUILD_REPLAYABLE by actually replaying. A fresh worktree at the baseline commit is the whole
 * point: replaying in the directory that already holds the result proves the result exists.
 */
export async function reproduce({ repoRoot, packet, command, now = () => new Date().toISOString() }) {
  if (!packet?.baseline?.commit) fail("packet has no baseline commit to replay from");
  if (!isNonEmptyString(command)) fail("needs a command to replay");

  const worktree = await mkdtemp(path.join(os.tmpdir(), `nodekit-reproduce-${packet.runId}-`));
  const startedAt = now();
  let outcome;
  let observed;
  try {
    await git(repoRoot, ["worktree", "add", "--detach", worktree, packet.baseline.commit]);
    const [bin, ...args] = command.split(/\s+/);
    try {
      const { stdout, stderr } = await run(bin, args, { cwd: worktree, maxBuffer: 32 * 1024 * 1024 });
      outcome = "pass";
      observed = `\`${command}\` succeeded in a fresh worktree at ${packet.baseline.commit.slice(0, 12)}`;
      void stdout; void stderr;
    } catch (error) {
      // A failed replay is a real observation, not an error to swallow. It establishes that the
      // baseline does NOT reproduce, which is a finding worth recording.
      outcome = "fail";
      observed = `\`${command}\` failed in a fresh worktree at ${packet.baseline.commit.slice(0, 12)}: ${String(error.message).slice(0, 200)}`;
    }
  } finally {
    await git(repoRoot, ["worktree", "remove", "--force", worktree]).catch(() => {});
    await rm(worktree, { recursive: true, force: true }).catch(() => {});
  }

  const replayed = {
    ...packet,
    reproduction: {
      ...packet.reproduction,
      levelClaimed: outcome === "pass" ? "BUILD_REPLAYABLE" : "PROMPT_REPLAYABLE",
      evidence: [
        ...packet.reproduction.evidence.filter((e) => e.level === "PROMPT_REPLAYABLE"),
        ...(outcome === "pass"
          ? [{ level: "BUILD_REPLAYABLE", observed, artifact: `proof/replay/${packet.runId}.replay.log`, freshWorktree: true }]
          : []),
      ],
      notReproduced: [
        ...(outcome === "pass"
          ? ["No user journey was replayed and no UI state was compared, so behaviour is not established."]
          : [`The replay did not succeed, so the baseline is not shown to rebuild this run: ${observed}`]),
      ],
    },
  };

  const verdict = evaluateReplayPacket(replayed);
  return { packet: replayed, verdict, outcome, observed, startedAt, finishedAt: now() };
}

export async function writeReplayPacket(repoRoot, packet, artifactDir = "proof/replay") {
  const file = path.join(repoRoot, artifactDir, `${packet.runId}.json`);
  await writeFile(file, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return { file, digest: createHash("sha256").update(JSON.stringify(packet)).digest("hex") };
}
