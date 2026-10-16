// Scenario tests for the consumer side (SPEC-v9 §B.5, §B.6, §B.9): the maintainer of a repo that pins one
// default model, the Tuesday robot that proposes a lock change, the lint that stops a dead id, and the alarm
// that must never mistake a stopped robot for "nothing is retiring". No network, no paid call.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { decisionMarker, markerHashOf, stringifyYaml } from "../src/lib/model-registry.mjs";
import {
  LOCK_SCHEMA, WATCH_HORIZON_DAYS, buildLock, lintLock, lockDecisionSha256, renderLockBody, scanRawIds, syncLock, validateConfig, watchReport,
} from "../src/lib/model-lock.mjs";
import { ROOT, T0, makeSet, readSeed, seededRegistry } from "./model-registry.fixtures.mjs";

const REF = "c".repeat(40);
const clone = (v) => structuredClone(v);
const day = (n) => new Date(Date.parse("2026-10-16T10:30:00Z") + n * 86_400_000).toISOString();
const CONFIG = {
  contractVersion: LOCK_SCHEMA, lock: "models.lock.json",
  roles: { reasoner: { line: "anthropic.haiku", transport: "anthropic", minMaxTokens: 2048, env: ["AGENT_MODEL"] } },
  frozen: [], exclude: [], idAllowlist: ["evidence/", "docs/", "test/", "// model-id-fixture"],
  gate: { install: "npm ci --ignore-scripts", check: "npm test && npm run typecheck" },
};
const cli = (args, cwd = ROOT) => spawnSync(process.execPath, [path.join(ROOT, "src/cli.mjs"), ...args], { cwd, encoding: "utf8" });

async function world() {
  const registry = await seededRegistry(makeSet(), T0);
  const { lock } = syncLock({ registry, config: CONFIG, existing: null, registryRef: REF });
  return { registry, lock };
}

test("the lock pins the role's exact id, wire ids per transport, constraints and lifecycle, and knows every reviewed id", async () => {
  const { lock, registry } = await world();
  assert.equal(lock.schemaVersion, LOCK_SCHEMA);
  const role = lock.roles.reasoner;
  assert.equal(role.id, "claude-haiku-5-5");
  assert.equal(role.ids.anthropic, "claude-haiku-5-5");
  assert.deepEqual(role.lineTransports, ["anthropic"]);
  assert.equal(role.constraints.sampling, "forbidden");
  assert.equal(role.availability.anthropic.state, "active");
  assert.ok(!JSON.stringify(lock).includes("checkedAt"), "no clock inside the decision fields");
  assert.equal(role.price.source, "openrouter", "the price says which transport priced it");
  assert.deepEqual(Object.keys(lock.known).sort(), ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"], "unreviewed ids are not known");
  assert.equal(lock.registrySha256.length, 64);
  assert.equal(lock.decisionDigest, registry.decisionDigest);
});

test("sync is idempotent on the clock: a new date or an unrelated registry change opens no consumer PR; a relevant one does", async () => {
  const { registry, lock } = await world();
  const same = (mutate) => { const next = clone(registry); mutate(next); return syncLock({ registry: next, config: CONFIG, existing: lock, registryRef: "d".repeat(40) }); };
  // provenance and unrelated entries
  let r = same((n) => { n.generatedAt = day(30); n.evaluatedAt = day(30); n.registryRef = "e".repeat(40); n.decisionDigest = "f".repeat(64); n.snapshots.openrouter.sha256 = "1".repeat(64); n.entries["claude-opus-5-5"].price.inPerM = 99; for (const e of Object.values(n.entries)) for (const a of Object.values(e.availability)) if (a.checkedAt) a.checkedAt = day(30); });
  assert.equal(r.changed, false);
  assert.equal(r.lock, lock, "the committed lock object is kept byte for byte, provenance included");
  // the pinned model's price, constraints, lifecycle, or the set of known ids
  assert.equal(same((n) => { n.entries["claude-haiku-5-5"].price.inPerM = 0.2; }).changed, true);
  assert.equal(same((n) => { n.entries["claude-haiku-5-5"].constraints.defaultEffort = "high"; }).changed, true);
  assert.equal(same((n) => { n.entries["claude-haiku-5-5"].availability.anthropic.retiresOn = "2027-01-01"; }).changed, true);
  assert.equal(same((n) => { n.entries["claude-sonnet-5-5"].reviewed = false; delete n.entries["claude-sonnet-5-5"].constraints; n.lines["anthropic.sonnet"].current = "claude-opus-5-5"; }).changed, true);
  // a successor the line moved to
  r = same((n) => { n.lines["anthropic.haiku"].current = "claude-sonnet-5-5"; });
  assert.equal(r.changed, true);
  assert.equal(r.lock.roles.reasoner.id, "claude-sonnet-5-5");
  assert.equal(r.lock.generatedAt, registry.generatedAt, "provenance is refreshed only when the decision changes");
});

test("sync refuses, loudly, rather than guess: excluded current, transport the line does not offer, unreviewed current, unknown line", async () => {
  const { registry } = await world();
  assert.throws(() => buildLock({ registry, config: { ...CONFIG, exclude: ["claude-haiku-5-5"] } }), /excluded for this repo; a human must decide/);
  assert.throws(() => buildLock({ registry, config: { ...CONFIG, roles: { reasoner: { line: "anthropic.haiku", transport: "openrouter" } } } }), /transport openrouter is not in lines\.anthropic\.haiku\.transports/);
  assert.throws(() => buildLock({ registry, config: { ...CONFIG, roles: { reasoner: { line: "anthropic.nope", transport: "anthropic" } } } }), /line anthropic\.nope is not in the registry/);
  const unreviewed = clone(registry);
  unreviewed.entries["claude-haiku-5-5"].reviewed = false;
  assert.throws(() => buildLock({ registry: unreviewed, config: CONFIG }), /is not reviewed/);
  assert.deepEqual(validateConfig({ ...CONFIG, roles: {}, frozen: "x" }), ["models.config.json needs at least one role", "frozen must be an array"]);
  assert.deepEqual(validateConfig(CONFIG), []);
});

test("lint (b): a raw model id in code is a finding unless the path or the line is on the allowlist", () => {
  const files = [
    { path: "packages/app/src/agent.ts", text: 'const a = "claude-haiku-5-5";\nconst b = `gpt-6-luna`;\nconst c = \'anthropic/claude-sonnet-5.5\';\nconst d = "gemini-3.8-flash";' },
    { path: "packages/app/src/ok.ts", text: 'const fixture = "claude-haiku-4-5"; // model-id-fixture\nif (id.startsWith("gpt")) {}\nconst note = "o1"; const short = "claude";' },
    { path: "evidence/receipt.mjs", text: 'const m = "claude-haiku-5-5";' },
    { path: "test/models.test.ts", text: 'const m = "claude-haiku-5-5";' },
    { path: "README.md", text: "claude-haiku-5-5" },
    { path: "packages/app/src/data.json", text: '{"m":"claude-haiku-5-5"}' },
  ];
  const hits = scanRawIds(files, CONFIG.idAllowlist);
  assert.deepEqual(hits.map((h) => `${h.path}:${h.line}:${h.id}`), [
    "packages/app/src/agent.ts:1:claude-haiku-5-5", "packages/app/src/agent.ts:2:gpt-6-luna", "packages/app/src/agent.ts:3:anthropic/claude-sonnet-5.5", "packages/app/src/agent.ts:4:gemini-3.8-flash",
  ]);
});

test("lint (c): the dying-incumbent rule on the transport in use, evaluated at the clock; a floor is never a finding", async () => {
  const { lock, registry } = await world();
  const lint = (mutate, now = T0, extra = {}) => { const next = clone(lock); mutate?.(next); return lintLock({ lock: next, config: CONFIG, files: [], now, ...extra }); };
  assert.deepEqual(lint().errors, [], "Haiku 5.5 with a 2027 floor is clean");
  assert.deepEqual(lint((l) => { l.roles.reasoner.availability.anthropic.retiresNotBefore = "2026-10-15"; }).errors, [], "a floor in the past is advisory only");
  // an announced retirement 45 days out is information; 25 days out blocks; the same lock goes red as the clock moves
  const announced = (l) => { l.roles.reasoner.availability.anthropic = { state: "deprecated", retiresOn: "2026-11-30" }; };
  assert.match(lint(announced, day(0)).errors[0], /\(c\) role reasoner: claude-haiku-5-5 is deprecated on anthropic/);
  const dated = (l) => { l.roles.reasoner.availability.anthropic = { state: "active", retiresOn: "2026-11-30" }; };
  assert.deepEqual(lint(dated, day(0)).errors, [], "45 days out: not yet");
  assert.match(lint(dated, day(20)).errors[0], /retires 2026-11-30 on anthropic \(25 d\)/);
  assert.match(lint(dated, day(60)).errors[0], /\(-1 d\)|\(-\d+ d\)/, "past the date it is still red");
  assert.match(lint((l) => { l.roles.reasoner.availability.anthropic.state = "unlisted"; }).errors[0], /unlisted on anthropic/);
  // an unverified transport warns and never blocks
  const unverified = lint((l) => { l.roles.reasoner.availability.anthropic = { state: "unverified" }; });
  assert.deepEqual(unverified.errors, []);
  assert.match(unverified.warnings.join("\n"), /lifecycle on anthropic is unverified/);
  // an OpenRouter expiry on a transport the role does not use is irrelevant
  assert.deepEqual(lint((l) => { l.roles.reasoner.availability.openrouter = { state: "listed", expiration: "2026-10-20" }; }).errors, []);
  // (b2)
  assert.match(lint((l) => { l.roles.reasoner.transport = "openrouter"; }).errors.join("\n"), /\(a\) role reasoner: lock says/);
  assert.match(lint((l) => { l.roles.reasoner.lineTransports = ["bedrock"]; }).errors.join("\n"), /\(b2\) role reasoner: transport anthropic is not in its line's transports/);
  assert.match(lint((l) => { delete l.roles.reasoner.ids.anthropic; }).errors.join("\n"), /\(b2\) role reasoner: claude-haiku-5-5 has no anthropic wire id/);
  // (a)
  assert.deepEqual(lintLock({ lock, config: CONFIG, files: [], registry, now: T0 }).errors, []);
  const moved = clone(registry);
  moved.entries["claude-haiku-5-5"].price.outPerM = 9;
  assert.match(lintLock({ lock, config: CONFIG, files: [], registry: moved, now: T0 }).errors[0], /\(a\) models\.lock\.json is not in sync/);
  assert.match(lint(undefined, T0, { registry: null }).warnings.join("\n"), /\(a\) skipped: no --registry/);
  // frozen ids advise, they do not block (B.9)
  const frozen = lint((l) => { l.frozen = [{ id: "whisper-1", transport: "openai", class: "voice", reason: "voice is shape-verified", promotionPath: "shape-verified replacement" }]; });
  assert.deepEqual(frozen.errors, []);
  assert.match(frozen.advisories[0], /frozen voice whisper-1 on openai.*shape-verified replacement/);
});

test("watch: an announced horizon within 60 days is URGENT, a floor is not, and a stopped robot is never reported as 'no deprecations'", async () => {
  const { lock, registry } = await world();
  const fresh = { ok: true, latestSuccessAt: "2026-10-14T13:47:00Z" };
  const quiet = watchReport({ lock, registry, now: T0, refreshRun: fresh });
  assert.equal(quiet.urgent, false);
  assert.equal(quiet.floors.length, 1, "Haiku 5.5's 2027 floor is listed as an advisory");

  const pinned = clone(lock);
  pinned.roles.reasoner = { ...pinned.roles.reasoner, id: "claude-sonnet-4-5-20250929" };
  const horizon = watchReport({ lock: pinned, registry, now: T0, refreshRun: fresh });
  assert.equal(horizon.urgent, true);
  assert.equal(horizon.horizons[0].days, 45);
  assert.match(horizon.body, /claude-sonnet-4-5-20250929.*announced 2026-11-30 in 45 d.*vendor-named replacement `claude-sonnet-5-5`/);
  assert.ok(WATCH_HORIZON_DAYS >= horizon.horizons[0].days);
  assert.equal(watchReport({ lock: pinned, registry, now: "2026-08-01T00:00:00Z", refreshRun: fresh }).urgent, false, "90+ days out is not yet urgent");

  // D-6: liveness
  for (const [name, run, matcher] of [
    ["the status could not be read", { ok: false, latestSuccessAt: null }, /status could not be read/],
    ["no successful run exists", { ok: true, latestSuccessAt: null }, /no successful registry refresh run exists/],
    ["the last success is 20 days old", { ok: true, latestSuccessAt: "2026-09-26T00:00:00Z" }, /20 d ago, allowed 14/],
  ]) {
    const r = watchReport({ lock, registry, now: T0, refreshRun: run });
    assert.equal(r.urgent, true, name);
    assert.match(r.body, /registry refresh not running — lifecycle facts unverified/);
    assert.match(r.body, matcher);
    assert.doesNotMatch(r.body, /no (announced )?deprecations/i);
    assert.match(r.body, /not a statement that nothing is retiring/);
  }
});

test("the consumer PR body shows the per-role diff, labels floor vs announced, ends with the closed-PR marker", async () => {
  const { registry, lock } = await world();
  const next = clone(registry);
  next.entries["claude-haiku-5-5"].price.inPerM = 0.2;
  next.entries["claude-haiku-5-5"].availability.anthropic.retiresOn = "2027-03-01";
  const { lock: updated } = syncLock({ registry: next, config: CONFIG, existing: lock, registryRef: "d".repeat(40) });
  const hash = lockDecisionSha256(updated);
  const body = renderLockBody({ oldLock: lock, newLock: updated, hash, config: CONFIG });
  assert.match(body, /### `reasoner` \(anthropic\.haiku, anthropic\)/);
  assert.match(body, /price \(valid on the `openrouter` transport only\)/);
  assert.match(body, /retires 2027-03-01 \(announced\)/);
  assert.match(body, /Environment checklist: `AGENT_MODEL`/);
  assert.equal(markerHashOf(body), hash);
  assert.ok(body.trimEnd().endsWith(decisionMarker(hash)));
  assert.doesNotMatch(body, /[A-Z]:\\/);
});

test("the CLI in a consumer checkout: sync writes the lock once, --check agrees, a registry price change makes --check red, lint passes then catches a raw id", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "models-consumer-"));
  try {
    await mkdir(path.join(tmp, "src"), { recursive: true });
    await writeFile(path.join(tmp, "models.config.json"), JSON.stringify(CONFIG, null, 2));
    await writeFile(path.join(tmp, "src/agent.ts"), 'import { resolveModel } from "./models.ts";\nexport const id = resolveModel("reasoner").id;\n');
    const registry = path.join(ROOT, "models.yaml");
    const common = ["--repo-root", tmp, "--registry", registry];

    let r = cli(["models", "sync", ...common, "--ref", REF, "--body-out", path.join(tmp, "body.md"), "--json"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).changed, true);
    const written = await readFile(path.join(tmp, "models.lock.json"), "utf8");
    assert.equal(JSON.parse(written).roles.reasoner.id, "claude-haiku-5-5");
    assert.match(await readFile(path.join(tmp, "body.md"), "utf8"), /### `reasoner`/);

    r = cli(["models", "sync", ...common, "--ref", REF, "--check", "--json"]);
    assert.equal(r.status, 0, "second sync changes nothing");
    assert.equal(JSON.parse(r.stdout).changed, false);
    assert.equal(await readFile(path.join(tmp, "models.lock.json"), "utf8"), written);

    r = cli(["models", "lint", ...common, "--now", "2026-10-17T00:00:00.000Z"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /MODELS LINT PASS/);

    const changed = YAML.parse(await readFile(registry, "utf8"));
    changed.entries["claude-haiku-5-5"].price.inPerM = 0.3;
    await writeFile(path.join(tmp, "registry.yaml"), stringifyYaml(changed));
    r = cli(["models", "sync", "--repo-root", tmp, "--registry", path.join(tmp, "registry.yaml"), "--check"]);
    assert.equal(r.status, 1, "the lock would change, so --check is red");
    r = cli(["models", "lint", "--repo-root", tmp, "--registry", path.join(tmp, "registry.yaml"), "--now", "2026-10-17T00:00:00.000Z"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\(a\) models\.lock\.json is not in sync/);

    await writeFile(path.join(tmp, "src/agent.ts"), 'export const id = "claude-haiku-4-5";\n');
    r = cli(["models", "lint", "--repo-root", tmp, "--now", "2026-10-17T00:00:00.000Z"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\(b\) raw model id "claude-haiku-4-5" at src\/agent\.ts:1/);

    // a registry that is not valid is refused, not read
    await writeFile(path.join(tmp, "bad.yaml"), "schemaVersion: nope\n");
    r = cli(["models", "sync", "--repo-root", tmp, "--registry", path.join(tmp, "bad.yaml")]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /registry is not valid/);

    // watch: the CLI emits the issue body with the lookup key's title, and reads the runs file
    await writeFile(path.join(tmp, "runs.json"), JSON.stringify({ workflow_runs: [{ updated_at: "2026-10-14T13:50:00Z" }] }));
    r = cli(["models", "watch", ...common, "--refresh-runs", path.join(tmp, "runs.json"), "--now", T0, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const watch = JSON.parse(r.stdout);
    assert.equal(watch.urgent, false);
    assert.equal(watch.title, "Model defaults: URGENT");
    assert.equal(watch.label, "model-defaults");
    r = cli(["models", "watch", ...common, "--now", T0, "--json"]);
    assert.equal(JSON.parse(r.stdout).urgent, true, "no readable runs file means liveness is unverified, which is urgent");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
