// The robot's own permissions are part of its contract (SPEC-v9 §B.6/§B.7): weekly, proposal-only, least
// privilege, tooling pinned, no secret, no merge. These assertions read the workflow files, so a later edit
// that widens a scope or adds an unpinned action fails here instead of in production.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});

test("the reusable bump workflow pins its tooling by 40-hex SHA, fetches the registry as data by resolved SHA, and sets no permissions of its own", async () => {
  const { text, wf } = await load("model-bump.yml");
  assert.ok(wf.on.workflow_call, "reusable");
  assert.equal(wf.permissions, undefined, "a called workflow can only narrow its caller's grant; each calling job states its own");
  assert.equal(wf.jobs.run.permissions, undefined);
  assert.deepEqual(Object.keys(wf.jobs), ["run"], "one job, so the caller's per-job permissions are what apply");
  const checks = steps(wf).find((s) => /platform_sha must be a 40-hex/.test(s.run ?? ""));
  assert.match(checks.run, /\^\[0-9a-f\]\{40\}\$/);
  const platform = steps(wf).find((s) => s.with?.path === ".node-platform");
  assert.equal(platform.with.ref, "${{ inputs.platform_sha }}");
  assert.equal(platform.with.repository, "HomenShum/NodeKit");
  const resolve = steps(wf).find((s) => /commits\/\$REGISTRY_REF/.test(s.run ?? ""));
  assert.match(resolve.run, /\^\[0-9a-f\]\{40\}\$/, "the ref is resolved to a commit first, and must be 40-hex");
  const fetchStep = steps(wf).find((s) => s.name === "Fetch the registry as data");
  assert.match(fetchStep.run, /raw\.githubusercontent\.com\/HomenShum\/NodeKit\/\$REG_SHA\/models\.yaml/);
  assert.match(fetchStep.run, /--max-filesize/);
  assert.match(fetchStep.run, /--stage inputs --schema-only/, "the data is validated by the pinned tooling's schema");
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

// ---- the token (G-token): consumer install/test commands must never run with a write-capable GITHUB_TOKEN ----------

const usesGithub = (run) => /\bgh (api|pr|issue|label)\b|\bnet (fetch|push)\b|\bGH_TOKEN\b/.test(run ?? "");

test("GH_TOKEN is set per step, only on the steps that talk to GitHub, and never on the job or on a step that runs consumer commands", async () => {
  const { wf } = await load("model-bump.yml");
  const job = wf.jobs.run;
  assert.equal(job.env.GH_TOKEN, undefined, "was a job-level GH_TOKEN, which put the write token in the environment of the consumer's gate");
  assert.equal(wf.env, undefined);
  for (const step of job.steps) {
    const hasToken = step.env?.GH_TOKEN !== undefined;
    if (hasToken) assert.equal(step.env.GH_TOKEN, "${{ github.token }}", `${step.name}: only the job's own token`);
    if (usesGithub(step.run)) assert.ok(hasToken, `${step.name}: calls GitHub without its own GH_TOKEN`);
    else assert.ok(!hasToken, `${step.name}: has a token it does not use`);
    // the consumer's commands: anything that executes a string read from models.config.json
    if (/bash -ec "\$(INSTALL|CHECK)"/.test(step.run ?? "")) {
      assert.ok(!hasToken, `${step.name}: consumer commands run with no token`);
      assert.ok(!usesGithub(step.run), `${step.name}: consumer commands and GitHub calls share a step`);
    }
  }
  const gate = job.steps.find((s) => /bash -ec "\$CHECK"/.test(s.run ?? ""));
  assert.ok(gate, "the gate step exists");
  // Order: everything that needs the token and everything staged for the push happens around the gate, never inside it.
  const names = job.steps.map((s) => s.name);
  const at = (name) => names.findIndex((n) => n?.startsWith(name));
  assert.ok(at("Stage the proposal") < at("Closed-PR guard") && at("Closed-PR guard") < at("Run the consumer's own gate") && at("Run the consumer's own gate") < at("Open or update the proposal PR"));
  assert.match(gate.if, /suppress != 'true'/, "a suppressed proposal does not run consumer code at all");
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

test("the frozen-id snapshots are fetched by watch only when the lock has frozen ids", async () => {
  const { wf } = await load("model-bump.yml");
  const step = steps(wf).find((s) => s.name?.startsWith("Fetch the catalog snapshots"));
  assert.equal(step.if, "env.MODE == 'watch'");
  assert.match(step.run, /frozen\|\|\[\]\)\.length/);
  assert.match(step.run, /\$REG_SHA\/models\/snapshots\/latest/);
  assert.match(step.run, /--max-filesize/);
  const watch = steps(wf).find((s) => s.name === "Watch");
  assert.match(watch.run, /--snapshots \.model-registry\/snapshots/);
});

// The push step, executed: the real `run` script against a local bare repository and a stub `gh`, from a workspace
// the gate has tampered with (a pre-commit hook that steals the token, a rewritten lock, a hostile remote).
const bash = spawnSync("bash", ["-c", "command -v base64 git"], { encoding: "utf8" });
const posix = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);
test("the PR is committed and pushed from a fresh repository: a gate that tampers with .git, hooks or the lock cannot reach the token or change what is pushed", { skip: bash.status !== 0 && "bash, git and base64 are required" }, async () => {
  const { wf } = await load("model-bump.yml");
  const step = steps(wf).find((s) => s.name === "Open or update the proposal PR");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "bump-push-"));
  const sh = (cwd, script, env = {}) => spawnSync("bash", ["-ec", script], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, "gitconfig"), GIT_TERMINAL_PROMPT: "0", ...env } });
  try {
    await writeFile(path.join(tmp, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n");
    const server = posix(tmp);
    const remote = `${server}/owner/repo.git`;
    // the "GitHub": a bare repo with the consumer's base commit on main
    await mkdir(path.join(tmp, "owner"), { recursive: true });
    let r = sh(tmp, `git init -q --bare owner/repo.git && git clone -q "${remote}" work 2>/dev/null; cd work && git checkout -q -B main && printf '{"lock":"models.lock.json"}' > models.config.json && printf '{"old":true}' > models.lock.json && git add . && git commit -q -m base && git push -q origin main && git rev-parse HEAD`);
    assert.equal(r.status, 0, r.stderr);
    const baseSha = r.stdout.trim().split("\n").at(-1);
    // the workspace the gate ran in, already tampered with
    const ws = path.join(tmp, "work");
    await writeFile(path.join(ws, ".git/hooks/pre-commit"), `#!/bin/sh\nprintf '%s' "$GH_TOKEN" > "${server}/stolen-by-hook"\n`);
    await writeFile(path.join(ws, ".git/hooks/pre-push"), `#!/bin/sh\nprintf '%s' "$GH_TOKEN" > "${server}/stolen-by-pre-push"\n`);
    await writeFile(path.join(ws, ".git/hooks/post-commit"), `#!/bin/sh\nprintf '%s' "$GH_TOKEN" > "${server}/stolen-by-post-commit"\n`);
    sh(ws, `chmod +x .git/hooks/*; git config url.file:///nowhere/.insteadOf "${server}/"; git config core.hooksPath .git/hooks`);
    await writeFile(path.join(ws, "models.lock.json"), '{"tampered":true}');
    // what the sync step staged before the gate ran
    const staged = path.join(tmp, "runner", "proposal");
    await mkdir(staged, { recursive: true });
    await writeFile(path.join(staged, "lock"), '{"proposal":"from-sync"}\n');
    await writeFile(path.join(staged, "path"), "models.lock.json");
    await writeFile(path.join(tmp, "runner", "body.md"), "body");
    // a stub `gh` that records its arguments
    await mkdir(path.join(tmp, "bin"), { recursive: true });
    await writeFile(path.join(tmp, "bin", "gh"), `#!/bin/sh\necho "$@" >> "${server}/gh.log"\nprintf '%s' "$GH_TOKEN" > "${server}/gh-token"\n`);
    sh(tmp, "chmod +x bin/gh");
    const env = {
      PATH: `${posix(path.join(tmp, "bin"))}${path.delimiter === ";" ? ":" : path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: posix(path.join(tmp, "runner")), GITHUB_SERVER_URL: `file://${server}`, GITHUB_REPOSITORY: "owner/repo", GITHUB_SHA: baseSha,
      GITHUB_REF_NAME: "main", BRANCH: "automation/model-defaults", GH_TOKEN: "TOKEN-SENTINEL-123",
    };
    r = sh(ws, step.run, env);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    for (const stolen of ["stolen-by-hook", "stolen-by-pre-push", "stolen-by-post-commit"]) {
      await assert.rejects(readFile(path.join(tmp, stolen)), /ENOENT/, `${stolen}: a hook in the tampered workspace ran with the token`);
    }
    const pushed = sh(tmp, `git --git-dir=owner/repo.git show automation/model-defaults:models.lock.json; git --git-dir=owner/repo.git log --format=%s -n1 automation/model-defaults; git --git-dir=owner/repo.git log --format=%P -n1 automation/model-defaults`);
    assert.equal(pushed.status, 0, pushed.stderr);
    const [lock, subject, parent] = pushed.stdout.trimEnd().split("\n");
    assert.equal(lock, '{"proposal":"from-sync"}', "the staged lock is what is pushed, not what the gate left in the workspace");
    assert.equal(subject, "chore(models): bump the model lock");
    assert.equal(parent, baseSha, "one commit on top of the base commit");
    const log = await readFile(path.join(tmp, "gh.log"), "utf8");
    assert.match(log, /pr create --repo owner\/repo --head automation\/model-defaults --base main --title chore\(models\): bump the model lock --body-file .*body\.md/);
    assert.equal(await readFile(path.join(tmp, "gh-token"), "utf8"), "TOKEN-SENTINEL-123", "the PR call has the token");
    // a second run force-with-lease updates the same branch
    r = sh(ws, step.run, env);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("the staged lock path must be a plain relative path (no traversal, no .git)", async () => {
  const { wf } = await load("model-bump.yml");
  const stage = steps(wf).find((s) => s.name?.startsWith("Stage the proposal"));
  const tmp = await mkdtemp(path.join(os.tmpdir(), "bump-stage-"));
  try {
    for (const [lock, ok] of [["models.lock.json", true], ["config/models.lock.json", true], ["../x.json", false], ["/etc/passwd", false], [".git/config", false], ["a b.json", false], ["a/../b.json", false]]) {
      await writeFile(path.join(tmp, "models.config.json"), JSON.stringify({ lock }));
      await writeFile(path.join(tmp, path.basename(lock)), "{}").catch(() => {});
      await mkdir(path.join(tmp, "config"), { recursive: true });
      await writeFile(path.join(tmp, "config", "models.lock.json"), "{}");
      const r = spawnSync("bash", ["-ec", stage.run], { cwd: tmp, encoding: "utf8", env: { ...process.env, RUNNER_TEMP: posix(path.join(tmp, "rt")) } });
      assert.equal(r.status === 0, ok, `${lock}: ${r.stderr}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("bump fetches the registry's snapshot index as data and gives it to sync, so the PR body quotes real hashes (SPEC B.6)", async () => {
  const { wf } = await load("model-bump.yml");
  const fetchStep = steps(wf).find((s) => s.name === "Fetch the registry as data");
  assert.match(fetchStep.run, /\$REG_SHA\/models\/snapshots\/latest\/index\.json/);
  const sync = steps(wf).find((s) => s.id === "sync");
  assert.match(sync.run, /--snapshot-index \.model-registry\/index\.json/);
});
