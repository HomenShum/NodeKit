// Capturing every prompt from an agent run feels like capturing the build. It is not. Prompt text
// establishes that the instruction can be replayed and nothing else — not that the same application
// comes back, not that the journeys still pass, not that the UI matches. The gap between "we have
// the prompts" and "we can rebuild this" is where the belief that a run is reproducible quietly
// stops being true.
//
// So reproduction is a ladder and each rung must be earned. JSON Schema can check that a claimed
// level appears in the evidence; it cannot check that every rung BENEATH it does too, and skipping
// a rung is the interesting failure: behaviour said to reproduce on a baseline nobody re-ran.

import { createHash } from "node:crypto";

export const REPLAY_PACKET_SCHEMA = "nodekit.replay-packet.v1.schema.json";

/** Ordered weakest to strongest. A level is only as good as everything under it. */
export const REPRODUCTION_LADDER = Object.freeze([
  "PROMPT_REPLAYABLE",
  "BUILD_REPLAYABLE",
  "BEHAVIOR_REPRODUCED",
  "VISUAL_EQUIVALENT",
  "BYTE_IDENTICAL",
]);

export const promptDigest = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Faults are returned rather than thrown: a packet usually has one honest level below the one it
 * claimed, and the useful answer is "you earned BUILD_REPLAYABLE", not an exception.
 */
export function evaluateReplayPacket(packet) {
  const faults = [];
  const claimed = packet?.reproduction?.levelClaimed;
  const evidence = Array.isArray(packet?.reproduction?.evidence) ? packet.reproduction.evidence : [];
  const claimedIndex = REPRODUCTION_LADDER.indexOf(claimed);
  if (claimedIndex < 0) {
    return { passed: false, claimed, earned: null, faults: [`unknown reproduction level "${claimed}"`] };
  }

  const shown = new Set(evidence.map((entry) => entry.level));
  for (const level of REPRODUCTION_LADDER.slice(0, claimedIndex + 1)) {
    if (!shown.has(level)) {
      faults.push(`claims ${claimed} but shows no evidence for ${level}, which it stands on`);
    }
  }

  // A replay performed where the result already exists has proven that the result exists.
  for (const entry of evidence) {
    const index = REPRODUCTION_LADDER.indexOf(entry.level);
    if (index >= REPRODUCTION_LADDER.indexOf("BUILD_REPLAYABLE") && entry.freshWorktree !== true) {
      faults.push(`${entry.level} evidence was not produced in a fresh worktree, so it did not replay anything`);
    }
  }

  // The prompts are the packet's own subject; a packet that lost the original has rewritten history.
  if (!packet?.prompts?.original?.text) faults.push("the original prompt is missing; the improved one is not a substitute");
  else if (packet.prompts.original.digest !== promptDigest(packet.prompts.original.text)) {
    faults.push("the original prompt does not match its digest, so it has been edited since capture");
  }
  if (packet?.prompts?.recommendedReplay?.text
    && packet.prompts.recommendedReplay.text === packet.prompts.original?.text) {
    faults.push("the recommended replay prompt is identical to the original, so no lesson was recorded");
  }

  // The honest level is the tallest unbroken run from the bottom of the ladder.
  let earned = null;
  for (const level of REPRODUCTION_LADDER) {
    if (!shown.has(level)) break;
    earned = level;
  }

  return { passed: faults.length === 0, claimed, earned, faults };
}

export function formatReplayVerdict(verdict) {
  if (verdict.passed) return `REPLAY ${verdict.claimed}: earned, with evidence for every level beneath it.`;
  return [
    `REPLAY ${verdict.claimed}: NOT earned (highest level actually evidenced: ${verdict.earned ?? "none"}).`,
    ...verdict.faults.map((fault) => `  ${fault}`),
  ].join("\n");
}
