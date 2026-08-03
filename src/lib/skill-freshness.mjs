import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// `nodekit create` copies the launch, QA and present skills into the generated project's
// .claude/skills and .codex/skills. Those copies are what a coding agent actually reads — the
// platform's originals are never loaded by a consumer.
//
// Which means the skills freeze at create time, and nothing noticed. Measured on a project created
// this morning: platform skill cac380ef, project copy 66bdbbf8, no version marker in the copy, and
// no check anywhere that compares them. Improve the skill and no existing project ever sees it.
//
// That is the same defect as the one this session just fixed one level up — an improvement that
// ships and never reaches its consumer — so leaving it recorded rather than closed would be the
// joke telling itself. Two different questions, and they need different evidence:
//
//   EDITED  the copy differs from what create wrote. Answerable offline from the record, and a
//           local edit is legitimate — projects customise. It must be reported, not failed.
//   SKEWED  the platform has moved on since the copy was taken. Needs a reference. The record
//           carries the NodeKit version the skills came from, which is comparable against the
//           vendored runtime's version without reaching the network.
//
// A missing record is its own answer: skills whose provenance nobody recorded, which is every
// project generated before this existed. That reads as unknown, never as fresh.

export const SKILL_PROVENANCE_FILE = "skill-provenance.json";
export const SKILL_PROVENANCE_SCHEMA_VERSION = "nodekit.skill-provenance/v1";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Digest a skill directory's SKILL.md. Only the instruction file, deliberately: references/ change
 * for reasons that do not alter what the agent is told to do, and a digest that churns is one
 * people learn to ignore.
 */
export async function digestSkill(skillDir) {
  try {
    return sha256(await readFile(path.join(skillDir, "SKILL.md"), "utf8"));
  } catch {
    return null;
  }
}

/** The record `create` writes, so a later check has something to compare against. */
export async function buildSkillProvenance({ sourceRoot, skillNames, nodekitVersion, copiedAt }) {
  const skills = {};
  for (const name of skillNames) {
    const digest = await digestSkill(path.join(sourceRoot, name));
    if (digest) skills[name] = digest;
  }
  return {
    schemaVersion: SKILL_PROVENANCE_SCHEMA_VERSION,
    nodekitVersion,
    copiedAt,
    note: "Digests of SKILL.md as copied. A difference means this project edited its copy; a NodeKit version newer than the one here means the upstream skills have moved on.",
    skills,
  };
}

/**
 * Compare a project's skill copies against the record `create` left.
 *
 * @param projectRoot     the generated project
 * @param installedVersion the NodeKit version currently vendored, or null if unreadable
 */
export async function evaluateSkillFreshness(projectRoot, installedVersion = null) {
  let record = null;
  try {
    record = JSON.parse(await readFile(path.join(projectRoot, ".claude", "skills", SKILL_PROVENANCE_FILE), "utf8"));
  } catch {
    record = null;
  }

  const skillsRoot = path.join(projectRoot, ".claude", "skills");
  let present = [];
  try {
    present = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    present = [];
  }

  // No skills at all is not a freshness problem. Say so plainly rather than reporting a clean pass
  // over nothing, which is how "checked" and "nothing to check" become indistinguishable.
  if (present.length === 0) {
    return { status: "no-skills", edited: [], unrecorded: [], missing: [], versionSkew: null, checked: 0, record: null };
  }

  if (!record) {
    return {
      status: "unrecorded",
      edited: [],
      missing: [],
      unrecorded: present.sort(),
      versionSkew: null,
      checked: present.length,
      record: null,
      detail: `${present.length} skill(s) present with no provenance record; this project predates skill provenance, so whether they match upstream is unknown rather than fine`,
    };
  }

  const edited = [];
  const unrecorded = [];
  const missing = [];
  // The UNION of what is recorded and what is on disk. Iterating only the present directories meant
  // a recorded skill that had been deleted was invisible, and a directory whose SKILL.md could not
  // be read produced a null digest that was neither edited nor unrecorded — so both reported
  // `current`. Codex reproduced both. A skill the agent cannot read is the strongest possible
  // freshness failure, and it was the one state that passed.
  const names = new Set([...present, ...Object.keys(record.skills ?? {})]);
  for (const name of names) {
    const recorded = record.skills?.[name];
    const actual = present.includes(name) ? await digestSkill(path.join(skillsRoot, name)) : null;
    if (actual === null) {
      missing.push(name);           // recorded but deleted, or present with no readable SKILL.md
      continue;
    }
    if (!recorded) unrecorded.push(name);
    else if (actual !== recorded) edited.push(name);
  }

  const versionSkew = installedVersion && record.nodekitVersion && installedVersion !== record.nodekitVersion
    ? { copiedFrom: record.nodekitVersion, installed: installedVersion }
    : null;

  // An unknown installed version leaves the skew question OPEN. Reporting `current` there answers
  // it "no", which is what the test comment claimed the code avoided while the assertion pinned the
  // opposite — a check weakened by its own test.
  const skewUnknown = !installedVersion && record.nodekitVersion;

  const status = versionSkew
    ? "skewed"
    : missing.length > 0
      ? "missing"
      : edited.length > 0 || unrecorded.length > 0
        ? "edited"
        : skewUnknown ? "unknown-version" : "current";
  return {
    status,
    edited: edited.sort(),
    unrecorded: unrecorded.sort(),
    missing: missing.sort(),
    versionSkew,
    checked: names.size,
    record,
  };
}

export function formatSkillFreshness(verdict) {
  switch (verdict.status) {
    case "no-skills":
      return "SKILLS: none projected into this project — nothing to compare.";
    case "unrecorded":
      // The remedy names `nodekit skills sync` and not `nodekit create`, because create refuses a
      // non-empty directory — advising it here would have named the one command that cannot run on
      // the only projects that ever see this message.
      return `SKILLS: ${verdict.detail}. Run \`nodekit skills sync\` to refresh them and record their provenance.`;
    case "skewed":
      return `SKILLS: copied from NodeKit ${verdict.versionSkew.copiedFrom}, but ${verdict.versionSkew.installed} is installed — `
        + "the upstream skills have moved on and this project is still reading the old instructions. "
        + "Run `nodekit skills sync` to take the new ones."
        + (verdict.edited.length > 0 ? ` Also locally edited: ${verdict.edited.join(", ")}.` : "");
    case "missing":
      return `SKILLS: ${verdict.missing.join(", ")} recorded but unreadable or absent — an agent cannot load an instruction file that is not there, `
        + "and a missing skill is a bigger freshness failure than an out-of-date one. Run `nodekit skills sync`.";
    case "unknown-version":
      return `SKILLS: ${verdict.checked} match their recorded digests, but the installed NodeKit version could not be read, `
        + "so whether the upstream skills have moved on is unknown rather than answered no.";
    case "edited":
      return `SKILLS: ${verdict.checked} checked; locally edited: ${[...verdict.edited, ...verdict.unrecorded].join(", ")}. `
        + "Editing a projected skill is legitimate — this is a record, not a fault.";
    default:
      return `SKILLS: ${verdict.checked} projected skill(s) match what NodeKit ${verdict.record.nodekitVersion} wrote.`;
  }
}
