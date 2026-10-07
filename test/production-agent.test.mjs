import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLDEN_METRICS,
  ProductionAgentRefusal,
  parseProductionAgentContract,
  productionAgentTemplate,
  formatProductionAgentVerdict,
  PRODUCTION_AGENT_SCHEMA,
} from "../src/lib/production-agent.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

// The scenario is the one the 26Agent breakdown opens with: a support-desk agent whose business
// goal is "lower support operating cost". The declaration below is what a senior agent engineer
// would actually write for it — refunds above a threshold suspend for a human, tool failures
// degrade to a canned-answer UI, the loop cannot run away, and the canary rolls itself back.
const SUPPORT_DESK = () => ({
  schemaVersion: "nodekit.production-agent/v1",
  application: "support-desk-agent",
  declaredAt: "2026-08-04T09:00:00.000Z",
  goalTranslation: {
    businessGoal: "lower support operating cost without losing customers",
    quantifiedTarget: { metric: "ticket-deflection-rate", comparator: "at-least", value: 0.4, rationale: "below 0.4 the licence costs more than the humans it replaces" },
    decomposition: ["classify intent", "retrieve account context", "answer or act", "escalate on low confidence"],
  },
  hitl: {
    tiers: [
      { action: "answer product questions from the knowledge base", risk: "low", mode: "auto" },
      { action: "issue refund above $100", risk: "high", mode: "suspend-approve", resumeAfterApproval: true },
    ],
  },
  toolFaultTolerance: {
    interception: { rawErrorsReachUser: false, how: "tool adapter catches, logs with traceId, rewrites to user-language" },
    retry: { maxAttempts: 3, backoff: "exponential", baseDelayMs: 250, maxDelayMs: 8000, jitter: true },
    fallback: { kind: "degraded-ui", description: "canned answers plus a ticket link when the provider is down" },
    toolContract: { descriptionsUnambiguous: true, fewShotForComplexParams: true },
  },
  context: { strategies: ["retrieval-extraction", "sliding-window"], tokenBudgetPerRun: 60000 },
  slos: [
    { metric: "task-completion-rate", comparator: "at-least", value: 0.95 },
    { metric: "tool-call-error-rate", comparator: "at-most", value: 0.001 },
    { metric: "p99-latency-ms", comparator: "at-most", value: 500 },
  ],
  runtimeGuards: {
    loopBreaker: { maxIterations: 25, maxDepth: 8 },
    circuitBreaker: { errorRateThreshold: 0.2, windowSeconds: 60, onTrip: "cut provider calls, page on-call, serve fallback" },
    costFuse: { maxTokensPerRun: 200000, onTrip: "halt run, surface partial answer with a notice" },
  },
  release: {
    judgeRegression: { trigger: "on-commit", command: "npm run eval:judge" },
    canary: {
      trafficPercent: 5,
      rollbackOn: [{ metric: "tool-call-error-rate", comparator: "above", value: 0.001 }],
      rollbackMode: "automatic",
    },
    modelMigration: { pinnedModel: "claude-sonnet-5", migrationEvalCommand: "npm run eval:judge -- --compare" },
    tracing: { traceIdPropagated: true, field: "traceId" },
  },
});

const refusalsOf = (contract) => {
  try {
    parseProductionAgentContract(contract);
    return [];
  } catch (error) {
    assert.ok(error instanceof ProductionAgentRefusal);
    return error.refusals;
  }
};

test("the filled support-desk declaration passes both the schema and the semantic parse", async () => {
  const contract = SUPPORT_DESK();
  const errors = await validateSchema(PRODUCTION_AGENT_SCHEMA, contract, "support-desk-agent");
  assert.deepEqual(errors, []);
  assert.equal(parseProductionAgentContract(contract), contract);
  const verdict = formatProductionAgentVerdict(contract);
  assert.match(verdict, /1 auto \/ 1 suspend-approve/);
  assert.match(verdict, /canary 5% with automatic rollback/);
});

test("the declare template itself is refused — a form you can submit unread is not a gate", () => {
  const refusals = refusalsOf(productionAgentTemplate("support-desk-agent", "2026-08-04T09:00:00.000Z"));
  assert.ok(refusals.some((entry) => entry.includes("template blanks not replaced")), refusals.join("\n"));
});

test("a high-risk action that runs alone is refused, whatever else is right", () => {
  const contract = SUPPORT_DESK();
  contract.hitl.tiers[1].mode = "auto";
  const refusals = refusalsOf(contract);
  assert.ok(refusals.some((entry) => entry.includes("high-risk tier must be mode suspend-approve")), refusals.join("\n"));
});

test("no suspension point anywhere needs an explicit noHighRiskActions rationale", () => {
  const contract = SUPPORT_DESK();
  contract.hitl.tiers = [{ action: "read-only lookups", risk: "low", mode: "auto" }];
  assert.ok(refusalsOf(contract).some((entry) => entry.includes("suspend-approve tier, or hitl.noHighRiskActions")));
  contract.hitl.noHighRiskActions = { value: true, rationale: "the agent only reads; every write path is behind a separate service it cannot call" };
  assert.deepEqual(refusalsOf(contract), []);
});

test("swapping a golden metric for a flattering substitute is refused by name", () => {
  const contract = SUPPORT_DESK();
  contract.slos[1] = { metric: "median-latency-ms", comparator: "at-most", value: 100 };
  const refusals = refusalsOf(contract);
  assert.ok(refusals.some((entry) => entry.includes("golden metric 'tool-call-error-rate'")), refusals.join("\n"));
  assert.equal(GOLDEN_METRICS.length, 3);
});

test("a backoff whose cap is below its base is refused — that backoff shrinks", () => {
  const contract = SUPPORT_DESK();
  contract.toolFaultTolerance.retry.maxDelayMs = 100;
  assert.ok(refusalsOf(contract).some((entry) => entry.includes("maxDelayMs below baseDelayMs")));
});

test("context strategy 'none' needs a rationale and cannot hide next to a real strategy", () => {
  const contract = SUPPORT_DESK();
  contract.context.strategies = ["none", "sliding-window"];
  const refusals = refusalsOf(contract);
  assert.ok(refusals.some((entry) => entry.includes("cannot mix 'none'")));
  contract.context.strategies = ["none"];
  assert.ok(refusalsOf(contract).some((entry) => entry.includes("noneRationale")));
  contract.context.noneRationale = "single-turn tool dispatch; the whole exchange fits in 2k tokens";
  assert.deepEqual(refusalsOf(contract), []);
});

test("every refusal is reported at once, not one per run", () => {
  const contract = SUPPORT_DESK();
  contract.hitl.tiers[1].mode = "auto";
  contract.slos.splice(0, 1);
  contract.toolFaultTolerance.retry.maxDelayMs = 1;
  const refusals = refusalsOf(contract);
  assert.ok(refusals.length >= 3, refusals.join("\n"));
});

test("schema refuses the shapes the parse never sees: 100% canary, manual rollback, leaked raw errors", async () => {
  const big = SUPPORT_DESK();
  big.release.canary.trafficPercent = 100; // a 100% canary is a launch
  assert.ok((await validateSchema(PRODUCTION_AGENT_SCHEMA, big, "x")).length > 0);
  const manual = SUPPORT_DESK();
  manual.release.canary.rollbackMode = "manual"; // a manual rollback at 3am is not a rollback
  assert.ok((await validateSchema(PRODUCTION_AGENT_SCHEMA, manual, "x")).length > 0);
  const leaky = SUPPORT_DESK();
  leaky.toolFaultTolerance.interception.rawErrorsReachUser = true;
  assert.ok((await validateSchema(PRODUCTION_AGENT_SCHEMA, leaky, "x")).length > 0);
  const fuseless = SUPPORT_DESK();
  delete fuseless.runtimeGuards.costFuse.maxTokensPerRun; // a fuse with no threshold fuses nothing
  assert.ok((await validateSchema(PRODUCTION_AGENT_SCHEMA, fuseless, "x")).length > 0);
});
