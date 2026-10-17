// Consumer side of the model registry (SPEC-v9 §B.5, §B.6, §B.9): build models.lock.json from the registry
// and a repo's models.config.json, lint it (G2), report horizons for `watch`, render the consumer PR body.
// Pure functions; models-cli.mjs owns files and the network.
import { canonical, daysUntil, decisionMarker, deprecationRow, deriveAvailability, digestOf } from "./model-registry.mjs";

export const LOCK_SCHEMA = "nodeplatform.model-defaults/v1";
export const URGENT_TITLE = "Model defaults: URGENT";
export const URGENT_LABEL = "model-defaults";
export const WATCH_HORIZON_DAYS = 60;
export const LINT_BLOCK_DAYS = 30;
export const REFRESH_MAX_AGE_DAYS = 14;

const stripClock = (value) => {
  if (Array.isArray(value)) return value.map(stripClock);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "checkedAt").map(([k, v]) => [k, stripClock(v)]));
  return value;
};

export function validateConfig(config) {
  const errors = [];
  if (config?.contractVersion !== LOCK_SCHEMA) errors.push(`models.config.json must use contractVersion ${LOCK_SCHEMA}`);
  if (typeof config?.lock !== "string" || !config.lock) errors.push("models.config.json needs a lock path");
  if (!config?.roles || !Object.keys(config.roles).length) errors.push("models.config.json needs at least one role");
  for (const [role, spec] of Object.entries(config?.roles ?? {})) {
    if (typeof spec?.line !== "string" || typeof spec?.transport !== "string") errors.push(`role ${role} needs line and transport`);
  }
  for (const key of ["frozen", "exclude", "idAllowlist"]) if (config?.[key] !== undefined && !Array.isArray(config[key])) errors.push(`${key} must be an array`);
  return errors;
}

// The lock. Throws (a held proposal for a human) when a role cannot be resolved: that is the honest outcome,
// never a guessed id.
export function buildLock({ registry, config }) {
  const exclude = [...(config.exclude ?? [])].sort();
  const known = {};
  for (const [id, entry] of Object.entries(registry.entries)) {
    if (!entry.reviewed || exclude.includes(id)) continue;
    known[id] = { provider: entry.provider, ids: { ...entry.ids }, constraints: entry.constraints ?? {} };
  }
  const roles = {};
  for (const [role, spec] of Object.entries(config.roles)) {
    const line = registry.lines[spec.line];
    if (!line) throw new Error(`role ${role}: line ${spec.line} is not in the registry`);
    if (!line.transports.includes(spec.transport)) throw new Error(`role ${role}: transport ${spec.transport} is not in lines.${spec.line}.transports (${line.transports.join(", ")})`);
    if (exclude.includes(line.current)) throw new Error(`role ${role}: registry current ${line.current} is excluded for this repo; a human must decide`);
    const entry = registry.entries[line.current];
    if (!entry?.reviewed) throw new Error(`role ${role}: registry current ${line.current} is not reviewed`);
    if (!entry.ids[spec.transport]) throw new Error(`role ${role}: ${line.current} has no ${spec.transport} id`);
    // Lifecycle and price are facts about ONE transport. A role that routes through `anthropic` must not change
    // (and open a PR) because the same id was unlisted on OpenRouter or re-priced there: it keeps the availability
    // of its own transport, and a price only when that transport priced it (brief D-3).
    const own = entry.availability?.[spec.transport];
    roles[role] = {
      line: spec.line,
      lineTransports: [...line.transports],
      transport: spec.transport,
      id: line.current,
      provider: entry.provider,
      ids: { ...entry.ids },
      constraints: entry.constraints,
      availability: own ? { [spec.transport]: stripClock(own) } : {},
      price: entry.price?.source === spec.transport ? entry.price : null,
      ...(spec.minMaxTokens ? { minMaxTokens: spec.minMaxTokens } : {}),
    };
  }
  // The registry slice the lock depends on: each role's deprecation row on its own transport, nothing else.
  const deprecations = {};
  for (const r of Object.values(roles)) {
    const key = `${r.id}/${r.transport}`;
    if (registry.deprecations?.[key]) deprecations[key] = registry.deprecations[key];
  }
  const decision = { roles, known, frozen: config.frozen ?? [], exclude };
  return { decision, registrySha256: digestOf({ ...decision, deprecations }), deprecations };
}

export const lockDecisionFields = (lock) => ({ roles: lock.roles, known: lock.known, frozen: lock.frozen, exclude: lock.exclude, registrySha256: lock.registrySha256 });
export const lockDecisionSha256 = (lock) => digestOf(lockDecisionFields(lock));

// Idempotent on the clock: the lock is rewritten only when its decision fields differ from `existing`.
// Provenance (generatedAt, registryRef, decisionDigest) comes from the registry, so sync is a pure function of
// (registry, config) and a new date or an unrelated NodeKit commit changes nothing.
export function syncLock({ registry, config, existing, registryRef }) {
  const { decision, registrySha256 } = buildLock({ registry, config });
  const candidate = { schemaVersion: LOCK_SCHEMA, registryRef, registrySha256, generatedAt: registry.generatedAt, decisionDigest: registry.decisionDigest, ...decision };
  if (existing && canonical(lockDecisionFields(existing)) === canonical(lockDecisionFields(candidate))) return { lock: existing, changed: false };
  return { lock: candidate, changed: true };
}

// ---- lint (G2) ----------------------------------------------------------------------------------------

const ID_LITERAL = /["'`](?:(?:anthropic|openai|google)\/)?(?:claude-[a-z0-9][a-z0-9.-]*|gpt-\d[a-z0-9.-]*|gemini-\d[a-z0-9.-]*|o[134]-[a-z0-9][a-z0-9-]*)["'`]/g;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// files: [{ path, text }], repo-relative with forward slashes. A literal is allowed under an idAllowlist
// prefix or on a line carrying the allowlist marker comment.
export function scanRawIds(files, idAllowlist = []) {
  const prefixes = idAllowlist.filter((a) => a.endsWith("/"));
  const markers = idAllowlist.filter((a) => !a.endsWith("/"));
  const hits = [];
  for (const { path, text } of files) {
    if (!SOURCE_FILE.test(path) || prefixes.some((p) => path.startsWith(p))) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (markers.some((m) => line.includes(m))) return;
      for (const match of line.matchAll(ID_LITERAL)) hits.push({ path, line: i + 1, id: match[0].slice(1, -1) });
    });
  }
  return hits;
}

export function lintLock({ lock, config, files = null, registry = null, now }) {
  const errors = [];
  const warnings = [];
  const advisories = [];
  if (lock?.schemaVersion !== LOCK_SCHEMA) return { errors: [`lock must use ${LOCK_SCHEMA}`], warnings, advisories };

  if (registry) {
    try {
      const { changed } = syncLock({ registry, config, existing: lock, registryRef: lock.registryRef });
      if (changed) errors.push("(a) models.lock.json is not in sync with the registry: run `nodekit models sync`");
    } catch (error) {
      errors.push(`(a) cannot regenerate the lock: ${error.message}`);
    }
  } else {
    warnings.push("(a) skipped: no --registry given, so lock sync was not checked");
  }

  for (const [role, spec] of Object.entries(config.roles)) {
    const locked = lock.roles?.[role];
    if (!locked) { errors.push(`(a) role ${role} is in models.config.json but not in the lock`); continue; }
    if (locked.line !== spec.line || locked.transport !== spec.transport) errors.push(`(a) role ${role}: lock says ${locked.line}/${locked.transport}, config says ${spec.line}/${spec.transport}`);
    if (!locked.lineTransports?.includes(locked.transport)) errors.push(`(b2) role ${role}: transport ${locked.transport} is not in its line's transports (${(locked.lineTransports ?? []).join(", ")})`);
    if (!locked.ids?.[locked.transport]) errors.push(`(b2) role ${role}: ${locked.id} has no ${locked.transport} wire id`);
    // (c): the dying-incumbent rule, on the transport in use, evaluated at `now`; a floor is never a finding.
    const av = locked.availability?.[locked.transport];
    if (!av || av.state === "unverified") warnings.push(`(c) role ${role}: ${locked.id} lifecycle on ${locked.transport} is unverified`);
    else {
      if (av.state !== "active" && av.state !== "listed") errors.push(`(c) role ${role}: ${locked.id} is ${av.state} on ${locked.transport}`);
      for (const date of [av.retiresOn, av.expiration].filter(Boolean)) {
        const days = daysUntil(date, now);
        if (days <= LINT_BLOCK_DAYS) errors.push(`(c) role ${role}: ${locked.id} ${av.retiresOn ? "retires" : "expires"} ${date} on ${locked.transport} (${days} d)`);
      }
    }
  }
  for (const f of lock.frozen ?? []) {
    advisories.push(`(c) frozen ${f.class ?? "id"} ${f.id} on ${f.transport}: ${f.reason ?? "frozen"}; changing it is a human PR through ${f.promotionPath ?? "its promotion path"}`);
  }

  if (files) {
    for (const hit of scanRawIds(files, config.idAllowlist ?? [])) errors.push(`(b) raw model id "${hit.id}" at ${hit.path}:${hit.line}; resolve it through the lock or allowlist it`);
  } else {
    warnings.push("(b) skipped: no source files were scanned");
  }
  return { errors, warnings, advisories };
}

// ---- watch ----------------------------------------------------------------------------------------------

// Announced horizons (<= 60 d) for every (id, transport) in the lock's roles and frozen list, floors as
// advisories, and registry liveness (brief D-6): a robot that stopped looks the same as "no deprecations".
// `refreshRun`: { ok: boolean, latestSuccessAt: ISO|null } from the public Actions API.
// A role's id is always a registry entry, so its row comes from `registry.deprecations`. A frozen id (B.9) is the
// consumer's own and need not be an entry, and the registry commits a snapshot only when ITS decision set changes
// (a frozen id is never part of it), so main's snapshots can be weeks behind the vendor page. Its row is therefore
// derived here from `snapshotSet` (the same parsers and rules as `select`), which the caller fetches live; a frozen
// id on a transport with no snapshot, or with no snapshot set loaded and no registry row, is listed as NOT CHECKED
// rather than silently passed.
export function watchReport({ lock, registry, now, refreshRun, snapshotSet = null }) {
  const pins = [
    ...Object.values(lock.roles ?? {}).map((r) => ({ id: r.id, transport: r.transport, kind: `role ${r.line}`, frozen: false })),
    ...(lock.frozen ?? []).map((f) => ({ id: f.id, transport: f.transport, kind: `frozen ${f.class ?? ""}`.trim(), frozen: true })),
  ];
  const horizons = [];
  const floors = [];
  const unchecked = [];
  for (const pin of pins) {
    let row;
    if (pin.frozen && snapshotSet) {
      const derived = deriveAvailability({ provider: pin.transport, ids: { [pin.transport]: pin.id } }, snapshotSet.parsed, now);
      const own = derived.availability[pin.transport];
      if (!own || own.state === "unverified") { unchecked.push(pin); continue; }
      row = deprecationRow(own, (derived.replacements[pin.transport] ?? [])[0] ?? null);
    } else {
      row = registry?.deprecations?.[`${pin.id}/${pin.transport}`];
      if (!row && pin.frozen) { unchecked.push(pin); continue; }
    }
    if (!row) continue;
    if (row.kind === "floor") floors.push({ ...pin, date: row.date });
    else if (row.date) {
      const days = daysUntil(row.date, now);
      if (days <= WATCH_HORIZON_DAYS) horizons.push({ ...pin, kind2: row.kind, date: row.date, days, replacement: row.replacement });
    } else if (row.kind === "state") horizons.push({ ...pin, kind2: row.kind, date: null, days: null, state: row.state, replacement: row.replacement });
  }
  let liveness = null;
  if (!refreshRun?.ok) liveness = "registry refresh status could not be read";
  else if (!refreshRun.latestSuccessAt) liveness = "no successful registry refresh run exists";
  else {
    const age = (Date.parse(now) - Date.parse(refreshRun.latestSuccessAt)) / 86_400_000;
    if (!(age <= REFRESH_MAX_AGE_DAYS)) liveness = `the last successful registry refresh was ${refreshRun.latestSuccessAt} (${Math.floor(age)} d ago, allowed ${REFRESH_MAX_AGE_DAYS})`;
  }
  const urgent = horizons.length > 0 || liveness !== null;
  const body = [
    "## Model defaults: URGENT", "",
    ...(liveness ? [`**registry refresh not running — lifecycle facts unverified.** ${liveness}. This is not a statement that nothing is retiring.`, ""] : []),
    ...(horizons.length ? ["### Announced horizons (60 days or less, on the transport in use)", "", ...horizons.map((h) => `- \`${h.id}\` (${h.transport}, ${h.kind}): ${h.kind2}${h.date ? ` ${h.date} in ${h.days} d` : ` state ${h.state}`}${h.replacement ? `, vendor-named replacement \`${h.replacement}\`` : ""}`), ""] : []),
    ...(floors.length ? ["### Advisories (floors, not announcements)", "", ...floors.map((f) => `- \`${f.id}\` (${f.transport}): earliest possible retirement ${f.date}`), ""] : []),
    ...(unchecked.length ? ["### Not checked", "", ...unchecked.map((u) => `- \`${u.id}\` (${u.transport}, ${u.kind}): no catalog snapshot covers this transport, so its lifecycle is unknown. This is not a statement that it is safe.`), ""] : []),
    "_Opened by `nodekit models watch`. A floor never moves a default._",
  ].join("\n");
  return { urgent, title: URGENT_TITLE, label: URGENT_LABEL, body, horizons, floors, unchecked, liveness };
}

// ---- consumer PR body ---------------------------------------------------------------------------------------

// `registry` supplies the release and per-transport facts that the lock does not carry (SPEC B.6: "release/retirement
// facts, floor vs announced, labelled, per transport"). They are information in the PR body, not part of the lock.
const factsOf = (av) => `${av?.state ?? "unverified"}${av?.retiresOn ? `, retires ${av.retiresOn} (announced)` : ""}${av?.expiration ? `, expires ${av.expiration} (announced)` : ""}${av?.retiresNotBefore && !av?.retiresOn ? `, floor ${av.retiresNotBefore} (advisory)` : ""}`;

export function renderLockBody({ oldLock, newLock, hash, config, snapshots = null, registry = null }) {
  const lines = ["## Summary", "", `Registry ref \`${newLock.registryRef}\`, registry slice \`${newLock.registrySha256.slice(0, 16)}\`, input digest \`${newLock.decisionDigest.slice(0, 16)}\` (provenance only).`, "", "## Per-role changes", ""];
  let any = false;
  for (const [role, now] of Object.entries(newLock.roles)) {
    const before = oldLock?.roles?.[role];
    if (before && canonical(before) === canonical(now)) continue;
    any = true;
    lines.push(`### \`${role}\` (${now.line}, ${now.transport})`, "");
    if (!before || before.id !== now.id) lines.push(`- id: \`${before?.id ?? "(none)"}\` -> \`${now.id}\``);
    if (before && canonical(before.constraints) !== canonical(now.constraints)) lines.push(`- constraints changed: \`${canonical(before.constraints)}\` -> \`${canonical(now.constraints)}\``);
    if (before && canonical(before.price) !== canonical(now.price)) lines.push(`- price (valid on the \`${now.price?.source}\` transport only): \`${canonical(before.price)}\` -> \`${canonical(now.price)}\``);
    if (before && canonical(before.availability) !== canonical(now.availability)) lines.push(`- availability: \`${canonical(before.availability)}\` -> \`${canonical(now.availability)}\``);
    lines.push(`- lifecycle on ${now.transport}: ${factsOf(now.availability?.[now.transport])}`);
    const entry = registry?.entries?.[now.id];
    if (entry) {
      lines.push(`- released: ${entry.releaseDate ?? "unknown"}${entry.releaseDateSource ? ` (${entry.releaseDateSource})` : ""}`);
      const others = Object.entries(entry.availability ?? {}).filter(([t]) => t !== now.transport).map(([t, av]) => `${t}: ${factsOf(av)}`);
      if (others.length) lines.push(`- other transports (information; not in the lock): ${others.join("; ")}`);
    }
    lines.push("");
    const env = config.roles[role]?.env;
    if (env?.length) lines.push(`Environment checklist: ${env.map((e) => `\`${e}\``).join(", ")} may override this role; confirm each value still resolves.`, "");
  }
  if (!any) lines.push("- no role changed; `known`, `frozen` or `exclude` changed (see the diff).", "");
  if (snapshots) lines.push("## Snapshots the registry was computed from", "", ...Object.entries(snapshots).map(([key, v]) => `- ${key}: sha256 \`${v.sha256}\`, ${v.rows} rows, fetched ${v.fetchedAt}`), "");
  lines.push("## Gates", "", "Lint (G2) and the repo's own check (G3) ran on the bot branch before this PR was created. No paid provider call was made.", "",
    "Closing this PR keeps it closed until the decision set changes. A human merges.", "", decisionMarker(hash));
  return lines.join("\n");
}
