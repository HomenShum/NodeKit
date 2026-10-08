import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildRepoMap } from "../src/lib/repo-map.mjs";
import { renderDashboard, renderDashboardJson } from "../src/lib/dashboard.mjs";
import { loadRegistry } from "../src/lib/registry.mjs";
const run = promisify(execFile);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "src", "cli.mjs");
// Run the CLI as a real subprocess. The exit code is the thing a newcomer and CI both react to,
// and calling the function directly would not test it.
async function cli(args, cwd = REPO) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, out: stdout, stdout };
  } catch (error) {
    return { code: error.code ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}`, stdout: error.stdout ?? "" };
  }
}

// Persona: a senior engineer who has never seen NodeKit, on a fresh machine, told only
// "here is the repo". They open a terminal and try the obvious things.
// @nodekit-verifies orientation.tour#verified-and-explained-steps-separated
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
  // It must hand over the rule that RUNS. A cold reader followed this step to `advanceStage` in
  // src/lib/builder-journey.mjs, which no product path reaches, and lost the time. The step may
  // still mention that module — as a labelled reference implementation, never as the live rule.
  assert.match(trace.detail, /decideProposal/);
  assert.match(trace.detail, /advanceStage[\s\S]*nothing runnable calls it/);
});

// The defect this replaced: the step reported `[ ok ]` after checking only that its cited files
// EXISTED, so it passed whether or not the symbols it sends the reader to were still there.
// Give it files that exist and say nothing, and it must fail.
// @nodekit-verifies inv:tour-verifies-what-it-claims#citation-content-not-existence
test("the trace step fails when its cited files exist but no longer contain the symbols it cites", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-tour-citation-"));
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  await writeFile(path.join(root, "src", "cli.mjs"), 'if (first === "doctor") {}\n');
  await writeFile(path.join(root, "src", "lib", "caseflow.mjs"), "export const nothingHere = 1;\n");
  await writeFile(path.join(root, "src", "lib", "builder-journey.mjs"), "export const nothingHere = 1;\n");
  await writeFile(path.join(root, "schemas", "nodekit.builder-case.v1.schema.json"), "{}\n");

  const { out } = await cli(["tour", "--repo-root", root, "--json"]);
  const trace = JSON.parse(out).steps.find((s) => s.id === "trace.one-action");
  assert.equal(trace.passed, false, "present-but-wrong files must not report a pass");
  assert.match(trace.fix, /caseflow\.mjs no longer contains/, "the failure must name which citation broke");
  await rm(root, { recursive: true, force: true });
});

// Adversarial: the tour must not be able to report success for something it did not observe.
// Corrupt the world so a named architecture part is genuinely absent, and require a FAIL.
// @nodekit-verifies orientation.tour#fails-closed-on-missing-part
// @nodekit-verifies inv:tour-verifies-what-it-claims#fails-closed-on-missing-part
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

// Persona: a maintainer feeds repository snapshots to a coding agent. Static declarations
// and the checker verdict must remain distinct, including when the summary is complete.
function makeResult({ name, passed = true, drift = false, proof = true, noKey = "certified", errors = [], commandPassed = true }) {
  return {
    name,
    passed,
    errors,
    checks: [{ id: "command:build", passed: commandPassed }],
    contractFindings: [{ declared: !drift }],
    sourceFindings: [{ excepted: true }],
    manifest: {
      repository: `HomenShum/${name}`,
      lifecycle: "production",
      support: "active",
      canonicalFor: [],
      noKey: { status: noKey },
      proof: proof ? { receiptSchema: "some.schema/v1" } : {},
    },
  };
}

const registry = {
  root: "/tmp/registry",
  repositoryCatalog: {
    repositories: [
      { name: "alpha", lifecycle: "production", role: "core" },
      { name: "beta", lifecycle: "preview", role: "extension" },
    ],
  },
  ownership: { concepts: {} },
};

const results = [
  makeResult({ name: "alpha" }),
  makeResult({ name: "beta", drift: true, proof: false, noKey: "not-applicable" }),
];

const meta = { generatedAt: "2026-09-12T00:00:00.000Z", registryCommit: "deadbeef" };

test("renderDashboardJson has the declared envelope", () => {
  const json = renderDashboardJson(results, registry, meta);
  assert.equal(json.schemaVersion, "nodekit.dashboard/v1");
  assert.equal(json.generatedAt, meta.generatedAt);
  assert.equal(json.registryCommit, meta.registryCommit);
  assert.equal(json.rows.length, 2);
});

test("renderDashboardJson rows match the markdown table row-for-row", () => {
  const markdown = renderDashboard(results, registry);
  const json = renderDashboardJson(results, registry, meta);
  const tableLines = markdown.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Repo") && !line.includes("---"));

  assert.equal(tableLines.length, json.rows.length);
  for (const [index, row] of json.rows.entries()) {
    const cells = tableLines[index].split("|").map((cell) => cell.trim()).filter(Boolean);
    const [name, lifecycle, role, , noKey, proofSchema, drift, p0] = cells;
    assert.equal(row.repo, name);
    assert.equal(row.lifecycle, lifecycle);
    assert.equal(row.role, role);
    assert.equal(row.noKey, noKey);
    assert.equal(row.proofSchema, proofSchema);
    assert.equal(String(row.drift), drift);
    assert.equal(`${row.p0.met}/${row.p0.total}`, p0);
  }
});

test("nodekit dashboard --json --write is rejected before touching the filesystem", () => {
  const run = spawnSync(process.execPath, [CLI, "dashboard", "--json", "--write"], {
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--json cannot be combined with --write/);
});

test("a maintainer sees validation failures even when all static summary criteria are met", () => {
  const failing = makeResult({
    name: "alpha",
    passed: false,
    errors: ["environment.contractVersion must be nodeplatform.env/v1"],
  });
  const json = renderDashboardJson([results[0], failing], registry, meta);
  assert.equal(json.passed, false);
  assert.equal(json.rows[0].passed, true);
  assert.deepEqual(json.rows[0].errors, []);
  assert.equal(json.rows[1].passed, false);
  assert.deepEqual(json.rows[1].errors, failing.errors);
  assert.equal(json.rows[1].commands, "PASS");
  assert.deepEqual(json.rows[1].p0, { met: 8, total: 8 });
});

test("an agent keeps failed commands and missing checkouts visible across repeated snapshots", () => {
  const commandFailure = makeResult({
    name: "beta",
    passed: false,
    commandPassed: false,
    errors: ["required command build is not runnable"],
  });
  const missing = {
    name: "missing",
    passed: false,
    errors: ["repository checkout is missing"],
    checks: [],
    contractFindings: [],
    sourceFindings: [],
    manifest: null,
  };
  const input = [results[0], commandFailure, missing];
  for (let snapshot = 0; snapshot < 12; snapshot += 1) {
    const json = renderDashboardJson(input, registry, meta);
    assert.equal(json.passed, false);
    assert.deepEqual(json.rows.map((row) => row.passed), [true, false, false]);
    assert.deepEqual(json.rows.map((row) => row.commands), ["PASS", "FAIL", "FAIL"]);
    assert.deepEqual(json.rows[2].p0, { met: 0, total: 8 });
    assert.deepEqual(json.rows[2].errors, missing.errors);
    assert.deepEqual(json.rows[1].errors, commandFailure.errors);
    assert.equal(json.rows.length, input.length);
  }
});

test("a burst of operator scripts receives valid failure JSON and the inspected registry revision", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "nodekit-dashboard-missing-"));
  try {
    const expected = await run("git", ["rev-parse", "HEAD"], {
      cwd: REPO, timeout: 2_000, maxBuffer: 16 * 1024,
    });
    const catalog = (await loadRegistry(REPO)).repositoryCatalog.repositories;
    const tracked = catalog.filter((repository) => repository.commandProfile !== "untracked");
    const platforms = tracked.filter((repository) => repository.commandProfile === "platform");
    const external = tracked.filter((repository) => repository.commandProfile !== "platform");
    const trackedNames = tracked.map((repository) => repository.name);
    const externalNames = external.map((repository) => repository.name);
    assert.deepEqual(platforms.map((repository) => repository.name), ["NodeKit"]);
    assert.equal(tracked.length, 14, "this retained registry has fourteen tracked repositories");
    assert.equal(external.length, 13, "the platform already exists at the registry root");
    const args = ["dashboard", "--registry-root", REPO, "--workspace", workspace, "--json"];
    const burst = await Promise.all(Array.from({ length: 4 }, () => cli(args)));
    for (const response of burst) {
      assert.equal(response.code, 1);
      const json = JSON.parse(response.stdout);
      assert.equal(json.passed, false);
      assert.equal(json.registryCommit, expected.stdout.trim());
      assert.ok(!("generatorCommit" in json));
      assert.deepEqual(json.rows.map((row) => row.repo), trackedNames);
      const platform = json.rows.find((row) => row.repo === platforms[0].name);
      assert.equal(platform.passed, true, platform.errors.join("\n"));
      assert.deepEqual(platform.errors, []);
      assert.equal(platform.commands, "PASS", "platform commands remain statically resolvable");
      const externalRows = json.rows.filter((row) => externalNames.includes(row.repo));
      assert.equal(externalRows.length, external.length);
      assert.ok(externalRows.every((row) => !row.passed && row.errors.some((error) => error.includes("repository checkout is missing"))));
    }
    const first = JSON.parse(burst[0].stdout).rows;
    for (let snapshot = 0; snapshot < 3; snapshot += 1) {
      const response = await cli(args);
      assert.equal(response.code, 1);
      const repeated = JSON.parse(response.stdout);
      assert.equal(repeated.passed, false);
      assert.deepEqual(repeated.rows, first);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a downloaded registry never borrows the containing application's Git revision", async () => {
  const app = await mkdtemp(path.join(os.tmpdir(), "nodekit-dashboard-context-"));
  const downloaded = path.join(app, "downloaded-registry");
  try {
    await mkdir(downloaded);
    for (const file of ["architecture.yaml", "ownership.yaml", "repositories.yaml"]) {
      await writeFile(path.join(downloaded, file), await readFile(path.join(REPO, file)));
    }
    const args = ["dashboard", "--registry-root", downloaded, "--workspace", path.join(app, "missing"), "--json"];
    const unpacked = await cli(args);
    assert.equal(unpacked.code, 1);
    assert.equal(JSON.parse(unpacked.stdout).registryCommit, null);
    const gitOptions = { timeout: 2_000, maxBuffer: 16 * 1024 };
    await run("git", ["init", "--quiet", app], gitOptions);
    await run("git", [
      "-C", app, "-c", "user.name=NodeKit fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "--allow-empty", "--quiet", "-m", "Fixture application",
    ], gitOptions);
    const nested = await cli(args);
    assert.equal(nested.code, 1);
    const json = JSON.parse(nested.stdout);
    assert.equal(json.registryCommit, null);
    assert.equal(json.passed, false);
    assert.ok(json.rows.every((row) => !row.passed && row.errors.length > 0));
  } finally {
    await rm(app, { recursive: true, force: true });
  }
});
