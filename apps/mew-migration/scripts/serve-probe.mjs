import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importExport } from "../src/importer.mjs";
import { emptyStore, saveStore } from "../src/store.mjs";
import { createApp } from "../src/serve.mjs";
import { readFile } from "node:fs/promises";

// Probe the served agent surface in both states it can honestly be in today, and write a receipt.
//
//   probe A — EMPTY store (the real current state: zero notes exist anywhere): every answer must
//             render unbound, with machine-readable state (data-nodekit-unbound="true").
//   probe B — labeled FIXTURE store: answers must carry fixture: note ids + digests; a question
//             matching nothing must still render unbound.
//
// Method is recorded as raw-http on every observation. Nothing here claims a rendered-DOM
// observation, and this receipt can never satisfy a LaunchManifest green claim — that gate needs
// a browser engine, which this script deliberately is not.
//
//   node scripts/serve-probe.mjs [--out <receipt.json>]

const outPath = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(".data", "serve-probe.json");
})();

function listen(app) {
  return new Promise((resolve) => app.listen(0, "127.0.0.1", () => resolve(app.address().port)));
}

async function probeOnce(name, dataDir, expectations) {
  const app = createApp({ dataDir });
  const port = await listen(app);
  const base = `http://127.0.0.1:${port}`;
  const observations = [];
  for (const { id, url, accept, mustContain, mustNotContain } of expectations) {
    const response = await fetch(`${base}${url}`, { headers: accept ? { accept } : {} });
    const body = await response.text();
    const found = mustContain.filter((needle) => body.includes(needle));
    const leaked = (mustNotContain ?? []).filter((needle) => body.includes(needle));
    observations.push({
      id,
      method: "raw-http",
      url,
      httpStatus: response.status,
      responseBytes: Buffer.byteLength(body),
      bodySha256: createHash("sha256").update(body).digest("hex"),
      expectedSignals: mustContain,
      signalsFound: found,
      forbiddenSignalsLeaked: leaked,
      pass: response.status === 200 && found.length === mustContain.length && leaked.length === 0,
    });
  }
  await new Promise((resolve) => app.close(resolve));
  return { name, dataDir: dataDir.replaceAll("\\", "/"), observations };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "mew-probe-"));

// Probe A: truly empty store.
const emptyDir = path.join(tmp, "empty");
await mkdir(emptyDir, { recursive: true });
const probeA = await probeOnce("empty-store", emptyDir, [
  {
    id: "root-discloses-empty-store",
    url: "/",
    mustContain: ['data-nodekit-artifact="mew-migration-agent-surface"', "store: 0 nodes, 0 relations, 0 relation types, 0 list entries", "No notebook data has been imported"],
  },
  {
    id: "ask-renders-unbound",
    url: "/ask?q=what+did+I+write+about+provenance",
    mustContain: ['data-nodekit-unbound="true"', "UNBOUND", "zero nodes"],
    mustNotContain: ['data-nodekit-unbound="false"', "<blockquote"],
  },
  {
    id: "ask-json-unbound",
    url: "/ask?q=provenance",
    accept: "application/json",
    mustContain: ['"unbound": true', '"bindings": []'],
  },
]);

// Probe B: labeled fixture store.
const fixtureDir = path.join(tmp, "fixture");
const doc = JSON.parse(await readFile(path.join("fixtures", "ideaflow-export.fixture.json"), "utf8"));
const { rows } = importExport(doc);
await saveStore(fixtureDir, { ...emptyStore(), ...rows });
const probeB = await probeOnce("fixture-store", fixtureDir, [
  {
    id: "ask-binds-to-fixture-ids",
    url: "/ask?q=provenance+migration",
    mustContain: ['data-nodekit-unbound="false"', 'data-note-id="fixture:node-alpha"', "data-note-digest="],
  },
  {
    id: "unmatched-question-stays-unbound",
    url: "/ask?q=zzz-nothing-matches-this",
    mustContain: ['data-nodekit-unbound="true"', "no stored node matches"],
  },
]);

const receipt = {
  schemaVersion: "mew.serve-probe-receipt/v1",
  probedAt: new Date().toISOString(),
  method: "raw-http against a locally served instance; NOT a rendered-DOM observation and usable by no green launch claim",
  probes: [probeA, probeB],
  pass: [probeA, probeB].every((p) => p.observations.every((o) => o.pass)),
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`serve-probe receipt written: ${outPath}`);
for (const probe of receipt.probes) {
  for (const o of probe.observations) console.log(`  [${o.pass ? "PASS" : "FAIL"}] ${probe.name}/${o.id} (${o.signalsFound.length}/${o.expectedSignals.length} signals, ${o.responseBytes} bytes)`);
}
process.exit(receipt.pass ? 0 : 1);
