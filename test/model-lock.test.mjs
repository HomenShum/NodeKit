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
import { DEFAULT_ANTHROPIC_ROWS, ROOT, T0, anthropicMd, makeSet, openaiMd, readSeed, seededRegistry } from "./model-registry.fixtures.mjs";

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
  // was: assert.equal(role.price.source, "openrouter") - an anthropic role carried the OpenRouter price. Brief D-3: a
  // price is valid only on the transport that priced it, so an anthropic role has none (and no dispatch is priced from it).
  assert.equal(role.price, null, "an anthropic role carries no price: only OpenRouter priced it");
  assert.deepEqual(Object.keys(role.availability), ["anthropic"], "availability of the role's own transport only");
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
  // was: a price change of the pinned model on OpenRouter -> changed === true. Only OpenRouter prices it, and the role
  // routes through anthropic, so it is not a fact about this lock (brief D-3); the OpenRouter-role test below keeps it.
  for (const unrelated of [
    (n) => { n.entries["claude-haiku-5-5"].price.inPerM = 0.2; },
    (n) => { n.entries["claude-haiku-5-5"].availability.openrouter = { state: "unlisted", source: "openrouter", checkedAt: day(30) }; n.deprecations["claude-haiku-5-5/openrouter"] = { kind: "state", date: null, state: "unlisted", source: "openrouter", replacement: null }; },
    (n) => { n.entries["claude-haiku-5-5"].availability.openrouter.expiration = "2026-11-01"; n.deprecations["claude-haiku-5-5/openrouter"] = { kind: "expiration", date: "2026-11-01", source: "openrouter", replacement: null }; },
  ]) assert.equal(same(unrelated).changed, false, "another transport's price or lifecycle never opens a PR for an anthropic role");
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
  moved.entries["claude-haiku-5-5"].constraints.defaultEffort = "high"; // was price.outPerM = 9 (not a fact about an anthropic role any more)
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

// A repo that routes the same line through OpenRouter as well: there the price IS a fact about its transport.
const OR_CONFIG = { ...CONFIG, roles: { reasoner: { ...CONFIG.roles.reasoner, transport: "openrouter" } } };
const withOpenRouterLine = (registry) => { const next = clone(registry); next.lines["anthropic.haiku"].transports = ["anthropic", "openrouter"]; return next; };

test("an OpenRouter-routed role carries OpenRouter's price and availability, and only those transports' changes move it", async () => {
  const registry = withOpenRouterLine((await world()).registry);
  const { lock } = syncLock({ registry, config: OR_CONFIG, existing: null, registryRef: REF });
  const role = lock.roles.reasoner;
  assert.equal(role.price.source, "openrouter");
  assert.deepEqual(Object.keys(role.availability), ["openrouter"]);
  const change = (mutate) => { const next = clone(registry); mutate(next); return syncLock({ registry: next, config: OR_CONFIG, existing: lock, registryRef: "d".repeat(40) }).changed; };
  assert.equal(change((n) => { n.entries["claude-haiku-5-5"].price.inPerM = 0.2; }), true, "its own transport's price");
  assert.equal(change((n) => { n.entries["claude-haiku-5-5"].availability.openrouter.expiration = "2026-11-01"; n.deprecations["claude-haiku-5-5/openrouter"] = { kind: "expiration", date: "2026-11-01", source: "openrouter", replacement: null }; }), true, "its own transport's lifecycle");
  assert.equal(change((n) => { n.entries["claude-haiku-5-5"].availability.anthropic.retiresOn = "2027-03-01"; n.deprecations["claude-haiku-5-5/anthropic"] = { kind: "announced", date: "2027-03-01", source: "anthropicDocs", replacement: null }; }), false, "the other transport's lifecycle is not its business");
});

test("the consumer PR body shows the per-role diff, labels floor vs announced, ends with the closed-PR marker", async () => {
  const registry = withOpenRouterLine((await world()).registry);
  const { lock } = syncLock({ registry, config: OR_CONFIG, existing: null, registryRef: REF });
  const next = clone(registry);
  next.entries["claude-haiku-5-5"].price.inPerM = 0.2;
  next.entries["claude-haiku-5-5"].availability.openrouter.expiration = "2027-03-01";
  const { lock: updated } = syncLock({ registry: next, config: OR_CONFIG, existing: lock, registryRef: "d".repeat(40) });
  const hash = lockDecisionSha256(updated);
  const body = renderLockBody({ oldLock: lock, newLock: updated, hash, config: OR_CONFIG, snapshots: next.snapshots });
  assert.match(body, /## Snapshots the registry was computed from/);
  for (const [key, v] of Object.entries(next.snapshots)) assert.ok(body.includes(`- ${key}: sha256 \`${v.sha256}\``), `${key} sha256 in the body`);
  assert.match(body, /### `reasoner` \(anthropic\.haiku, openrouter\)/);
  assert.match(body, /price \(valid on the `openrouter` transport only\)/);
  assert.match(body, /expires 2027-03-01 \(announced\)/);
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
    const body = await readFile(path.join(tmp, "body.md"), "utf8");
    assert.match(body, /### `reasoner`/);
    assert.match(body, /- released: 2026-10-07 \(anthropic-release-notes\)/, "the CLI gives the body the registry's release facts");

    r = cli(["models", "sync", ...common, "--ref", REF, "--check", "--json"]);
    assert.equal(r.status, 0, "second sync changes nothing");
    assert.equal(JSON.parse(r.stdout).changed, false);
    assert.equal(await readFile(path.join(tmp, "models.lock.json"), "utf8"), written);

    r = cli(["models", "lint", ...common, "--now", "2026-10-17T00:00:00.000Z"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /MODELS LINT PASS/);

    const changed = YAML.parse(await readFile(registry, "utf8"));
    changed.entries["claude-haiku-5-5"].constraints.defaultEffort = "high"; // was price.inPerM = 0.3 (OpenRouter's price is not an anthropic role's fact)
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

// ---- Part B v1 adversarial review (round 1) ------------------------------------------------------------------

const FROZEN = { id: "tts-1", transport: "openai", class: "voice", reason: "voice fixture pinned by a customer", promotionPath: "a human PR" };

test("watch (B.9): a frozen id the registry has no entry for still raises its announced shutdown, and one that cannot be checked is listed, never passed", async () => {
  const { lock, registry } = await world();
  assert.equal(registry.deprecations["tts-1/openai"], undefined, "tts-1 is the consumer's own: no registry entry, no registry row");
  const set = makeSet();
  const frozen = { ...clone(lock), frozen: [FROZEN] };
  const fresh = { ok: true, latestSuccessAt: "2026-11-19T00:00:00Z" };
  const now = "2026-11-20T10:30:00Z"; // OpenAI's page says tts-1 shuts down 2027-01-06: 47 days

  const r = watchReport({ lock: frozen, registry, now, refreshRun: fresh, snapshotSet: set });
  assert.equal(r.urgent, true);
  assert.deepEqual(r.horizons.map((h) => [h.id, h.transport, h.days]), [["tts-1", "openai", 47]]);
  assert.match(r.body, /`tts-1` \(openai, frozen voice\): announced 2027-01-06 in 47 d, vendor-named replacement `gpt-realtime-2\.1-mini`/);
  assert.deepEqual(r.unchecked, []);

  // 90 days out is not yet urgent
  assert.equal(watchReport({ lock: frozen, registry, now: T0, refreshRun: fresh, snapshotSet: set }).urgent, false);

  // no snapshot set loaded: the frozen id is NOT CHECKED, which is said out loud
  const blind = watchReport({ lock: frozen, registry, now, refreshRun: fresh });
  assert.equal(blind.urgent, false);
  assert.deepEqual(blind.unchecked.map((u) => u.id), ["tts-1"]);
  assert.match(blind.body, /### Not checked[\s\S]*`tts-1` \(openai, frozen voice\): no catalog snapshot covers this transport, so its lifecycle is unknown\. This is not a statement that it is safe\./);

  // a transport no snapshot covers is not checked either, with the snapshots loaded
  const bedrock = { ...clone(lock), frozen: [{ ...FROZEN, id: "anthropic.claude-3-haiku", transport: "bedrock" }] };
  assert.deepEqual(watchReport({ lock: bedrock, registry, now, refreshRun: fresh, snapshotSet: set }).unchecked.map((u) => u.transport), ["bedrock"]);

  // an id the page has no notice for is simply active
  const quiet = { ...clone(lock), frozen: [{ ...FROZEN, id: "gpt-4o-mini-tts" }] };
  const q = watchReport({ lock: quiet, registry, now, refreshRun: fresh, snapshotSet: set });
  assert.deepEqual([q.urgent, q.horizons.length, q.unchecked.length], [false, 0, 0]);
});

test("watch --snapshots in a consumer checkout: the registry's snapshot files carry a frozen id's shutdown into the URGENT body", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "models-frozen-"));
  try {
    const set = makeSet();
    const snaps = path.join(tmp, "snapshots");
    await mkdir(snaps, { recursive: true });
    for (const [key, snap] of Object.entries(set.index.snapshots)) await writeFile(path.join(snaps, snap.file), set.texts[key]);
    await writeFile(path.join(snaps, "index.json"), JSON.stringify(set.index));
    await writeFile(path.join(tmp, "models.config.json"), JSON.stringify({ ...CONFIG, frozen: [FROZEN] }, null, 2));
    await writeFile(path.join(tmp, "runs.json"), JSON.stringify({ workflow_runs: [{ updated_at: "2026-11-19T00:00:00Z" }] }));
    const registry = path.join(ROOT, "models.yaml");
    const common = ["--repo-root", tmp, "--registry", registry];
    let r = cli(["models", "sync", ...common, "--ref", REF]);
    assert.equal(r.status, 0, r.stderr);
    const watch = (extra) => cli(["models", "watch", ...common, "--refresh-runs", path.join(tmp, "runs.json"), "--now", "2026-11-20T10:30:00Z", "--json", ...extra]);
    r = watch(["--snapshots", snaps]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).urgent, true);
    assert.match(JSON.parse(r.stdout).body, /`tts-1` \(openai, frozen voice\): announced 2027-01-06 in 47 d/);
    r = watch([]);
    assert.equal(JSON.parse(r.stdout).urgent, false);
    assert.match(JSON.parse(r.stdout).body, /Not checked/);
    // a snapshot directory that does not verify is refused, not skipped
    await writeFile(path.join(snaps, "openai-deprecations.md"), "tampered");
    r = watch(["--snapshots", snaps]);
    assert.notEqual(r.status, 0, "a snapshot whose bytes do not match index.json fails closed");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("sync --snapshot-index: the consumer PR body quotes the snapshot hashes from the fetched index.json, and an index that disagrees with models.yaml is refused", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "models-index-"));
  try {
    await writeFile(path.join(tmp, "models.config.json"), JSON.stringify(CONFIG, null, 2));
    const index = JSON.parse(await readFile(path.join(ROOT, "models/snapshots/latest/index.json"), "utf8"));
    const common = ["models", "sync", "--repo-root", tmp, "--registry", path.join(ROOT, "models.yaml"), "--ref", REF, "--body-out", path.join(tmp, "body.md")];
    await writeFile(path.join(tmp, "index.json"), JSON.stringify(index));
    let r = cli([...common, "--snapshot-index", path.join(tmp, "index.json")]);
    assert.equal(r.status, 0, r.stderr);
    const body = await readFile(path.join(tmp, "body.md"), "utf8");
    for (const [key, v] of Object.entries(index.snapshots)) assert.ok(body.includes(`- ${key}: sha256 \`${v.sha256}\``), key);
    index.snapshots.openaiDocs.sha256 = "0".repeat(64);
    await writeFile(path.join(tmp, "index.json"), JSON.stringify(index));
    r = cli([...common, "--snapshot-index", path.join(tmp, "index.json")]);
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /snapshot index disagrees with models\.yaml for openaiDocs/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---- Part B v1 adversarial review (round 2) ------------------------------------------------------------------

test("watch (B.9): a frozen id is judged on the catalogs fetched now, not on the snapshots main last committed", async () => {
  // The registry commits a snapshot only when ITS decision set changes, and a consumer's frozen id is never part of it.
  // Week 0: the committed snapshots have no notice for tts-1. Week 1: OpenAI posts a shutdown 47 days out; the refresh
  // run's decision set is unchanged, so main keeps the week-0 pages while the vendor page has moved on.
  const rowsWithout = [["January 14, 2027", "GPT-4.1 mini (`gpt-4.1-mini-2025-04-14`)", "`gpt-6-luna`"], ["2026‑09‑24", "`old-model`", "`new-model`"]];
  const rowsWith = [...rowsWithout, ["December 9, 2026", "`tts-1`", "`gpt-realtime-2.1-mini`"]];
  const week0 = makeSet({ texts: { openaiDocs: openaiMd(rowsWithout) } });
  const week1 = makeSet({ texts: { openaiDocs: openaiMd(rowsWith) } });
  const registry = await seededRegistry(week0, T0); // main after the last merged proposal
  const { lock } = syncLock({ registry, config: CONFIG, existing: null, registryRef: REF });
  const frozen = { ...clone(lock), frozen: [FROZEN] };
  const now = day(7);
  const fresh = { ok: true, latestSuccessAt: now };
  const onMain = watchReport({ lock: frozen, registry, now, refreshRun: fresh, snapshotSet: week0 });
  assert.equal(onMain.urgent, false, "main's snapshots do not know yet: this is what the consumer used to read");
  const live = watchReport({ lock: frozen, registry, now, refreshRun: fresh, snapshotSet: week1 });
  assert.equal(live.urgent, true);
  assert.deepEqual(live.horizons.map((h) => [h.id, h.days]), [["tts-1", 47]]);

  // a frozen id that IS a registry entry: the registry row it committed is older than the page just fetched
  const haiku = { id: "claude-haiku-4-5-20251001", transport: "anthropic", class: "judge", reason: "judge fixture", promotionPath: "a human PR" };
  assert.equal(registry.deprecations["claude-haiku-4-5-20251001/anthropic"].kind, "floor");
  const announced = makeSet({ texts: { anthropicDocs: anthropicMd({ rows: DEFAULT_ANTHROPIC_ROWS.map((r) => (r[0] === "claude-haiku-4-5-20251001" ? ["claude-haiku-4-5-20251001", "Deprecated", "October 20, 2026", "December 15, 2026"] : r)), notices: [["December 15, 2026", "claude-haiku-4-5-20251001", "claude-haiku-5-5"]] }) } });
  const judge = { ...clone(lock), frozen: [haiku] };
  assert.equal(watchReport({ lock: judge, registry, now, refreshRun: fresh }).urgent, false, "from the registry row alone: only a floor");
  const viaLive = watchReport({ lock: judge, registry, now, refreshRun: fresh, snapshotSet: announced });
  assert.equal(viaLive.urgent, true);
  assert.deepEqual(viaLive.horizons.map((h) => [h.id, h.kind2, h.date, h.replacement]), [["claude-haiku-4-5-20251001", "announced", "2026-12-15", "claude-haiku-5-5"]]);
});

test("the consumer PR body carries the release and per-transport lifecycle facts the registry has, labelled, and says they are not in the lock (SPEC B.6)", async () => {
  const { lock, registry } = await world();
  const next = clone(registry);
  next.entries["claude-haiku-5-5"].constraints.defaultEffort = "high";
  const { lock: updated } = syncLock({ registry: next, config: CONFIG, existing: lock, registryRef: "d".repeat(40) });
  const body = renderLockBody({ oldLock: lock, newLock: updated, hash: lockDecisionSha256(updated), config: CONFIG, snapshots: next.snapshots, registry: next });
  assert.match(body, /- released: 2026-10-07 \(anthropic-release-notes\)/);
  assert.match(body, /- lifecycle on anthropic: active, floor 2027-10-07 \(advisory\)/);
  assert.match(body, /- other transports \(information; not in the lock\): openrouter: listed/);
  // without the registry the body still renders (the facts are an addition, not a dependency)
  assert.doesNotMatch(renderLockBody({ oldLock: lock, newLock: updated, hash: lockDecisionSha256(updated), config: CONFIG }), /released:/);
});
