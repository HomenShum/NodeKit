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

  // Not knowing the installed version means the skew question was not answered. This used to assert
  // "current", which answers it "no" — the comment claimed one thing and the assertion pinned the
  // opposite, so the test was weakening the check it was meant to protect. Codex caught it.
  assert.equal(verdict.versionSkew, null);
  assert.equal(verdict.status, "unknown-version");
  assert.match(formatSkillFreshness(verdict), /unknown rather than answered no/);
});

test("a recorded skill that has been deleted is caught, not skipped for being absent", async () => {
  // Iterating only the present directories meant a deleted skill was invisible and the pack read
  // current. An agent cannot load an instruction file that is not there.
  const source = await project();
  const record = await recordFor(source);
  const root = await project({ skills: { "nodekit-qa": "# other\n" }, record });
  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "missing");
  assert.deepEqual(verdict.missing, ["nodekit-launch"]);
});

test("a skill directory with no readable SKILL.md is missing, not current", async () => {
  const source = await project();
  const record = await recordFor(source);
  const root = await mkdtemp(path.join(tmpdir(), "skillfresh-empty-dir-"));
  await mkdir(path.join(root, ".claude", "skills", "nodekit-launch"), { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", SKILL_PROVENANCE_FILE), JSON.stringify(record), "utf8");
  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "missing");
  assert.match(formatSkillFreshness(verdict), /cannot load an instruction file that is not there/);
});

// The remedy needs its own check, because the first remedy shipped here was wrong: the message said
// to re-run `nodekit create`, and create refuses a non-empty directory — it named the one command
// that cannot run on the only projects that would ever read the advice. `adopt` was no help either,
// projecting skills with missingOnly so an existing stale copy is skipped precisely because it
// exists. There was no upgrade path at all, and the check would have reported drift forever.
test("skills sync actually refreshes a stale copy and records provenance", async () => {
  const { syncCodingAgentSkills } = await import("../src/lib/scaffold.mjs");
  const root = await mkdtemp(path.join(tmpdir(), "skillsync-"));
  const stale = path.join(root, ".claude", "skills", "nodekit-launch");
  await mkdir(stale, { recursive: true });
  await writeFile(path.join(stale, "SKILL.md"), "# an old copy nobody updated\n", "utf8");

  const result = await syncCodingAgentSkills(root);

  assert.ok(result.changed.includes(".claude/nodekit-launch"), `expected the stale copy to be replaced, got ${JSON.stringify(result)}`);
  // The project had only one skill; the other two are added rather than replaced, and the
  // distinction is reported so a caller can see what was overwritten versus what was new.
  assert.ok(result.added.includes(".claude/nodekit-qa"));

  // And the whole point: the freshness check now reads current against the installed version.
  const verdict = await evaluateSkillFreshness(root, result.version);
  assert.equal(verdict.status, "current");
  assert.deepEqual(verdict.edited, []);
});

// --- second adversarial pass -------------------------------------------------------------------

test("a drifted .codex copy is caught, not just .claude", async () => {
  // scaffold projects skills into BOTH roots and only .claude was read, so a project whose Codex
  // copy had drifted reported current while Codex loaded different instructions.
  const source = await project();
  const record = await recordFor(source);
  const root = await project({ record });
  await mkdir(path.join(root, ".codex", "skills", "nodekit-launch"), { recursive: true });
  await writeFile(path.join(root, ".codex", "skills", "nodekit-launch", "SKILL.md"), "# a different copy\n", "utf8");

  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "edited");
  assert.ok(verdict.edited.some((entry) => entry.includes(".codex")), JSON.stringify(verdict.edited));
});

test("a record whose skills have ALL been deleted is missing, not no-skills", async () => {
  // The early return ran before the recorded/present union, so wiping every skill directory read as
  // nothing to check rather than as everything missing.
  const source = await project();
  const record = await recordFor(source);
  const root = await mkdtemp(path.join(tmpdir(), "skillfresh-wiped-"));
  await mkdir(path.join(root, ".claude", "skills"), { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", SKILL_PROVENANCE_FILE), JSON.stringify(record), "utf8");

  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "missing");
  assert.deepEqual(verdict.missing, ["nodekit-launch"]);
});

test("a missing skill outranks version skew, because absent beats out-of-date", async () => {
  const source = await project();
  const record = await recordFor(source, "0.2.1");
  const root = await mkdtemp(path.join(tmpdir(), "skillfresh-both-"));
  await mkdir(path.join(root, ".claude", "skills"), { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", SKILL_PROVENANCE_FILE), JSON.stringify(record), "utf8");

  const verdict = await evaluateSkillFreshness(root, "0.9.0");

  // Skew is real here too, but reporting it hid the absent skill from the formatted line entirely.
  assert.equal(verdict.status, "missing");
  assert.match(formatSkillFreshness(verdict), /cannot load an instruction file that is not there/);
});

test("a skill changed UPSTREAM without a version bump is caught, not reported current", async () => {
  // The hole that reported a pass on genuinely stale skills. The project's copy matched its own
  // recorded digest (not edited) and the version was unchanged (not skewed), so both existing
  // checks were satisfied while the platform skill had moved on. Measured live: preflight said
  // "3 projected skills match" and `skills sync` then replaced four files.
  const source = await project();
  const record = await recordFor(source);
  const root = await project({ record });
  // The vendored upstream now carries DIFFERENT content — the platform edited its skill.
  const vendored = path.join(root, "vendor", "nodekit", "plugins", "nodekit", "skills", "nodekit-launch");
  await mkdir(vendored, { recursive: true });
  await writeFile(path.join(vendored, "SKILL.md"), "# v2 — the platform moved on\n", "utf8");

  const verdict = await evaluateSkillFreshness(root, "0.2.1");

  assert.equal(verdict.status, "behind-upstream", JSON.stringify(verdict));
  assert.deepEqual(verdict.behind, ["nodekit-launch"]);
  assert.match(formatSkillFreshness(verdict), /changed upstream without a version bump/);
});

test("a vendored copy that matches is still current", async () => {
  const source = await project();
  const record = await recordFor(source);
  const root = await project({ record });
  const vendored = path.join(root, "vendor", "nodekit", "plugins", "nodekit", "skills", "nodekit-launch");
  await mkdir(vendored, { recursive: true });
  // Byte-identical to what the record captured.
  await writeFile(path.join(vendored, "SKILL.md"), "# v1\n", "utf8");

  assert.equal((await evaluateSkillFreshness(root, "0.2.1")).status, "current");
});
