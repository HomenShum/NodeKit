// The robot's own permissions are part of its contract (SPEC-v9 §B.6/§B.7): weekly, proposal-only, least
// privilege, tooling pinned, no secret, no merge. These assertions read the workflow files, so a later edit
// that widens a scope or adds an unpinned action fails here instead of in production.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { ROOT } from "./model-registry.fixtures.mjs";

const load = async (name) => {
  const text = await readFile(path.join(ROOT, ".github/workflows", name), "utf8");
  return { text, wf: YAML.parse(text) };
};
const steps = (wf) => Object.values(wf.jobs).flatMap((job) => job.steps);

test("the weekly registry refresh is proposal-only: weekly cron, empty top-level permissions, two write scopes on one job, no merge, no secret", async () => {
  const { text, wf } = await load("model-registry-refresh.yml");
  assert.equal(wf.on.schedule.length, 1);
  assert.match(wf.on.schedule[0].cron, /^\d+ \d+ \* \* 1$/, "weekly, Monday");
  assert.ok(wf.on.workflow_dispatch, "can be re-run by hand");
  assert.equal(wf.on.workflow_dispatch.inputs.dry_run.default, true, "a manual run is a dry run unless asked otherwise");
  assert.deepEqual(wf.permissions, {});
  assert.deepEqual(wf.jobs.refresh.permissions, { contents: "write", "pull-requests": "write" });
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  assert.ok(wf.jobs.refresh["timeout-minutes"] <= 15);
  assert.doesNotMatch(text, /secrets\./, "no secret of any kind");
  assert.doesNotMatch(text, /gh pr merge|--auto\b|--merge\b|automerge|auto-merge/i, "a human merges");
  assert.doesNotMatch(text, /ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY/);
  assert.doesNotMatch(text, /pull_request_target/);
  const run = steps(wf).map((s) => s.run ?? "").join("\n");
  for (const command of ["models snapshot", "models validate --stage inputs", "models select --write", "models validate --stage full", "models replay", "models pr-guard"]) assert.ok(run.includes(command), command);
  assert.ok(run.indexOf("models snapshot") < run.indexOf("models validate --stage inputs") && run.indexOf("models validate --stage inputs") < run.indexOf("models select --write") && run.indexOf("models select --write") < run.indexOf("models replay"), "snapshot -> validate -> select -> replay");
  assert.match(run, /push --force-with-lease origin "\$BRANCH"/);
  assert.match(run, /gh pr create .*\|\| gh pr edit/s, "create, else update the one PR");
  const push = steps(wf).find((s) => /force-with-lease/.test(s.run ?? ""));
  assert.match(push.if, /env\.DRY_RUN != 'true'/);
  assert.match(push.if, /suppress != 'true'/, "the closed-PR guard gates the push");
});

test("every checkout drops its credentials, every run script takes inputs through env, and no workflow here installs scripts", async () => {
  for (const name of ["model-registry-refresh.yml", "model-registry-check.yml", "model-bump.yml"]) {
    const { wf } = await load(name);
    for (const step of steps(wf)) {
      if (step.uses?.startsWith("actions/checkout@")) assert.equal(step.with["persist-credentials"], false, `${name} checkout keeps credentials`);
      assert.doesNotMatch(step.run ?? "", /\$\{\{\s*(inputs|github\.head_ref|github\.event)/, `${name}: an expression is interpolated into a shell script (injection): ${step.name ?? step.run}`);
      if (/\bnpm (ci|install)\b/.test(step.run ?? "")) assert.match(step.run, /--ignore-scripts/, `${name}: npm install must not run lifecycle scripts`);
    }
  }
});

test("the registry check (G1) has no write scope, and the allowlist step runs only for the bot branch", async () => {
  const { wf } = await load("model-registry-check.yml");
  assert.deepEqual(wf.permissions, {});
  assert.deepEqual(wf.jobs.g1.permissions, { contents: "read" });
  assert.ok(wf.on.pull_request.paths.includes("models.yaml"));
  const allow = wf.jobs.g1.steps.find((s) => /--changed-files/.test(s.run ?? ""));
  assert.equal(allow.if, "env.HEAD_REF == 'automation/model-registry'");
  assert.match(allow.run, /--base "\$RUNNER_TEMP\/base\.yaml"/);
  // the allowlist says which fields may change; the replay says the change is the one selection makes (a move with no
  // trigger or an edited release date pass the allowlist). It is given the base branch's registry as the input.
  const replayStep = wf.jobs.g1.steps.find((s) => /models replay/.test(s.run ?? ""));
  assert.equal(replayStep.if, "env.HEAD_REF == 'automation/model-registry'");
  assert.match(replayStep.run, /models replay --input-registry "\$RUNNER_TEMP\/base\.yaml"/);
  const names = wf.jobs.g1.steps.map((s) => s.name);
  assert.ok(names.indexOf(allow.name) < names.indexOf(replayStep.name), "base.yaml is written by the allowlist step, which runs first");
});

test("the reusable bump workflow pins its tooling by 40-hex SHA, fetches the registry as data by resolved SHA, and leaves each job's scopes to its caller or narrows them", async () => {
  const { text, wf } = await load("model-bump.yml");
  assert.ok(wf.on.workflow_call, "reusable");
  assert.equal(wf.permissions, undefined, "a called workflow can only narrow its caller's grant; the caller states each job's scopes");
  assert.deepEqual(Object.keys(wf.jobs), ["check", "write"], "consumer code and the write scope are in different jobs (see the next test)");
  assert.deepEqual(wf.jobs.check.permissions, { contents: "read" }, "the job that runs the consumer's gate narrows the caller's grant to read");
  assert.equal(wf.jobs.write.permissions, undefined, "the job that writes takes exactly what the caller granted it");
  for (const job of Object.values(wf.jobs)) {
    const checks = job.steps.find((s) => /platform_sha must be a 40-hex/.test(s.run ?? ""));
    assert.match(checks.run, /\^\[0-9a-f\]\{40\}\$/);
    const platform = job.steps.find((s) => s.with?.path === ".node-platform");
    assert.equal(platform.with.ref, "${{ inputs.platform_sha }}");
    assert.equal(platform.with.repository, "HomenShum/NodeKit");
    const fetchStep = job.steps.find((s) => s.name === "Fetch the registry as data");
    assert.match(fetchStep.run, /raw\.githubusercontent\.com\/HomenShum\/NodeKit\/\$REG_SHA\/models\.yaml/);
    assert.match(fetchStep.run, /--max-filesize/);
    assert.match(fetchStep.run, /--stage inputs --schema-only/, "the data is validated by the pinned tooling's schema");
  }
  const resolve = steps(wf).find((s) => /commits\/\$REGISTRY_REF/.test(s.run ?? ""));
  assert.match(resolve.run, /\^\[0-9a-f\]\{40\}\$/, "the ref is resolved to a commit first, and must be 40-hex");
  assert.doesNotMatch(text, /secrets\.|ANTHROPIC|OPENAI_API|OPENROUTER|GEMINI/, "no provider secret is passed");
  assert.doesNotMatch(text, /gh pr merge|--auto\b|automerge/i);
  const pr = steps(wf).find((s) => /gh pr create/.test(s.run ?? ""));
  assert.match(pr.if, /env\.DRY_RUN != 'true'/);
  assert.match(pr.if, /suppress != 'true'/);
  assert.match(pr.run, /automation\/model-defaults|\$BRANCH/);
});

test("the URGENT issue is found by label and exact title, never by position", async () => {
  const { wf } = await load("model-bump.yml");
  const watch = steps(wf).find((s) => s.name === "Watch");
  assert.match(watch.run, /--label model-defaults --state open/);
  assert.match(watch.run, /select\(\.title == "Model defaults: URGENT"\)/);
  assert.match(watch.run, /gh issue edit "\$N"/);
  assert.match(watch.run, /gh issue create --label model-defaults --title "Model defaults: URGENT"/);
  assert.match(watch.run, /gh api "repos\/HomenShum\/NodeKit\/actions\/workflows\/model-registry-refresh\.yml\/runs\?status=success&per_page=1"/, "liveness comes from the refresh workflow's last success, read with the job's token (was an unauthenticated curl: a shared-IP rate limit read as 'status could not be read')");
  assert.doesNotMatch(watch.run, /curl[^\n]*api\.github\.com/);
});

test("the entry-point routing in src/cli.mjs lists exactly the registry subcommands", async () => {
  const { MODELS_SUBCOMMANDS } = await import("../src/lib/models-cli.mjs");
  const text = await readFile(path.join(ROOT, "src/cli.mjs"), "utf8");
  const routed = JSON.parse(`[${/\[("help"[^\]]*)\]/.exec(text)[1]}]`);
  assert.deepEqual(routed.filter((s) => s !== "help").sort(), [...MODELS_SUBCOMMANDS].sort());
});

// ---- the token and the consumer's code ------------------------------------------------------------------------------
//
// The consumer's install and test commands (the gate) are code this repo does not control. Anything that runs in a job can
// reach everything the job holds: its token, the runner files in $RUNNER_TEMP, $GITHUB_ENV / $GITHUB_PATH (which steer
// every later step of that job) and the global git config of its user (a fresh `git init` still reads it, so a hooksPath
// there runs on the push step's commit). So the gate must not share a job with the write scope.

const usesGithub = (run) => /\bgh (api|pr|issue|label)\b|\bnet (fetch|push)\b|\bGH_TOKEN\b/.test(run ?? "");

test("GH_TOKEN is an env on the steps that talk to GitHub and nowhere else, in every model workflow", async () => {
  for (const name of ["model-bump.yml", "model-registry-refresh.yml"]) {
    const { wf } = await load(name);
    assert.equal(wf.env, undefined, name);
    for (const [jobId, job] of Object.entries(wf.jobs)) {
      assert.equal(job.env?.GH_TOKEN, undefined, `${name}/${jobId}: a job-level GH_TOKEN puts the token in the environment of every step, including \`npm ci\` and \`git commit\``);
      for (const step of job.steps) {
        const hasToken = step.env?.GH_TOKEN !== undefined;
        if (hasToken) assert.equal(step.env.GH_TOKEN, "${{ github.token }}", `${name}/${jobId}/${step.name}: only the job's own token`);
        if (usesGithub(step.run)) assert.ok(hasToken, `${name}/${jobId}/${step.name}: calls GitHub without its own GH_TOKEN`);
        else assert.ok(!hasToken, `${name}/${jobId}/${step.name}: has a token it does not use`);
      }
    }
  }
  const registryCheck = await load("model-registry-check.yml");
  assert.doesNotMatch(registryCheck.text, /github\.token|GH_TOKEN|secrets\./, "the registry check holds no token at all");
});

test("the consumer's code and the write token never share a job: the gate is the last step of a read-only job, and the job that writes runs none of it", async () => {
  const { wf } = await load("model-bump.yml");
  const { check, write } = wf.jobs;
  assert.deepEqual(check.permissions, { contents: "read" });
  // what executes a string read from models.config.json, or any npm other than the pinned tooling's own install
  const runsConsumer = (s) => /\bbash -ec\b/.test(s.run ?? "") || (/\bnpm\b/.test(s.run ?? "") && !/\bnpm ci --prefix \.node-platform --ignore-scripts\b/.test(s.run ?? ""));
  const gates = check.steps.filter(runsConsumer);
  assert.equal(gates.length, 1, "exactly one step runs consumer commands");
  assert.equal(check.steps.at(-1), gates[0], "and it is the LAST step of its job: whatever it writes to $GITHUB_ENV / $GITHUB_PATH or the runner files steers nothing after it");
  assert.deepEqual(write.steps.filter(runsConsumer).map((s) => s.name), [], "the job with the write scope executes nothing the consumer supplied");
  // the gate holds no token, under any name (a rename of GH_TOKEN would slip past a test that looks for that one name)
  assert.doesNotMatch(JSON.stringify(gates[0]), /github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN|ACTIONS_/i);
  assert.doesNotMatch(JSON.stringify(check.env ?? {}), /github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN/i);
  assert.deepEqual(check.steps.filter((s) => s.env?.GH_TOKEN !== undefined).map((s) => s.name), ["Resolve the registry commit (bump)"], "the only token in the read-only job resolves a public commit, before the gate, and is read-only");
  // every output of the read-only job is written by a step that ended before the gate began: the runner records a step's
  // outputs when it ends, so nothing the gate does can rewrite them
  for (const [name, expr] of Object.entries(check.outputs)) {
    const id = /^\$\{\{ steps\.([\w-]+)\.outputs\.\w+ \}\}$/.exec(expr)?.[1];
    const at = check.steps.findIndex((s) => s.id === id);
    assert.ok(at >= 0 && at < check.steps.length - 1, `output ${name} must come from a step before the gate`);
  }
  assert.deepEqual(Object.keys(check.outputs).sort(), ["changed", "lock_sha256", "reg_sha"]);
  // the write job runs after a green gate only, takes the registry commit from the read-only job, and does not read anything
  // staged on the gate's runner
  assert.match(write.if, /needs\.check\.result == 'success'/);
  assert.match(write.if, /needs\.check\.outputs\.changed == 'true'/);
  assert.doesNotMatch(JSON.stringify(write), /proposal\/lock|RUNNER_TEMP\/proposal/);
  const names = write.steps.map((s) => s.name);
  const at = (prefix) => names.findIndex((n) => n?.startsWith(prefix));
  assert.ok(at("Recompute the lock") > 0 && at("Recompute the lock") < at("Closed-PR guard") && at("Closed-PR guard") < at("Commit the proposal") && at("Commit the proposal") < at("Open or update the proposal PR"));
  for (const gated of ["Commit the proposal", "Open or update the proposal PR"]) {
    const step = write.steps[at(gated)];
    assert.match(step.if, /suppress != 'true'/, "a suppressed proposal pushes nothing");
    assert.match(step.if, /env\.DRY_RUN != 'true'/);
  }
  assert.equal(write.steps[at("Commit the proposal")].env?.GH_TOKEN, undefined, "the commit (and any hook it runs) has no token");
});

test("lint mode compares the lock with the registry at the commit the lock pins, so rule (a) can fail on a pull request", async () => {
  const { wf } = await load("model-bump.yml");
  const resolve = steps(wf).find((s) => s.name?.startsWith("Resolve the registry commit (lint"));
  assert.equal(resolve.if, "env.MODE == 'lint'");
  assert.match(resolve.run, /registryRef/);
  assert.match(resolve.run, /\^\[0-9a-f\]\{40\}\$/, "a lock without a 40-hex registryRef fails closed");
  assert.ok(!resolve.env?.GH_TOKEN, "lint needs no token");
  const fetchStep = steps(wf).find((s) => s.name === "Fetch the registry as data");
  assert.equal(fetchStep.if, undefined, "every mode fetches the registry");
  const lint = steps(wf).find((s) => s.if === "env.MODE == 'lint'" && /models lint/.test(s.run ?? ""));
  assert.match(lint.run, /--registry \.model-registry\/models\.yaml/, "was `models lint --repo-root .` alone: '(a) skipped' on every pull request");
  assert.ok(steps(wf).indexOf(fetchStep) < steps(wf).indexOf(lint));
});

test("watch judges frozen ids on the public catalogs fetched now, only when the lock has frozen ids, and fails the run when they cannot be fetched", async () => {
  const { wf, text } = await load("model-bump.yml");
  const step = wf.jobs.write.steps.find((s) => s.name?.startsWith("Fetch the public catalogs live"));
  assert.equal(step.if, "env.MODE == 'watch'");
  assert.match(step.run, /frozen\|\|\[\]\)\.length/);
  assert.match(step.run, /models snapshot --out \.model-registry\/live --registry \.model-registry\/models\.yaml/);
  assert.doesNotMatch(step.run, /\|\| true|2>\/dev\/null/, "a fetch or structure failure is not swallowed: the run goes red rather than reporting a frozen id as safe");
  const watch = wf.jobs.write.steps.find((s) => s.name === "Watch");
  assert.match(watch.run, /--snapshots \.model-registry\/live/);
  assert.doesNotMatch(text, /snapshots\/latest\/(anthropic|openai|google|openrouter)/, "main's committed pages (weeks behind the vendor's) are not what a frozen id is judged on");
});

// ---- the write job, executed ---------------------------------------------------------------------------------------

const bash = spawnSync("bash", ["-c", "command -v base64 git sha256sum node"], { encoding: "utf8" });
const skipBash = bash.status !== 0 && "bash, git, base64, sha256sum and node are required";
const posix = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);
const fwd = (p) => p.replace(/\\/g, "/");

// A consumer workspace as the bump job sees it: its config, and the registry fetched as data beside it.
async function consumerWorkspace(lockPath = "models.lock.json") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "bump-ws-"));
  await mkdir(path.join(tmp, ".model-registry"), { recursive: true });
  await mkdir(path.join(tmp, "rt"), { recursive: true });
  await writeFile(path.join(tmp, "models.config.json"), JSON.stringify({ contractVersion: "nodeplatform.model-defaults/v1", lock: lockPath, roles: { reasoner: { line: "anthropic.haiku", transport: "anthropic" } }, frozen: [], exclude: [], gate: { check: "true" } }));
  await cp(path.join(ROOT, "models.yaml"), path.join(tmp, ".model-registry/models.yaml"));
  await cp(path.join(ROOT, "models/snapshots/latest/index.json"), path.join(tmp, ".model-registry/index.json"));
  return tmp;
}
const stepEnv = (tmp, extra = {}) => ({ ...process.env, NODEKIT: `${fwd(ROOT)}/src/cli.mjs`, REG_SHA: "c".repeat(40), RUNNER_TEMP: fwd(path.join(tmp, "rt")), GITHUB_OUTPUT: fwd(path.join(tmp, "out.txt")), ...extra });
const runStep = (tmp, step, extra) => spawnSync("bash", ["-ec", step.run], { cwd: tmp, encoding: "utf8", env: stepEnv(tmp, extra) });

test("the write job recomputes the lock itself and pushes nothing unless it is the one the gate ran on; the read-only job's hash and the write job's agree", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const sync = wf.jobs.check.steps.find((s) => s.id === "sync");
  const hash = wf.jobs.check.steps.find((s) => s.id === "lockhash");
  const recompute = wf.jobs.write.steps.find((s) => s.name?.startsWith("Recompute the lock"));
  const dirs = [];
  try {
    // the read-only job: sync, then hash the proposal BEFORE any consumer code runs
    const a = await consumerWorkspace();
    dirs.push(a);
    let r = runStep(a, sync, { GITHUB_OUTPUT: fwd(path.join(a, "sync-out.txt")) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(await readFile(path.join(a, "sync-out.txt"), "utf8"), /changed=true/);
    r = runStep(a, hash, { GITHUB_OUTPUT: fwd(path.join(a, "hash-out.txt")) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const checked = /lock_sha256=([0-9a-f]{64})/.exec(await readFile(path.join(a, "hash-out.txt"), "utf8"))[1];
    assert.equal(checked, createHash("sha256").update(await readFile(path.join(a, "models.lock.json"))).digest("hex"));

    // the write job, in its own fresh workspace: the same lock, so it goes on...
    const b = await consumerWorkspace();
    dirs.push(b);
    r = runStep(b, recompute, { CHECKED_LOCK_SHA256: checked });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = await readFile(path.join(b, "out.txt"), "utf8");
    assert.match(out, /lockpath=models\.lock\.json/);
    assert.match(out, /decisionSetSha256=[0-9a-f]{64}/);
    assert.equal(await readFile(path.join(b, "models.lock.json"), "utf8"), await readFile(path.join(a, "models.lock.json"), "utf8"));

    // ...a lock that is not the one the gate ran on stops it, before any commit or push is possible...
    const c = await consumerWorkspace();
    dirs.push(c);
    r = runStep(c, recompute, { CHECKED_LOCK_SHA256: "0".repeat(64) });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /is not the one the gate ran on/);
    assert.ok(!/lockpath=/.test(await readFile(path.join(c, "out.txt"), "utf8")), "the step that hands the lock path to the commit step never ran");

    // ...and a workspace holding some other lock changes nothing, because what is pushed is the recomputed one
    const d = await consumerWorkspace();
    dirs.push(d);
    await writeFile(path.join(d, "models.lock.json"), '{"tampered":true}\n');
    r = runStep(d, recompute, { CHECKED_LOCK_SHA256: checked });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(await readFile(path.join(d, "models.lock.json"), "utf8"), await readFile(path.join(a, "models.lock.json"), "utf8"));
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
});

test("the write job's bump run uses the registry commit the gate ran on, never one the ref points to by then; watch resolves the ref now", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const resolve = wf.jobs.write.steps.find((s) => s.name === "Resolve the registry commit");
  const tmp = await consumerWorkspace();
  try {
    await mkdir(path.join(tmp, "bin"), { recursive: true });
    // a `gh` that says the ref now points elsewhere, and notes that it was asked
    await writeFile(path.join(tmp, "bin", "gh"), `#!/bin/sh
echo asked >> "${posix(tmp)}/gh.log"
printf '%s' "${"d".repeat(40)}"
`);
    spawnSync("bash", ["-c", "chmod +x bin/gh"], { cwd: tmp });
    const run = async (extra) => {
      await rm(path.join(tmp, "env.txt"), { force: true });
      await rm(path.join(tmp, "gh.log"), { force: true });
      const r = runStep(tmp, resolve, { PATH: `${posix(path.join(tmp, "bin"))}:${process.env.PATH}`, GITHUB_ENV: fwd(path.join(tmp, "env.txt")), REGISTRY_REF: "main", GH_TOKEN: "t", ...extra });
      const env = await readFile(path.join(tmp, "env.txt"), "utf8").catch(() => "");
      const asked = await readFile(path.join(tmp, "gh.log"), "utf8").then(() => true, () => false);
      return { status: r.status, env, asked };
    };
    const bump = await run({ MODE: "bump", CHECKED_REG_SHA: "a".repeat(40) });
    assert.equal(bump.status, 0);
    assert.equal(bump.env.trim(), `REG_SHA=${"a".repeat(40)}`, "the commit the read-only job synced and linted against");
    assert.equal(bump.asked, false, "the ref is not looked up again: it may have moved since the gate ran");
    assert.equal((await run({ MODE: "bump", CHECKED_REG_SHA: "" })).status, 1, "no commit from the read-only job, no push");
    const watch = await run({ MODE: "watch", CHECKED_REG_SHA: "" });
    assert.equal(watch.status, 0);
    assert.equal(watch.env.trim(), `REG_SHA=${"d".repeat(40)}`);
    assert.equal(watch.asked, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("the lock path must be a plain relative path (no traversal, no .git): refused before the lock is written, in both jobs", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const hash = wf.jobs.check.steps.find((s) => s.id === "lockhash");
  const recompute = wf.jobs.write.steps.find((s) => s.name?.startsWith("Recompute the lock"));
  const outside = path.join(os.tmpdir(), "models-outside-check.json");
  await rm(outside, { force: true });
  for (const [lock, ok] of [["models.lock.json", true], ["config/models.lock.json", true], ["../models-outside-check.json", false], ["/etc/passwd", false], [".git/config", false], ["a b.json", false], ["a/../b.json", false]]) {
    const tmp = await consumerWorkspace(lock);
    try {
      await mkdir(path.join(tmp, "config"), { recursive: true });
      await writeFile(path.join(tmp, "models.lock.json"), "{}");
      await writeFile(path.join(tmp, "config", "models.lock.json"), "{}");
      if (ok) assert.equal(runStep(tmp, hash).status, 0, `${lock} (hash)`);
      else assert.equal(runStep(tmp, hash).status, 1, `${lock} (hash)`);
      const r = runStep(tmp, recompute, { CHECKED_LOCK_SHA256: "0".repeat(64) });
      assert.match(r.stdout + r.stderr, ok ? /is not the one the gate ran on/ : /is not a plain relative path/, `${lock} (recompute): ${r.stderr}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  await assert.rejects(readFile(outside), /ENOENT/, "nothing was written outside the workspace");
});

test("the proposal is committed on the bot branch from the fresh checkout, with no token in the commit step, and the PR is created with it only in the push step", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const commit = wf.jobs.write.steps.find((s) => s.name === "Commit the proposal");
  const push = wf.jobs.write.steps.find((s) => s.name === "Open or update the proposal PR");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "bump-push-"));
  const sh = (cwd, script, env = {}) => spawnSync("bash", ["-ec", script], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, "gitconfig"), GIT_TERMINAL_PROMPT: "0", ...env } });
  try {
    await writeFile(path.join(tmp, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n");
    const server = posix(tmp);
    // "GitHub": a bare repo holding the consumer's base commit on main; "the runner": a checkout of it
    await mkdir(path.join(tmp, "owner"), { recursive: true });
    let r = sh(tmp, `git init -q --bare owner/repo.git && git clone -q "${server}/owner/repo.git" work 2>/dev/null; cd work && git checkout -q -B main && printf '{"lock":"models.lock.json"}' > models.config.json && printf '{"old":true}' > models.lock.json && printf 'untouched' > other.txt && git add . && git commit -q -m base && git push -q origin main && git rev-parse HEAD`);
    assert.equal(r.status, 0, r.stderr);
    const baseSha = r.stdout.trim().split("\n").at(-1);
    const ws = path.join(tmp, "work");
    await mkdir(path.join(tmp, "runner"), { recursive: true });
    await writeFile(path.join(tmp, "runner", "body.md"), "body");
    await mkdir(path.join(tmp, "bin"), { recursive: true });
    await writeFile(path.join(tmp, "bin", "gh"), `#!/bin/sh\necho "$@" >> "${server}/gh.log"\nprintf '%s' "$GH_TOKEN" > "${server}/gh-token"\n`);
    sh(tmp, "chmod +x bin/gh");
    const base = { PATH: `${posix(path.join(tmp, "bin"))}${path.delimiter === ";" ? ":" : path.delimiter}${process.env.PATH}`, RUNNER_TEMP: posix(path.join(tmp, "runner")), GITHUB_SERVER_URL: `file://${server}`, GITHUB_REPOSITORY: "owner/repo", GITHUB_SHA: baseSha, GITHUB_REF_NAME: "main", BRANCH: "automation/model-defaults", LOCKPATH: "models.lock.json" };
    const cycle = async (lock) => {
      sh(ws, "git checkout -q main && git reset -q --hard " + baseSha); // a new weekly run starts from a fresh checkout of main
      await writeFile(path.join(ws, "models.lock.json"), lock);
      await writeFile(path.join(ws, "stray.txt"), "left by tooling, not part of the proposal");
      const noToken = { ...base, GH_TOKEN: "" };
      let out = sh(ws, commit.run, noToken);
      assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
      out = sh(ws, push.run, { ...base, GH_TOKEN: "TOKEN-SENTINEL-123" });
      assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
    };
    await cycle('{"proposal":"week 1"}\n');
    const git = (args) => sh(tmp, `git --git-dir=owner/repo.git ${args}`);
    assert.equal(git("show automation/model-defaults:models.lock.json").stdout, '{"proposal":"week 1"}\n');
    assert.equal(git("log --format=%s -n1 automation/model-defaults").stdout.trim(), "chore(models): bump the model lock");
    assert.equal(git("log --format=%P -n1 automation/model-defaults").stdout.trim(), baseSha, "one commit on top of the base commit");
    assert.equal(git("diff --name-only main automation/model-defaults").stdout.trim(), "models.lock.json", "only the lock is in the commit");
    const log = await readFile(path.join(tmp, "gh.log"), "utf8");
    assert.match(log, /pr create --repo owner\/repo --head automation\/model-defaults --base main --title chore\(models\): bump the model lock --body-file .*body\.md/);
    assert.equal(await readFile(path.join(tmp, "gh-token"), "utf8"), "TOKEN-SENTINEL-123", "the PR call has the token");
    // the next week's run force-with-lease updates the same branch
    await cycle('{"proposal":"week 2"}\n');
    assert.equal(git("show automation/model-defaults:models.lock.json").stdout, '{"proposal":"week 2"}\n');
    assert.equal(git("rev-list --count main..automation/model-defaults").stdout.trim(), "1", "still one commit: the branch is rebuilt, not appended to");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("bump fetches the registry's snapshot index as data and gives it to sync, so the PR body quotes real hashes (SPEC B.6)", async () => {
  const { wf } = await load("model-bump.yml");
  const fetchStep = steps(wf).find((s) => s.name === "Fetch the registry as data");
  assert.match(fetchStep.run, /\$REG_SHA\/models\/snapshots\/latest\/index\.json/);
  for (const sync of steps(wf).filter((s) => /models sync/.test(s.run ?? ""))) assert.match(sync.run, /--snapshot-index \.model-registry\/index\.json/);
});

// ---- Part B v1 adversarial review (round 3) ------------------------------------------------------------------

test("setup-node runs before the consumer's files exist and without a package-manager cache, in both jobs of the reusable workflow", async () => {
  // setup-node runs `yarn --version` in the workspace (a committed .yarnrc `yarn-path` would execute, with the action's
  // default token in its environment) and, when package.json says `packageManager: npm`, saves ~/.npm after the gate
  // and restores it in the job that writes. Neither can happen in an empty workspace with the cache off.
  const { wf } = await load("model-bump.yml");
  for (const [jobId, job] of Object.entries(wf.jobs)) {
    const at = job.steps.findIndex((s) => s.uses?.startsWith("actions/setup-node@"));
    const firstCheckout = job.steps.findIndex((s) => s.uses?.startsWith("actions/checkout@"));
    assert.ok(at >= 0 && firstCheckout >= 0, jobId);
    assert.ok(at < firstCheckout, `${jobId}: setup-node must run before the consumer's checkout`);
    assert.equal(job.steps[at].with["package-manager-cache"], false, `${jobId}: automatic package-manager caching is off`);
    assert.equal(job.steps[at].with.cache, undefined, `${jobId}: no explicit cache either`);
  }
});

test("the scheduled refresh is never a dry run, and a manual one is unless it says otherwise", async () => {
  // A forced DRY_RUN: 'true' keeps every run green (the liveness check in each consumer reads "alive") while no PR ever opens.
  const { wf } = await load("model-registry-refresh.yml");
  const raw = wf.jobs.refresh.env.DRY_RUN;
  assert.match(raw, /^\$\{\{[^}]+\}\}$/, "DRY_RUN is computed from the event, not fixed");
  const expr = /^\$\{\{\s*([^}]+?)\s*\}\}$/.exec(raw)[1];
  assert.match(expr, /^[\w.'= &|]+$/, "only the tokens this evaluator knows");
  const evaluate = (eventName, inputs) => String(new Function("github", "inputs", `return (${expr});`)({ event_name: eventName }, inputs));
  assert.equal(evaluate("schedule", {}), "false", "the weekly run opens its PR");
  assert.equal(evaluate("workflow_dispatch", { dry_run: true }), "true", "a manual run defaults to a dry run");
  assert.equal(evaluate("workflow_dispatch", { dry_run: false }), "false", "...and can be told not to be");
  for (const step of wf.jobs.refresh.steps.filter((s) => /force-with-lease/.test(s.run ?? "") || /git commit/.test(s.run ?? ""))) assert.match(step.if, /env\.DRY_RUN != 'true'/, step.name);
});

test("a push never overwrites work it has not seen: both workflows use --force-with-lease and no bare --force", async () => {
  for (const name of ["model-registry-refresh.yml", "model-bump.yml"]) {
    const { wf } = await load(name);
    const pushes = steps(wf).filter((s) => /\bpush\b/.test(s.run ?? "") && /origin/.test(s.run ?? ""));
    assert.equal(pushes.length, 1, name);
    assert.match(pushes[0].run, /push --force-with-lease origin "\$BRANCH"/, name);
    assert.doesNotMatch(pushes[0].run, /--force(?!-with-lease)|\s-f\s/, name);
  }
});

test("each job refuses a mode it does not run, and a platform_sha or registry_ref that is not what the contract says", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "bump-inputs-"));
  const sha = "a".repeat(40);
  const run = (job, env) => spawnSync("bash", ["-ec", wf.jobs[job].steps.find((s) => s.name === "Check the inputs").run], { cwd: tmp, encoding: "utf8", env: { ...process.env, PLATFORM_SHA: sha, REGISTRY_REF: "main", MODE: "bump", ...env } }).status;
  try {
    for (const [job, ok, bad] of [["check", ["lint", "bump"], ["watch", "", "Bump", "lint;id"]], ["write", ["watch", "bump"], ["lint", "", "Watch", "bump;id"]]]) {
      for (const mode of ok) assert.equal(run(job, { MODE: mode }), 0, `${job} runs ${mode}`);
      for (const mode of bad) assert.equal(run(job, { MODE: mode }), 1, `${job} refuses ${JSON.stringify(mode)}`);
      assert.equal(run(job, { PLATFORM_SHA: "a".repeat(39) }), 1, `${job}: a 39-hex platform_sha`);
      assert.equal(run(job, { PLATFORM_SHA: "main" }), 1, `${job}: a branch name as platform_sha`);
      assert.equal(run(job, { REGISTRY_REF: "feature/x y" }), 1, `${job}: a registry_ref with a space`);
      assert.equal(run(job, { REGISTRY_REF: "refs/tags/v1.2" }), 0, `${job}: a tag path`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("the Watch step opens the URGENT issue exactly when the report is urgent, updates the one that exists, and opens nothing on a dry run", { skip: skipBash }, async () => {
  const { wf } = await load("model-bump.yml");
  const sync = wf.jobs.check.steps.find((s) => s.id === "sync");
  const watch = wf.jobs.write.steps.find((s) => s.name === "Watch");
  const stale = JSON.stringify({ workflow_runs: [{ updated_at: "2020-01-01T00:00:00Z" }] });
  const dirs = [];
  // A consumer workspace with its lock, a `gh` that records every call, and a refresh-run history to serve.
  const scenario = async ({ runs, quietRegistry = false, issue = "", dry = "false" }) => {
    const tmp = await consumerWorkspace();
    dirs.push(tmp);
    assert.equal(runStep(tmp, sync).status, 0);
    if (quietRegistry) {
      // no announced date anywhere, so only the liveness read can make the report urgent (the clock-independent case)
      const registry = YAML.parse(await readFile(path.join(tmp, ".model-registry/models.yaml"), "utf8"));
      registry.deprecations = {};
      await writeFile(path.join(tmp, ".model-registry/models.yaml"), YAML.stringify(registry));
    }
    await mkdir(path.join(tmp, "bin"), { recursive: true });
    await writeFile(path.join(tmp, "bin", "gh"), `#!/bin/sh
echo "$@" >> "$GH_LOG"
[ "$1" = api ] && cat "$RUNS_JSON"
[ "$1 $2" = "issue list" ] && printf '%s' "$ISSUE_N"
exit 0
`);
    spawnSync("bash", ["-c", "chmod +x bin/gh"], { cwd: tmp });
    await writeFile(path.join(tmp, "runs.json"), runs === "fresh" ? JSON.stringify({ workflow_runs: [{ updated_at: new Date().toISOString() }] }) : stale);
    const r = runStep(tmp, watch, {
      MODE: "watch", DRY_RUN: dry, GH_TOKEN: "t", ISSUE_N: issue, GH_LOG: fwd(path.join(tmp, "gh.log")), RUNS_JSON: fwd(path.join(tmp, "runs.json")),
      GITHUB_STEP_SUMMARY: fwd(path.join(tmp, "summary.md")), PATH: `${posix(path.join(tmp, "bin"))}:${process.env.PATH}`,
    });
    const log = await readFile(path.join(tmp, "gh.log"), "utf8").catch(() => "");
    const summary = await readFile(path.join(tmp, "summary.md"), "utf8").catch(() => "");
    return { status: r.status, out: r.stdout + r.stderr, log, summary };
  };
  try {
    const urgent = await scenario({ runs: "stale" });
    assert.equal(urgent.status, 0, urgent.out);
    assert.match(urgent.log, /issue create --label model-defaults --title Model defaults: URGENT --body-file/, "an urgent report opens the issue");
    assert.doesNotMatch(urgent.log, /issue edit/);
    assert.match(urgent.summary, /registry refresh not running/);

    const existing = await scenario({ runs: "stale", issue: "7" });
    assert.match(existing.log, /issue edit 7 --body-file/, "the one open issue is updated, not duplicated");
    assert.doesNotMatch(existing.log, /issue create/);

    const dry = await scenario({ runs: "stale", dry: "true" });
    assert.equal(dry.status, 0, dry.out);
    assert.doesNotMatch(dry.log, /issue (create|edit)|label create/, "a dry run reads and reports but writes nothing");
    assert.match(dry.summary, /registry refresh not running/, "...and still says what it found");

    const quiet = await scenario({ runs: "fresh", quietRegistry: true });
    assert.equal(quiet.status, 0, quiet.out);
    assert.doesNotMatch(quiet.log, /issue /, "nothing urgent, no issue");
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
});
