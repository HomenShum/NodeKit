import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionContractRefusal,
  evaluateSessionContract,
  formatSessionContract,
  parseSessionContract,
} from "../src/lib/session-contract.mjs";

// The fixture is the collision as it actually happened. Two sessions were launched on one repository
// with genuinely clean, non-overlapping ownership:
//
//   Session A  evals/**, app/agent.py, tests/test_eval_*.py
//   Session B  app/mcp_server.py, app/cli.py, app/render.py, AGENTS.md
//
// Every file anybody had thought about was assigned. Both sessions were about to add dependencies,
// and pyproject.toml and uv.lock belonged to neither. The plan looked complete because the omission
// was of a file the work was not about.

const REAL_PLAN = () => ({
  schemaVersion: "nodekit.session-contract/v1",
  sessions: [
    { id: "A", owns: ["evals/**", "app/agent.py", "tests/test_eval_*.py"] },
    { id: "B", owns: ["app/mcp_server.py", "app/cli.py", "app/render.py", "AGENTS.md"] },
  ],
  defaults: { outsideOwnedPaths: "read-only" },
  handback: { required: ["filesWritten", "commandsRun", "realOutput", "discoveredFacts", "deferred"] },
});

const REPO = [
  "app/agent.py", "app/cli.py", "app/render.py", "app/mcp_server.py", "app/executor.py",
  "evals/bench.py", "pyproject.toml", "uv.lock", "AGENTS.md", "README.md",
];

test("the plan that looked complete is blocked, and names both lockfiles", () => {
  const verdict = evaluateSessionContract(REAL_PLAN(), REPO);

  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unclassified.sort(), ["pyproject.toml", "uv.lock"]);
  // The consequence is named per file kind: a lockfile drops a dependency, a deferral record drops
  // an entry. One sentence about lockfiles applied to every file is wrong where a reader checks first.
  assert.match(formatSessionContract(verdict), /uv\.lock is a contended manifest/);
  assert.match(formatSessionContract(verdict), /silently dropping one session's dependency/);
});

test("declaring the manifests shared-write with an arbiter clears it", () => {
  const verdict = evaluateSessionContract(
    {
      ...REAL_PLAN(),
      sharedWrite: [
        { path: "pyproject.toml", arbiter: "parent" },
        { path: "uv.lock", arbiter: "regenerated", regenerateFrom: "pyproject.toml" },
      ],
    },
    REPO,
  );

  assert.equal(verdict.passed, true);
  assert.equal(verdict.contendedManifestsPresent, 2);
});

test("a manifest a session genuinely owns needs no shared-write entry", () => {
  const verdict = evaluateSessionContract(
    { ...REAL_PLAN(), sessions: [{ id: "A", owns: ["evals/**", "pyproject.toml", "uv.lock"] }] },
    REPO,
  );

  assert.equal(verdict.passed, true);
});

test("two sessions owning the same path is caught, including through a directory glob", () => {
  const verdict = evaluateSessionContract(
    {
      ...REAL_PLAN(),
      sessions: [
        { id: "A", owns: ["app/**"] },
        { id: "B", owns: ["app/cli.py"] },
      ],
      sharedWrite: [{ path: "pyproject.toml", arbiter: "parent" }, { path: "uv.lock", arbiter: "parent" }],
    },
    REPO,
  );

  assert.equal(verdict.passed, false);
  assert.ok(verdict.faults.some((entry) => /both own/.test(entry)));
});

test("an unstated read-only default is refused; silence reads as permission", () => {
  assert.throws(
    () => parseSessionContract({ ...REAL_PLAN(), defaults: {} }),
    (error) => error instanceof SessionContractRefusal && /without either one noticing/.test(error.message),
  );
});

test("a handback that returns only files is blocked", () => {
  // Three of the day's best findings each cost real time to discover and were unportable.
  const verdict = evaluateSessionContract(
    {
      ...REAL_PLAN(),
      handback: { required: ["filesWritten", "commandsRun"] },
      sharedWrite: [{ path: "pyproject.toml", arbiter: "parent" }, { path: "uv.lock", arbiter: "parent" }],
    },
    REPO,
  );

  assert.equal(verdict.passed, false);
  assert.ok(verdict.faults.some((entry) => /discoveredFacts/.test(entry)));
});

test("a manifest that is not in the repository is not demanded", () => {
  // The gate checks what exists. Demanding a Cargo.toml classification from a Python repo is the
  // kind of noise that gets a gate switched off.
  const verdict = evaluateSessionContract(
    { ...REAL_PLAN(), sharedWrite: [{ path: "pyproject.toml", arbiter: "parent" }, { path: "uv.lock", arbiter: "parent" }] },
    REPO,
  );

  assert.equal(verdict.passed, true);
  assert.equal(verdict.contendedManifestsPresent, 2);
});

test("a shared-write entry with no arbiter is refused; shared without a serialiser is just contended", () => {
  assert.throws(
    () => parseSessionContract({ ...REAL_PLAN(), sharedWrite: [{ path: "uv.lock" }] }),
    (error) => /arbiter must be one of/.test(error.message),
  );
});

test("a contract describing no sessions is refused rather than passing vacuously", () => {
  assert.throws(
    () => parseSessionContract({ ...REAL_PLAN(), sessions: [] }),
    (error) => /constrains nothing/.test(error.message),
  );
});

// --- what the adversarial review reproduced ------------------------------------------------------

test("a one-level glob does not claim a nested manifest", async () => {
  // `app/*` was treated as a recursive prefix, so a session owning a directory's files silently
  // acquired every manifest beneath it and the gate passed. Codex reproduced it through the CLI.
  const verdict = evaluateSessionContract(
    { ...REAL_PLAN(), sessions: [{ id: "A", owns: ["app/*"] }] },
    ["app/cli.py", "app/nested/package.json"],
  );

  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unclassified, ["app/nested/package.json"]);
});

test("a recursive glob still claims what is beneath it", async () => {
  const verdict = evaluateSessionContract(
    { ...REAL_PLAN(), sessions: [{ id: "A", owns: ["app/**"] }] },
    ["app/cli.py", "app/nested/package.json"],
  );

  assert.equal(verdict.passed, true);
});

test("a Windows-shaped path cannot slip past a POSIX-shaped rule", async () => {
  const verdict = evaluateSessionContract(
    { ...REAL_PLAN(), sessions: [{ id: "A", owns: ["app/**"] }] },
    // String.raw so the backslashes are unambiguously backslashes; a plain literal here silently
    // becomes a newline and an escaped p, and the test then measures nothing it claims to.
    [String.raw`app\nested\package.json`],
  );

  // Discovered as a manifest, and covered by the rule — neither step may depend on the separator.
  assert.equal(verdict.contendedManifestsPresent, 1);
  assert.equal(verdict.passed, true);
});

test("an empty file list is insufficient, not a pass — the coverage check did not run", async () => {
  const verdict = evaluateSessionContract(REAL_PLAN(), []);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.insufficient, true);
  assert.match(formatSessionContract(verdict), /an unrun check is not a passed one/);
});
