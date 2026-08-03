// node-platform blocks self-APPROVAL thoroughly — findSelfApprovalKeys, inv-repair-cannot-self-
// approve, a status derived only from a verified signature. It does not block self-asserted
// INDEPENDENCE, which is the softer and more useful lie: nobody writes `approved: true`, they write
// `independentReview: true` and mean it.
//
// The evaluator work already enforces independence from the CANDIDATE — separate container,
// read-only source, no evidence mount, evaluator bytes hashed. What nothing checks is independence
// from the OPERATOR: the party that wrote the evaluator, holds the signing key, and ran the
// campaign is the same party whose work is being judged, and no schema notices.
//
// So independence stops being a claim and becomes a derived property of who the parties were.

export const REVIEW_ROLES = Object.freeze(["producer", "evaluator", "approver", "operator"]);

// Claims a record may not make about itself. A caller supplying its own independence verdict is
// exactly the input this exists to refuse.
const SELF_ASSERTED = /^(independent|independentReview|independentlyEvaluated|isIndependent|unbiased|arms?Length|thirdParty)$/i;

function fail(message) {
  const error = new Error(message);
  error.code = "REVIEW_CONTEXT_INVALID";
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

export function parseReviewContext(record) {
  if (!record || typeof record !== "object") fail("review context must be an object");
  for (const key of Object.keys(record)) {
    if (SELF_ASSERTED.test(key)) {
      fail(`"${key}" is a verdict about this record, supplied by the record; independence is derived from the parties, never declared`);
    }
  }
  if (!Array.isArray(record.parties) || record.parties.length === 0) fail("needs parties");

  const byRole = new Map();
  for (const [i, party] of record.parties.entries()) {
    const at = `parties[${i}]`;
    if (!REVIEW_ROLES.includes(party?.role)) fail(`${at} role must be one of ${REVIEW_ROLES.join(", ")}`);
    if (!isNonEmptyString(party.principal)) fail(`${at} needs a principal — who, concretely`);
    if (byRole.has(party.role)) fail(`${at} repeats role ${party.role}`);
    byRole.set(party.role, party.principal.trim().toLowerCase());
  }
  for (const role of ["producer", "evaluator"]) {
    if (!byRole.has(role)) fail(`no ${role} named; independence cannot be derived from an incomplete party list`);
  }
  return { record, byRole };
}

/**
 * Independence is a comparison, not a field. Returns the level actually earned:
 *   none      — the producer evaluated its own work
 *   process   — a different evaluator, but the operator is the producer (the YC-S26 gap)
 *   party     — evaluator, approver and operator are all distinct from the producer
 */
export function deriveIndependence(record) {
  const { byRole } = parseReviewContext(record);
  const producer = byRole.get("producer");
  const evaluator = byRole.get("evaluator");
  const approver = byRole.get("approver");
  const operator = byRole.get("operator");

  if (evaluator === producer) {
    return { level: "none", reason: "the producer evaluated its own work" };
  }
  const sameAsProducer = [
    approver === producer ? "approver" : null,
    operator === producer ? "operator" : null,
  ].filter(Boolean);
  if (sameAsProducer.length > 0) {
    return {
      level: "process",
      reason: `the evaluator differs from the producer, but ${sameAsProducer.join(" and ")} is the producer; `
        + "a verdict the judged party can re-run until it likes the answer is procedurally independent and not actually so",
    };
  }
  if (!approver || !operator) {
    return { level: "process", reason: "no approver or operator named, so party independence cannot be established" };
  }
  return { level: "party", reason: "producer, evaluator, approver and operator are distinct principals" };
}

export function requireIndependence(record, minimum = "party") {
  const order = ["none", "process", "party"];
  const actual = deriveIndependence(record);
  if (order.indexOf(actual.level) < order.indexOf(minimum)) {
    const error = new Error(`independence ${actual.level} is below the required ${minimum}: ${actual.reason}`);
    error.code = "INDEPENDENCE_INSUFFICIENT";
    throw error;
  }
  return actual;
}
