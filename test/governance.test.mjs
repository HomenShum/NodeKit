import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  classifyGovernanceRisk,
  createChangeEvidencePack,
  createHumanFeedbackEvent,
  createPr32GovernanceScenario,
  createPromotionReadinessReceipt,
  projectGovernanceGraph,
  renderGovernanceGraphHtml,
  runRollbackAdapter,
} from "../src/lib/governance.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ref = (kind, value) => `${kind}:sha256:${hash(value)}`;

function reversibleInput(overrides = {}) {
  return {
    changeRef: ref("change", "founder-reversible-architecture"),
    candidateDigest: hash("candidate"),
    effects: {},
    evidence: {
      exactRollbackTarget: true,
      rollbackVerified: true,
      forwardCompatible: true,
      rollbackCompatible: true,
      observationConfigured: true,
      nodeProofPromotionReady: true,
      unresolvedMajorFindings: false,
    },
    context: {
      architectureChanged: true,
      standingPromotionPolicy: true,
      isolatedEngineeringOnly: false,
    },
    ...overrides,
  };
}

test("founder ships a reversible architecture candidate without an architecture-only interruption", async () => {
  const bundle = createPr32GovernanceScenario();
  assert.equal(bundle.riskAssessment.mode, "AUTO_PROMOTE_WITH_ROLLBACK");
  assert.equal(bundle.riskAssessment.codeMayContinue, true);
  assert.equal(bundle.riskAssessment.protectedActionMayRun, true);
  assert.equal(bundle.promotionReadiness.ready, true);
  assert.deepEqual(
    await validateSchema(
      "nodekit.governance-risk-assessment.v1.schema.json",
      bundle.riskAssessment,
      "risk assessment",
    ),
    [],
  );
  assert.deepEqual(
    await validateSchema("nodekit.change-evidence-pack.v1.schema.json", bundle.evidencePack, "evidence pack"),
    [],
  );
  assert.deepEqual(
    await validateSchema("nodekit.rollback-receipt.v1.schema.json", bundle.rollbackReceipt, "rollback receipt"),
    [],
  );
  assert.deepEqual(
    await validateSchema(
      "nodekit.promotion-readiness-receipt.v1.schema.json",
      bundle.promotionReadiness,
      "promotion readiness",
    ),
    [],
  );
});

test("native-session operator can continue isolated engineering but cannot cross an authority boundary", () => {
  const assessment = classifyGovernanceRisk(reversibleInput({
    effects: { credentialOrAuthorityChange: true },
    context: {
      architectureChanged: true,
      standingPromotionPolicy: true,
      isolatedEngineeringOnly: true,
    },
    mode: "AUTO_PROMOTE_WITH_ROLLBACK",
  }));
  assert.equal(assessment.mode, "PRE_ACTION_HUMAN_GATE", "caller-supplied mode must not create authority");
  assert.equal(assessment.codeMayContinue, true);
  assert.equal(assessment.protectedActionMayRun, false);
  assert.equal(assessment.promotionRequiresHuman, true);
});

test("product designer gets showcase-ready deferred review for a materially subjective UI change", () => {
  const assessment = classifyGovernanceRisk(reversibleInput({
    context: {
      architectureChanged: true,
      materiallySubjectiveProductEffect: true,
      standingPromotionPolicy: true,
      isolatedEngineeringOnly: false,
    },
  }));
  assert.equal(assessment.mode, "DEFERRED_HUMAN_REVIEW");
  assert.equal(assessment.codeMayContinue, true);
  assert.equal(assessment.promotionRequiresHuman, true);
});

test("missing rollback proof permits evidence work but never rounds up to promotion", () => {
  const assessment = classifyGovernanceRisk(reversibleInput({
    evidence: {
      exactRollbackTarget: true,
      rollbackVerified: false,
      forwardCompatible: true,
      rollbackCompatible: true,
      observationConfigured: true,
      nodeProofPromotionReady: true,
      unresolvedMajorFindings: false,
    },
  }));
  assert.equal(assessment.mode, "AUTO_CONTINUE");
  assert.equal(assessment.protectedActionMayRun, false);
});

test("SRE forced health failure triggers bounded rollback and proves the exact baseline", async () => {
  const calls = [];
  const rollbackTargetDigest = hash("baseline-v1");
  const receipt = await runRollbackAdapter({
    trigger: "held-out health check failed",
    deploymentRef: ref("deployment", "candidate-v2"),
    rollbackTargetRef: ref("deployment", "baseline-v1"),
    rollbackTargetDigest,
    observeHealth: async () => ({ healthy: false, checks: ["HTTP response digest mismatch"] }),
    rollback: async ({ rollbackTargetDigest: target }) => {
      calls.push(`rollback:${target}`);
      return { targetApplied: true, actionRef: ref("rollback-action", target) };
    },
    verify: async ({ rollbackTargetDigest: target }) => {
      calls.push(`verify:${target}`);
      return { restored: target === rollbackTargetDigest, checks: ["baseline response digest restored"] };
    },
  });
  assert.equal(receipt.status, "ROLLED_BACK");
  assert.equal(receipt.rollbackAttempted, true);
  assert.deepEqual(calls, [`rollback:${rollbackTargetDigest}`, `verify:${rollbackTargetDigest}`]);
  assert.deepEqual(
    await validateSchema("nodekit.rollback-receipt.v1.schema.json", receipt, "rollback receipt"),
    [],
  );
});

test("healthy sustained observation performs no rollback mutation", async () => {
  let rollbackCalls = 0;
  const receipt = await runRollbackAdapter({
    trigger: "observation window",
    deploymentRef: ref("deployment", "candidate-healthy"),
    rollbackTargetRef: ref("deployment", "baseline"),
    rollbackTargetDigest: hash("baseline"),
    observeHealth: async () => ({ healthy: true, checks: ["2,000 probes healthy"] }),
    rollback: async () => {
      rollbackCalls += 1;
      return { targetApplied: true };
    },
    verify: async () => ({ restored: true, checks: [] }),
  });
  assert.equal(receipt.status, "NOT_REQUIRED");
  assert.equal(rollbackCalls, 0);
});

test("degraded rollback dependency times out honestly instead of reporting success", async () => {
  await assert.rejects(
    runRollbackAdapter({
      timeoutMs: 5,
      trigger: "health dependency stalled",
      deploymentRef: ref("deployment", "candidate-timeout"),
      rollbackTargetRef: ref("deployment", "baseline-timeout"),
      rollbackTargetDigest: hash("baseline-timeout"),
      observeHealth: async () => new Promise(() => {}),
      rollback: async () => ({ targetApplied: true }),
      verify: async () => ({ restored: true, checks: [] }),
    }),
    /health observation exceeded 5ms/,
  );
});

test("concurrent and sustained classification stays deterministic without accumulated state", () => {
  const outputs = Array.from({ length: 2_000 }, () => classifyGovernanceRisk(reversibleInput()));
  assert.equal(new Set(outputs.map((entry) => entry.riskAssessmentDigest)).size, 1);
  assert.equal(new Set(outputs.map((entry) => entry.assessmentId)).size, 1);
});

test("human feedback remains scoped evidence and validates without becoming policy", async () => {
  const bundle = createPr32GovernanceScenario();
  const feedback = createHumanFeedbackEvent({
    candidateRef: bundle.riskAssessment.changeRef,
    candidateDigest: bundle.riskAssessment.candidateDigest,
    evidencePackRef: bundle.evidencePack.packId,
    evidencePackDigest: bundle.evidencePack.evidencePackDigest,
    actorRef: ref("human", "founder"),
    decision: "request-changes",
    statement: "Keep the summary strip but reduce graph density on mobile.",
    scope: ["governance-graph", "mobile"],
    preference: {
      statement: "Prefer summary-first workflow screens.",
      appliesWhen: ["single-candidate-governance"],
      expiresAt: "2026-10-30T00:00:00.000Z",
    },
  });
  assert.equal("promotionAuthorized" in feedback, false);
  assert.deepEqual(
    await validateSchema("nodekit.human-feedback-event.v1.schema.json", feedback, "feedback"),
    [],
  );
});

test("operator sees a content-bound graph, not a decorative diagram", () => {
  const bundle = createPr32GovernanceScenario();
  const graph = projectGovernanceGraph(bundle);
  const html = renderGovernanceGraphHtml({
    ...bundle,
    graph,
    referenceProvenance: [{
      label: "StackAI run detail",
      url: "https://mobbin.com/screens/bb0174f4-60aa-4e30-ac5f-73679b160f38",
      factIds: ["obs-mobbin-stackai-run-detail/f2"],
    }],
  });
  assert.match(html, /data-testid="governance-graph"/);
  assert.match(html, /AUTO PROMOTE WITH ROLLBACK/);
  assert.match(html, new RegExp(graph.graphDigest.slice(0, 14)));
  assert.match(html, /Caseflow is canonical/);
  assert.match(html, /mobbin\.com\/screens\/bb0174f4/);
});

test("adversarial graph references cannot inject an executable URL", () => {
  const bundle = createPr32GovernanceScenario();
  assert.throws(() => renderGovernanceGraphHtml({
    ...bundle,
    graph: projectGovernanceGraph(bundle),
    referenceProvenance: [{
      label: "untrusted reference",
      url: "javascript:alert(1)",
      factIds: ["untrusted/f1"],
    }],
  }), /must use https/);
});

test("adversarial graph projections remain bounded and structurally valid", () => {
  const bundle = createPr32GovernanceScenario();
  const graph = projectGovernanceGraph(bundle);
  assert.throws(() => renderGovernanceGraphHtml({
    ...bundle,
    graph: { ...graph, nodes: Array.from({ length: 65 }, (_, index) => ({ ...graph.nodes[0], id: `node-${index}` })) },
  }), /1-64 nodes/);
  assert.throws(() => renderGovernanceGraphHtml({
    ...bundle,
    graph: { ...graph, edges: [{ id: "bad", from: "missing", to: "gate", label: "bad" }] },
  }), /unknown node/);
});

test("evidence pack rejects a changed UI with no screenshot or clip reference", () => {
  assert.throws(() => createChangeEvidencePack({
    changeRef: ref("change", "ui-without-proof"),
    baselineDigest: hash("before"),
    candidateDigest: hash("after"),
    materialFiles: ["src/app.ts"],
    before: [{ ref: ref("evidence", "before"), digest: hash("before"), kind: "live-io", label: "before" }],
    after: [{ ref: ref("evidence", "after"), digest: hash("after"), kind: "live-io", label: "after" }],
    ui: { changed: true, mediaRefs: [] },
    rollbackTarget: { ref: ref("commit", "before"), digest: hash("before") },
  }), /changed UI requires screenshot or clip references/);
});

test("promotion receipt keeps deferred review and pre-action gates blocked", () => {
  const bundle = createPr32GovernanceScenario();
  const deferred = {
    ...bundle.riskAssessment,
    mode: "DEFERRED_HUMAN_REVIEW",
    promotionRequiresHuman: true,
  };
  const receipt = createPromotionReadinessReceipt({
    riskAssessment: deferred,
    evidencePack: bundle.evidencePack,
    rollbackReceipt: bundle.rollbackReceipt,
    nodeProofReady: true,
    unresolvedMajorFindings: false,
    nodeProofDigest: hash("nodeproof"),
  });
  assert.equal(receipt.ready, false);
  assert.deepEqual(receipt.blockers, ["DEFERRED_HUMAN_REVIEW"]);
});
