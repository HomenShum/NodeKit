import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildRepoMap } from "../src/lib/repo-map.mjs";

const run = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "src", "cli.mjs");

// Run the CLI as a real subprocess. The exit code is the thing a newcomer and CI both react to,
// and calling the function directly would not test it.
async function cli(args, cwd = REPO) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.code ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

// Persona: a senior engineer who has never seen NodeKit, on a fresh machine, told only
// "here is the repo". They open a terminal and try the obvious things.
test("an uninformed senior engineer can orient with `nodekit tour` and the tour separates what it verified from what it merely explained", async () => {
  const { code, out } = await cli(["tour", "--json"]);
  assert.equal(code, 0, "tour must pass on a healthy repository");
  const result = JSON.parse(out);
  assert.equal(result.schemaVersion, "nodekit.tour-result/v1");
  assert.equal(result.passed, true);

  // The honesty property: a step is either CHECKED (and its pass/fail was observed) or it is an
  // explanation with passed:null. An explanation must never be counted as a verified pass.
  for (const step of result.steps) {
    if (step.checked) assert.equal(typeof step.passed, "boolean", `${step.id} is checked so it must report a real boolean`);
    else assert.equal(step.passed, null, `${step.id} is unverified so it must not claim a verdict`);
  }
  assert.equal(result.verifiedCount, result.steps.filter((s) => s.checked).length);
  assert.ok(result.steps.some((s) => !s.checked), "the tour should be explicit that some steps are explanations");

  // It must actually orient: name the five parts and hand over a concrete trace target.
  const architecture = result.steps.find((s) => s.id === "architecture.five-parts");
  assert.equal(architecture.passed, true);
  const trace = result.steps.find((s) => s.id === "trace.one-action");
  assert.match(trace.detail, /advanceStage/);
});

// Adversarial: the tour must not be able to report success for something it did not observe.
// Corrupt the world so a named architecture part is genuinely absent, and require a FAIL.
test("the tour fails closed when a part it names does not exist, and does not report a pass it did not observe", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-tour-fail-"));
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "schemas"), { recursive: true });
  // A repository shaped enough to build a map, but missing the modules the map names.
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  await writeFile(path.join(root, "src", "cli.mjs"), 'if (first === "doctor") {}\n');

  const { code, out } = await cli(["tour", "--repo-root", root, "--json"]);
  assert.equal(code, 1, "a tour with missing parts must exit non-zero");
  const result = JSON.parse(out);
  assert.equal(result.passed, false);
  assert.ok(result.failedCount > 0);

  const architecture = result.steps.find((s) => s.id === "architecture.five-parts");
  assert.equal(architecture.passed, false, "must report the missing parts as a failure, not a pass");
  assert.match(architecture.fix, /stale/, "a failure must name the recovery");
  await rm(root, { recursive: true, force: true });
});

// The F5 friction record: the highest-severity dead end in the cold-start baseline was an error
// that stated a fact and taught nothing. The refusal is correct; it must also teach recovery.
test("running a lifecycle command the repository does not declare names what IS declared and the next step", async () => {
  const { code, out } = await cli(["demo"]);
  assert.equal(code, 1, "the refusal must remain fail-closed");
  assert.match(out, /not declared in nodekit\.yaml/);
  assert.match(out, /This repository declares: check, doctor/, "must name what IS available here");
  assert.match(out, /nodekit tour/, "must offer the orientation next step");
  assert.match(out, /nodekit create/, "must offer the path to a repo that declares demo");
});

// Three separate proposals (App Atlas, NodeAgent Kit, the "Human Journey Harness") each turned out
// to be ~80% already built in this repository under different names. The expensive failure is not
// missing capability, it is rebuilding capability you already have. This guard fails when a second
// subsystem appears that owns a concern one of these already owns.
test("no second subsystem duplicates an existing owner of human-journey concerns", async () => {
  const map = await buildRepoMap(REPO);
  // Each concern must keep exactly ONE owning schema family.
  const owners = {
    "recorded human friction": /^nodekit\.human-study-/,
    "candidate vs baseline judging": /^nodekit\.builder-gym/,
    "fresh participant study": /^nodekit\.fresh-user-/,
    "governed step-by-step flow": /^nodekit\.interaction-flow/,
  };
  for (const [concern, pattern] of Object.entries(owners)) {
    const matches = map.schemas.filter((s) => pattern.test(s));
    assert.ok(matches.length > 0, `${concern} lost its owner — did a rename orphan it?`);
  }
  // The journey work added a contract, a baseline and a copy audit. None of them may be a
  // re-implementation of the four owners above.
  const forbidden = [/journey-friction/, /human-journey-harness/, /friction-record\./, /walkthrough-study/];
  const offenders = map.schemas.filter((s) => forbidden.some((f) => f.test(s)));
  assert.deepEqual(
    offenders,
    [],
    `these schemas duplicate an existing owner; wire the existing one instead: ${offenders.join(", ")}`,
  );
});

// The map is DERIVED. A hand-maintained map rots and then teaches a false shape of the system;
// this proves a new command shows up without anyone editing the map by hand.
test("the repository map is derived from source, so a newly added command appears without hand-editing", async () => {
  const map = await buildRepoMap(REPO);
  assert.equal(map.schemaVersion, "nodekit.repo-map/v1");
  // `tour` was added to the dispatch in this change; a derived map must already know about it.
  assert.ok(map.commands.topLevel.includes("tour"), "derived map must include the newly added tour command");
  // Lifecycle verbs are dispatched via an inclusion list, not `first === "x"`; both spellings must
  // be read, or the map silently under-reports the CLI.
  for (const verb of ["dev", "demo", "check", "proof"]) {
    assert.ok(map.commands.topLevel.includes(verb), `derived map must include lifecycle verb ${verb}`);
  }
  assert.ok(map.counts.schemas > 50 && map.counts.modules > 20);

  // The committed map must not be stale relative to source.
  const committed = JSON.parse(await readFile(path.join(REPO, "repo-map.json"), "utf8"));
  assert.deepEqual(committed, map, "repo-map.json is stale — run `npm run repo:map`");
});
