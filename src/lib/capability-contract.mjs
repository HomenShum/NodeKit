// The measurement gate: a capability is a bet placed before it is built, and settled afterwards
// against a threshold nobody can argue with.
//
// This exists because of one question asked at the right moment on a real build — "why graphs, what
// will we be measuring that graphs can help with?" — and the agent's own answer to it: *that's the
// question I should have asked before building it.* It had built a graph traversal, wired it into
// shortlist padding, and measured +2 to +4 entities for +20-29% latency, with zero counts changed.
// Every one of those numbers was available. None of them had been compared to anything, because no
// prediction had been written down.
//
// NodeKit's job is to make an agent ask that unprompted, so a human does not have to catch it after
// the build. Three mechanics do the work:
//
//   THE BET PRECEDES THE EVIDENCE. `declaredAt` must be earlier than the measurement's `observedAt`.
//   A kill condition written after the result is not a threshold, it is a defence of the result, and
//   it always passes. This is the single field that separates a bet from a discussion, so the gate
//   refuses rather than warns.
//
//   THRESHOLDS, NOT PROSE. "kill it if it doesn't help much" is argued with. `below 4 entities` is
//   evaluated. The schema takes structured clauses only.
//
//   CONSUMERS DECIDE DECORATIVE, NOT THE METRIC. A capability can beat every threshold and still be
//   decorative if the only thing calling it is itself. That was the real defect on the real build:
//   all eleven dimensions were one hop, so nothing could ask a question the traversal answered. The
//   middle state — a capability that exists, costs latency, and answers no question a user asked —
//   is the worst outcome, and it is invisible to a purely numeric gate.

export const CAPABILITY_CONTRACT_SCHEMA = "nodekit.capability-contract.v1.schema.json";
export const CAPABILITY_CONTRACT_SCHEMA_VERSION = "nodekit.capability-contract/v1";

/** What the gate can conclude. `decorative` is a first-class verdict, not a soft pass. */
export const VERDICTS = Object.freeze(["load-bearing", "decorative", "killed", "insufficient"]);

const COMPARATORS = Object.freeze({
  below: (observed, value) => observed < value,
  above: (observed, value) => observed > value,
  "at-most": (observed, value) => observed <= value,
  "at-least": (observed, value) => observed >= value,
  equals: (observed, value) => observed === value,
});

export class CapabilityContractRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`capability contract refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "CapabilityContractRefusal";
    this.refusals = list;
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Structural parse. Schema validation covers shape; this covers the things a schema cannot express —
 * chiefly that a question serving a capability must not simply be the capability restated.
 */
export function parseCapabilityContract(contract) {
  if (!contract || typeof contract !== "object") throw new CapabilityContractRefusal(["a capability contract must be an object"]);
  const refusals = [];
  if (contract.schemaVersion !== CAPABILITY_CONTRACT_SCHEMA_VERSION) {
    refusals.push(`schemaVersion must be ${CAPABILITY_CONTRACT_SCHEMA_VERSION}`);
  }
  for (const field of ["capability", "declaredAt", "questionItServes", "whyExistingToolsCannot"]) {
    if (!isNonEmptyString(contract[field])) refusals.push(`needs ${field}`);
  }
  if (!Array.isArray(contract.killCondition) || contract.killCondition.length === 0) {
    refusals.push("needs at least one killCondition clause; a bet with no losing outcome is not a bet");
  }
  for (const [i, clause] of (contract.killCondition ?? []).entries()) {
    if (!COMPARATORS[clause?.comparator]) {
      refusals.push(`killCondition[${i}] comparator must be one of ${Object.keys(COMPARATORS).join(", ")}`);
    }
    if (typeof clause?.value !== "number" || Number.isNaN(clause.value)) {
      refusals.push(`killCondition[${i}] needs a numeric value; a prose threshold is one that gets argued with`);
    }
  }
  const improvement = contract.measuredImprovement ?? {};
  for (const field of ["baseline", "predicted"]) {
    if (typeof improvement[field] !== "number") refusals.push(`measuredImprovement.${field} must be a number`);
  }
  // A prediction equal to the baseline predicts nothing, and will be satisfied by doing nothing.
  if (typeof improvement.baseline === "number" && improvement.predicted === improvement.baseline) {
    refusals.push("measuredImprovement.predicted equals baseline; that predicts no improvement and cannot be lost");
  }
  if (!Array.isArray(contract.consumers)) refusals.push("needs consumers as a list; absent and empty must not look the same");
  if (refusals.length > 0) throw new CapabilityContractRefusal(refusals);
  return contract;
}

/**
 * Settle the bet.
 *
 * @param contract    a parsed capability contract
 * @param measurement { observedAt, metrics: {name: number}, consumersReachable?: [id] }
 */
export function evaluateCapability(contract, measurement) {
  parseCapabilityContract(contract);
  if (!measurement || typeof measurement !== "object") {
    throw new CapabilityContractRefusal(["a measurement is required to settle a capability contract"]);
  }
  const metrics = measurement.metrics ?? {};
  const refusals = [];

  if (!isNonEmptyString(measurement.observedAt)) refusals.push("the measurement needs observedAt");
  // THE central rule, and it must compare INSTANTS. Comparing the ISO strings lexicographically
  // looks equivalent and is not: "2026-08-03T11:00:00+02:00" sorts after "2026-08-03T10:00:00.000Z"
  // while being an hour EARLIER, so a contract could be authored after its own evidence and settle
  // clean. Codex reproduced exactly that against this gate, which makes the whole mechanism
  // decorative — the one comparison the design turns on, defeated by a timezone offset.
  // Strict UTC ISO, not whatever Date.parse will swallow. Date.parse accepts "08/03/26 10:00" and
  // "Aug 3 2026 10:00" and resolves them in the RUNTIME'S LOCAL ZONE, so the same file settles
  // differently in two timezones and a date-only "2026-08-03" becomes a midnight instant nobody
  // observed. Codex settled load-bearing with a measurement that was actually earlier. The contract
  // already had to be strict UTC by schema; the measurement was the half nobody validated.
  // A full ISO instant: date, time, and an explicit zone that is either Z or a numeric offset.
  // An offset is unambiguous and stays allowed — the earlier bypass it enabled is caught by
  // comparing parsed instants, not by banning the format. What is refused is anything whose meaning
  // depends on where it is read: date-only, and every locale form Date.parse quietly accepts.
  const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (isNonEmptyString(measurement.observedAt) && !ISO_INSTANT.test(measurement.observedAt)) {
    refusals.push(
      `the measurement's observedAt (${measurement.observedAt}) is not a full ISO instant like 2026-08-03T17:00:00.000Z or 2026-08-03T19:00:00+02:00 — `
        + "a date-only or locale-dependent value resolves differently on different machines, so it cannot establish which came first",
    );
  }
  const declaredMs = Date.parse(contract.declaredAt);
  const observedMs = Date.parse(measurement.observedAt ?? "");
  if (isNonEmptyString(measurement.observedAt) && !Number.isFinite(observedMs)) {
    refusals.push(`the measurement's observedAt (${measurement.observedAt}) is not a parseable timestamp; an unparseable time cannot establish that the bet came first`);
  }
  if (!Number.isFinite(declaredMs)) {
    refusals.push(`the contract's declaredAt (${contract.declaredAt}) is not a parseable timestamp`);
  }
  if (Number.isFinite(declaredMs) && Number.isFinite(observedMs) && observedMs <= declaredMs) {
    refusals.push(
      `the measurement was observed at ${measurement.observedAt} (${new Date(observedMs).toISOString()}), at or before the contract was declared at `
        + `${contract.declaredAt} (${new Date(declaredMs).toISOString()}) — a kill condition written after its own evidence is a defence of the `
        + "result, not a threshold it could have failed",
    );
  }
  if (refusals.length > 0) throw new CapabilityContractRefusal(refusals);

  // Zero measured metrics is not a pass. Nothing was compared.
  const named = Object.keys(metrics).filter((key) => typeof metrics[key] === "number");
  if (named.length === 0) {
    return {
      verdict: "insufficient",
      capability: contract.capability,
      triggered: [],
      unmeasured: contract.killCondition.map((clause) => clause.metric),
      consumers: { declared: contract.consumers.length, userFacing: 0, reachable: 0 },
      reason: "no metric was measured, so nothing was compared; an unmeasured capability is undecided, never kept by default",
    };
  }

  // A clause whose metric nobody measured cannot clear the capability. Silence is not a pass.
  const unmeasured = contract.killCondition
    .map((clause) => clause.metric)
    .filter((metric) => typeof metrics[metric] !== "number");

  const triggered = contract.killCondition
    .filter((clause) => typeof metrics[clause.metric] === "number")
    .filter((clause) => COMPARATORS[clause.comparator](metrics[clause.metric], clause.value))
    .map((clause) => ({
      metric: clause.metric,
      observed: metrics[clause.metric],
      comparator: clause.comparator,
      value: clause.value,
      rationale: clause.rationale,
    }));

  const userFacing = contract.consumers.filter((entry) => entry.kind === "user-facing-question");
  const reachable = measurement.consumersReachable
    ? contract.consumers.filter((entry) => measurement.consumersReachable.includes(entry.consumerId))
    : contract.consumers;
  // A consumer that is declared but unreachable is a plan, not a caller. Computing reachability and
  // then deciding on the declared list was a real hole: supplying consumersReachable: [] returned
  // load-bearing with reachable 0, over a reason string that said a consumer "can reach it".
  // Absent consumersReachable is UNMEASURED, not "all reachable". Treating omission as success let
  // a caller who measured nothing get load-bearing with reachableUserFacing: 1, over a reason
  // saying the consumers were "measured reachable" — a sentence about a measurement that never
  // happened. It is the same absence-versus-zero rule the rest of this repository turns on.
  const reachabilityMeasured = Array.isArray(measurement.consumersReachable);
  const reachableUserFacing = reachabilityMeasured
    ? userFacing.filter((entry) => measurement.consumersReachable.includes(entry.consumerId))
    : [];

  // Order matters. A killed capability is killed whether or not anything calls it; asking "who
  // consumes this?" about a capability that failed its own threshold is the wrong next question.
  if (triggered.length > 0) {
    return {
      verdict: "killed",
      capability: contract.capability,
      triggered,
      unmeasured,
      consumers: { declared: contract.consumers.length, userFacing: userFacing.length, reachable: reachable.length },
      reason: `${triggered.length} kill condition(s) triggered against a threshold declared before the build`,
    };
  }

  // Decorative outranks a clean measurement. This is the middle state — real, measured, and serving
  // no question anybody asked — which is the worst outcome to ship and the easiest to miss.
  // Nobody looked. That is undecided, and distinct from looking and finding nothing.
  if (!reachabilityMeasured && userFacing.length > 0) {
    return {
      verdict: "insufficient",
      capability: contract.capability,
      triggered: [],
      unmeasured: [...unmeasured, "consumersReachable"],
      consumers: { declared: contract.consumers.length, userFacing: userFacing.length, reachable: null, reachableUserFacing: null },
      reason: "no measurement of which consumers can actually reach this capability; a declared consumer is a plan until something confirms it, and omission must not read as confirmation",
    };
  }
  if (reachableUserFacing.length === 0) {
    return {
      verdict: "decorative",
      capability: contract.capability,
      triggered: [],
      unmeasured,
      consumers: { declared: contract.consumers.length, userFacing: userFacing.length, reachable: reachable.length, reachableUserFacing: 0 },
      reason: contract.consumers.length === 0
        ? "no consumer is declared, so nothing calls this capability but itself"
        : userFacing.length === 0
          ? "every declared consumer is internal-only; the capability enriches its own output and answers no question a user can ask"
          : "every user-facing consumer was measured as unreachable; a consumer that cannot be reached is a plan, not a caller",
    };
  }

  if (unmeasured.length > 0) {
    return {
      verdict: "insufficient",
      capability: contract.capability,
      triggered: [],
      unmeasured,
      consumers: { declared: contract.consumers.length, userFacing: userFacing.length, reachable: reachable.length, reachableUserFacing: reachableUserFacing.length },
      reason: `${unmeasured.length} kill condition(s) name a metric nobody measured (${unmeasured.join(", ")}); an unrun check is not a passed one`,
    };
  }

  return {
    verdict: "load-bearing",
    capability: contract.capability,
    triggered: [],
    unmeasured: [],
    consumers: { declared: contract.consumers.length, userFacing: userFacing.length, reachable: reachable.length, reachableUserFacing: reachableUserFacing.length },
    reason: `no kill condition triggered and ${reachableUserFacing.length} user-facing consumer(s) measured reachable`,
  };
}

export function formatCapabilityVerdict(verdict) {
  const head = `CAPABILITY ${verdict.capability}: ${verdict.verdict.toUpperCase()} — ${verdict.reason}`;
  const lines = [head];
  for (const entry of verdict.triggered) {
    lines.push(`  killed by: ${entry.metric} observed ${entry.observed}, kill if ${entry.comparator} ${entry.value}`);
    if (entry.rationale) lines.push(`    ${entry.rationale}`);
  }
  if (verdict.unmeasured.length > 0) lines.push(`  unmeasured: ${verdict.unmeasured.join(", ")}`);
  lines.push(`  consumers: ${verdict.consumers.declared} declared, ${verdict.consumers.userFacing} user-facing`);
  return lines.join("\n");
}
