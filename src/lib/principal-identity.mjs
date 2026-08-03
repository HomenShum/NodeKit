// Twice today a gate was shipped with the same stated ceiling: "the real answer is canonical
// principal identity, which this repo does not have." The attestor denylist compared lowercased
// strings, so "NodeKit Inc" and a Cyrillic lookalike walked past. The review context compared
// normalised display names, so "Team A" and "Team  A" read as two parties until it was patched.
// Both are string matching standing in for identity.
//
// The pattern is borrowed from a Life Sciences Knowledge Graph, where it is the load-bearing
// problem rather than a detail: Merck Sharp & Dohme LLC, Merck & Co. and MSD are one entity, and
// Keytruda and Pembrolizumab are one drug. Their discipline is the part worth stealing — an alias
// is a claim, and a claim needs evidence. A resolution nobody verified is a guess with a
// confident interface, and it is worse than no resolution because it silently merges two parties
// who are not the same.
//
// So aliases are declared, each carries evidence, and an unverified alias never merges identities.

const CONFUSABLES = new Map(Object.entries({
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x",
  "у": "y", "і": "i", "ј": "j", "һ": "h", "ԁ": "d", "ԛ": "q",
  "ο": "o", "α": "a", "ρ": "p", "ɡ": "g",
}));

/** Fold to a comparable surface form. This is normalisation, NOT identity — see resolve(). */
export function surfaceForm(value) {
  return [...String(value).normalize("NFKC").toLowerCase()]
    .map((ch) => CONFUSABLES.get(ch) ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fail(message, code = "PRINCIPAL_REGISTRY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * A registry of principals and their aliases. Every alias carries how it was established, because
 * the failure being prevented is a confident merge of two distinct parties.
 *
 *   { id: "acme-audit", aliases: [{ text: "Acme Audit LLC", evidence: "contract:2026-01-12" }] }
 */
export function buildPrincipalRegistry(principals) {
  if (!Array.isArray(principals)) fail("principals must be a list");
  const bySurface = new Map();
  const byId = new Map();

  for (const [i, principal] of principals.entries()) {
    const at = `principals[${i}]`;
    if (!isNonEmptyString(principal?.id)) fail(`${at} needs an id`);
    if (byId.has(principal.id)) fail(`${at} repeats id "${principal.id}"`);
    if (!Array.isArray(principal.aliases)) fail(`${at} needs aliases as a list`);
    byId.set(principal.id, principal);

    for (const [j, alias] of [{ text: principal.id, evidence: "canonical id" }, ...principal.aliases].entries()) {
      if (!isNonEmptyString(alias?.text)) fail(`${at}.aliases[${j - 1}] needs text`);
      // An alias with no evidence is somebody's recollection that two names are one party.
      if (!isNonEmptyString(alias?.evidence)) {
        fail(`${at}.aliases[${j - 1}] ("${alias.text}") needs evidence; an unverified alias merges two parties on a hunch`);
      }
      const surface = surfaceForm(alias.text);
      const existing = bySurface.get(surface);
      // The dangerous collision: two DIFFERENT principals claiming one surface form.
      if (existing && existing !== principal.id) {
        fail(`"${alias.text}" is claimed by both ${existing} and ${principal.id}; a surface form cannot resolve to two identities`);
      }
      bySurface.set(surface, principal.id);
    }
  }

  return {
    /**
     * Returns the canonical id, or null when the name is not registered. Null is the honest answer
     * and callers must handle it: an unregistered principal is unknown, not distinct-by-default and
     * not same-by-default.
     */
    resolve(name) {
      return bySurface.get(surfaceForm(name)) ?? null;
    },
    /**
     * Three-valued on purpose. "unknown" is the state string comparison never had, and it is the
     * one that matters: two unregistered names may or may not be the same party, and a gate that
     * guesses is the thing this replaces.
     */
    sameParty(a, b) {
      const ra = this.resolve(a);
      const rb = this.resolve(b);
      if (ra === null || rb === null) return "unknown";
      return ra === rb ? "same" : "different";
    },
    ids: () => [...byId.keys()],
    size: byId.size,
  };
}

/**
 * The registry-backed replacement for a denylist. `producerIds` are canonical ids, so renaming the
 * producer in a record cannot evade it — and an unregistered attestor is refused rather than
 * assumed independent, because assuming independence is the failure mode.
 */
export function assertAttestorIsIndependent(registry, attestor, producerIds, label = "attestor") {
  const resolved = registry.resolve(attestor);
  if (resolved === null) {
    fail(
      `${label} "${attestor}" is not a registered principal; an unknown attestor cannot be shown independent, `
        + "and treating unknown as independent is how a builder certifies itself under a new name",
      "PRINCIPAL_UNREGISTERED",
    );
  }
  if (producerIds.includes(resolved)) {
    fail(`${label} "${attestor}" resolves to ${resolved}, which produced the thing being certified`, "PRINCIPAL_NOT_INDEPENDENT");
  }
  return resolved;
}
