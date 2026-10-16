// The robot's own permissions are part of its contract (SPEC-v9 §B.6/§B.7): weekly, proposal-only, least
// privilege, tooling pinned, no secret, no merge. These assertions read the workflow files, so a later edit
// that widens a scope or adds an unpinned action fails here instead of in production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const fetchStep = steps(wf).find((s) => /raw\.githubusercontent\.com/.test(s.run ?? ""));
  assert.match(fetchStep.run, /commits\/\$REGISTRY_REF/, "the ref is resolved to a commit first");
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
  assert.match(watch.run, /model-registry-refresh\.yml\/runs\?status=success&per_page=1/, "liveness comes from the refresh workflow's last success");
});

test("the entry-point routing in src/cli.mjs lists exactly the registry subcommands", async () => {
  const { MODELS_SUBCOMMANDS } = await import("../src/lib/models-cli.mjs");
  const text = await readFile(path.join(ROOT, "src/cli.mjs"), "utf8");
  const routed = JSON.parse(`[${/\[("help"[^\]]*)\]/.exec(text)[1]}]`);
  assert.deepEqual(routed.filter((s) => s !== "help").sort(), [...MODELS_SUBCOMMANDS].sort());
});
