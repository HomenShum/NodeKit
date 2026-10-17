// Public catalogs the model registry reads (SPEC-v9 §B.1, brief D-1/D-2). Four free, keyless sources.
// This file owns: the fixed source list, a bounded fetch, and one parser per source that THROWS on any
// structure it does not recognise. A parser that returns "nothing deprecated" for a re-laid-out page is the
// failure this module exists to prevent (a robot that is wrong without anyone noticing).
import { createHash } from "node:crypto";

export class SnapshotError extends Error {
  constructor(message, { kind, key } = {}) {
    super(message);
    this.name = "SnapshotError";
    this.kind = kind ?? "structure"; // "fetch" | "structure"
    this.key = key;
  }
}

// Fixed URLs only (SSRF): nothing in this module fetches a URL it was handed. minRows is the LiteLLM-style
// floor (constants.py MODEL_COST_MAP_MIN_MODEL_COUNT); SHRINK is its MAX_SHRINK_RATIO.
export const SNAPSHOT_SOURCES = Object.freeze({
  openrouter: { url: "https://openrouter.ai/api/v1/models", file: "openrouter.json", maxBytes: 8 * 1024 * 1024, minRows: 50 },
  anthropicDocs: { url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md", file: "anthropic-deprecations.md", maxBytes: 1024 * 1024, minRows: 5 },
  // minIdRows: rows that name at least one backticked model id (103 of 107 on 2026-10-16; the rest are API and
  // header deprecations). A page that lost its backticks still parses into rows, every id list empty, and would
  // read "nothing deprecated", so the id-bearing count has its own floor.
  openaiDocs: { url: "https://developers.openai.com/api/docs/deprecations.md", file: "openai-deprecations.md", maxBytes: 2 * 1024 * 1024, minRows: 3, minIdRows: 50 },
  googleDocs: { url: "https://ai.google.dev/gemini-api/docs/deprecations?hl=en", file: "google-deprecations.html", maxBytes: 2 * 1024 * 1024, minRows: 5 },
});
export const SNAPSHOT_KEYS = Object.freeze(Object.keys(SNAPSHOT_SOURCES));
export const SHRINK_RATIO = 0.5;
const ALLOWED_HOSTS = new Set(["openrouter.ai", "platform.claude.com", "docs.claude.com", "developers.openai.com", "ai.google.dev"]);
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- bounded fetch --------------------------------------------------------------------------------

async function readBounded(response, maxBytes, key) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new SnapshotError(`${key}: body ${declared} B exceeds ${maxBytes} B`, { kind: "fetch", key });
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SnapshotError(`${key}: body exceeds ${maxBytes} B`, { kind: "fetch", key });
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export async function fetchText(key, { fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const source = SNAPSHOT_SOURCES[key];
  let url = source.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new SnapshotError(`${key}: refusing to fetch ${parsed.origin}`, { kind: "fetch", key });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { accept: "*/*", "accept-language": "en-US,en;q=0.9", "user-agent": "nodekit-models/1" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new SnapshotError(`${key}: redirect without location`, { kind: "fetch", key });
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status !== 200) throw new SnapshotError(`${key}: HTTP ${response.status} from ${parsed.hostname}`, { kind: "fetch", key });
      // LF only: this repo normalises text to LF on commit, so a stored CRLF page would no longer match its sha256.
      return (await readBounded(response, source.maxBytes, key)).replace(/\r\n/g, "\n");
    } catch (error) {
      if (error instanceof SnapshotError) throw error;
      throw new SnapshotError(`${key}: ${error?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : error?.message ?? error}`, { kind: "fetch", key });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SnapshotError(`${key}: more than ${MAX_REDIRECTS} redirects`, { kind: "fetch", key });
}

// ---- dates ----------------------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "September 30, 2026", "Sep 30, 2026" and ISO "2026-09-30" (OpenAI also writes it with U+2011 hyphens).
export function parseVendorDate(text) {
  const clean = String(text).trim().replace(/[‐-―−]/g, "-");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})$/.exec(clean);
  const month = named ? MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) : -1;
  const date = iso ? clean : named && month >= 0 ? `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}` : null;
  return date && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
}
const mustDate = (text, key, what) => {
  const date = parseVendorDate(text);
  if (!date) throw new SnapshotError(`${key}: cannot read ${what} date "${String(text).slice(0, 60)}"`, { key });
  return date;
};

// ---- markdown tables (Anthropic, OpenAI) ----------------------------------------------------------

// Splits on unescaped pipes only: OpenAI writes a literal pipe inside a cell as backslash-pipe.
const cells = (line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.replaceAll("\\|", "|").trim());
const unTick = (cell) => cell.replaceAll("`", "").trim();

// All pipe tables whose header row matches `header`; returns the body rows of each, split into cells.
function tableRows(markdown, header) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let found = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith("|") || !header.test(lines[i])) continue;
    found += 1;
    let j = i + 2; // skip the |---| separator
    while (j < lines.length && lines[j].trimStart().startsWith("|")) {
      rows.push(cells(lines[j]));
      j += 1;
    }
    i = j;
  }
  return { rows, found };
}

const ANTHROPIC_MAIN = /^\|\s*API model name\s*\|\s*Current state\s*\|\s*Deprecated\s*\|\s*Tentative retirement date\s*\|\s*$/i;
const ANTHROPIC_NOTICE = /^\|\s*Retirement date\s*\|\s*Deprecated model\s*\|\s*Recommended replacement\s*\|\s*$/i;
const ANTHROPIC_STATES = new Set(["active", "legacy", "deprecated", "retired"]);

export function parseAnthropicDocs(markdown) {
  const key = "anthropicDocs";
  const main = tableRows(markdown, ANTHROPIC_MAIN);
  if (main.found !== 1) throw new SnapshotError(`${key}: expected exactly one "API model name | Current state | Deprecated | Tentative retirement date" table, found ${main.found}`, { key });
  const models = main.rows.map((row) => {
    if (row.length !== 4) throw new SnapshotError(`${key}: table row has ${row.length} cells: ${row.join(" | ").slice(0, 80)}`, { key });
    const [id, stateText, deprecated, retirement] = row.map(unTick);
    const state = stateText.toLowerCase();
    if (!ANTHROPIC_STATES.has(state)) throw new SnapshotError(`${key}: unknown state "${stateText}" for ${id}`, { key });
    const floor = /^Not sooner than (.+)$/i.exec(retirement);
    return {
      id,
      state,
      deprecatedAt: /^N\/A$/i.test(deprecated) ? null : mustDate(deprecated, key, `${id} deprecated`),
      retiresNotBefore: floor ? mustDate(floor[1], key, `${id} floor`) : null,
      retiresOn: floor || /^(To be announced|N\/A)$/i.test(retirement) ? null : mustDate(retirement, key, `${id} retirement`),
      quote: row.join(" | "),
    };
  });
  // The deprecation-history tables carry the vendor-named replacement. If none is found, the page was re-laid out:
  // reading that as "the vendor names no replacement" would be a wrong proposal, so it fails the run like any
  // other structure change (brief D-2: each docs parser must find its exact header).
  const history = tableRows(markdown, ANTHROPIC_NOTICE);
  if (history.found < 1) throw new SnapshotError(`${key}: no "Retirement date | Deprecated model | Recommended replacement" table`, { key });
  const notices = history.rows.map((row) => {
    if (row.length !== 3) throw new SnapshotError(`${key}: notice row has ${row.length} cells`, { key });
    return { retiresOn: mustDate(row[0], key, "notice retirement"), id: unTick(row[1]), replacement: unTick(row[2]) || null };
  });
  return { rows: models.length, models, notices };
}

// OpenAI's page holds many shutdown tables with differing column names ("Model / system", "Model snapshot",
// "Substitute model"). A table counts when its first column is "Shutdown date" and its second starts with
// "Model"; the last column is the replacement. A row whose width differs from its header is a layout change.
const OPENAI_HEADER = /^\|\s*Shutdown date\s*\|\s*Model[^|]*\|/i;
// A lowercase hyphenated token (gpt-4o-mini, o3-pro, gpt-4.1-mini-2025-04-14). The 4 id-less rows on the live page
// are "Videos API", "Assistants API" and "OpenAI-Beta: ...", none of which has one.
const BARE_ID = /(?<![\w-])[a-z][a-z0-9]*(?:-[a-z0-9.]+)+(?![\w-])/;
export function parseOpenAiDocs(markdown) {
  const key = "openaiDocs";
  const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const notices = [];
  let found = 0;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith("|") || !OPENAI_HEADER.test(lines[i])) continue;
    found += 1;
    const width = cells(lines[i]).length;
    let j = i + 2;
    for (; j < lines.length && lines[j].trimStart().startsWith("|"); j += 1) {
      const row = cells(lines[j]);
      if (row.length !== width) throw new SnapshotError(`${key}: row has ${row.length} cells, header ${width}: ${row.join(" | ").slice(0, 80)}`, { key });
      const earliest = /^at earliest\s+(.+)$/i.exec(row[0]);
      // A row that names no backticked id but whose name cell holds an id-shaped token lost its markup; it would
      // read as "no notice" for that model. The page-wide floor (minIdRows) cannot see one such row.
      if (!ticks(row[1]).length && BARE_ID.test(row[1])) throw new SnapshotError(`${key}: row names a model id without backticks: ${row.join(" | ").slice(0, 80)}`, { key });
      notices.push({ retiresOn: earliest ? null : mustDate(row[0], key, "shutdown"), retiresNotBefore: earliest ? mustDate(earliest[1], key, "earliest shutdown") : null, ids: ticks(row[1]), replacements: ticks(row[width - 1]), quote: row.join(" | ").slice(0, 300) });
    }
    i = j;
  }
  if (found < 1) throw new SnapshotError(`${key}: no "Shutdown date | Model ..." table`, { key });
  return { rows: notices.length, notices };
}

// ---- Google HTML ----------------------------------------------------------------------------------

const decode = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export function parseGoogleDocs(html) {
  const key = "googleDocs";
  const models = [];
  let tables = 0;
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const head = decode((table.match(/<thead[\s\S]*?<\/thead>/) ?? [""])[0]);
    if (!/^Model\s+Release date\s+Shutdown date\s+Recommended replacement$/i.test(head)) continue;
    tables += 1;
    for (const row of table.replace(/<thead[\s\S]*?<\/thead>/, "").match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      if (/colspan/i.test(row)) continue;
      const tds = [...row.matchAll(/<td[\s\S]*?<\/td>/g)].map((m) => decode(m[0]));
      if (tds.length === 0) continue;
      if (tds.length !== 4) throw new SnapshotError(`${key}: row has ${tds.length} cells: ${tds.join(" | ").slice(0, 80)}`, { key });
      // "N/A" appears only on a model the endpoint keeps serving by auto-routing to a successor, whose name is
      // the <code> id in the last cell ("...automatically routes API requests to gemini-3.8-flash").
      const routed = tds[2] === "N/A" && /automatically routes/i.test(tds[3]) ? (row.match(/<code[^>]*>([^<]+)<\/code>/g) ?? []).map(decode).at(-1) ?? null : null;
      if (tds[2] === "N/A" && !routed) throw new SnapshotError(`${key}: ${tds[0]} has shutdown N/A without an auto-route target`, { key });
      models.push({
        id: tds[0],
        shutdown: routed || /^No shutdown date announced$/i.test(tds[2]) ? null : mustDate(tds[2], key, `${tds[0]} shutdown`),
        autoRoutedTo: routed,
        replacement: routed ?? ((row.match(/<code[^>]*>([^<]+)<\/code>/g) ?? []).map(decode).slice(1)[0] || null),
        quote: tds.join(" | "),
      });
    }
  }
  if (tables < 1) throw new SnapshotError(`${key}: no "Model | Release date | Shutdown date | Recommended replacement" table`, { key });
  return { rows: models.length, models };
}

// ---- OpenRouter -----------------------------------------------------------------------------------

export function parseOpenRouter(text) {
  const key = "openrouter";
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new SnapshotError(`${key}: not JSON (${error.message})`, { key });
  }
  if (!Array.isArray(json?.data)) throw new SnapshotError(`${key}: no top-level data array`, { key });
  json.data.forEach((row, index) => {
    const ok = row && typeof row.id === "string" && row.pricing && typeof row.pricing === "object" && typeof row.context_length === "number";
    const expiryOk = row?.expiration_date === undefined || row.expiration_date === null || (typeof row.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date));
    if (!ok || !expiryOk) throw new SnapshotError(`${key}: row ${index} (${row?.id ?? "no id"}) lacks id, pricing or context_length, or has a malformed expiration_date`, { key });
  });
  return { rows: json.data.length, byId: new Map(json.data.map((row) => [row.id, row])) };
}

const PARSERS = Object.freeze({ openrouter: parseOpenRouter, anthropicDocs: parseAnthropicDocs, openaiDocs: parseOpenAiDocs, googleDocs: parseGoogleDocs });

// Parses one snapshot and applies the row tripwires: rows >= source minimum, and rows >= SHRINK_RATIO x the
// last committed rows (when known).
export function parseSnapshot(key, text, { previousRows = null } = {}) {
  const parsed = PARSERS[key](text);
  const { minRows, minIdRows } = SNAPSHOT_SOURCES[key];
  if (parsed.rows < minRows) throw new SnapshotError(`${key}: ${parsed.rows} rows is below the minimum ${minRows}`, { key });
  const idRows = minIdRows === undefined ? null : parsed.notices.filter((n) => n.ids.length).length; // not part of `parsed`: it is digested
  if (idRows !== null && idRows < minIdRows) throw new SnapshotError(`${key}: ${idRows} rows name a model id, below the minimum ${minIdRows} (the page's layout changed?)`, { key });
  if (Number.isInteger(previousRows) && previousRows > 0 && parsed.rows < previousRows * SHRINK_RATIO) {
    throw new SnapshotError(`${key}: ${parsed.rows} rows is under ${SHRINK_RATIO} x the last committed ${previousRows}`, { key });
  }
  return parsed;
}

// Fetches and parses all four. Any failure aborts the whole set (one weekly registry should fail loud);
// nothing is returned half-built.
export async function fetchSnapshots({ fetchImpl, now = new Date(), previousRows = {}, timeoutMs } = {}) {
  const fetchedAt = now.toISOString();
  const texts = {};
  const snapshots = {};
  for (const key of SNAPSHOT_KEYS) {
    texts[key] = await fetchText(key, { fetchImpl, timeoutMs });
    const { rows } = parseSnapshot(key, texts[key], { previousRows: previousRows[key] ?? null });
    snapshots[key] = { url: SNAPSHOT_SOURCES[key].url, file: SNAPSHOT_SOURCES[key].file, sha256: sha256(texts[key]), bytes: Buffer.byteLength(texts[key]), fetchedAt, rows };
  }
  return { texts, index: { schemaVersion: "nodeplatform.models-snapshots/v1", snapshots } };
}
