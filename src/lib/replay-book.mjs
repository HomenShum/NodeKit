// PROMPT_BOOK.md and RECREATE.md, generated from a replay packet rather than written.
//
// These are the two documents a person actually opens, and that is exactly why they are the
// dangerous ones. A hand-written RECREATE.md drifts from the packet within a week and then reads
// with more authority than the receipt it contradicts — the packet says PROMPT_REPLAYABLE, the
// markdown says "run these steps to rebuild it", and a reader believes the markdown.
//
// So both are derived, and RECREATE.md leads with the rung that was actually earned instead of a
// step list that implies more. The thread this came from is explicit: do not claim that prompt text
// alone can recreate an application.
//
// PROMPT_BOOK.md prints the original prompt verbatim and never the cleaned one in its place. An
// improved prompt is what you would send next time; it is not what happened.

import { REPRODUCTION_LADDER } from "./replay-packet.mjs";

// What an improvement to a prompt actually did. Free-text "improved wording" is unreviewable; these
// are the kinds a reader can disagree with.
export const IMPROVEMENT_KINDS = Object.freeze([
  "removed-ambiguity",
  "added-invariant",
  "added-scope",
  "added-completion-test",
  "removed-dead-instruction",
  "corrected-false-premise",
]);

function fail(message, code = "REPLAY_BOOK_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * The typed record the thread specified. Each change says what KIND of improvement it was and what
 * prompted it, because "I made the prompt better" is a claim nobody can check.
 */
export function parsePromptImprovement(record) {
  if (!record || typeof record !== "object") fail("a prompt improvement record must be an object");
  if (record.schemaVersion !== "nodekit.prompt-improvement/v1") fail("schemaVersion must be nodekit.prompt-improvement/v1");
  for (const field of ["originalPromptDigest", "improvedPromptDigest"]) {
    if (!/^[0-9a-f]{64}$/.test(record[field] ?? "")) fail(`${field} must be a sha256`);
  }
  // The point of the record is that the improved prompt is a DIFFERENT prompt. Identical digests
  // mean nothing was learned, and recording that as an improvement is the claim being refused.
  if (record.originalPromptDigest === record.improvedPromptDigest) {
    fail("the improved prompt is byte-identical to the original; there is no improvement to record");
  }
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    fail("needs at least one change; an improvement that cannot name what it changed is a rewrite nobody reviewed");
  }
  for (const [i, change] of record.changes.entries()) {
    const at = `changes[${i}]`;
    if (!IMPROVEMENT_KINDS.includes(change?.kind)) fail(`${at} kind must be one of ${IMPROVEMENT_KINDS.join(", ")}`);
    if (!isNonEmptyString(change.detail)) fail(`${at} needs a detail`);
    // Every improvement traces to something that happened in the run, or it is taste.
    if (!isNonEmptyString(change.learnedFrom)) {
      fail(`${at} needs learnedFrom — the correction, failure or finding in the run that taught it`);
    }
  }
  return record;
}

export function renderPromptBook(packet, improvement = null) {
  const { prompts, environment, runId } = packet;
  const lines = [
    `# Prompt book — ${runId}`,
    "",
    "Generated from the replay packet. Do not edit: the original prompt below is the record of what",
    "was actually sent, and correcting it here would erase the only copy.",
    "",
    `- agent: \`${environment.agent}\`  model: \`${environment.model}\``,
    `- deterministic: ${environment.deterministic === true ? "yes" : "no"}`,
    "",
    "## A. Original prompt",
    "",
    "The exact instruction as given. Never corrected, never cleaned.",
    "",
    "```text",
    prompts.original.text,
    "```",
    `sha256: \`${prompts.original.digest}\``,
    "",
    "## B. Resolved execution prompt",
    "",
    "What was actually dispatched after binding scope, repository identity, authority, inputs and",
    "completion tests.",
    "",
    "```text",
    prompts.resolvedExecution.text,
    "```",
    `sha256: \`${prompts.resolvedExecution.digest}\``,
  ];

  if (prompts.recommendedReplay) {
    lines.push(
      "",
      "## C. Recommended replay prompt",
      "",
      "What to send next time. This is **not** what happened — section A is.",
      "",
      "```text",
      prompts.recommendedReplay.text,
      "```",
      `sha256: \`${prompts.recommendedReplay.digest}\``,
    );
    if (improvement) {
      lines.push("", "### What changed, and what taught it", "");
      for (const change of improvement.changes) {
        lines.push(`- **${change.kind}** — ${change.detail}`, `  - learned from: ${change.learnedFrom}`);
      }
    }
  } else {
    lines.push("", "## C. Recommended replay prompt", "", "None recorded. A run that learned nothing should not invent a lesson.");
  }

  const interventions = prompts.humanInterventions ?? [];
  lines.push("", "## Human interventions", "");
  if (interventions.length === 0) {
    lines.push("None recorded.");
  } else {
    lines.push(`A run steered ${interventions.length} time(s) by a human is not reproducible by prompt A alone.`, "");
    for (const entry of interventions) {
      lines.push(`- \`${entry.at}\` — ${entry.instruction}${entry.reason ? ` _(${entry.reason})_` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderRecreate(packet) {
  const { reproduction, baseline, environment, runId } = packet;
  const earnedIndex = REPRODUCTION_LADDER.indexOf(reproduction.levelClaimed);
  const above = REPRODUCTION_LADDER.slice(earnedIndex + 1);

  const lines = [
    `# Recreating ${runId}`,
    "",
    `## What this establishes: \`${reproduction.levelClaimed}\``,
    "",
    "That is the first line on purpose. A step list at the top of this file would imply the",
    "application can be rebuilt from it, and for most packets that is not what was demonstrated.",
    "",
  ];

  if (above.length > 0) {
    lines.push(`**Not established:** ${above.map((l) => `\`${l}\``).join(", ")}.`, "");
  }
  if ((reproduction.notReproduced ?? []).length > 0) {
    lines.push("In the packet's own words:", "");
    for (const limit of reproduction.notReproduced) lines.push(`- ${limit}`);
    lines.push("");
  }

  lines.push(
    "## Starting point",
    "",
    `- baseline commit: \`${baseline.commit}\``,
    `- worktree clean at capture: ${baseline.worktreeClean === true ? "yes" : "no"}`,
    `- agent / model: \`${environment.agent}\` / \`${environment.model}\``,
    "",
    "## Steps",
    "",
    "```bash",
    `git worktree add ../replay-${runId} ${baseline.commit}`,
    `cd ../replay-${runId}`,
    "# send the prompt from PROMPT_BOOK.md section C, or section B to repeat the original dispatch",
    "```",
    "",
    "## What was observed",
    "",
  );

  for (const entry of reproduction.evidence ?? []) {
    lines.push(`- **${entry.level}** — ${entry.observed}`, `  - artifact: \`${entry.artifact}\`${entry.freshWorktree === true ? " (fresh worktree)" : ""}`);
  }

  lines.push(
    "",
    "## The honest caveat",
    "",
    "Prompt text alone does not recreate an application. The reproduction unit is the prompt plus",
    "its context, the repository baseline, the model and its settings, the tool and authority policy,",
    "the runtime topology, the input fixtures, the human interventions, and the proof criteria.",
    "This file records which of those were captured, not a promise that running them returns the",
    "same bytes.",
  );
  return `${lines.join("\n")}\n`;
}
