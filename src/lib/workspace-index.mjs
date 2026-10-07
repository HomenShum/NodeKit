// The workspace surface: one generated index that files every governance artifact in a repository
// under six fixed branches, each named for the QUESTION an orienting agent asks.
//
// Modeled on how Notion keeps a workspace navigable: the top level never changes, so anyone —
// human or driven agent — orients in thirty seconds regardless of what the workspace contains.
// NodeKit's own recorded failure is the inverse: 116 schemas and a skill that mentioned two, so
// every contract needed a human who already knew it existed. Coverage without navigation.
//
// Rules that keep this honest:
//
//   GENERATED, NEVER HAND-MAINTAINED. A curated index goes stale silently, and a stale map is
//   worse than none — `workspace check` refuses an index older than the newest artifact it maps,
//   the same freshness rule the repo map already enforces for code.
//
//   FILED BY QUESTION, NOT BY PRODUCER. Artifacts are recognized by their schemaVersion (or a
//   well-known filename), and routed to the question they answer. An agent asking "what was
//   decided?" must not need to know which tool wrote the answer down.
//
//   ABSENCE IS VISIBLE. A contract-shaped file the router does not recognize lands in `unfiled`,
//   listed in the map and refused by the gate. Silently dropping it would recreate the original
//   routing failure one layer up.

import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_SCHEMA = "nodekit.workspace.v1.schema.json";
export const WORKSPACE_SCHEMA_VERSION = "nodekit.workspace/v1";
export const WORKSPACE_MD = "WORKSPACE.md";
export const WORKSPACE_JSON = "workspace.json";

/** The six questions. Frozen — see the schema for why. */
export const BRANCHES = Object.freeze({
  record: "What was decided, measured, and proven?",
  openThreads: "What is open, deferred, or unsettled?",
  agents: "Who works here, and what do they already know?",
  connections: "What external things are load-bearing?",
  journey: "Where are we, and what happens next?",
  platform: "What can I run from here?",
});

// schemaVersion prefix -> branch. Substring match on the version string keeps this table short and
// lets new v2 schemas route without an edit; a version matching nothing files as unfiled.
const SCHEMA_ROUTES = [
  ["capability-contract", "record"],
  ["production-agent", "record"],
  ["adversarial-verdict", "record"],
  ["audience-research", "record"],
  ["build-evidence-pack", "record"],
  ["attestation", "record"],
  ["assumption", "record"],
  ["measurement", "record"],
  ["screenshot-proof", "record"],
  ["browser-certification", "record"],
  ["ease-proof", "record"],
  ["developer-timing", "record"],
  ["engineering-issue", "openThreads"],
  ["session", "agents"],
  ["agent-definition", "agents"],
  ["agent-ease", "agents"],
  ["nodeagent.", "agents"],
  ["skill", "agents"],
  ["integration", "connections"],
  ["builder-case", "journey"],
  ["builder-journey", "journey"],
  ["journey", "journey"],
  ["evolution", "journey"],
  ["delivery-brief", "journey"],
  ["opportunity", "journey"],
  ["limitations", "openThreads"],
  ["generated-candidate", "platform"],
  // Broad needles LAST: "evidence" would otherwise steal evolution-evidence from its family
  // above — first match wins, so family prefixes outrank generic suffixes.
  ["relevance", "record"],
  ["architecture-diff", "record"],
  ["claim", "record"],
  ["evidence", "record"],
  ["preflight", "record"],
  ["campaign-video", "record"],
  ["visual-qa", "record"],
  ["verification", "record"],
  ["browser-contract", "record"],
  ["distribution-gate", "record"],
];

// Well-known files that carry no schemaVersion but answer a branch question directly.
const FILE_ROUTES = [
  [/(^|[\\/])deferred\.ya?ml$/i, "openThreads", "deferred-ledger"],
  [/(^|[\\/])hackathon\.ya?ml$/i, "journey", "launch-brief"],
  [/(^|[\\/])harness\.ya?ml$/i, "platform", "harness-declaration"],
  [/(^|[\\/])integrations[\\/][^\\/]+\.ya?ml$/i, "connections", "integration-note"],
  [/(^|[\\/])repo-map\.json$/i, "platform", "repo-map"],
  [/(^|[\\/])behavior-index\.json$/i, "platform", "behavior-index"],
  [/(^|[\\/])MEMORY\.md$/i, "agents", "memory-index"],
  [/(^|[\\/])RUNBOOK[^\\/]*\.md$/i, "platform", "runbook"],
];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", ".next", "coverage", ".turbo", "public"]);
const MAX_FILES = 250000; // ponytail: hard scan ceiling; a repo bigger than this needs its own indexer
// Learned live: node-platform holds 120k files (59,831 proof receipts alone) — a 60k cap silently
// dropped half the repo, so two scans could disagree about what exists.
// Above this many files of one kind in one branch, the map lists ONE row with a count instead of
// every path. Learned live: node-platform's first index enumerated 9,689 screenshot/timing proof
// receipts one per line — a map nobody can read is a map, and a walk truncated by the file cap
// made two consecutive scans disagree about which 20,000 files existed.
const AGGREGATE_ABOVE = 20;

function* walk(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".") || e.name === ".claude") stack.push(path.join(dir, e.name)); continue; }
      if (++seen > MAX_FILES) return;
      yield path.join(dir, e.name);
    }
  }
}

// Meaning-based fallback, tried AFTER the specific routes. New instrument kinds keep appearing
// (the first self-index left 33 kinds unfiled), and almost all of them say what they are in the
// name: something proved/measured/decided files under record, something planned files under
// journey. A kind matching nothing still lands in unfiled — the fallback narrows the tail, it
// does not close the visibility rule.
const FALLBACK_ROUTES = [
  [/proof|verdict|receipt|conformance|observation|closure|approval|certification|eval|study|health|rule|trace/, "record"],
  [/manifest|story|task|quest|plan/, "journey"],
  [/trajectory|memory/, "agents"],
  [/packet|fixture|source/, "platform"],
];

function routeSchemaVersion(version) {
  for (const [needle, branch] of SCHEMA_ROUTES) if (version.includes(needle)) return branch;
  for (const [rx, branch] of FALLBACK_ROUTES) if (rx.test(version)) return branch;
  return null;
}

// schemaVersion sits at the top of every artifact this indexes — read 4 KB, not the file.
// Learned live: full reads over 59,831 proof receipts took >3 minutes; this build is <10 s.
const SNIFF_BYTES = 4096;
function sniffVersion(file) {
  const buf = Buffer.alloc(SNIFF_BYTES);
  let fd;
  try { fd = openSync(file, "r"); } catch { return null; }
  try {
    const n = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    const m = buf.toString("utf8", 0, n).match(/"schemaVersion"\s*:\s*"((?:nodekit|nodeagent)[^"]+)"/);
    return m?.[1] ?? null;
  } catch { return null; } finally { closeSync(fd); }
}

/** Scan the repo and build the index object (schema nodekit.workspace/v1). */
export function buildWorkspaceIndex(root, { now = new Date().toISOString() } = {}) {
  const branches = Object.fromEntries(Object.keys(BRANCHES).map((k) => [k, []]));
  const unfiled = [];
  // ponytail: after AGGREGATE_ABOVE identical sniffs in one directory, siblings inherit the kind
  // without being opened — a bin of thousands of receipts costs ~20 opens. Ceiling: a mixed-kind
  // bin misfiles the minority kind; split bins by kind if that ever matters.
  const dirStreak = new Map(); // dir -> { version, streak }
  for (const file of walk(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (rel.startsWith("schemas/") || rel.includes(".judge.")) continue; // schema definitions and judge outputs are tooling, not repo record
    // Test fixtures are deliberately contract-shaped — one is literally named
    // not-a-journey-artifact — and indexing them files a rehearsal as a fact.
    if (/^(test|tests|fixtures|calibration)\//.test(rel) || rel.includes("/fixtures/")) continue;
    // The map must not index itself: workspace.json carries a schemaVersion, so without this the
    // committed copy is stale BY CONSTRUCTION the moment it is written — check could never pass.
    if (rel === WORKSPACE_JSON || rel === WORKSPACE_MD) continue;
    const wellKnown = FILE_ROUTES.find(([rx]) => rx.test(rel));
    if (wellKnown) { branches[wellKnown[1]].push({ path: rel, kind: wellKnown[2] }); continue; }
    if (!/\.json$/i.test(rel)) continue;
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
    const cached = dirStreak.get(dir);
    let version;
    if (cached && cached.streak > AGGREGATE_ABOVE) {
      version = cached.version;
    } else {
      version = sniffVersion(file);
      if (cached && cached.version === version) cached.streak += 1;
      else dirStreak.set(dir, { version, streak: 1 });
    }
    if (!version) continue;
    const branch = routeSchemaVersion(version);
    if (branch) branches[branch].push({ path: rel, kind: version });
    else unfiled.push({ path: rel, kind: version });
  }
  // Aggregate bulk evidence: a kind with more than AGGREGATE_ABOVE files in a branch becomes one
  // row — the longest common directory, the kind, and a count. The count keeps freshness honest
  // (new receipts still change the map) without a nine-thousand-line index.
  const aggregate = (list) => {
    const byKind = new Map();
    for (const item of list) { if (!byKind.has(item.kind)) byKind.set(item.kind, []); byKind.get(item.kind).push(item); }
    const outList = [];
    for (const [kind, items] of byKind) {
      if (items.length <= AGGREGATE_ABOVE) { outList.push(...items); continue; }
      const dirs = items.map((i) => i.path.split("/").slice(0, -1));
      let prefix = dirs[0];
      for (const d of dirs) { let k = 0; while (k < prefix.length && prefix[k] === d[k]) k += 1; prefix = prefix.slice(0, k); }
      outList.push({ path: `${prefix.join("/") || "."}/`, kind, count: items.length });
    }
    return outList;
  };
  for (const key of Object.keys(branches)) branches[key] = aggregate(branches[key]);
  const unfiledOut = aggregate(unfiled);
  for (const list of [...Object.values(branches), unfiledOut]) list.sort((a, b) => a.path.localeCompare(b.path));
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, generatedAt: now, branches, unfiled: unfiledOut };
}

/** Render the human half of the index. Same content as workspace.json, never more. */
export function renderWorkspaceMd(index) {
  const lines = [
    "# Workspace map",
    "",
    "Generated by `nodekit workspace index` — do not edit by hand; regenerate instead.",
    "Six fixed branches, each the question an orienting agent asks first. Run `nodekit explain",
    "--for <your stack>` for the platform surfaces themselves.",
    "",
  ];
  for (const [key, question] of Object.entries(BRANCHES)) {
    const items = index.branches[key];
    lines.push(`## ${key} — ${question}`, "");
    if (items.length === 0) lines.push("(nothing filed — if this repo should have artifacts here, that absence is the finding)", "");
    else { for (const it of items) lines.push(`- \`${it.path}\` (${it.kind}${it.count ? `, ${it.count} files` : ""})`); lines.push(""); }
  }
  if (index.unfiled.length) {
    lines.push("## UNFILED — recognized as contract-shaped, not yet routed", "");
    for (const it of index.unfiled) lines.push(`- \`${it.path}\` (${it.kind})`);
    lines.push("", "Add a route for these kinds or they stay invisible to orientation — the failure this map exists to prevent.");
  }
  lines.push("", `_${index.generatedAt}_`, "");
  return lines.join("\n");
}

/** The gate: refusals, or [] when the committed index still tells the truth. */
export function checkWorkspace(root) {
  const refusals = [];
  const fresh = buildWorkspaceIndex(root);
  const artifactCount = Object.values(fresh.branches).reduce((a, l) => a + l.length, 0) + fresh.unfiled.length;
  const mdPath = path.join(root, WORKSPACE_MD);
  const jsonPath = path.join(root, WORKSPACE_JSON);
  if (!existsSync(mdPath) || !existsSync(jsonPath)) {
    if (artifactCount > 0) refusals.push(`no ${WORKSPACE_MD}/${WORKSPACE_JSON} while ${artifactCount} governance artifacts exist — run \`nodekit workspace index\``);
    return refusals;
  }
  let committed;
  try { committed = JSON.parse(readFileSync(jsonPath, "utf8")); } catch { return [`${WORKSPACE_JSON} is unreadable — regenerate it`]; }
  const flat = (ix) => [...Object.entries(ix.branches).flatMap(([b, l]) => l.map((i) => `${b}:${i.path}:${i.kind}:${i.count ?? 1}`)), ...ix.unfiled.map((i) => `unfiled:${i.path}:${i.kind}:${i.count ?? 1}`)].sort();
  const a = flat(fresh); const b = flat(committed);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const setB = new Set(b);
    const missing = a.filter((x) => !setB.has(x)).slice(0, 5);
    const stale = b.filter((x) => !new Set(a).has(x)).slice(0, 5);
    refusals.push(`the committed index no longer matches the repository (a stale map is worse than none)${missing.length ? ` — unindexed: ${missing.join(", ")}` : ""}${stale.length ? ` — vanished: ${stale.join(", ")}` : ""}`);
  }
  if (fresh.unfiled.length > 0) {
    refusals.push(`${fresh.unfiled.length} contract-shaped file(s) are UNFILED (${fresh.unfiled.map((i) => i.kind).join(", ")}) — route their kinds; an artifact off the map cannot be found by the next agent`);
  }
  return refusals;
}
