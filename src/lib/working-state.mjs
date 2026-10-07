// The harness promises that a long-running build keeps its head. Nothing checked it. An agent that
// truncates its way through a six-hour run — losing what it already tried, what it ruled out, and
// why — passes every gate in this repository today, because none of them can see the difference
// between a context that was compacted and one that was simply cut.
//
// The load-bearing field is failedApproaches. Everything else survives truncation by accident: the
// objective is restated in every prompt, the next action is obvious from the diff. What dies first
// and costs most is the record of what was already tried and did not work, and its loss is
// invisible — the agent cheerfully re-attempts the thing it abandoned two hours ago and reports
// progress. A continuity check that does not require it is checking the wrong thing.

export const TRUST_LEVELS = Object.freeze(["H0", "H1", "H2", "H3"]);

// A protected canonical ledger requires a key the agent cannot reach. H1 is an exportable software
// key living in the same protection domain as the process that writes the ledger — which means the
// signature attests that the writer had the key, and the writer is who we were trying to constrain.
export const CANONICAL_PROMOTION_MIN_TRUST = "H2";

function fail(message, code = "WORKING_STATE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const REQUIRED_SECTIONS = Object.freeze([
  "objective",
  "decisions",
  "constraints",
  "evidence",
  "failedApproaches",
  "openQuestions",
  "blockers",
  "nextAction",
]);

export function parseWorkingState(state) {
  if (!state || typeof state !== "object") fail("working state must be an object");
  if (!isNonEmptyString(state.objective)) fail("needs an objective");
  if (!isNonEmptyString(state.nextAction)) fail("needs a nextAction");
  for (const key of ["decisions", "constraints", "evidence", "failedApproaches", "openQuestions", "blockers"]) {
    if (!Array.isArray(state[key])) fail(`needs ${key} as a list; an absent list and an empty one must not look the same`);
  }
  for (const [i, entry] of state.failedApproaches.entries()) {
    if (!isNonEmptyString(entry?.approach)) fail(`failedApproaches[${i}] needs an approach`);
    // Without why, the record cannot stop the retry — "we tried X" invites trying X differently.
    if (!isNonEmptyString(entry?.whyItFailed)) fail(`failedApproaches[${i}] needs whyItFailed, or it cannot prevent the retry it exists to prevent`);
  }
  return state;
}

/**
 * Continuity is a comparison between two checkpoints, not a property of one. `carried` is what
 * survived; the failure mode is silent loss, so anything present before and absent after is a
 * finding regardless of how the compaction was performed.
 */
export function verifyContinuity(before, after) {
  parseWorkingState(before);
  parseWorkingState(after);
  const losses = [];

  if (after.objective !== before.objective && !isNonEmptyString(after.objectiveChangeReason)) {
    losses.push("the objective changed with no objectiveChangeReason; a run that quietly re-aims is not the same run");
  }
  // Codex refuted the first comparison three ways: it projected each entry down to `approach ?? id`,
  // so rewriting whyItFailed to "unknown" was invisible; it used a Set, so two distinct failures
  // sharing an approach collapsed into one and a deletion vanished; and it skipped `evidence`
  // entirely. Compare canonicalised WHOLE entries as a multiset, over every protected section.
  const canon = (v) => (v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`);
  const counts = (list) => list.reduce((m, e) => m.set(canon(e), (m.get(canon(e)) ?? 0) + 1), new Map());

  for (const key of ["decisions", "constraints", "evidence", "failedApproaches", "openQuestions", "blockers"]) {
    const b = counts(before[key]);
    const a = counts(after[key]);
    let dropped = 0;
    for (const [entry, n] of b) dropped += Math.max(0, n - (a.get(entry) ?? 0));
    if (dropped > 0) {
      losses.push(`${key}: ${dropped} entr(ies) present before compaction and absent or altered after`);
    }
  }

  const ledgerEntries = ["decisions", "constraints", "evidence", "failedApproaches", "openQuestions", "blockers"]
    .reduce((n, k) => n + before[k].length, 0);

  return {
    // A pass over an empty history established nothing. Callers reading `continuous` as a gate
    // result must not get true from a state that had no ledger to lose.
    continuous: losses.length === 0 && ledgerEntries > 0,
    insufficientHistory: ledgerEntries === 0,
    losses: ledgerEntries === 0 ? ["no ledger entries before compaction; there was nothing to establish continuity over"] : losses,
    // Reported so a pass over an empty state cannot look like a pass over a real one.
    carried: REQUIRED_SECTIONS.reduce((n, k) => n + (Array.isArray(after[k]) ? after[k].length : (after[k] ? 1 : 0)), 0),
  };
}

/**
 * Gap #2, second attempt. The first version took a trust LEVEL and compared it to a floor, which
 * Codex refuted in one line: `requireTrustForCanonicalPromotion("H2")` returns "H2". The caller —
 * the agent the ledger exists to constrain — simply supplies the label. My own test codified the
 * bypass by asserting exactly that call succeeds.
 *
 * A level is a conclusion, so it cannot also be the input. This takes the key's provenance and
 * derives the level: a key the agent's own process can export, in the agent's own protection
 * domain, is H1 whatever anyone labels it.
 */
export function deriveTrustLevel(key) {
  if (!key || typeof key !== "object") fail("trust requires a key descriptor, not a level", "TRUST_DESCRIPTOR_MISSING");
  if (!isNonEmptyString(key.keyId)) fail("key descriptor needs a keyId", "TRUST_DESCRIPTOR_MISSING");
  if (!isNonEmptyString(key.protectionDomain)) {
    fail("key descriptor needs a protectionDomain — where the private key actually lives", "TRUST_DESCRIPTOR_MISSING");
  }
  if (typeof key.exportable !== "boolean") fail("key descriptor needs exportable as a boolean", "TRUST_DESCRIPTOR_MISSING");
  if (!isNonEmptyString(key.agentDomain)) {
    fail("key descriptor needs agentDomain — the domain the constrained agent runs in, to compare against", "TRUST_DESCRIPTOR_MISSING");
  }

  const sameDomain = key.protectionDomain.normalize("NFKC").toLowerCase().trim()
    === key.agentDomain.normalize("NFKC").toLowerCase().trim();

  // H0: no key. H1: a key the agent can reach or export. H2: a separate protection domain.
  // H3: a separate domain that also required a human presence gesture per signature.
  if (key.exportable || sameDomain) return { level: "H1", reason: sameDomain ? "the key lives in the agent's own protection domain" : "the key is exportable, so possession does not bind the signer" };
  if (key.humanPresencePerSignature === true) return { level: "H3", reason: "separate protection domain with a human presence gesture per signature" };
  return { level: "H2", reason: "separate, non-exportable protection domain" };
}

export function requireTrustForCanonicalPromotion(key) {
  const derived = deriveTrustLevel(key);
  if (TRUST_LEVELS.indexOf(derived.level) < TRUST_LEVELS.indexOf(CANONICAL_PROMOTION_MIN_TRUST)) {
    fail(
      `derived trust ${derived.level} may not promote a canonical record (${CANONICAL_PROMOTION_MIN_TRUST}+ required): ${derived.reason}. `
        + "Below that floor the signature attests only that the writer had the key, and the writer is who the ledger exists to bind",
      "TRUST_LEVEL_INSUFFICIENT",
    );
  }
  return derived;
}
