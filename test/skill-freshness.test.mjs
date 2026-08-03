import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SKILL_PROVENANCE_FILE,
  buildSkillProvenance,
  evaluateSkillFreshness,
  formatSkillFreshness,
} from "../src/lib/skill-freshness.mjs";

// Measured on a project generated this morning, which is what makes this worth a gate rather than a
// note: the platform's nodekit-launch skill digested cac380ef, the project's copy digested
// 66bdbbf8, the copy carried no version marker, and nothing anywhere compared them. The project was
// four hours old and already reading instructions that had been superseded.
//
// The copies are what a coding agent actually loads. The platform originals are never read by a
// consumer, so an improvement to them reaches nobody until something notices the drift.

async function project({ skills = { "nodekit-launch": "# v1\n" }, record = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "skillfresh-"));
  const skillsRoot = path.join(root, ".claude", "skills");
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(path.join(skillsRoot, name), { recursive: true });
    await writeFile(path.join(skillsRoot, name, "SKILL.md"), body, "utf8");
  }
  await mkdir(skillsRoot, { recursive: true });
  if (record) await writeFile(path.join(skillsRoot, SKILL_PROVENANCE_FILE), JSON.stringify(record), "utf8");
  return root;
}

async function recordFor(root, nodekitVersion = "0.2.1") {
  return buildSkillProvenance({
    sourceRoot: path.join(root, ".claude", "skills"),
    skillNames: ["nodekit-launch"],
    nodekitVersion,
    copiedAt: "2026-08-03T00:00:00.000Z",
  });
}

test("an untouched copy from the installed version reads as current", async () => {
  const root = await project();
  const root2 = await project({ record: await recordFor(root) });
  // Same body in both, so the digest matches.
  const verdict = await evaluateSkillFreshness(root2, "0.2.1");

  assert.equal(verdict.status, "current");
  assert.deepEqual(verdict.edited, []);
  assert.match(formatSkillFreshness(verdict), /match what NodeKit 0\.2\.1 wrote/);
});

test("a newer installed NodeKit is version skew — the project is reading superseded instructions", async () => {
  // The measured case. The skill improved upstream; this project never saw it and had no way to know.
  const root = await project();
  const root2 = await project({ record: await recordFor(root, "0.2.1") });
  const verdict = await evaluateSkillFreshness(root2, "0.3.0");

  assert.equal(verdict.status, "skewed");
  assert.deepEqual(verdict.versionSkew, { copiedFrom: "0.2.1", installed: "0.3.0" });
  assert.match(formatSkillFreshness(verdict), /still reading the old instructions/);
});

test("a locally edited skill is reported, not failed — projects legitimately customise", async () => {
  const source = await project();
  const record = await recordFor(source);
  const root = await project({ skills: { "nodekit-launch": "# v1\nlocal addition\n" }, record });
  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "edited");
  assert.deepEqual(verdict.edited, ["nodekit-launch"]);
  assert.match(formatSkillFreshness(verdict), /this is a record, not a fault/);
});

test("skills with no provenance record read as unknown vintage, never as fresh", async () => {
  // Every project generated before this existed, including the one that surfaced the problem.
  const root = await project();
  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "unrecorded");
  assert.deepEqual(verdict.unrecorded, ["nodekit-launch"]);
  assert.match(formatSkillFreshness(verdict), /unknown rather than fine/);
});

test("no skills at all is distinguishable from a clean check over nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillfresh-empty-"));
  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "no-skills");
  assert.equal(verdict.checked, 0);
  assert.match(formatSkillFreshness(verdict), /nothing to compare/);
});

test("version skew outranks a local edit, because the newer instructions are the bigger fact", async () => {
  const source = await project();
  const record = await recordFor(source, "0.2.1");
  const root = await project({ skills: { "nodekit-launch": "# v1\nedited\n" }, record });
  const verdict = await evaluateSkillFreshness(root, "0.9.0");

  assert.equal(verdict.status, "skewed");
  // The edit is still reported; it is not lost behind the skew.
  assert.deepEqual(verdict.edited, ["nodekit-launch"]);
  assert.match(formatSkillFreshness(verdict), /Also locally edited/);
});

test("an unreadable installed version does not fabricate a skew verdict", async () => {
  const source = await project();
  const root = await project({ record: await recordFor(source) });
  const verdict = await evaluateSkillFreshness(root, null);

  // Not knowing the installed version means the skew question was not answered, and it must not be
  // answered "no" by default.
  assert.equal(verdict.versionSkew, null);
  assert.equal(verdict.status, "current");
});
