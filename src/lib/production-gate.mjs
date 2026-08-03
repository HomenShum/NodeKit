// Decided for NodeBook, never absorbed by the platform, and obviously portable: every application
// NodeKit generates faces the same seven questions before a real person's data is on the line.
//
// The load-bearing rule is that NOT_RUN blocks. A check nobody ran is not a check that passed, and
// the difference between "we looked and it was fine" and "we never looked" is exactly the gap a
// release ladder is supposed to close. Absence is the default and it fails.
//
// The second rule is that neither the builder nor the platform may set PASS. A generated app
// asserting its own tenant isolation is the shape of every breach postmortem.

export const PRODUCTION_CHECKS = Object.freeze([
  "SECRET_BOUNDARY",
  "SERVER_AUTHORIZATION",
  "TENANT_ISOLATION",
  "ERROR_OBSERVABILITY",
  "RESTORE_PROOF",
  "CHANGE_REGRESSION",
  "PAYMENT_INTEGRITY",
]);

export const CHECK_OUTCOMES = Object.freeze(["PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE"]);

// Only PAYMENT_INTEGRITY may be waived, and only by a verifier that looked for billing surfaces and
// found none. Every other check applies to every application that holds someone's data.
export const WAIVABLE = Object.freeze(["PAYMENT_INTEGRITY"]);

// A party that built the thing cannot certify it. These are roles, not identities: the point is that
// the attesting party is structurally distinct from the producing one.
export const FORBIDDEN_ATTESTORS = Object.freeze(["nodekit", "platform", "builder", "generator", "self"]);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// " nodekit", "NodeKit Inc", "nodekit-ci" and a Cyrillic lookalike all slipped past a bare
// lowercase compare. Normalising unicode and matching on a token boundary closes the cheap ones;
// the real fix is canonical principal identity, which this repo does not yet have.
// Cyrillic о, е, а, с, р, х and friends render identically to Latin and defeat any denylist. Folding
// the common confusables closes the copy-paste attack. It is still a denylist, and a determined
// caller can pick a homoglyph not in this table — the real answer remains canonical principal
// identity, which this repo does not have. This raises the cost; it does not close the class.
const CONFUSABLES = new Map(Object.entries({
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x",
  "у": "y", "і": "i", "ј": "j", "һ": "h", "ԁ": "d", "ԛ": "q",
  "ο": "o", "α": "a", "ρ": "p", "ɡ": "g", "ẞ": "s",
}));

function foldConfusables(text) {
  return [...text].map((ch) => CONFUSABLES.get(ch) ?? ch).join("");
}

function isForbiddenAttestor(value) {
  const normalized = foldConfusables(String(value).normalize("NFKC").toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
  return FORBIDDEN_ATTESTORS.some((f) => normalized === f || normalized.startsWith(`${f} `) || normalized.endsWith(` ${f}`) || normalized.includes(` ${f} `));
}

function fail(message) {
  const error = new Error(message);
  error.code = "PRODUCTION_GATE_INVALID";
  throw error;
}

export function parseProductionReadiness(record) {
  if (!record || typeof record !== "object") fail("production readiness must be an object");
  if (!isNonEmptyString(record.application)) fail("needs an application");
  if (!isNonEmptyString(record.revision)) fail("needs the exact revision being certified");
  if (!Array.isArray(record.checks)) fail("needs checks as a list");

  const seen = new Set();
  for (const [i, check] of record.checks.entries()) {
    const at = `checks[${i}]`;
    if (!PRODUCTION_CHECKS.includes(check?.id)) fail(`${at} id must be one of ${PRODUCTION_CHECKS.join(", ")}`);
    if (seen.has(check.id)) fail(`${at} repeats ${check.id}`);
    seen.add(check.id);
    if (!CHECK_OUTCOMES.includes(check.outcome)) fail(`${at} outcome must be one of ${CHECK_OUTCOMES.join(", ")}`);

    // A verdict with nothing behind it is the thing this refuses.
    if (check.outcome === "PASS" || check.outcome === "FAIL") {
      if (!isNonEmptyString(check.evidenceRef)) fail(`${at} is ${check.outcome} with no evidenceRef`);
      if (!isNonEmptyString(check.attestedBy)) fail(`${at} is ${check.outcome} with no attestedBy`);
      if (isForbiddenAttestor(check.attestedBy)) {
        fail(`${at} is attested by "${check.attestedBy}"; the party that produced the application may not certify it`);
      }
    }
    if (check.outcome === "NOT_APPLICABLE") {
      if (!WAIVABLE.includes(check.id)) fail(`${at}: ${check.id} is not waivable — it applies to every application holding user data`);
      if (!isNonEmptyString(check.verifiedAbsentBy)) {
        fail(`${at} is NOT_APPLICABLE without verifiedAbsentBy; a waiver requires someone who looked for the surface and found none`);
      }
      // A waiver is an attestation. Exempting it from the attestor rule let the builder waive itself.
      if (isForbiddenAttestor(check.verifiedAbsentBy)) {
        fail(`${at} is waived by "${check.verifiedAbsentBy}"; the party that produced the application may not waive its own check`);
      }
    }
  }
  return record;
}

/**
 * Absence is the default and it blocks. A record that simply omits TENANT_ISOLATION is not a record
 * of an application without tenants — it is a record of a question nobody asked.
 */
export function evaluateProductionReadiness(record) {
  // Codex refuted the first version: parse and evaluate were separate exports, and evaluate assumed
  // parse had run. Seven checks with outcome "BOGUS" returned releasable:true, because the loop only
  // blocked absent/NOT_RUN/FAIL and let everything else fall through. A release decision that trusts
  // its caller to have validated the input is not a gate. It validates its own input now.
  try {
    parseProductionReadiness(record);
  } catch (error) {
    return { releasable: false, blockers: [`record is not a valid production readiness record: ${error.message}`], checked: PRODUCTION_CHECKS.length, passed: 0, waived: 0 };
  }
  const byId = new Map((record.checks ?? []).map((c) => [c.id, c]));
  const blockers = [];

  for (const id of PRODUCTION_CHECKS) {
    const check = byId.get(id);
    if (!check) {
      blockers.push(`${id} is absent; an unasked question is NOT_RUN, and NOT_RUN blocks release`);
      continue;
    }
    if (check.outcome === "NOT_RUN") blockers.push(`${id} was not run`);
    if (check.outcome === "FAIL") blockers.push(`${id} failed: ${check.evidenceRef}`);
  }

  return {
    releasable: blockers.length === 0,
    blockers,
    checked: PRODUCTION_CHECKS.length,
    passed: PRODUCTION_CHECKS.filter((id) => byId.get(id)?.outcome === "PASS").length,
    waived: PRODUCTION_CHECKS.filter((id) => byId.get(id)?.outcome === "NOT_APPLICABLE").length,
  };
}

export function formatProductionReadiness(verdict) {
  const head = `PRODUCTION ${verdict.releasable ? "READY" : "BLOCKED"}: ${verdict.passed}/${verdict.checked} passed, ${verdict.waived} waived.`;
  return verdict.releasable ? head : [head, ...verdict.blockers.map((b) => `  ${b}`)].join("\n");
}
