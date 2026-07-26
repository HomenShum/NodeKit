#!/usr/bin/env node
/**
 * brain-graph.mjs — extract the whole second brain into one graph.
 *
 * Both halves, one file. Every node and every edge comes from a real record on
 * disk. Nothing here is inferred or invented: an edge exists only where one
 * record names another by id, or where an edges row already says so.
 *
 * Sources
 *   repositories.yaml        repos
 *   ownership.yaml           contracts and who owns them
 *   evolution/events/**      promoted decisions, by track
 *   evolution/drafts/**      agent proposals, not canonical
 *   evolution/invariants/**  standing rules derived from decisions
 *   evolution/evidence/**    receipts
 *   evolution/assumptions/** open assumptions
 *   behavior-index.json      mapped behaviours
 *   brain.db                 leads, obligations, facts   (personal half)
 *   .claude/memory/*.md      durable facts about the operator
 *   .claude/skills/*         published skills
 *
 * Usage: node scripts/brain-graph.mjs > graph.json
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PLATFORM = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const BRAIN_DB = "C:/Users/hshum/Downloads/Interview items/brain/brain.db";

const N = new Map();   // id -> node
const E = [];          // {s, t, rel}
const missing = [];    // sources that were not found, reported not hidden

const add = (id, o) => { if (id && !N.has(id)) N.set(id, { id, ...o }); return id; };
const link = (s, t, rel) => { if (s && t && s !== t) E.push({ s, t, rel }); };

function readJSON(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function walk(dir) {
  if (!existsSync(dir)) { missing.push(dir); return []; }
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (extname(e.name) === ".json") out.push(p);
  }
  return out;
}

// -- repos ------------------------------------------------------------------
const repoYaml = join(PLATFORM, "repositories.yaml");
if (existsSync(repoYaml)) {
  const txt = readFileSync(repoYaml, "utf8");
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const name = raw.match(/^\s*-\s*name:\s*(\S+)/);
    if (name) { cur = add(`repo:${name[1]}`, { kind: "repo", label: name[1], half: "eng" }); continue; }
    if (!cur) continue;
    const role = raw.match(/^\s*role:\s*(\S+)/);
    const life = raw.match(/^\s*lifecycle:\s*(\S+)/);
    if (role) N.get(cur).role = role[1];
    if (life) N.get(cur).lifecycle = life[1];
  }
} else missing.push(repoYaml);

// -- contracts --------------------------------------------------------------
const ownYaml = join(PLATFORM, "ownership.yaml");
if (existsSync(ownYaml)) {
  for (const raw of readFileSync(ownYaml, "utf8").split(/\r?\n/)) {
    const c = raw.match(/^\s{0,4}([a-z][a-z0-9.-]*\.[a-z0-9.-]+):\s*$/);
    if (c) add(`contract:${c[1]}`, { kind: "contract", label: c[1], half: "eng" });
  }
} else missing.push(ownYaml);

// -- evolution records ------------------------------------------------------
const LANES = [
  ["events", "event"], ["drafts", "draft"], ["invariants", "invariant"],
  ["evidence", "evidence"], ["assumptions", "assumption"], ["adoptions", "adoption"],
];
for (const [dir, kind] of LANES) {
  for (const f of walk(join(PLATFORM, "evolution", dir))) {
    const d = readJSON(f);
    if (!d || !d.id) continue;
    const track = d.track || basename(dirname(f));
    const id = add(`${kind}:${d.id}`, {
      kind, label: d.id.replace(/^[a-z]+:/, ""), half: "eng", track,
      status: d.interpretation?.status || null,
      materiality: d.materiality || [],
      file: f.slice(PLATFORM.length + 1).replace(/\\/g, "/"),
    });
    for (const [field, rel, pfx] of [
      ["predecessorIds", "follows", null], ["supersedesIds", "supersedes", null],
      ["invariantIds", "establishes", "invariant"], ["evidenceIds", "proves", "evidence"],
      ["assumptionIds", "assumes", "assumption"],
    ]) {
      for (const ref of d[field] || []) {
        // Resolve to whichever lane actually holds it; do not invent a node.
        const cands = pfx ? [`${pfx}:${ref}`] : ["event", "draft"].map(k => `${k}:${ref}`);
        const hit = cands.find(c => N.has(c)) || cands[0];
        link(id, hit, rel);
      }
    }
    if (d.repository) link(id, `repo:${d.repository.split("/").pop()}`, "in");
  }
}

// -- behaviours -------------------------------------------------------------
const bi = readJSON(join(PLATFORM, "behavior-index.json"));
if (bi?.behaviors) {
  const list = Array.isArray(bi.behaviors) ? bi.behaviors : Object.values(bi.behaviors);
  for (const b of list) {
    const key = b.id || b.name;
    if (!key) continue;
    const id = add(`behavior:${key}`, { kind: "behavior", label: String(key), half: "eng" });
    for (const iv of b.invariants || b.invariantIds || []) link(id, `invariant:${iv}`, "covered-by");
  }
} else missing.push("behavior-index.json:behaviors");

// -- personal half ----------------------------------------------------------
if (existsSync(BRAIN_DB)) {
  const py = `
import json,sqlite3
c=sqlite3.connect(r"${BRAIN_DB}"); c.row_factory=sqlite3.Row
print(json.dumps({
 "nodes":[dict(r) for r in c.execute("select id,kind,name,status,due,cash_wks,data from nodes")],
 "edges":[dict(r) for r in c.execute("select src,dst,rel from edges")]}))`;
  try {
    const out = execFileSync("python", ["-c", py], { encoding: "utf8" });
    const b = JSON.parse(out);
    for (const r of b.nodes) {
      add(`me:${r.id}`, { kind: r.kind, label: r.name, half: "me",
                          status: r.status, due: r.due, cash: r.cash_wks });
    }
    for (const r of b.edges) link(`me:${r.src}`, `me:${r.dst}`, r.rel);
  } catch (e) { missing.push(`brain.db (${e.message.split("\n")[0]})`); }
} else missing.push(BRAIN_DB);

// -- memory + skills --------------------------------------------------------
const memDir = join(HOME, ".claude", "projects",
  "C--Users-hshum-Downloads-Interview-items", "memory");
if (existsSync(memDir)) {
  for (const f of readdirSync(memDir)) {
    if (extname(f) !== ".md" || f === "MEMORY.md") continue;
    add(`memory:${basename(f, ".md")}`, { kind: "memory", label: basename(f, ".md"), half: "mind" });
  }
} else missing.push(memDir);

const skillDir = join(HOME, ".claude", "skills");
if (existsSync(skillDir)) {
  for (const f of readdirSync(skillDir, { withFileTypes: true })) {
    if (!f.isDirectory()) continue;
    add(`skill:${f.name}`, { kind: "skill", label: f.name, half: "mind" });
  }
} else missing.push(skillDir);

// Threads are named explicitly: a thread referenced by a record is real
// provenance, and nothing else claims one.
for (const n of [...N.values()]) {
  if (!n.file) continue;
  const d = readJSON(join(PLATFORM, n.file));
  const ref = d?.source?.reasoningOrigin?.ref;
  if (ref) {
    const t = add(`thread:${ref.split("/").pop()}`,
      { kind: "thread", label: "ChatGPT thread", half: "mind", url: ref });
    link(n.id, t, "reasoned-in");
  }
}

// Drop edges whose target never materialised, and say how many.
const before = E.length;
const edges = E.filter(e => N.has(e.s) && N.has(e.t));

/**
 * Clusters, by label propagation over the undirected graph.
 *
 * Deliberately NOT the same partition as `half`. The halves are how the stores
 * are organised; clusters are how the records actually reference each other,
 * and the difference between the two is the interesting part. A cluster that
 * spans two halves is a real join. A half that shatters into many clusters is
 * a store whose records do not talk to each other.
 *
 * Fully deterministic: ties resolve to the lowest node id, and iteration order
 * is insertion order, so the same graph always yields the same partition.
 */
function cluster(){
  const adj = new Map([...N.keys()].map(k => [k, []]));
  for (const e of edges){ adj.get(e.s).push(e.t); adj.get(e.t).push(e.s); }
  const lab = new Map([...N.keys()].map(k => [k, k]));
  for (let pass = 0; pass < 30; pass++){
    let moved = 0;
    for (const id of N.keys()){
      const nb = adj.get(id);
      if (!nb.length) continue;
      const tally = new Map();
      for (const m of nb) tally.set(lab.get(m), (tally.get(lab.get(m)) || 0) + 1);
      let best = lab.get(id), bc = -1;
      for (const [l, ct] of [...tally].sort((a,b) => a[0] < b[0] ? -1 : 1))
        if (ct > bc){ bc = ct; best = l; }
      if (best !== lab.get(id)){ lab.set(id, best); moved++; }
    }
    if (!moved) break;
  }
  // Name each cluster after its highest-degree member, and drop singletons to
  // a shared "unconnected" bucket so the list stays readable.
  const deg = new Map([...N.keys()].map(k => [k, adj.get(k).length]));
  const groups = new Map();
  for (const [id, l] of lab) (groups.get(l) || groups.set(l, []).get(l)).push(id);
  const out = new Map();
  let i = 0;
  for (const [, ids] of [...groups].sort((a,b) => b[1].length - a[1].length)){
    if (ids.length < 2){ for (const id of ids) out.set(id, {c: -1, name: "unconnected"}); continue; }
    const hub = ids.slice().sort((a,b) => deg.get(b) - deg.get(a) || (a < b ? -1 : 1))[0];
    const name = N.get(hub).label;
    const ci = i++;
    for (const id of ids) out.set(id, {c: ci, name, size: ids.length});
  }
  return out;
}

const cl = cluster();
for (const n of N.values()){
  const g = cl.get(n.id) || {c: -1, name: "unconnected"};
  n.cluster = g.c; n.clusterName = g.name;
}
const clusterList = [...new Set([...cl.values()].filter(g => g.c >= 0)
  .map(g => JSON.stringify({c: g.c, name: g.name, size: g.size})))].map(JSON.parse)
  .sort((a,b) => b.size - a.size);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  counts: {
    nodes: N.size, edges: edges.length,
    danglingEdgesDropped: before - edges.length,
    byKind: [...N.values()].reduce((a, n) => (a[n.kind] = (a[n.kind] || 0) + 1, a), {}),
    byHalf: [...N.values()].reduce((a, n) => (a[n.half] = (a[n.half] || 0) + 1, a), {}),
    clusters: clusterList.length,
    unconnected: [...N.values()].filter(n => n.cluster < 0).length,
  },
  clusterList,
  sourcesNotFound: missing,
  nodes: [...N.values()],
  edges,
}, null, 2));
