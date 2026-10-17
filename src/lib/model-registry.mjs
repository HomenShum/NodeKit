// The model registry: select (B.4), validate (B.2), decision set + digest (B.3), the G1 bot-diff allowlist,
// the closed-PR guard (brief D-5) and the proposal PR body. Pure functions over parsed snapshots; the CLI
// glue (models-cli.mjs) owns files and network. SPEC-v9 §B, brief 2026-10-16.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { SNAPSHOT_KEYS, SnapshotError, parseSnapshot, sha256 } from "./model-catalogs.mjs";
import { validateSchema } from "./schema-validation.mjs";

const load = createRequire(import.meta.url);
export const stringifyYaml = (value) => load("yaml").stringify(value, { lineWidth: 0 });

export const MODELS_SCHEMA_FILE = "nodeplatform.models.v1.schema.json";
export const SOAK_DAYS = 14;
export const TRIGGER_DAYS = 90; // B.4: an announced date this close moves `current` (if a replacement is eligible)
export const BLOCK_DAYS = 30; // B.2.2: an announced date this close makes `current` ineligible
const DAY = 86_400_000;
const TRANSPORT_SOURCE = Object.freeze({ anthropic: "anthropicDocs", openrouter: "openrouter", openai: "openaiDocs", google: "googleDocs" });
// A non-OpenRouter transport is verified by a vendor page only for that vendor's own models.
const SOURCE_PROVIDER = Object.freeze({ anthropicDocs: "anthropic", openaiDocs: "openai", googleDocs: "google" });

// ---- canonical JSON, hashing, dates ----------------------------------------------------------------

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const digestOf = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const clone = (value) => structuredClone(value);
const dayOf = (iso) => String(iso).slice(0, 10);
export const daysUntil = (date, evaluatedAt) => Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dayOf(evaluatedAt)}T00:00:00Z`)) / DAY);
// The 90/30-day window a dated row is in at `evaluatedAt`. It is part of the row, so the decision set changes on
// the run where a date crosses a window even when nothing else did (B.3), also on a line already held.
const horizonOf = (date, evaluatedAt) => {
  const days = daysUntil(date, evaluatedAt);
  return days <= BLOCK_DAYS ? BLOCK_DAYS : days <= TRIGGER_DAYS ? TRIGGER_DAYS : null;
};
const addDays = (iso, n) => new Date(Date.parse(`${dayOf(iso)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const sortedKeys = (object) => Object.fromEntries(Object.keys(object).sort().map((k) => [k, object[k]]));
const nonEmpty = (object) => object && typeof object === "object" && Object.keys(object).length > 0;

// ---- snapshot set -----------------------------------------------------------------------------------

// `index` is models/snapshots/latest/index.json; `texts` maps snapshot key -> file text. Re-hashes every file
// against the index (B.2.1 (2)) and parses it through its tripwire; throws SnapshotError on any mismatch.
export function parseSnapshotSet({ index, texts, previousRows = {} }) {
  if (index?.schemaVersion !== "nodeplatform.models-snapshots/v1") throw new SnapshotError("snapshot index.json has the wrong schemaVersion");
  const parsed = {};
  for (const key of SNAPSHOT_KEYS) {
    const row = index.snapshots?.[key];
    if (!row || typeof texts[key] !== "string") throw new SnapshotError(`${key}: missing from the snapshot set`, { key });
    if (sha256(texts[key]) !== row.sha256) throw new SnapshotError(`${key}: file does not re-hash to index.json`, { key });
    parsed[key] = parseSnapshot(key, texts[key], { previousRows: previousRows[key] ?? null });
    if (parsed[key].rows !== row.rows) throw new SnapshotError(`${key}: index.json says ${row.rows} rows, the file has ${parsed[key].rows}`, { key });
  }
  return { index, texts, parsed };
}

// ---- price / context from an OpenRouter row ---------------------------------------------------------

const perM = (perToken) => (perToken === undefined || perToken === null ? null : Number((Number(perToken) * 1e6).toPrecision(10)));

// D-3: priced by `openrouter`, valid only on that transport. An override with `min_prompt_tokens` becomes a tier;
// any other override condition (time windows) is folded into the base price as the per-key maximum, which is an
// upper bound. A `-1` or unparseable price is "no price" (null) so nothing downstream reserves against it.
export function priceFromOpenRouter(row) {
  const p = row.pricing;
  const inPerM = perM(p.prompt);
  const outPerM = perM(p.completion);
  if (![inPerM, outPerM].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const base = { inPerM, outPerM };
  const cache = perM(p.input_cache_read);
  if (Number.isFinite(cache) && cache >= 0) base.cacheReadPerM = cache;
  const tiers = [];
  for (const override of Array.isArray(p.overrides) ? p.overrides : []) {
    const tier = { inPerM: perM(override.prompt), outPerM: perM(override.completion), cacheReadPerM: perM(override.input_cache_read) };
    if (Number.isInteger(override.min_prompt_tokens) && override.min_prompt_tokens > 0) {
      tiers.push({ abovePromptTokens: override.min_prompt_tokens, inPerM: tier.inPerM ?? inPerM, outPerM: tier.outPerM ?? outPerM, ...(Number.isFinite(tier.cacheReadPerM) ? { cacheReadPerM: tier.cacheReadPerM } : {}) });
    } else {
      if (Number.isFinite(tier.inPerM)) base.inPerM = Math.max(base.inPerM, tier.inPerM);
      if (Number.isFinite(tier.outPerM)) base.outPerM = Math.max(base.outPerM, tier.outPerM);
      if (Number.isFinite(tier.cacheReadPerM) && base.cacheReadPerM !== undefined) base.cacheReadPerM = Math.max(base.cacheReadPerM, tier.cacheReadPerM);
    }
  }
  tiers.sort((a, b) => a.abovePromptTokens - b.abovePromptTokens);
  return { ...base, tiers, source: "openrouter" };
}

const contextFromOpenRouter = (row) => ({ maxInput: row.context_length, maxOutput: Number.isInteger(row.top_provider?.max_completion_tokens) ? row.top_provider.max_completion_tokens : null, source: "openrouter" });

const RELEASE_RANK = Object.freeze({ "anthropic-release-notes": 3, "hf-created-at": 2, "openrouter-canonical-slug": 1, "openrouter-created": 0 });
function releaseFromOpenRouter(row) {
  const slug = /-(\d{4})(\d{2})(\d{2})$/.exec(row.canonical_slug ?? "");
  if (slug) return { date: `${slug[1]}-${slug[2]}-${slug[3]}`, source: "openrouter-canonical-slug" };
  if (Number.isFinite(row.created)) return { date: new Date(row.created * 1000).toISOString().slice(0, 10), source: "openrouter-created" };
  return null;
}

// ---- availability (per transport, re-derived every run) ---------------------------------------------

// Returns { availability, replacements, quotes } for one entry. A transport with no snapshot is `unverified`:
// neither a trigger nor a block, only shown.
export function deriveAvailability(entry, parsed, evaluatedAt) {
  const availability = {};
  const replacements = {};
  const quotes = {};
  for (const [transport, wire] of Object.entries(entry.ids)) {
    const source = TRANSPORT_SOURCE[transport];
    if (!source || (SOURCE_PROVIDER[source] && SOURCE_PROVIDER[source] !== entry.provider)) {
      availability[transport] = { state: "unverified" };
      continue;
    }
    const checkedAt = evaluatedAt;
    if (source === "anthropicDocs") {
      const row = parsed.anthropicDocs.models.find((m) => m.id === wire);
      if (!row) {
        availability[transport] = { state: "unlisted", source, checkedAt };
        quotes[transport] = { snapshot: source, quote: `(no row for ${wire})` };
        continue;
      }
      const notice = parsed.anthropicDocs.notices.find((n) => n.id === wire);
      availability[transport] = { state: row.state, deprecatedAt: row.deprecatedAt, retiresOn: row.retiresOn ?? notice?.retiresOn ?? null, retiresNotBefore: row.retiresNotBefore, autoRoutedTo: null, source, checkedAt };
      replacements[transport] = notice?.replacement ? [notice.replacement] : [];
      quotes[transport] = { snapshot: source, quote: row.quote };
    } else if (source === "openrouter") {
      const row = parsed.openrouter.byId.get(wire);
      availability[transport] = row ? { state: "listed", expiration: row.expiration_date ?? null, source, checkedAt } : { state: "unlisted", source, checkedAt };
      quotes[transport] = { snapshot: source, quote: row ? `${wire} expiration_date=${row.expiration_date ?? "null"}` : `(no row for ${wire})` };
    } else if (source === "openaiDocs") {
      const notice = parsed.openaiDocs.notices.find((n) => n.ids.includes(wire));
      availability[transport] = notice
        ? { state: "deprecated", deprecatedAt: null, retiresOn: notice.retiresOn, retiresNotBefore: notice.retiresNotBefore, source, checkedAt }
        : { state: "active", deprecatedAt: null, retiresOn: null, retiresNotBefore: null, source, checkedAt }; // no notice on the page; the page lists only deprecations
      replacements[transport] = notice?.replacements ?? [];
      quotes[transport] = { snapshot: source, quote: notice ? notice.quote : `(no deprecation notice for ${wire})` };
    } else {
      const row = parsed.googleDocs.models.find((m) => m.id === wire);
      availability[transport] = row
        ? { state: row.autoRoutedTo ? "auto-routed" : row.shutdown ? "deprecated" : "active", retiresOn: row.shutdown, autoRoutedTo: row.autoRoutedTo, source, checkedAt }
        : { state: "unlisted", source, checkedAt };
      replacements[transport] = row?.replacement ? [row.replacement] : [];
      quotes[transport] = { snapshot: source, quote: row ? row.quote : `(no row for ${wire})` };
    }
  }
  return { availability, replacements, quotes };
}

// The machine-derived half of the registry, re-derived from the snapshots: each entry's availability, OpenRouter
// price / context / supported parameters and release date, then the deprecation rows. `select` writes them and
// `validateModels` re-derives them from the recorded snapshots to catch a hand edit (B.2.1 item 5). Mutates `next`.
function refreshDerived(next, parsed, evaluatedAt) {
  const evidenceMeta = {}; // `${id}/${transport}` -> {snapshot, quote}
  const replacementsOf = {}; // `${id}/${transport}` -> [names]
  for (const [id, entry] of Object.entries(next.entries)) {
    const derived = deriveAvailability(entry, parsed, evaluatedAt);
    entry.availability = derived.availability;
    for (const [t, q] of Object.entries(derived.quotes)) evidenceMeta[`${id}/${t}`] = q;
    for (const [t, r] of Object.entries(derived.replacements)) replacementsOf[`${id}/${t}`] = r;
    const row = entry.ids.openrouter ? parsed.openrouter.byId.get(entry.ids.openrouter) : null;
    if (row) {
      // A row that no longer yields a price must not leave the old OpenRouter price standing as if it were
      // current; a price a human recorded from a vendor page (any other source) is theirs and stays.
      entry.price = priceFromOpenRouter(row) ?? (entry.price?.source === "openrouter" ? null : entry.price);
      entry.context = contextFromOpenRouter(row);
      entry.supportedParameters = [...(row.supported_parameters ?? [])].sort();
      const found = releaseFromOpenRouter(row);
      const rank = entry.releaseDateSource === null ? -1 : (RELEASE_RANK[entry.releaseDateSource] ?? -1);
      if (found && (entry.releaseDate === null || RELEASE_RANK[found.source] > rank)) {
        entry.releaseDate = found.date;
        entry.releaseDateSource = found.source;
      }
      evidenceMeta[`${id}/openrouter-row`] = { snapshot: "openrouter", quote: `${row.id} prompt=${row.pricing.prompt} completion=${row.pricing.completion} context_length=${row.context_length} canonical_slug=${row.canonical_slug}` };
    }
  }
  const deprecations = {};
  for (const [id, entry] of Object.entries(next.entries)) {
    for (const [transport, av] of Object.entries(entry.availability)) {
      const key = `${id}/${transport}`;
      const row = deprecationRow(av, (replacementsOf[key] ?? [])[0] ?? null);
      if (row && (row.kind === "announced" || row.kind === "expiration")) row.horizon = horizonOf(row.date, evaluatedAt);
      if (row) deprecations[key] = row;
    }
  }
  next.deprecations = sortedKeys(deprecations);
  return { evidenceMeta, replacementsOf };
}

// The deprecation row for one (id, transport): an announced date, an expiration, a non-active state, or a floor.
// `unverified` has none. Shared with `watch`, which derives the same row for a consumer's frozen ids.
export function deprecationRow(av, replacement) {
  if (!av || av.state === "unverified") return null;
  if (av.retiresOn) return { kind: "announced", date: av.retiresOn, deprecatedAt: av.deprecatedAt ?? null, source: av.source, replacement };
  if (av.expiration) return { kind: "expiration", date: av.expiration, source: av.source, replacement };
  if (av.state !== "active" && av.state !== "listed") return { kind: "state", date: null, state: av.state, source: av.source, replacement };
  if (av.retiresNotBefore) return { kind: "floor", date: av.retiresNotBefore, source: av.source, replacement };
  return null;
}

// B.2.2 / B.4. A floor is never a factor. `trigger`: state outside {active, listed} or a date within 90 days.
// `eligible`: state active/listed and no date within 30 days. `unverified` is neither.
export function eligibility(av, evaluatedAt) {
  if (!av || av.state === "unverified") return { unverified: true, eligible: null, trigger: false };
  const dates = [av.retiresOn, av.expiration].filter(Boolean).sort();
  const days = dates.length ? daysUntil(dates[0], evaluatedAt) : null;
  const stateOk = av.state === "active" || av.state === "listed";
  const why = [];
  if (!stateOk) why.push(`state ${av.state}`);
  if (days !== null && days <= TRIGGER_DAYS) why.push(`${av.retiresOn ? "retires" : "expires"} ${dates[0]} (${days} d)`);
  return { unverified: false, eligible: stateOk && !(days !== null && days <= BLOCK_DAYS), trigger: !stateOk || (days !== null && days <= TRIGGER_DAYS), why: why.join("; ") };
}

// ---- lines ------------------------------------------------------------------------------------------

// What a `current` must carry (B.2.1 item 1) and so what a replacement must carry before the robot may move to it.
// Price and context come only from a catalog the bot reads for pricing (OpenRouter); a line that does not route
// through such a transport has none to give and is not asked for them. One rule, used by `validate` and `select`.
const PRICED_BY = Object.freeze(["openrouter"]);
export function missingCurrentFields(entry, line) {
  const fields = ["releaseDate", ...(line.transports.some((t) => PRICED_BY.includes(t)) ? ["context", "price"] : [])];
  return fields.filter((field) => entry[field] === null || entry[field] === undefined);
}

const versionOf = (line, id) => {
  const m = new RegExp(line.regex).exec(id);
  return m ? m.slice(1).filter((g) => g !== undefined).map((g) => Number(String(g).replace(/^-/, ""))) : null;
};
const compareVersion = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

// ---- select (B.4) -----------------------------------------------------------------------------------

export function select({ registry, snapshotSet, evaluatedAt, ref }) {
  const { parsed, index } = snapshotSet;
  const next = clone(registry);
  const report = { moves: [], held: [], added: [], advisories: [], soaking: [], available: [], information: [] };

  // 1. discover newer ids (v1: Anthropic lines, from the vendor table; the regex is the keyless fallback, D-7)
  for (const [lineName, line] of Object.entries(next.lines)) {
    const current = next.entries[line.current];
    if (!current || current.provider !== "anthropic" || !line.transports.includes("anthropic")) continue;
    const currentVersion = versionOf(line, line.current);
    if (!currentVersion) continue;
    for (const row of parsed.anthropicDocs.models) {
      const version = versionOf(line, row.id);
      const known = next.entries[row.id] || Object.values(next.entries).some((e) => e.ids.anthropic === row.id);
      if (!version || known || compareVersion(version, currentVersion) <= 0) continue;
      next.entries[row.id] = { provider: "anthropic", line: lineName, ids: { anthropic: row.id }, releaseDate: null, releaseDateSource: null, availability: {}, price: null, context: null, supportedParameters: [], reviewed: false };
      report.added.push({ id: row.id, line: lineName });
    }
  }

  // 2-3. refresh every entry's machine fields and the deprecation rows from the snapshots
  const { evidenceMeta, replacementsOf } = refreshDerived(next, parsed, evaluatedAt);

  // 4. lines
  for (const [lineName, line] of Object.entries(next.lines)) {
    const current = next.entries[line.current];
    if (!current) {
      report.held.push({ kind: "needs-human", line: lineName, id: line.current, detail: "current is not a key in entries" });
      continue;
    }
    // A move re-judges the NEW current: a replacement that itself retires in 31-90 days is eligible (B.4) but
    // triggers, so with nothing eligible after it the line is held in this same run. The next run over the same
    // catalogs is then a fixed point and no status-only PR follows the merge.
    const visited = new Set();
    const start = { current: line.current, previous: line.previous, moves: report.moves.length };
    let startSource = null;
    let held = false;
    for (;;) {
      visited.add(line.current);
      const incumbentNow = next.entries[line.current];
      const facts = line.transports.map((t) => ({ transport: t, ...eligibility(incumbentNow.availability[t], evaluatedAt) }));
      for (const f of facts.filter((x) => x.unverified)) report.information.push({ line: lineName, id: line.current, transport: f.transport, detail: "unverified: no snapshot for this transport" });
      const triggered = facts.filter((f) => f.trigger);
      if (!triggered.length) break;
      const reasons = triggered.map((f) => `${f.transport}: ${f.why}`);
      const named = triggered.flatMap((f) => replacementsOf[`${line.current}/${f.transport}`] ?? []);
      const tried = named.map((name) => ({ name, ...replacementFor(next, lineName, line, name, evaluatedAt, parsed) }));
      const candidate = tried.find((r) => r.ok && !visited.has(r.id));
      const source = evidenceMeta[`${line.current}/${triggered[0].transport}`] ?? null;
      startSource ??= source;
      if (!candidate && report.moves.length > start.moves && tried.some((r) => r.ok && visited.has(r.id))) {
        // The vendor pages name each other as replacements. Stopping at wherever the loop ran out would be a different
        // id every run (A -> B this week, B -> A next), a PR every week. Hold where the line started instead: the
        // next run starts there too and reaches the same answer.
        const loop = [...visited, ...tried.filter((r) => r.ok && visited.has(r.id)).map((r) => r.id)].join(" -> ");
        report.moves.length = start.moves;
        line.current = start.current;
        line.previous = start.previous;
        line.status = "held-no-replacement";
        report.held.push({ kind: "held-no-replacement", line: lineName, id: start.current, source: startSource, detail: `the vendor-named replacements form a cycle (${loop}), so no end of it is better than where the line is. A human must choose the id.` });
        held = true;
        break;
      }
      if (!candidate) {
        line.status = "held-no-replacement";
        const why = tried.length ? tried.map((r) => `${r.name}: ${r.ok ? "already passed through in this run" : r.why}`).join("; ") : "the vendor names no replacement";
        report.held.push({ kind: "held-no-replacement", line: lineName, id: line.current, source, detail: `${reasons.join("; ")}. ${why}. A human must add constraints/reviewed (or a transport id, or the missing fields) for a replacement.` });
        held = true;
        break;
      }
      report.moves.push({ line: lineName, from: line.current, to: candidate.id, reasons, source });
      line.previous = line.current;
      line.current = candidate.id;
      // No status of its own: the new current is judged by the next pass of this loop and below like any other,
      // so `status` is already the one the next run computes.
    }
    if (held) continue;
    const incumbent = next.entries[line.current];
    for (const t of line.transports) {
      const av = incumbent.availability[t];
      if (av?.retiresNotBefore && !av.retiresOn) {
        const passed = daysUntil(av.retiresNotBefore, evaluatedAt) < 0;
        report.advisories.push({ line: lineName, id: line.current, transport: t, detail: `floor ${av.retiresNotBefore}${passed ? " passed, no notice published" : ""} (advisory only; a floor never moves a default)` });
      }
    }
    const currentVersion = versionOf(line, line.current);
    const newer = Object.entries(next.entries)
      .filter(([id, e]) => e.line === lineName && id !== line.current && currentVersion && versionOf(line, id) && compareVersion(versionOf(line, id), currentVersion) > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    let status = "current";
    for (const [id, e] of newer) {
      if (!e.reviewed) {
        status = "held-unreviewed";
        report.held.push({ kind: "held-unreviewed", line: lineName, id, detail: "a newer id matches the line but has reviewed: false and no constraints; a human adds both to make it selectable" });
      } else if (!e.releaseDate || e.releaseDate > addDays(evaluatedAt, -SOAK_DAYS)) {
        if (status === "current") status = "soaking";
        report.soaking.push({ line: lineName, id, releaseDate: e.releaseDate, detail: e.releaseDate ? `released ${e.releaseDate}; soaks until ${addDays(e.releaseDate, SOAK_DAYS)}` : "no releaseDate: soaks until one is recorded" });
      } else {
        report.available.push({ line: lineName, id, releaseDate: e.releaseDate, detail: "soak complete; available. v1 never moves current on availability alone: a human edits models.yaml" });
      }
    }
    line.status = status;
  }

  // 5. canonical order + provenance
  next.entries = sortedKeys(next.entries);
  next.generatedAt = evaluatedAt;
  next.evaluatedAt = evaluatedAt;
  next.registryRef = ref;
  next.snapshots = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, { url: index.snapshots[key].url, sha256: index.snapshots[key].sha256, fetchedAt: index.snapshots[key].fetchedAt, rows: index.snapshots[key].rows }]));
  next.decisionDigest = decisionDigest(next, snapshotSet);
  report.evidence = evidenceRows(registry, next, evidenceMeta, index, report);
  return { proposal: next, report };
}

function replacementFor(registry, lineName, line, name, evaluatedAt, parsed) {
  const id = registry.entries[name] ? name : Object.keys(registry.entries).find((k) => Object.values(registry.entries[k].ids).includes(name));
  if (!id) return { ok: false, why: "not an entry in the registry" };
  const entry = registry.entries[id];
  if (entry.line !== lineName) return { ok: false, why: `belongs to line ${entry.line}, not ${lineName}` };
  if (!entry.reviewed || !nonEmpty(entry.constraints)) return { ok: false, why: "not reviewed (no constraints)" };
  const missing = line.transports.filter((t) => !entry.ids[t]);
  if (missing.length) return { ok: false, why: `no ${missing.join(", ")} id` };
  // Same for the id itself: a vendor can name a dated Claude id, a :free id or an alias, which `validate` refuses as a
  // `current`. Hold the line and say why; a human decides whether that id is what the line should follow.
  const problems = idProblems(id, lineName, line, entry, registry, parsed);
  if (problems.length) return { ok: false, why: `${problems.join("; ")} (not allowed as a line's current)` };
  // The robot must never propose a `current` that its own validation rejects (that fails the weekly run and no
  // repair PR opens): hold the line and name what a human has to record.
  const absent = missingCurrentFields(entry, line);
  if (absent.length) return { ok: false, why: `no ${absent.join(", ")} recorded (a human adds ${absent.length > 1 ? "them" : "it"}; no catalog the bot reads gives ${absent.length > 1 ? "them" : "it"} for this id)` };
  // B.4: "eligible on each" is the B.2.2 test (state active/listed, no date inside 30 days). A replacement that
  // itself retires in 31-90 days still qualifies and is moved again, with its own proposal, when its time comes;
  // an unverified transport is neither eligible nor ineligible and does not block.
  const bad = line.transports.filter((t) => eligibility(entry.availability[t], evaluatedAt).eligible === false);
  if (bad.length) return { ok: false, why: `not eligible on ${bad.join(", ")}` };
  return { ok: true, id };
}

// ---- decision set + digest (B.3) --------------------------------------------------------------------

function stripClock(value) {
  if (Array.isArray(value)) return value.map(stripClock);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "checkedAt").map(([k, v]) => [k, stripClock(v)]));
  return value;
}
// Exactly the fields a consumer lock can copy. The provenance block (generatedAt, evaluatedAt, registryRef,
// decisionDigest, snapshots) is deliberately absent: a new date or a new fetch alone never opens a PR.
export const decisionSet = (registry) => stripClock({ entries: registry.entries, lines: registry.lines, roles: registry.roles, deprecations: registry.deprecations });
export const decisionSetSha256 = (registry) => digestOf(decisionSet(registry));

// Clock-free provenance of the inputs a decision was computed from. Never compared, never an exit condition.
// Docs pages are digested by their parsed rows, not raw bytes: Google's HTML carries a per-request token, so a
// byte hash would change on every fetch of an unchanged page.
export function decisionDigest(registry, snapshotSet) {
  const rows = Object.values(registry.entries).map((e) => e.ids.openrouter).filter(Boolean).sort().map((id) => snapshotSet.parsed.openrouter.byId.get(id)).filter(Boolean).map((r) => ({
    id: r.id, canonical_slug: r.canonical_slug, created: r.created, prompt: r.pricing.prompt, completion: r.pricing.completion, input_cache_read: r.pricing.input_cache_read,
    overrides: r.pricing.overrides ?? null, context_length: r.context_length, max_completion_tokens: r.top_provider?.max_completion_tokens ?? null,
    supported_parameters: [...(r.supported_parameters ?? [])].sort(), reasoning: r.reasoning ?? null, expiration_date: r.expiration_date ?? null,
  }));
  return digestOf({ rows, docs: Object.fromEntries(["anthropicDocs", "openaiDocs", "googleDocs"].map((k) => [k, digestOf(snapshotSet.parsed[k])])) });
}

// ---- evidence rows (PR body) ------------------------------------------------------------------------

function leaves(value, prefix = []) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return [[prefix, value]];
  const entries = Object.entries(value);
  return entries.length === 0 ? [[prefix, {}]] : entries.flatMap(([k, v]) => leaves(v, [...prefix, k]));
}
export function diffLeaves(a, b) {
  const left = new Map(leaves(a).map(([p, v]) => [p.join("\u0000"), [p, v]]));
  const right = new Map(leaves(b).map(([p, v]) => [p.join("\u0000"), [p, v]]));
  const out = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const [pathL, valL] = left.get(key) ?? [null, undefined];
    const [pathR, valR] = right.get(key) ?? [null, undefined];
    if (canonical(valL) !== canonical(valR)) out.push({ path: pathR ?? pathL, old: valL, new: valR });
  }
  return out;
}

function evidenceRows(before, after, meta, index, report) {
  const rows = [];
  for (const change of diffLeaves(decisionSet(before), decisionSet(after))) {
    const [section, id, field, transport] = change.path;
    let source = null;
    if (section === "entries" && field === "availability") source = meta[`${id}/${transport}`];
    else if (section === "entries") source = meta[`${id}/openrouter-row`];
    else if (section === "deprecations") source = meta[id];
    if (section === "entries" && !before.entries[id]) source = meta[`${id}/anthropic`];
    if (section === "lines") source = (report.moves.find((m) => m.line === id) ?? report.held.find((h) => h.line === id && h.source))?.source ?? null;
    rows.push({ field: change.path.join("."), old: change.old ?? null, new: change.new ?? null, snapshot: source?.snapshot ?? "(registry rule)", sha256: source ? index.snapshots[source.snapshot]?.sha256 ?? null : null, quote: source?.quote ?? null });
  }
  return rows;
}

// ---- validate (B.2) ---------------------------------------------------------------------------------

const DATED_CLAUDE = /^claude-.+-\d{8}$/;
// What is wrong with an id as a line's `current`; [] when nothing is. One rule, used by `validate` (on the current)
// and by `select` (on a replacement before it moves there): the robot must not propose what its own validation rejects.
function idProblems(id, lineName, line, entry, registry, parsed) {
  const problems = [];
  // Only the wire ids of transports the line routes through: a bad row for a transport nobody on this line uses is
  // information, never a reason to stop the whole weekly run.
  const used = line.transports.map((t) => entry.ids[t]).filter(Boolean);
  for (const wire of [id, ...used]) {
    if (/:batch$/.test(wire)) problems.push(`uses a :batch id (${wire})`);
    if (/:free$/.test(wire) && registry.roles?.free?.line !== lineName) problems.push(`uses a :free id (${wire}) outside role free`);
    if (wire.startsWith("~") || wire.startsWith("openrouter/")) problems.push(`uses a router/alias id (${wire})`);
  }
  if (DATED_CLAUDE.test(id) || used.some((wire) => DATED_CLAUDE.test(wire))) problems.push("is a dated Claude id");
  if (/^claude-mythos-/.test(id)) problems.push("is claude-mythos-*");
  if (/-preview$/.test(id) && Object.entries(registry.entries).some(([other, e]) => e.line === entry.line && other !== id && !/-preview$/.test(other))) problems.push("is a -preview id while the line has a GA model");
  const row = line.transports.includes("openrouter") && entry.ids.openrouter ? parsed?.openrouter?.byId.get(entry.ids.openrouter) : null;
  if (row && (row.pricing.prompt === "-1" || row.pricing.completion === "-1")) problems.push("is a -1 priced OpenRouter row");
  return problems;
}

// Input validation + eligibility. `stage`: "inputs" = B.2.1 only (before select); "full" = B.2.1 + B.2.2 merge
// rule + registry/snapshot agreement. Returns { errors, findings }. Never throws on bad data.
export function validateModels({ registry, snapshotSet = null, snapshotError = null, evaluatedAt, stage = "full", maxAgeDays = null }) {
  const errors = [];
  const findings = [];
  const error = (message) => errors.push(message);
  if (!registry || typeof registry !== "object") return { errors: ["models.yaml is not an object"], findings };

  // schema errors are reported by the caller (async); here only referential rules, which assume a valid shape.
  for (const [lineName, line] of Object.entries(registry.lines ?? {})) {
    const current = registry.entries?.[line.current];
    if (!current) { error(`lines.${lineName}.current ${line.current} is not a key in entries`); continue; }
    if (current.reviewed !== true) error(`lines.${lineName}.current ${line.current} must have reviewed: true`);
    if (!nonEmpty(current.constraints)) error(`lines.${lineName}.current ${line.current} has no constraints`);
    for (const field of missingCurrentFields(current, line)) error(`lines.${lineName}.current ${line.current} has no ${field}`);
    for (const t of line.transports) if (!current.ids?.[t]) error(`lines.${lineName}.transports lists ${t} but ${line.current} has no ${t} id`);
    if (line.previous && !registry.entries[line.previous]) error(`lines.${lineName}.previous ${line.previous} is not a key in entries`);
    if (current.line !== lineName) error(`entries.${line.current}.line is ${current.line}, expected ${lineName}`);
    try { new RegExp(line.regex); } catch { error(`lines.${lineName}.regex does not compile`); }
    for (const problem of idProblems(line.current, lineName, line, current, registry, snapshotSet?.parsed)) error(`${lineName}: current ${line.current} ${problem}`);
  }
  for (const [id, entry] of Object.entries(registry.entries ?? {})) {
    if (!registry.lines?.[entry.line]) error(`entries.${id}.line ${entry.line} is not a line`);
    if (entry.reviewed === true && !nonEmpty(entry.constraints)) error(`entries.${id} is reviewed: true with no constraints`);
  }
  for (const [role, value] of Object.entries(registry.roles ?? {})) if (value.line && !registry.lines?.[value.line]) error(`roles.${role}.line ${value.line} is not a line`);

  // snapshots
  if (snapshotError) error(`snapshots: ${snapshotError.message}`);
  if (snapshotSet) {
    for (const key of SNAPSHOT_KEYS) {
      const row = snapshotSet.index.snapshots[key];
      if (maxAgeDays !== null) {
        const age = (Date.parse(evaluatedAt) - Date.parse(row.fetchedAt)) / DAY;
        if (!(age <= maxAgeDays) || age < -1) error(`snapshots.${key}: fetched ${row.fetchedAt} is ${age.toFixed(1)} d from ${evaluatedAt} (allowed 0..${maxAgeDays})`);
      }
      if (stage === "full" && registry.snapshots?.[key]?.sha256 !== row.sha256) error(`snapshots.${key}: models.yaml records ${String(registry.snapshots?.[key]?.sha256).slice(0, 12)} but index.json has ${row.sha256.slice(0, 12)}`);
    }
  }

  // eligibility (B.2.2): availability is re-derived from the snapshots at `evaluatedAt`, never trusted from the file
  if (stage === "full" && snapshotSet) {
    for (const [lineName, line] of Object.entries(registry.lines ?? {})) {
      const current = registry.entries?.[line.current];
      if (!current) continue;
      const { availability } = deriveAvailability(current, snapshotSet.parsed, evaluatedAt);
      for (const t of line.transports) {
        const e = eligibility(availability[t], evaluatedAt);
        if (e.unverified) findings.push({ line: lineName, transport: t, detail: "unverified (no snapshot for this transport)" });
        else if (e.eligible === false || e.trigger) findings.push({ line: lineName, transport: t, detail: `${line.current}: ${e.why}${e.eligible === false ? " (ineligible)" : " (trigger)"}` });
        if (e.eligible === false && line.status !== "held-no-replacement") error(`lines.${lineName}: current ${line.current} is ineligible on ${t} (${e.why}) and status is ${line.status}, not held-no-replacement`);
      }
    }
    // Baseline integrity (B.2.1 item 5): the bot-owned derived fields must be what the RECORDED snapshots give.
    // Not "reproducible from today's catalogs" (a retired incumbent may change them), only consistent with the
    // snapshots committed beside the file, so a hand-edited price, availability or deleted deprecation row fails.
    try {
      // At the clock the file records, not today's: the 90/30-day window on a deprecation row moves with time.
      errors.push(...derivedFieldErrors(registry, snapshotSet.parsed, registry.evaluatedAt ?? evaluatedAt));
    } catch (cause) {
      error(`cannot re-derive the bot-owned fields from the recorded snapshots: ${cause.message}`);
    }
  }
  return { errors, findings };
}

const DERIVED_ENTRY_FIELDS = Object.freeze(["availability", "price", "context", "supportedParameters"]);
export function derivedFieldErrors(registry, parsed, evaluatedAt) {
  const again = clone(registry);
  refreshDerived(again, parsed, evaluatedAt);
  const errors = [];
  for (const [id, entry] of Object.entries(registry.entries ?? {})) {
    for (const field of DERIVED_ENTRY_FIELDS) {
      if (canonical(stripClock(entry[field])) !== canonical(stripClock(again.entries[id][field]))) errors.push(`entries.${id}.${field} is bot-owned and does not match the recorded snapshots (run \`nodekit models select --write\`, do not edit it by hand)`);
    }
  }
  if (canonical(stripClock(registry.deprecations ?? {})) !== canonical(again.deprecations)) errors.push("deprecations is bot-owned and does not match the rows the recorded snapshots give (run `nodekit models select --write`, do not edit it by hand)");
  return errors;
}

// ---- G1: what a bot PR may change -------------------------------------------------------------------

const BOT_ENTRY_FIELDS = new Set(["ids", "releaseDate", "releaseDateSource", "availability", "price", "context", "supportedParameters"]);
const BOT_LINE_FIELDS = new Set(["current", "previous", "status"]);
const BOT_TOP = new Set(["generatedAt", "evaluatedAt", "registryRef", "decisionDigest", "snapshots", "deprecations"]);
const VERIFIED_TRANSPORTS = new Set(Object.keys(TRANSPORT_SOURCE));
export const BOT_WRITABLE_FILES = Object.freeze(["models.yaml", "models/selection-input.json"]);
export const BOT_WRITABLE_PREFIXES = Object.freeze(["models/snapshots/latest/"]);

export function checkChangedFiles(files) {
  return files.filter((f) => !BOT_WRITABLE_FILES.includes(f) && !BOT_WRITABLE_PREFIXES.some((p) => f.startsWith(p))).map((f) => `G1: bot PR changes ${f}, which is not on the bot-writable list`);
}

// Allowlist, not blocklist: a changed path that is not named here fails. A bot PR that removes any key under
// `entries` fails; absence from a catalog sets availability.<t>.state: unlisted and never deletes data.
export function botDiffViolations(base, head) {
  const violations = [];
  for (const id of Object.keys(base.entries ?? {})) if (!(id in (head.entries ?? {}))) violations.push(`G1: entries.${id} was removed`);
  for (const lineName of Object.keys(base.lines ?? {})) if (!(lineName in (head.lines ?? {}))) violations.push(`G1: lines.${lineName} was removed`);
  for (const change of diffLeaves(base, head)) {
    const [section, a, b, c] = change.path;
    const where = change.path.join(".");
    if (BOT_TOP.has(section) && change.path.length >= 1) continue;
    if (section === "entries") {
      if (!(a in (base.entries ?? {}))) {
        const entry = head.entries[a];
        if (entry.reviewed !== false || "constraints" in entry || "sdkSupport" in entry) violations.push(`G1: new entries.${a} must be reviewed: false with no constraints/sdkSupport`);
        continue;
      }
      if (b === "ids" && VERIFIED_TRANSPORTS.has(c)) continue;
      if (BOT_ENTRY_FIELDS.has(b) && b !== "ids") continue;
      violations.push(`G1: ${where} is human-owned (or not bot-writable)`);
    } else if (section === "lines") {
      if (BOT_LINE_FIELDS.has(b)) continue;
      violations.push(`G1: ${where} is human-owned`);
    } else {
      violations.push(`G1: ${where} is human-owned or not on the bot-writable list`);
    }
  }
  return [...new Set(violations)];
}

// ---- closed-PR guard (brief D-5) --------------------------------------------------------------------

export const decisionMarker = (hash) => `<!-- model-defaults:decision-set sha256=${hash} -->`;
export const markerHashOf = (body) => /<!-- model-defaults:decision-set sha256=([0-9a-f]{64}) -->/.exec(String(body ?? ""))?.[1] ?? null;

// `closedPrs`: [{ number, mergedAt, closedAt, body }] on the bot branch. Suppress iff the most recent closed PR
// was closed unmerged with the same decision-set hash. Any decision change yields a new hash and opens normally.
export function closedPrGuard(closedPrs, hash) {
  const latest = [...(closedPrs ?? [])].sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)))[0];
  if (latest && !latest.mergedAt && markerHashOf(latest.body) === hash) return { suppress: true, reason: `suppressed: closed by human (#${latest.number}, same decision set)` };
  return { suppress: false, reason: "no matching closed proposal" };
}

// ---- proposal PR body -------------------------------------------------------------------------------

const MAX_BODY = 60_000;
const cell = (v) => String(typeof v === "object" ? canonical(v) : v ?? "null").replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 160);

export function renderProposalBody({ report, proposal, hash, ref, extraFooter = "" }) {
  const lines = [];
  lines.push("## Summary", "");
  if (report.moves.length) for (const m of report.moves) lines.push(`- **${m.line}**: current moves \`${m.from}\` -> \`${m.to}\` (${m.reasons.join("; ")}).`);
  lines.push(`- ${report.evidence.length} decision field(s) changed; ${report.added.length} new unreviewed id(s); ${report.held.length} row(s) held for a human.`);
  lines.push(`- Registry ref \`${ref}\`, evaluated at \`${proposal.evaluatedAt}\`, input digest \`${proposal.decisionDigest.slice(0, 16)}\` (provenance only; never compared).`, "");
  lines.push("## Evidence", "", "| Field | Old | New | Snapshot (sha256) | Source row |", "|---|---|---|---|---|");
  const rows = report.evidence;
  const room = 200;
  for (const r of rows.slice(0, room)) lines.push(`| \`${r.field}\` | ${cell(r.old)} | ${cell(r.new)} | ${r.snapshot}${r.sha256 ? ` (${r.sha256.slice(0, 12)})` : ""} | ${cell(r.quote ?? "")} |`);
  if (rows.length > room) lines.push(`| ... | | | | ${rows.length - room} more rows omitted; see the diff |`);
  lines.push("", "## Held for a human", "");
  if (!report.held.length && !report.advisories.length && !report.information.length) lines.push("- none");
  for (const h of report.held) lines.push(`- \`${h.kind}\` **${h.line}** \`${h.id}\`: ${h.detail}`);
  for (const a of report.advisories) lines.push(`- advisory **${a.line}** \`${a.id}\` (${a.transport}): ${a.detail}`);
  for (const s of report.soaking) lines.push(`- soaking **${s.line}** \`${s.id}\`: ${s.detail}`);
  for (const s of report.available) lines.push(`- available **${s.line}** \`${s.id}\`: ${s.detail}`);
  for (const i of report.information) lines.push(`- information **${i.line}** \`${i.id}\` (${i.transport}): ${i.detail}`);
  lines.push("", "---", "",
    "- Human-owned edits (`constraints`, `reviewed`, `sdkSupport`, `lines.*.regex`, `lines.*.transports`, `roles`) go in their own PR to `main`: the G1 check rejects them on this branch, so a force-push here loses nothing G1 would accept.",
    "- Closing this PR keeps it closed until the decision set changes (a new horizon, retirement or entry gives a new hash).",
    "- Re-run with `workflow_dispatch` on `model-registry-refresh.yml`. A human merges; this bot never merges.");
  if (extraFooter) lines.push(extraFooter);
  lines.push("", decisionMarker(hash));
  let body = lines.join("\n");
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 200)}\n\n(body truncated at ${MAX_BODY} characters; see the diff)\n\n${decisionMarker(hash)}`;
  return body;
}

// ---- replay (B.2.3) ---------------------------------------------------------------------------------

export function selectionInput({ evaluatedAt, snapshotSet, inputRegistryText, ref }) {
  return { evaluatedAt, registryRef: ref, snapshotSha256s: Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, snapshotSet.index.snapshots[k].sha256])), inputRegistrySha256: sha256(inputRegistryText), toolingSha: ref };
}

// True when a time-dependent rule has a boundary between the two clocks: a dated row crossing the 90/30-day line, or
// a release date leaving its 14-day soak. Those, and only those, may change the decision set with the date (B.3).
function crossedBoundary(proposal, t1, t2) {
  const entries = Object.values(proposal.entries);
  const dates = entries.flatMap((e) => Object.values(e.availability ?? {}).flatMap((av) => [av.retiresOn, av.expiration])).filter(Boolean);
  if (dates.some((date) => horizonOf(date, t1) !== horizonOf(date, t2))) return true;
  return entries.some((e) => e.releaseDate && (e.releaseDate > addDays(t1, -SOAK_DAYS)) !== (e.releaseDate > addDays(t2, -SOAK_DAYS)));
}

// B.3: selection at two clocks over the same snapshots gives the same decisionDigest, and the same decision set unless a
// boundary lies between the clocks. Returns the first problem, or null.
export function clockProblem(first, second, t1, t2) {
  if (first.decisionDigest !== second.decisionDigest) return `decisionDigest differs between ${dayOf(t1)} and ${dayOf(t2)} over the same snapshots: the clock leaked into the digest`;
  if (decisionSetSha256(first) !== decisionSetSha256(second) && !crossedBoundary(first, t1, t2)) return `the decision set differs between ${dayOf(t1)} and ${dayOf(t2)} although no horizon or soak boundary lies between them`;
  return null;
}

// Re-runs selection from the same inputs and clock and compares to the proposal text byte for byte (B.2.3), then runs
// it a day later and checks the clock changed nothing it should not have (B.3).
// Compares proposal to proposal, never to the committed registry, so a retirement still replays.
export function replay({ inputRegistry, snapshotSet, input, proposalText, selectFn = select }) {
  const first = selectFn({ registry: inputRegistry, snapshotSet, evaluatedAt: input.evaluatedAt, ref: input.registryRef }).proposal;
  if (stringifyYaml(first) !== proposalText) return { ok: false, detail: "selection is not deterministic: re-running it over the same snapshots and clock produced different bytes" };
  const later = new Date(Date.parse(input.evaluatedAt) + DAY).toISOString();
  const problem = clockProblem(first, selectFn({ registry: inputRegistry, snapshotSet, evaluatedAt: later, ref: input.registryRef }).proposal, input.evaluatedAt, later);
  return problem ? { ok: false, detail: problem } : { ok: true };
}

export async function schemaErrors(registry) {
  return validateSchema(MODELS_SCHEMA_FILE, registry, "models.yaml");
}
