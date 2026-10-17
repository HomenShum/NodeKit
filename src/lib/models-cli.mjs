// `nodekit models snapshot | validate | select | replay | pr-guard | sync | lint | watch` (SPEC-v9 §B.2–B.6).
// Glue only: argument handling, files, the network. Rules live in model-registry.mjs / model-lock.mjs.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SNAPSHOT_KEYS, SNAPSHOT_SOURCES, SnapshotError, fetchSnapshots } from "./model-catalogs.mjs";
import {
  botDiffViolations, checkChangedFiles, closedPrGuard, decisionSetSha256, parseSnapshotSet, renderProposalBody,
  replay, schemaErrors, select, selectionInput, stringifyYaml, validateModels,
} from "./model-registry.mjs";
import { URGENT_LABEL, URGENT_TITLE, lintLock, lockDecisionSha256, renderLockBody, syncLock, validateConfig, watchReport } from "./model-lock.mjs";
import { readYaml } from "./files.mjs";

export const MODELS_SUBCOMMANDS = Object.freeze(["snapshot", "validate", "select", "replay", "pr-guard", "sync", "lint", "watch"]);
export const MODELS_USAGE = `  nodekit models snapshot [--out <dir>] [--registry <models.yaml>] [--repo-root <path>]
  nodekit models validate [--stage inputs|full] [--schema-only] [--evaluated-at <ISO>] [--max-age-days <n>] [--base <models.yaml>] [--changed-files <list>] [--registry <file>] [--snapshots <dir>] [--repo-root <path>] [--json]
  nodekit models select --evaluated-at <ISO> [--ref <sha>] [--write] [--body-out <file>] [--registry <file>] [--snapshots <dir>] [--repo-root <path>] [--json]
  nodekit models replay --input-registry <file> [--registry <file>] [--snapshots <dir>] [--repo-root <path>]
  nodekit models pr-guard --closed-prs <json> --hash <sha256>
  nodekit models sync --registry <models.yaml> [--snapshot-index <index.json>] [--config <file>] [--ref <sha>] [--check] [--body-out <file>] [--repo-root <path>]
  nodekit models lint [--registry <models.yaml>] [--config <file>] [--now <ISO>] [--repo-root <path>] [--json]
  nodekit models watch --registry <models.yaml> [--snapshots <dir>] [--refresh-runs <json>] [--now <ISO>] [--config <file>] [--repo-root <path>] [--json]`;

const flag = (value) => value === true || value === "true";
const one = (value, name) => {
  if (Array.isArray(value)) throw new Error(`--${name} was given more than once`);
  return value;
};
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const SCAN_SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".node-platform", ".model-registry"]);

async function readBounded(file) {
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error(`${file} exceeds ${MAX_FILE_BYTES} bytes`);
  return text;
}
const readJson = async (file) => JSON.parse(await readBounded(file));

function paths(options) {
  const root = path.resolve(one(options["repo-root"], "repo-root") ?? ".");
  return {
    root,
    registry: path.resolve(root, one(options.registry, "registry") ?? "models.yaml"),
    snapshots: path.resolve(root, one(options.snapshots, "snapshots") ?? "models/snapshots/latest"),
    selectionInput: path.resolve(root, "models/selection-input.json"),
    config: path.resolve(root, one(options.config, "config") ?? "models.config.json"),
  };
}

const evaluatedAtOf = (options, name = "evaluated-at") => {
  const given = one(options[name], name);
  const at = given === undefined ? new Date().toISOString() : given;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || !/^\d{4}-\d{2}-\d{2}T/.test(at)) throw new Error(`--${name} must be an ISO date-time`);
  return new Date(at).toISOString();
};

function currentRef(options, root) {
  const given = one(options.ref, "ref") ?? process.env.GITHUB_SHA;
  if (given) return given;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("--ref is required outside a git checkout");
  }
}

export async function loadSnapshotDir(dir, previousRows = {}) {
  const index = await readJson(path.join(dir, "index.json"));
  const texts = {};
  for (const key of SNAPSHOT_KEYS) {
    const file = index.snapshots?.[key]?.file;
    if (file !== SNAPSHOT_SOURCES[key].file) throw new SnapshotError(`${key}: index.json names file ${file}`, { key });
    texts[key] = await readBounded(path.join(dir, file));
  }
  return parseSnapshotSet({ index, texts, previousRows });
}

// Output: key=value lines when --github-output is set (for $GITHUB_OUTPUT), else JSON or text.
function emit(options, data, text) {
  if (options["github-output"] && typeof options["github-output"] === "string") {
    appendFileSync(options["github-output"], Object.entries(data).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
  console.log(options.json ? JSON.stringify(data, null, 2) : text);
}

export async function runModelsCommand(sub, parsed, { fetchImpl } = {}) {
  const { options } = parsed;
  const p = paths(options);
  switch (sub) {
    case "snapshot": return snapshotCommand(options, p, fetchImpl);
    case "validate": return validateCommand(options, p);
    case "select": return selectCommand(options, p);
    case "replay": return replayCommand(options, p);
    case "pr-guard": return prGuardCommand(options);
    case "sync": return syncCommand(options, p);
    case "lint": return lintCommand(options, p);
    case "watch": return watchCommand(options, p);
    default: throw new Error(`unknown models command: ${sub}`);
  }
}

async function snapshotCommand(options, p, fetchImpl) {
  const out = path.resolve(p.root, one(options.out, "out") ?? "models/snapshots/latest");
  let previousRows = {};
  try {
    const registry = await readYaml(p.registry);
    previousRows = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, registry.snapshots?.[k]?.rows ?? null]));
  } catch { /* first run: no committed rows to compare against */ }
  // The last committed pages in `out`: the baseline a partly changed page is judged against (none on a first run).
  const previousTexts = {};
  for (const key of SNAPSHOT_KEYS) {
    try { previousTexts[key] = await readBounded(path.join(out, SNAPSHOT_SOURCES[key].file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const { texts, index } = await fetchSnapshots({ fetchImpl, now: new Date(), previousRows, previousTexts });
  // Write beside, then rename: a failure leaves the previous snapshot set untouched. index.json goes last so a
  // crash between renames is caught by the re-hash in `validate`.
  const staging = `${out}.staging-${process.pid}-${randomUUID().slice(0, 8)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const key of SNAPSHOT_KEYS) await writeFile(path.join(staging, SNAPSHOT_SOURCES[key].file), texts[key]);
    await writeFile(path.join(staging, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    await mkdir(out, { recursive: true });
    for (const file of [...SNAPSHOT_KEYS.map((k) => SNAPSHOT_SOURCES[k].file), "index.json"]) await rename(path.join(staging, file), path.join(out, file));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  emit(options, { snapshots: Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, { sha256: index.snapshots[k].sha256, rows: index.snapshots[k].rows }])) },
    SNAPSHOT_KEYS.map((k) => `SNAPSHOT ${k}: ${index.snapshots[k].rows} rows sha256 ${index.snapshots[k].sha256.slice(0, 12)}`).join("\n"));
}

async function validateCommand(options, p) {
  const stage = one(options.stage, "stage") ?? "full";
  if (!["inputs", "full"].includes(stage)) throw new Error("--stage must be inputs or full");
  const evaluatedAt = evaluatedAtOf(options);
  const registry = await readYaml(p.registry);
  const base = options.base ? await readYaml(path.resolve(p.root, one(options.base, "base"))) : null;
  const errors = await schemaErrors(registry);
  let snapshotSet = null;
  let snapshotError = null;
  // --schema-only: a consumer reading the registry as data has no snapshots; it checks shape and references only.
  if (!flag(options["schema-only"])) try {
    snapshotSet = await loadSnapshotDir(p.snapshots, Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, (base ?? registry).snapshots?.[k]?.rows ?? null])));
  } catch (error) {
    if (!(error instanceof SnapshotError) && error?.code !== "ENOENT") throw error;
    snapshotError = error;
  }
  const maxAge = options["max-age-days"] === undefined ? null : Number(one(options["max-age-days"], "max-age-days"));
  if (maxAge !== null && !(maxAge > 0)) throw new Error("--max-age-days must be a positive number");
  const result = validateModels({ registry, snapshotSet, snapshotError, evaluatedAt, stage, maxAgeDays: errors.length ? null : maxAge });
  errors.push(...result.errors);
  if (base) errors.push(...botDiffViolations(base, registry));
  if (options["changed-files"]) {
    const list = (await readBounded(path.resolve(p.root, one(options["changed-files"], "changed-files")))).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    errors.push(...checkChangedFiles(list));
  }
  const data = { passed: errors.length === 0, stage, evaluatedAt, errors, findings: result.findings };
  emit(options, data, errors.length
    ? `MODELS VALIDATE BLOCKED (${stage}): ${errors.length} error(s)\n${errors.map((e) => `  ${e}`).join("\n")}`
    : `MODELS VALIDATE PASS (${stage}): ${Object.keys(registry.entries).length} entries, ${Object.keys(registry.lines).length} lines; ${result.findings.length} finding(s)${result.findings.map((f) => `\n  ${f.line} ${f.transport}: ${f.detail}`).join("")}`);
  if (errors.length) process.exitCode = 1;
}

async function selectCommand(options, p) {
  const evaluatedAt = evaluatedAtOf(options);
  const ref = currentRef(options, p.root);
  const inputText = await readBounded(p.registry);
  const registry = await readYaml(p.registry);
  const errors = await schemaErrors(registry);
  if (errors.length) throw new Error(`models.yaml is not valid: ${errors[0]}`);
  const snapshotSet = await loadSnapshotDir(p.snapshots, Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, registry.snapshots?.[k]?.rows ?? null])));
  const { proposal, report } = select({ registry, snapshotSet, evaluatedAt, ref });
  const changed = decisionSetSha256(proposal) !== decisionSetSha256(registry);
  const hash = decisionSetSha256(proposal);
  const proposalText = stringifyYaml(proposal);
  if (flag(options.write)) {
    await writeFile(p.registry, proposalText);
    await mkdir(path.dirname(p.selectionInput), { recursive: true });
    await writeFile(p.selectionInput, `${JSON.stringify(selectionInput({ evaluatedAt, snapshotSet, inputRegistryText: inputText, ref }), null, 2)}\n`);
  }
  if (options["body-out"]) await writeFile(path.resolve(p.root, one(options["body-out"], "body-out")), renderProposalBody({ report, proposal, hash, ref }));
  emit(options, { changed, decisionSetSha256: hash, evaluatedAt, moves: report.moves, held: report.held.length, added: report.added.length },
    `MODELS SELECT: ${changed ? "decision set CHANGED" : "decision set unchanged (no PR)"} (${hash.slice(0, 12)}); ${report.moves.length} move(s), ${report.held.length} held, ${report.added.length} new id(s)`);
}

async function replayCommand(options, p) {
  const input = await readJson(p.selectionInput);
  const inputText = await readBounded(path.resolve(p.root, one(options["input-registry"], "input-registry") ?? ""));
  const { sha256 } = await import("./model-catalogs.mjs");
  if (sha256(inputText) !== input.inputRegistrySha256) throw new Error("replay: --input-registry does not hash to selection-input.json inputRegistrySha256");
  const registry = (await import("yaml")).parse(inputText);
  const snapshotSet = await loadSnapshotDir(p.snapshots, Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, registry.snapshots?.[k]?.rows ?? null])));
  for (const key of SNAPSHOT_KEYS) if (snapshotSet.index.snapshots[key].sha256 !== input.snapshotSha256s[key]) throw new Error(`replay: ${key} snapshot differs from selection-input.json`);
  const result = replay({ inputRegistry: registry, snapshotSet, input, proposalText: await readBounded(p.registry) });
  console.log(result.ok ? "MODELS REPLAY PASS: the proposal reproduces byte for byte, and a day later the digest and (absent a boundary) the decision set are unchanged" : `MODELS REPLAY FAILED: ${result.detail}`);
  if (!result.ok) process.exitCode = 1;
}

async function prGuardCommand(options) {
  const closed = await readJson(path.resolve(one(options["closed-prs"], "closed-prs")));
  const hash = one(options.hash, "hash");
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new Error("--hash must be a sha256 hex digest");
  const { suppress, reason } = closedPrGuard(Array.isArray(closed) ? closed : [], hash);
  emit(options, { suppress, reason }, reason);
}

async function readConfig(p) {
  const config = await readJson(p.config);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`models.config.json: ${errors.join("; ")}`);
  return config;
}
async function readLock(p, config) {
  try { return await readJson(path.resolve(p.root, config.lock)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function syncCommand(options, p) {
  const config = await readConfig(p);
  const registry = await readYaml(path.resolve(p.root, one(options.registry, "registry") ?? "models.yaml"));
  const errors = await schemaErrors(registry);
  if (errors.length) throw new Error(`registry is not valid: ${errors[0]}`);
  const existing = await readLock(p, config);
  const registryRef = one(options.ref, "ref") ?? registry.registryRef;
  const { lock, changed } = syncLock({ registry, config, existing, registryRef });
  const hash = lockDecisionSha256(lock);
  if (changed && !flag(options.check)) await writeFile(path.resolve(p.root, config.lock), `${JSON.stringify(lock, null, 2)}\n`);
  // --snapshot-index: the registry's models/snapshots/latest/index.json, fetched as data (SPEC B.6). The PR body
  // quotes the hashes from it, after checking they are the ones models.yaml records.
  let snapshots = registry.snapshots;
  if (options["snapshot-index"]) {
    const index = await readJson(path.resolve(one(options["snapshot-index"], "snapshot-index")));
    for (const [key, recorded] of Object.entries(registry.snapshots ?? {})) {
      if (index?.snapshots?.[key]?.sha256 !== recorded.sha256) throw new Error(`snapshot index disagrees with models.yaml for ${key}: ${index?.snapshots?.[key]?.sha256 ?? "missing"} vs ${recorded.sha256}`);
    }
    snapshots = index.snapshots;
  }
  if (options["body-out"]) await writeFile(path.resolve(p.root, one(options["body-out"], "body-out")), renderLockBody({ oldLock: existing, newLock: lock, hash, config, snapshots, registry }));
  emit(options, { changed, decisionSetSha256: hash }, changed ? `MODELS SYNC: lock ${flag(options.check) ? "would change" : "rewritten"} (${hash.slice(0, 12)})` : `MODELS SYNC: lock unchanged (${hash.slice(0, 12)})`);
  if (changed && flag(options.check)) process.exitCode = 1;
}

async function listSources(root, dir = "") {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (SCAN_SKIP.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listSources(root, rel)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

async function lintCommand(options, p) {
  const config = await readConfig(p);
  const lock = await readLock(p, config);
  if (!lock) throw new Error(`${config.lock} does not exist; run \`nodekit models sync\``);
  const registry = options.registry ? await readYaml(path.resolve(p.root, one(options.registry, "registry"))) : null;
  const files = [];
  for (const rel of await listSources(p.root)) {
    // A source file over 1 MiB is a generated bundle, not code someone typed a model id into.
    if ((await stat(path.join(p.root, rel))).size > 1024 * 1024) continue;
    files.push({ path: rel, text: await readFile(path.join(p.root, rel), "utf8") });
  }
  const result = lintLock({ lock, config, files, registry, now: evaluatedAtOf(options, "now") });
  emit(options, { passed: result.errors.length === 0, ...result },
    `${result.errors.length ? `MODELS LINT BLOCKED: ${result.errors.length} error(s)` : "MODELS LINT PASS"}${[...result.errors.map((e) => `\n  ERROR ${e}`), ...result.warnings.map((w) => `\n  WARN ${w}`), ...result.advisories.map((a) => `\n  ADVISORY ${a}`)].join("")}`);
  if (result.errors.length) process.exitCode = 1;
}

async function watchCommand(options, p) {
  const config = await readConfig(p);
  const lock = await readLock(p, config);
  if (!lock) throw new Error(`${config.lock} does not exist`);
  const registry = await readYaml(path.resolve(p.root, one(options.registry, "registry")));
  let refreshRun = { ok: false, latestSuccessAt: null };
  if (options["refresh-runs"]) {
    try {
      const runs = await readJson(path.resolve(one(options["refresh-runs"], "refresh-runs")));
      if (Array.isArray(runs?.workflow_runs)) refreshRun = { ok: true, latestSuccessAt: runs.workflow_runs[0]?.updated_at ?? runs.workflow_runs[0]?.created_at ?? null };
    } catch { /* unreadable: stays ok:false, which is itself an URGENT finding */ }
  }
  // --snapshots: the registry's catalog snapshots (re-hashed and parsed like the registry's own run), needed only to
  // check a frozen id the registry has no entry for.
  const snapshotSet = options.snapshots ? await loadSnapshotDir(p.snapshots, {}) : null;
  const report = watchReport({ lock, registry, now: evaluatedAtOf(options, "now"), refreshRun, snapshotSet });
  emit(options, { urgent: report.urgent, title: URGENT_TITLE, label: URGENT_LABEL, body: report.body }, report.urgent ? report.body : "MODELS WATCH: no announced horizon within 60 days; registry refresh is running");
}

// Same shape and the same repeated-flag rule as cli-main's parser: a repeated flag collects into an array and a
// verb that expects one value refuses, instead of silently acting on the last of several.
export function parseModelsArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [name, inline] = token.slice(2).split("=", 2);
    let value = true;
    if (inline !== undefined) value = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) { value = argv[i + 1]; i += 1; }
    options[name] = Object.hasOwn(options, name) ? [...[].concat(options[name]), value] : value;
  }
  return { options, positional };
}
