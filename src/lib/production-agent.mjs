// The production-agent gate: the responsibilities that separate a demo from a system that survives
// contact with production, declared as one structured contract before the agent ships.
//
// Source: the 2026 agent-engineer competency breakdown (26Agent, youtube.com/watch?v=oBy94l_48CQ),
// adopted 2026-08-04. Its opening observation is the failure this gate exists to prevent: teams
// hire for agents and get candidates whose experience is demos, because a demo never meets network
// jitter, a third-party timeout, a runaway reasoning loop, or a token bill. Five responsibility
// areas, each of which dies in chat scrollback unless a contract carries it:
//
//   GOAL TRANSLATION + HITL   a fuzzy business goal becomes a quantified target, and every action
//                             is tiered: low-risk runs alone, high-risk suspends for a human and
//                             resumes after approval.
//   FAULT-TOLERANT TOOLING    raw errors intercepted, retries with exponential backoff, and a
//                             declared fallback — because "an error" is not a fallback.
//   CONTEXT CONTROL           a named compression strategy and a token budget per run.
//   RUNTIME GUARDS + SLOs     the three golden metrics as thresholds, a loop breaker, a circuit
//                             breaker, and a cost fuse. An agent loop without a counter is a bill.
//   RELEASE ENGINEERING       judge-backed regression on commit, a small-percent canary with
//                             AUTOMATIC rollback clauses, a model-migration eval, and a trace id
//                             on every request.
//
// The schema enforces shape. This module enforces the things a schema cannot say: that the three
// golden metrics are all present by NAME, that a declaration with high-risk actions has at least
// one suspension point, and that template blanks were actually replaced.

export const PRODUCTION_AGENT_SCHEMA = "nodekit.production-agent.v1.schema.json";
export const PRODUCTION_AGENT_SCHEMA_VERSION = "nodekit.production-agent/v1";

/** The floor. More SLOs are welcome; fewer are refused. Metric names are exact. */
export const GOLDEN_METRICS = Object.freeze(["task-completion-rate", "tool-call-error-rate", "p99-latency-ms"]);

export class ProductionAgentRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`production-agent contract refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "ProductionAgentRefusal";
    this.refusals = list;
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const hasReplaceBlank = (value) => typeof value === "string" && value.includes("REPLACE");

/**
 * Semantic parse, run after (or without) schema validation. Throws ProductionAgentRefusal with
 * every refusal at once — a gate that reports one problem per run is a gate people stop running.
 */
export function parseProductionAgentContract(contract) {
  if (!contract || typeof contract !== "object") {
    throw new ProductionAgentRefusal(["a production-agent contract must be an object"]);
  }
  const refusals = [];
  if (contract.schemaVersion !== PRODUCTION_AGENT_SCHEMA_VERSION) {
    refusals.push(`schemaVersion must be ${PRODUCTION_AGENT_SCHEMA_VERSION}`);
  }

  // Template blanks anywhere in the document are an unfilled form, not a declaration.
  const blanks = [];
  (function walk(node, trail) {
    if (hasReplaceBlank(node)) blanks.push(trail);
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${trail}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, trail ? `${trail}.${k}` : k);
  })(contract, "");
  if (blanks.length > 0) refusals.push(`template blanks not replaced: ${blanks.join(", ")}`);

  // HITL: an agent that can take a high-risk action with no suspension point has no human in the
  // loop, whatever the document says. Declaring zero high-risk actions is allowed — with a
  // rationale — because some agents genuinely only read.
  const tiers = contract.hitl?.tiers ?? [];
  const highRisk = tiers.filter((t) => t?.risk === "high");
  const suspends = tiers.filter((t) => t?.mode === "suspend-approve");
  if (highRisk.some((t) => t.mode !== "suspend-approve")) {
    refusals.push("every high-risk tier must be mode suspend-approve; a high-risk action that runs alone is the incident report");
  }
  if (suspends.length === 0 && !(contract.hitl?.noHighRiskActions?.value === true && isNonEmptyString(contract.hitl?.noHighRiskActions?.rationale))) {
    refusals.push("needs at least one suspend-approve tier, or hitl.noHighRiskActions with a rationale — absence of a suspension point must be a decision, not an omission");
  }

  // Retry sanity the schema ranges cannot see.
  const retry = contract.toolFaultTolerance?.retry;
  if (retry && typeof retry.baseDelayMs === "number" && typeof retry.maxDelayMs === "number" && retry.maxDelayMs < retry.baseDelayMs) {
    refusals.push("retry.maxDelayMs below baseDelayMs; the backoff would shrink instead of backing off");
  }

  // Context: "none" is a strategy only with a reason, and never alongside a real strategy.
  const strategies = contract.context?.strategies ?? [];
  if (strategies.includes("none")) {
    if (strategies.length > 1) refusals.push("context.strategies cannot mix 'none' with a real strategy");
    if (!isNonEmptyString(contract.context?.noneRationale)) refusals.push("context.strategies 'none' needs context.noneRationale");
  }

  // The three golden metrics, by name. A declaration that swaps one for a flattering substitute is
  // exactly the "measure only what passes" move the capability gate refuses, so this one does too.
  const sloMetrics = new Set((contract.slos ?? []).map((clause) => clause?.metric));
  for (const metric of GOLDEN_METRICS) {
    if (!sloMetrics.has(metric)) refusals.push(`slos missing the golden metric '${metric}'`);
  }

  if (refusals.length > 0) throw new ProductionAgentRefusal(refusals);
  return contract;
}

/** The declare template. Every field present, every answer obviously unanswered. */
export function productionAgentTemplate(application, declaredAt) {
  return {
    schemaVersion: PRODUCTION_AGENT_SCHEMA_VERSION,
    application,
    declaredAt,
    goalTranslation: {
      businessGoal: "REPLACE: the goal in the stakeholder's words, e.g. 'lower support cost'",
      quantifiedTarget: { metric: "REPLACE: what you will count", comparator: "at-least", value: 0, rationale: "REPLACE: why this number means the goal" },
      decomposition: ["REPLACE: subtask waypoints for a long-horizon goal, or delete this array"],
    },
    hitl: {
      tiers: [
        { action: "REPLACE: a routine action", risk: "low", mode: "auto" },
        { action: "REPLACE: a consequential action, e.g. refund above threshold", risk: "high", mode: "suspend-approve", resumeAfterApproval: true },
      ],
    },
    toolFaultTolerance: {
      interception: { rawErrorsReachUser: false, how: "REPLACE: where errors are caught and rewritten" },
      retry: { maxAttempts: 3, backoff: "exponential", baseDelayMs: 250, maxDelayMs: 8000, jitter: true },
      fallback: { kind: "degraded-ui", description: "REPLACE: what the user gets when retries are exhausted" },
      toolContract: { descriptionsUnambiguous: true, fewShotForComplexParams: true },
    },
    context: { strategies: ["sliding-window"], tokenBudgetPerRun: 0 },
    slos: [
      { metric: "task-completion-rate", comparator: "at-least", value: 0.95 },
      { metric: "tool-call-error-rate", comparator: "at-most", value: 0.001 },
      { metric: "p99-latency-ms", comparator: "at-most", value: 500 },
    ],
    runtimeGuards: {
      loopBreaker: { maxIterations: 25, maxDepth: 8 },
      circuitBreaker: { errorRateThreshold: 0.2, windowSeconds: 60, onTrip: "REPLACE: cut which calls, alert whom" },
      costFuse: { maxTokensPerRun: 0, onTrip: "REPLACE: stop and surface where" },
    },
    release: {
      judgeRegression: { trigger: "on-commit", command: "REPLACE: the eval/judge command CI runs" },
      canary: {
        trafficPercent: 5,
        rollbackOn: [{ metric: "tool-call-error-rate", comparator: "above", value: 0.001 }],
        rollbackMode: "automatic",
      },
      modelMigration: { pinnedModel: "REPLACE: exact model id in use", migrationEvalCommand: "REPLACE: the eval diff run before any model swap" },
      tracing: { traceIdPropagated: true, field: "traceId" },
    },
  };
}

export function formatProductionAgentVerdict(contract) {
  const tiers = contract.hitl?.tiers ?? [];
  const lines = [
    `PRODUCTION-AGENT CONTRACT OK: ${contract.application}`,
    `  goal      ${contract.goalTranslation.quantifiedTarget.metric} ${contract.goalTranslation.quantifiedTarget.comparator} ${contract.goalTranslation.quantifiedTarget.value}`,
    `  hitl      ${tiers.filter((t) => t.mode === "auto").length} auto / ${tiers.filter((t) => t.mode === "suspend-approve").length} suspend-approve`,
    `  retry     ${contract.toolFaultTolerance.retry.maxAttempts} attempts, exponential ${contract.toolFaultTolerance.retry.baseDelayMs}ms..${contract.toolFaultTolerance.retry.maxDelayMs}ms, fallback ${contract.toolFaultTolerance.fallback.kind}`,
    `  guards    loop ${contract.runtimeGuards.loopBreaker.maxIterations} iters / depth ${contract.runtimeGuards.loopBreaker.maxDepth}, breaker at ${contract.runtimeGuards.circuitBreaker.errorRateThreshold}, cost fuse set`,
    `  release   canary ${contract.release.canary.trafficPercent}% with automatic rollback, judge ${contract.release.judgeRegression.trigger}, trace field '${contract.release.tracing.field}'`,
  ];
  return lines.join("\n");
}
