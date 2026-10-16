// Builders for the model-registry scenarios. Small, real-shaped catalog pages (same headers and cell shapes as
// the live pages read on 2026-10-16) so the parsers and the tripwires run on what the vendors actually serve.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { SNAPSHOT_KEYS, SNAPSHOT_SOURCES, parseSnapshot } from "../src/lib/model-catalogs.mjs";
import { parseSnapshotSet } from "../src/lib/model-registry.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const T0 = "2026-10-16T10:30:00.000Z";
export const sha = (text) => createHash("sha256").update(text).digest("hex");

export async function readSeed() {
  return YAML.parse(await readFile(path.join(ROOT, "models.yaml"), "utf8"));
}

const anthropicHeader = ["| API model name | Current state | Deprecated | Tentative retirement date |", "| :--- | :--- | :--- | :--- |"];
const noticeHeader = ["| Retirement date | Deprecated model | Recommended replacement |", "| --- | --- | --- |"];

export const DEFAULT_ANTHROPIC_ROWS = [
  ["claude-haiku-5-5", "Active", "N/A", "Not sooner than October 7, 2027"],
  ["claude-haiku-4-5-20251001", "Active", "N/A", "Not sooner than October 15, 2026"],
  ["claude-sonnet-5-5", "Active", "N/A", "Not sooner than September 28, 2027"],
  ["claude-sonnet-4-5-20250929", "Deprecated", "September 30, 2026", "November 30, 2026"],
  ["claude-opus-5-5", "Active", "N/A", "Not sooner than September 22, 2027"],
  ["claude-opus-4-8", "Active", "N/A", "Not sooner than May 28, 2027"],
];
export const DEFAULT_NOTICES = [["November 30, 2026", "claude-sonnet-4-5-20250929", "claude-sonnet-5-5"]];

export function anthropicMd({ rows = DEFAULT_ANTHROPIC_ROWS, notices = DEFAULT_NOTICES } = {}) {
  return [
    "# Model deprecations", "", "## Model status", "",
    ...anthropicHeader, ...rows.map((r) => `| ${r.join(" | ")} |`), "",
    "## Deprecation history", "",
    ...(notices.length ? [...noticeHeader, ...notices.map(([d, id, rep]) => `| ${d} | \`${id}\` | \`${rep}\` |`)] : []), "",
  ].join("\n");
}

// `filler` rows keep the page above the id-bearing-row floor (SNAPSHOT_SOURCES.openaiDocs.minIdRows) the way the live
// page does (103 id rows); they name ids no registry entry uses.
export function openaiMd(rows = [["January 14, 2027", "GPT-4.1 mini (`gpt-4.1-mini-2025-04-14`)", "`gpt-6-luna`"], ["Jan 6, 2027", "`tts-1`", "`gpt-realtime-2.1-mini`"], ["2026‑09‑24", "`old-model`", "`new-model`"]], { filler = 60 } = {}) {
  const padding = Array.from({ length: filler }, (_, i) => ["2027-12-31", `\`filler-model-${i}\``, "`filler-replacement`"]);
  return ["# Deprecations", "", "| Shutdown date | Model / system | Recommended replacement |", "| --- | --- | --- |", ...[...rows, ...padding].map((r) => `| ${r.join(" | ")} |`), ""].join("\n");
}

export function googleHtml(rows = [["gemini-3.8-flash", "No shutdown date announced", ""], ["gemini-2.5-flash", "No shutdown date announced", ""], ["gemini-2.5-pro", "No shutdown date announced", ""], ["gemini-3.1-flash-lite", "May 7, 2027", "gemini-3.5-flash-lite"], ["gemini-3.5-flash", "N/A", "gemini-3.6-flash (not available to select; the endpoint is not shutting down and automatically routes API requests to <code>gemini-3.6-flash</code>)"]]) {
  const tr = ([id, shutdown, replacement]) => `<tr><td><code translate="no">${id}</code></td><td>June 17, 2025</td><td>${shutdown}</td><td>${replacement && !replacement.includes("<code>") ? `<code>${replacement}</code>` : replacement}</td></tr>`;
  return `<html><body><table class="pricing-table"><thead><tr><td><b>Model</b></td><td><b>Release date</b></td><td><b>Shutdown date</b></td><td><b>Recommended replacement</b></td></tr></thead><tbody><tr><td colspan="4">Preview models</td></tr>${rows.map(tr).join("")}</tbody></table></body></html>`;
}

export function orRow(id, overrides = {}) {
  const slug = `${id}-20260901`;
  return {
    id, canonical_slug: slug, created: 1788000000, context_length: 1_000_000,
    pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.00000001" },
    top_provider: { context_length: 1_000_000, max_completion_tokens: 128000 },
    supported_parameters: ["tools", "max_tokens"], expiration_date: null, ...overrides,
  };
}
export function openrouterJson({ rows, filler = 60 } = {}) {
  const base = rows ?? ["anthropic/claude-haiku-5.5", "anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-5.5"].map((id) => orRow(id));
  const data = [...base, ...Array.from({ length: filler }, (_, i) => orRow(`filler/model-${i}`))];
  return JSON.stringify({ data, total_count: data.length, links: { next: null } });
}

// A parsed, hash-verified snapshot set built from page text.
export function makeSet({ texts: overrides = {}, fetchedAt = T0, previousRows = {} } = {}) {
  const texts = { openrouter: openrouterJson(), anthropicDocs: anthropicMd(), openaiDocs: openaiMd(), googleDocs: googleHtml(), ...overrides };
  const snapshots = {};
  for (const key of SNAPSHOT_KEYS) {
    snapshots[key] = { url: SNAPSHOT_SOURCES[key].url, file: SNAPSHOT_SOURCES[key].file, sha256: sha(texts[key]), bytes: Buffer.byteLength(texts[key]), fetchedAt, rows: 0 };
  }
  // rows: count through the same parsers by building once without the index check
  const set = parseSnapshotSetUnchecked(texts, snapshots, previousRows);
  return { ...set, texts };
}
function parseSnapshotSetUnchecked(texts, snapshots, previousRows) {
  for (const key of SNAPSHOT_KEYS) snapshots[key].rows = parseSnapshot(key, texts[key], { previousRows: previousRows[key] ?? null }).rows;
  return parseSnapshotSet({ index: { schemaVersion: "nodeplatform.models-snapshots/v1", snapshots }, texts, previousRows });
}

// Mutable copy of the committed registry with bot fields filled from a snapshot set, as it would be after merge.
export async function seededRegistry(set, evaluatedAt = T0) {
  const { select } = await import("../src/lib/model-registry.mjs");
  const seed = await readSeed();
  return select({ registry: seed, snapshotSet: set, evaluatedAt, ref: "a".repeat(40) }).proposal;
}
