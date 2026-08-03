import { createHash } from "node:crypto";

export const GOVERNANCE_MODES = Object.freeze([
  "AUTO_CONTINUE",
  "AUTO_PROMOTE_WITH_ROLLBACK",
  "DEFERRED_HUMAN_REVIEW",
  "PRE_ACTION_HUMAN_GATE",
]);

export const GOVERNANCE_SCHEMA_VERSIONS = Object.freeze({
  riskAssessment: "nodekit.governance-risk-assessment/v1",
  changeEvidencePack: "nodekit.change-evidence-pack/v1",
  rollbackReceipt: "nodekit.rollback-receipt/v1",
  promotionReadiness: "nodekit.promotion-readiness-receipt/v1",
  humanFeedback: "nodekit.human-feedback-event/v1",
});

const MAX_STRINGS = 64;
const MAX_TEXT = 4_096;
const MAX_GRAPH_NODES = 64;
const MAX_GRAPH_EDGES = 128;
const MAX_REFERENCE_LINKS = 12;
const SHA256 = /^[a-f0-9]{64}$/;
const REF = /^[a-z0-9][a-z0-9._-]*:sha256:[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`governance: ${message}`);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT) {
    fail(`${label} must be a non-empty string no longer than ${MAX_TEXT} characters`);
  }
  return value.trim();
}

function exactBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function boundedStrings(value, label, { max = MAX_STRINGS, pattern } = {}) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array with at most ${max} items`);
  const normalized = value.map((item, index) => nonEmpty(item, `${label}[${index}]`));
  if (pattern && normalized.some((item) => !pattern.test(item))) fail(`${label} contains an invalid reference`);
  return [...new Set(normalized)].sort();
}

function exactHash(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}

function exactRef(value, label) {
  if (typeof value !== "string" || !REF.test(value)) fail(`${label} must be a content-addressed reference`);
  return value;
}

function httpsUrl(value, label) {
  const normalized = nonEmpty(value, label);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use https`);
  return parsed.href;
}

function evidenceRef(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object`);
  return {
    ref: exactRef(entry.ref, `${label}.ref`),
    digest: exactHash(entry.digest, `${label}.digest`),
    kind: nonEmpty(entry.kind, `${label}.kind`),
    label: nonEmpty(entry.label, `${label}.label`),
  };
}

function withDigest(value, key) {
  return { ...value, [key]: digest(value) };
}

async function withinBudget(label, timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`governance: ${label} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function classifyGovernanceRisk(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("risk input must be an object");
  const changeRef = exactRef(input.changeRef, "changeRef");
  const candidateDigest = exactHash(input.candidateDigest, "candidateDigest");
  const effects = {
    destructiveWrite: exactBoolean(input.effects?.destructiveWrite ?? false, "effects.destructiveWrite"),
    credentialOrAuthorityChange: exactBoolean(
      input.effects?.credentialOrAuthorityChange ?? false,
      "effects.credentialOrAuthorityChange",
    ),
    irreversibleMigration: exactBoolean(input.effects?.irreversibleMigration ?? false, "effects.irreversibleMigration"),
    materialSpend: exactBoolean(input.effects?.materialSpend ?? false, "effects.materialSpend"),
    externalCommunication: exactBoolean(input.effects?.externalCommunication ?? false, "effects.externalCommunication"),
    legalOrComplianceCommitment: exactBoolean(
      input.effects?.legalOrComplianceCommitment ?? false,
      "effects.legalOrComplianceCommitment",
    ),
    irreversiblePromotion: exactBoolean(input.effects?.irreversiblePromotion ?? false, "effects.irreversiblePromotion"),
  };
  const evidence = {
    exactRollbackTarget: exactBoolean(input.evidence?.exactRollbackTarget ?? false, "evidence.exactRollbackTarget"),
    rollbackVerified: exactBoolean(input.evidence?.rollbackVerified ?? false, "evidence.rollbackVerified"),
    forwardCompatible: exactBoolean(input.evidence?.forwardCompatible ?? false, "evidence.forwardCompatible"),
    rollbackCompatible: exactBoolean(input.evidence?.rollbackCompatible ?? false, "evidence.rollbackCompatible"),
    observationConfigured: exactBoolean(
      input.evidence?.observationConfigured ?? false,
      "evidence.observationConfigured",
    ),
    nodeProofPromotionReady: exactBoolean(
      input.evidence?.nodeProofPromotionReady ?? false,
      "evidence.nodeProofPromotionReady",
    ),
    unresolvedMajorFindings: exactBoolean(
      input.evidence?.unresolvedMajorFindings ?? false,
      "evidence.unresolvedMajorFindings",
    ),
  };
  const context = {
    architectureChanged: exactBoolean(input.context?.architectureChanged ?? false, "context.architectureChanged"),
    publicContractChanged: exactBoolean(input.context?.publicContractChanged ?? false, "context.publicContractChanged"),
    materiallySubjectiveProductEffect: exactBoolean(
      input.context?.materiallySubjectiveProductEffect ?? false,
      "context.materiallySubjectiveProductEffect",
    ),
    isolatedEngineeringOnly: exactBoolean(
      input.context?.isolatedEngineeringOnly ?? false,
      "context.isolatedEngineeringOnly",
    ),
    standingPromotionPolicy: exactBoolean(
      input.context?.standingPromotionPolicy ?? false,
      "context.standingPromotionPolicy",
    ),
  };

  const protectedEffects = Object.entries(effects)
    .filter(([, active]) => active)
    .map(([name]) => name)
    .sort();
  const promotionProofComplete = evidence.exactRollbackTarget
    && evidence.rollbackVerified
    && evidence.forwardCompatible
    && evidence.rollbackCompatible
    && evidence.observationConfigured
    && evidence.nodeProofPromotionReady
    && !evidence.unresolvedMajorFindings;

  let mode;
  const decidingRiskInputs = [];
  if (protectedEffects.length > 0) {
    mode = "PRE_ACTION_HUMAN_GATE";
    decidingRiskInputs.push(...protectedEffects.map((effect) => `effect:${effect}`));
  } else if (context.publicContractChanged || context.materiallySubjectiveProductEffect) {
    mode = "DEFERRED_HUMAN_REVIEW";
    if (context.publicContractChanged) decidingRiskInputs.push("context:publicContractChanged");
    if (context.materiallySubjectiveProductEffect) decidingRiskInputs.push("context:materiallySubjectiveProductEffect");
  } else if (context.standingPromotionPolicy && promotionProofComplete) {
    mode = "AUTO_PROMOTE_WITH_ROLLBACK";
    decidingRiskInputs.push("policy:standingPromotionPolicy", "proof:promotionProofComplete");
  } else {
    mode = "AUTO_CONTINUE";
    if (context.architectureChanged) decidingRiskInputs.push("context:architectureChanged-not-a-risk");
    if (!context.standingPromotionPolicy) decidingRiskInputs.push("policy:noStandingPromotionGrant");
    if (!promotionProofComplete) decidingRiskInputs.push("proof:promotionProofIncomplete");
  }

  const assessment = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.riskAssessment,
    assessmentId: `governance-risk:sha256:${digest({ changeRef, candidateDigest, effects, evidence, context })}`,
    changeRef,
    candidateDigest,
    facts: { effects, evidence, context },
    mode,
    decidingRiskInputs: decidingRiskInputs.sort(),
    codeMayContinue: mode !== "PRE_ACTION_HUMAN_GATE" || context.isolatedEngineeringOnly,
    promotionRequiresHuman: mode === "DEFERRED_HUMAN_REVIEW" || mode === "PRE_ACTION_HUMAN_GATE",
    protectedActionMayRun: mode === "AUTO_PROMOTE_WITH_ROLLBACK",
  };
  return withDigest(assessment, "riskAssessmentDigest");
}

export function createChangeEvidencePack(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("evidence input must be an object");
  const before = (input.before ?? []).map((entry, index) => evidenceRef(entry, `before[${index}]`));
  const after = (input.after ?? []).map((entry, index) => evidenceRef(entry, `after[${index}]`));
  if (before.length === 0 || after.length === 0) fail("before and after evidence are both required");
  if (before.length > 32 || after.length > 32) fail("evidence is bounded to 32 items per side");
  const uiChanged = exactBoolean(input.ui?.changed ?? false, "ui.changed");
  const mediaRefs = boundedStrings(input.ui?.mediaRefs ?? [], "ui.mediaRefs", { max: 16, pattern: REF });
  if (uiChanged && mediaRefs.length === 0) fail("changed UI requires screenshot or clip references");
  if (!uiChanged && mediaRefs.length > 0) fail("unchanged UI cannot claim media evidence");
  const pack = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.changeEvidencePack,
    packId: `change-evidence:sha256:${digest(input)}`,
    changeRef: exactRef(input.changeRef, "changeRef"),
    baselineDigest: exactHash(input.baselineDigest, "baselineDigest"),
    candidateDigest: exactHash(input.candidateDigest, "candidateDigest"),
    materialFiles: boundedStrings(input.materialFiles ?? [], "materialFiles", { max: 512 }),
    before,
    after,
    ui: {
      changed: uiChanged,
      mediaRefs,
      notApplicableReason: uiChanged ? null : nonEmpty(input.ui?.notApplicableReason, "ui.notApplicableReason"),
    },
    rollbackTarget: {
      ref: exactRef(input.rollbackTarget?.ref, "rollbackTarget.ref"),
      digest: exactHash(input.rollbackTarget?.digest, "rollbackTarget.digest"),
    },
  };
  return withDigest(pack, "evidencePackDigest");
}

export async function runRollbackAdapter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("rollback input must be an object");
  for (const name of ["observeHealth", "rollback", "verify"]) {
    if (typeof input[name] !== "function") fail(`${name} must be a function`);
  }
  const trigger = nonEmpty(input.trigger, "trigger");
  const timeoutMs = Number(input.timeoutMs ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail("timeoutMs must be an integer from 1 through 120000");
  }
  const deploymentRef = exactRef(input.deploymentRef, "deploymentRef");
  const rollbackTargetRef = exactRef(input.rollbackTargetRef, "rollbackTargetRef");
  const rollbackTargetDigest = exactHash(input.rollbackTargetDigest, "rollbackTargetDigest");
  const health = await withinBudget("health observation", timeoutMs, (signal) => input.observeHealth({ signal }));
  if (!health || typeof health !== "object" || typeof health.healthy !== "boolean") {
    fail("observeHealth must return { healthy, checks }");
  }
  const checks = boundedStrings(health.checks ?? [], "health.checks");
  let rollbackAttempted = false;
  let rollbackResult = { targetApplied: false, actionRef: null };
  let verification = { restored: true, checks };
  if (!health.healthy) {
    rollbackAttempted = true;
    rollbackResult = await withinBudget("rollback", timeoutMs, (signal) => input.rollback({
      deploymentRef,
      rollbackTargetRef,
      rollbackTargetDigest,
      trigger,
      signal,
    }));
    if (!rollbackResult || rollbackResult.targetApplied !== true) fail("rollback adapter did not apply the target");
    verification = await withinBudget("rollback verification", timeoutMs, (signal) => input.verify({
      deploymentRef,
      rollbackTargetRef,
      rollbackTargetDigest,
      signal,
    }));
    if (!verification || typeof verification.restored !== "boolean") fail("verify must return { restored, checks }");
  }
  const receipt = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.rollbackReceipt,
    receiptId: `rollback:sha256:${digest({ deploymentRef, rollbackTargetRef, rollbackTargetDigest, trigger, health, rollbackResult, verification })}`,
    deploymentRef,
    trigger,
    rollbackTarget: { ref: rollbackTargetRef, digest: rollbackTargetDigest },
    observedHealth: { healthy: health.healthy, checks },
    rollbackAttempted,
    actionRef: rollbackResult.actionRef ?? null,
    verification: {
      restored: verification.restored,
      checks: boundedStrings(verification.checks ?? [], "verification.checks"),
    },
    status: health.healthy ? "NOT_REQUIRED" : verification.restored ? "ROLLED_BACK" : "ROLLBACK_FAILED",
  };
  return withDigest(receipt, "rollbackReceiptDigest");
}

export function createPromotionReadinessReceipt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("promotion input must be an object");
  const riskAssessment = input.riskAssessment;
  const evidencePack = input.evidencePack;
  const rollbackReceipt = input.rollbackReceipt;
  if (!GOVERNANCE_MODES.includes(riskAssessment?.mode)) fail("riskAssessment.mode is invalid");
  const blockers = [];
  if (riskAssessment.mode === "PRE_ACTION_HUMAN_GATE") blockers.push("PRE_ACTION_HUMAN_GATE");
  if (riskAssessment.mode === "DEFERRED_HUMAN_REVIEW") blockers.push("DEFERRED_HUMAN_REVIEW");
  if (!input.nodeProofReady) blockers.push("NODEPROOF_NOT_READY");
  if (input.unresolvedMajorFindings) blockers.push("MAJOR_FINDINGS");
  if (riskAssessment.mode === "AUTO_PROMOTE_WITH_ROLLBACK" && rollbackReceipt?.status === "ROLLBACK_FAILED") {
    blockers.push("ROLLBACK_FAILED");
  }
  const receipt = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.promotionReadiness,
    receiptId: `promotion-readiness:sha256:${digest({
      riskAssessmentDigest: riskAssessment.riskAssessmentDigest,
      evidencePackDigest: evidencePack?.evidencePackDigest,
      rollbackReceiptDigest: rollbackReceipt?.rollbackReceiptDigest,
      nodeProofDigest: input.nodeProofDigest,
    })}`,
    mode: riskAssessment.mode,
    riskAssessmentRef: riskAssessment.assessmentId,
    riskAssessmentDigest: exactHash(riskAssessment.riskAssessmentDigest, "riskAssessmentDigest"),
    evidencePackRef: exactRef(evidencePack?.packId, "evidencePackRef"),
    evidencePackDigest: exactHash(evidencePack?.evidencePackDigest, "evidencePackDigest"),
    rollbackReceiptRef: rollbackReceipt ? exactRef(rollbackReceipt.receiptId, "rollbackReceiptRef") : null,
    rollbackReceiptDigest: rollbackReceipt
      ? exactHash(rollbackReceipt.rollbackReceiptDigest, "rollbackReceiptDigest")
      : null,
    nodeProofDigest: exactHash(input.nodeProofDigest, "nodeProofDigest"),
    ready: blockers.length === 0 && riskAssessment.mode === "AUTO_PROMOTE_WITH_ROLLBACK",
    blockers: blockers.sort(),
  };
  return withDigest(receipt, "promotionReadinessDigest");
}

export function createHumanFeedbackEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("feedback input must be an object");
  const decisions = ["accept", "reject", "request-changes", "rollback"];
  if (!decisions.includes(input.decision)) fail("decision is invalid");
  const event = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.humanFeedback,
    eventId: `human-feedback:sha256:${digest(input)}`,
    candidateRef: exactRef(input.candidateRef, "candidateRef"),
    candidateDigest: exactHash(input.candidateDigest, "candidateDigest"),
    evidencePackRef: exactRef(input.evidencePackRef, "evidencePackRef"),
    evidencePackDigest: exactHash(input.evidencePackDigest, "evidencePackDigest"),
    actorRef: exactRef(input.actorRef, "actorRef"),
    decision: input.decision,
    statement: nonEmpty(input.statement, "statement"),
    scope: boundedStrings(input.scope ?? [], "scope"),
    preference: input.preference
      ? {
          statement: nonEmpty(input.preference.statement, "preference.statement"),
          appliesWhen: boundedStrings(input.preference.appliesWhen ?? [], "preference.appliesWhen"),
          expiresAt: input.preference.expiresAt ? nonEmpty(input.preference.expiresAt, "preference.expiresAt") : null,
        }
      : null,
  };
  return withDigest(event, "feedbackDigest");
}

export function projectGovernanceGraph({ riskAssessment, evidencePack, promotionReadiness }) {
  if (!GOVERNANCE_MODES.includes(riskAssessment?.mode)) fail("cannot project an invalid risk mode");
  const mode = riskAssessment.mode;
  const nodes = [
    { id: "assess", type: "RISK_ASSESSMENT", title: "Classify effect", status: "passed", x: 10, y: 180 },
    { id: "build", type: "BUILD", title: "Build candidate", status: riskAssessment.codeMayContinue ? "passed" : "blocked", x: 155, y: 180 },
    { id: "evidence", type: "CHECK", title: "Bind evidence", status: evidencePack ? "passed" : "waiting", x: 300, y: 180 },
    { id: "nodeproof", type: "REVIEW", title: "NodeProof", status: promotionReadiness ? "passed" : "waiting", x: 445, y: 180 },
    { id: "gate", type: "GATE", title: mode.replaceAll("_", " "), status: mode === "PRE_ACTION_HUMAN_GATE" ? "blocked" : "active", x: 590, y: 180 },
    { id: "observe", type: "OBSERVE", title: "Observe health", status: mode === "AUTO_PROMOTE_WITH_ROLLBACK" ? "active" : "waiting", x: 735, y: 100 },
    { id: "review", type: "HUMAN_REVIEW", title: "Review evidence", status: riskAssessment.promotionRequiresHuman ? "active" : "waiting", x: 735, y: 260 },
    { id: "rollback", type: "ROLLBACK", title: "Restore baseline", status: "standby", x: 880, y: 100 },
    { id: "accepted", type: "ACCEPT", title: "Accept exact candidate", status: "waiting", x: 880, y: 260 },
  ];
  const edges = [
    ["assess", "build", "code may continue"],
    ["build", "evidence", "candidate digest"],
    ["evidence", "nodeproof", "proof bundle"],
    ["nodeproof", "gate", "derived mode"],
    ["gate", "observe", "standing policy"],
    ["gate", "review", "human boundary"],
    ["observe", "rollback", "health failure"],
    ["observe", "accepted", "healthy window"],
    ["review", "rollback", "reject"],
    ["review", "accepted", "accept"],
  ].map(([from, to, label], index) => ({ id: `edge-${index + 1}`, from, to, label }));
  const graph = {
    schemaVersion: "nodekit.governance-graph-projection/v1",
    canonicalState: "caseflow",
    projection: "disposable",
    mode,
    nodes,
    edges,
    sourceDigests: {
      riskAssessment: riskAssessment.riskAssessmentDigest,
      evidencePack: evidencePack?.evidencePackDigest ?? null,
      promotionReadiness: promotionReadiness?.promotionReadinessDigest ?? null,
    },
  };
  return withDigest(graph, "graphDigest");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderGovernanceGraphHtml({ riskAssessment, evidencePack, promotionReadiness, graph, referenceProvenance = [] }) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) fail("graph must be an object");
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > MAX_GRAPH_NODES) {
    fail(`graph.nodes must contain 1-${MAX_GRAPH_NODES} nodes`);
  }
  if (!Array.isArray(graph.edges) || graph.edges.length > MAX_GRAPH_EDGES) {
    fail(`graph.edges must contain at most ${MAX_GRAPH_EDGES} edges`);
  }
  if (!Array.isArray(referenceProvenance) || referenceProvenance.length > MAX_REFERENCE_LINKS) {
    fail(`referenceProvenance must contain at most ${MAX_REFERENCE_LINKS} entries`);
  }
  const graphNodes = graph.nodes.map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) fail(`graph.nodes[${index}] must be an object`);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) fail(`graph.nodes[${index}] needs finite coordinates`);
    return {
      ...node,
      id: nonEmpty(node.id, `graph.nodes[${index}].id`),
      type: nonEmpty(node.type, `graph.nodes[${index}].type`),
      title: nonEmpty(node.title, `graph.nodes[${index}].title`),
      status: nonEmpty(node.status, `graph.nodes[${index}].status`),
    };
  });
  const nodeIds = new Set(graphNodes.map((node) => node.id));
  if (nodeIds.size !== graphNodes.length) fail("graph.nodes must have unique ids");
  const graphEdges = graph.edges.map((edge, index) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) fail(`graph.edges[${index}] must be an object`);
    const from = nonEmpty(edge.from, `graph.edges[${index}].from`);
    const to = nonEmpty(edge.to, `graph.edges[${index}].to`);
    if (!nodeIds.has(from) || !nodeIds.has(to)) fail(`graph.edges[${index}] references an unknown node`);
    return { ...edge, from, to, label: nonEmpty(edge.label, `graph.edges[${index}].label`) };
  });
  // Every shipped element is either cited or deliberately novel, and it has to say which. An entry
  // with an empty factIds list used to be accepted, which meant an element that referenced nothing
  // rendered identically to one standing on evidence — a provenance surface whose failure mode is
  // looking exactly like a success. "Novel" stays available, because inventing something is
  // legitimate; declaring it is what makes the citation on everything else mean anything.
  const safeReferences = referenceProvenance.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`referenceProvenance[${index}] must be an object`);
    }
    const at = `referenceProvenance[${index}]`;
    const label = nonEmpty(entry.label, `${at}.label`);
    const novel = entry.novel === true;
    const factIds = entry.factIds === undefined && novel
      ? []
      : boundedStrings(entry.factIds, `${at}.factIds`);

    if (novel && factIds.length > 0) {
      fail(`${at} is declared novel but also cites facts; it is one or the other`);
    }
    if (!novel && factIds.length === 0) {
      fail(`${at} cites no facts and is not declared novel; an unclassified element is not provenance`);
    }
    if (novel) {
      return { label, novel: true, rationale: nonEmpty(entry.rationale, `${at}.rationale`), factIds: [] };
    }
    return { label, url: httpsUrl(entry.url, `${at}.url`), factIds };
  });
  const modeLabel = riskAssessment.mode.replaceAll("_", " ");
  const modeTone = riskAssessment.mode === "PRE_ACTION_HUMAN_GATE"
    ? "danger"
    : riskAssessment.mode === "DEFERRED_HUMAN_REVIEW"
      ? "warn"
      : "success";
  const nodeById = Object.fromEntries(graphNodes.map((node) => [node.id, node]));
  const edges = graphEdges.map((edge) => {
    const from = nodeById[edge.from];
    const to = nodeById[edge.to];
    const x1 = from.x + 125;
    const y1 = from.y + 34;
    const x2 = to.x;
    const y2 = to.y + 34;
    const middle = x1 + Math.max(28, (x2 - x1) / 2);
    return `<path d="M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}" />
      <text x="${(x1 + x2) / 2}" y="${Math.min(y1, y2) - 9}">${escapeHtml(edge.label)}</text>`;
  }).join("");
  const nodes = graphNodes.map((node) => `<button class="node ${escapeHtml(node.status)}" style="left:${node.x}px;top:${node.y}px" data-node="${escapeHtml(node.id)}" aria-label="${escapeHtml(`${node.title}: ${node.status}`)}">
      <span class="node-kicker">${escapeHtml(node.type.replaceAll("_", " "))}</span>
      <strong>${escapeHtml(node.title)}</strong>
      <span class="node-status"><i></i>${escapeHtml(node.status)}</span>
    </button>`).join("");
  const facts = [
    ["Architecture changed", riskAssessment.facts.context.architectureChanged],
    ["Authority changed", riskAssessment.facts.effects.credentialOrAuthorityChange],
    ["Rollback verified", riskAssessment.facts.evidence.rollbackVerified],
    ["Observation configured", riskAssessment.facts.evidence.observationConfigured],
    ["Major findings", riskAssessment.facts.evidence.unresolvedMajorFindings],
  ];
  // A novel element has no source to link to, and must not be dressed as though it had one.
  const references = safeReferences.map((entry) => (entry.novel
    ? `<li><span>${escapeHtml(entry.label)}</span><span>novel — ${escapeHtml(entry.rationale)}</span></li>`
    : `<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.label)}</a><span>${escapeHtml(entry.factIds.join(", "))}</span></li>`)).join("");
  const details = Object.fromEntries(graphNodes.map((node) => [node.id, {
    title: node.title,
    type: node.type.replaceAll("_", " "),
    status: node.status,
    explanation: node.id === "gate"
      ? `The mode is derived from effect facts and proof state. Architecture alone never creates a human gate.`
      : node.id === "rollback"
        ? "A failed observation or rejection restores the exact content-addressed baseline."
        : `This stage receives a typed handoff and cannot promote itself.`,
  }]));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NodeKit governance graph</title>
  <style>
    :root{color-scheme:light;--ink:#17201d;--muted:#66716c;--line:#dfe5e1;--panel:#fff;--canvas:#f5f7f5;--green:#18794e;--green-bg:#e7f5ed;--amber:#9a6700;--amber-bg:#fff2cc;--red:#c93c37;--red-bg:#fdeceb;--blue:#315caa;--shadow:0 10px 28px rgba(30,42,36,.08)}
    *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    button,a{font:inherit}.shell{min-height:100vh;display:grid;grid-template-rows:auto auto 1fr}
    header{height:58px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid var(--line)}
    .brand{display:flex;align-items:center;gap:10px;font-weight:760}.mark{width:24px;height:24px;border:1px solid #b8c2bd;border-radius:7px;display:grid;place-items:center;font:700 11px ui-monospace,monospace}
    .status-pill{border:1px solid currentColor;border-radius:999px;padding:5px 10px;font:650 11px ui-monospace,monospace;letter-spacing:.04em}.status-pill.success{color:var(--green);background:var(--green-bg)}.status-pill.warn{color:var(--amber);background:var(--amber-bg)}.status-pill.danger{color:var(--red);background:var(--red-bg)}
    .summary{background:#fff;border-bottom:1px solid var(--line);padding:22px 28px 0}.summary-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:18px}
    .eyebrow{margin:0 0 5px;color:var(--muted);font:650 11px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.summary h1{margin:0;font-size:25px;letter-spacing:-.03em}.summary p{margin:5px 0 0;color:var(--muted)}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;overflow:hidden}.metric{padding:13px 16px;border-right:1px solid var(--line)}.metric:last-child{border:0}.metric span{display:block;color:var(--muted);font-size:11px}.metric strong{display:block;margin-top:3px;font:700 14px ui-monospace,monospace}
    main{display:grid;grid-template-columns:minmax(0,1fr) 310px;min-height:0}.workspace{padding:24px;min-width:0}.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.toolbar h2{margin:0;font-size:14px}.legend{display:flex;gap:13px;color:var(--muted);font-size:11px}.legend span{display:flex;align-items:center;gap:5px}.legend i,.node-status i{width:7px;height:7px;border-radius:50%;background:#98a39d}.legend .ok,.passed i{background:var(--green)}.legend .active-dot,.active i{background:var(--amber)}.legend .blocked-dot,.blocked i{background:var(--red)}
    .graph-frame{position:relative;height:430px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}.graph{position:relative;width:1020px;height:420px;background-image:radial-gradient(#d8dfda 1px,transparent 1px);background-size:18px 18px}
    svg{position:absolute;inset:0;width:1020px;height:420px;pointer-events:none}svg path{fill:none;stroke:#bac4be;stroke-width:1.4;marker-end:url(#arrow)}svg text{fill:#7a8580;font:10px ui-monospace,monospace;text-anchor:middle}
    .node{position:absolute;width:125px;min-height:68px;text-align:left;border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 12px;color:var(--ink);box-shadow:0 2px 8px rgba(30,42,36,.05);cursor:pointer}.node:hover,.node:focus-visible{border-color:#7b9185;outline:3px solid rgba(49,92,170,.15)}.node.active{border-color:#d9ae47}.node.blocked{border-color:#e3a29f}.node-kicker{display:block;color:var(--muted);font:620 9px ui-monospace,monospace;letter-spacing:.06em}.node strong{display:block;margin:4px 0 7px;font-size:12px}.node-status{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px;text-transform:capitalize}
    .facts{margin-top:16px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}.facts h2{margin:0;padding:14px 16px;border-bottom:1px solid var(--line);font-size:13px}.fact-row{display:grid;grid-template-columns:1fr 96px;padding:10px 16px;border-bottom:1px solid #edf0ee}.fact-row:last-child{border:0}.fact-row code{text-align:right;color:var(--muted)}
    aside{border-left:1px solid var(--line);background:#fff;padding:24px;overflow:auto}.aside-kicker{color:var(--green);font:650 10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}aside h2{margin:7px 0 8px;font-size:19px;letter-spacing:-.02em}aside p{color:var(--muted)}.detail-grid{margin-top:18px;border-top:1px solid var(--line)}.detail{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:12px}.detail span{color:var(--muted)}.detail code{text-align:right;overflow-wrap:anywhere}.refs{margin-top:24px}.refs h3{font-size:12px}.refs ul{list-style:none;padding:0}.refs li{padding:9px 0;border-bottom:1px solid var(--line)}.refs a{display:block;color:var(--blue);font-weight:650;text-decoration:none}.refs span{display:block;color:var(--muted);font:10px ui-monospace,monospace}
    @media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}main{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line)}.summary-top{align-items:flex-start;flex-direction:column}}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--ink:#edf2ef;--muted:#9eaaa4;--line:#34413b;--panel:#151d19;--canvas:#101713;--green:#70d6a3;--green-bg:#173a2a;--amber:#f0bf5f;--amber-bg:#3b2f12;--red:#ff8d87;--red-bg:#44211f;--blue:#8ab4ff;--shadow:0 10px 28px rgba(0,0,0,.28)}header,.summary,aside,.graph-frame,.facts,.node{background:var(--panel)}.graph{background-image:radial-gradient(#35423c 1px,transparent 1px)}.fact-row{border-bottom-color:#28342e}svg path{stroke:#64716a}svg text{fill:#99a69f}}
  </style>
</head>
<body>
<div class="shell" data-testid="governance-graph">
  <header><div class="brand"><span class="mark">NK</span>NodeKit governance</div><span class="status-pill ${modeTone}" data-testid="governance-mode">${escapeHtml(modeLabel)}</span></header>
  <section class="summary">
    <div class="summary-top"><div><p class="eyebrow">Exact candidate decision path</p><h1>See why the agent continues—or stops</h1><p>Caseflow is canonical. This graph is a disposable, content-bound explanation.</p></div></div>
    <div class="metrics">
      <div class="metric"><span>Decision mode</span><strong>${escapeHtml(modeLabel)}</strong></div>
      <div class="metric"><span>Code may continue</span><strong>${riskAssessment.codeMayContinue ? "YES" : "NO"}</strong></div>
      <div class="metric"><span>Rollback proof</span><strong>${riskAssessment.facts.evidence.rollbackVerified ? "VERIFIED" : "MISSING"}</strong></div>
      <div class="metric"><span>Promotion readiness</span><strong>${promotionReadiness?.ready ? "READY" : "NOT READY"}</strong></div>
    </div>
  </section>
  <main>
    <section class="workspace">
      <div class="toolbar"><h2>Governance route</h2><div class="legend"><span><i class="ok"></i>Complete</span><span><i class="active-dot"></i>Current</span><span><i class="blocked-dot"></i>Blocked</span></div></div>
      <div class="graph-frame" tabindex="0" aria-label="Scrollable governance graph">
        <div class="graph">
          <svg aria-hidden="true"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#bac4be"/></marker></defs>${edges}</svg>
          ${nodes}
        </div>
      </div>
      <section class="facts"><h2>Facts used by the classifier</h2>${facts.map(([label, value]) => `<div class="fact-row"><span>${escapeHtml(label)}</span><code>${value ? "true" : "false"}</code></div>`).join("")}</section>
    </section>
    <aside aria-live="polite">
      <span class="aside-kicker" id="detail-type">GATE</span><h2 id="detail-title">${escapeHtml(nodeById.gate.title)}</h2><p id="detail-explanation">The mode is derived from effect facts and proof state. Architecture alone never creates a human gate.</p>
      <div class="detail-grid">
        <div class="detail"><span>Status</span><code id="detail-status">${escapeHtml(nodeById.gate.status)}</code></div>
        <div class="detail"><span>Graph digest</span><code>${escapeHtml(graph.graphDigest.slice(0, 14))}…</code></div>
        <div class="detail"><span>Evidence pack</span><code>${evidencePack ? escapeHtml(evidencePack.evidencePackDigest.slice(0, 14)) + "…" : "missing"}</code></div>
        <div class="detail"><span>Canonical state</span><code>Caseflow</code></div>
      </div>
      <div class="refs"><h3>Reference provenance</h3><ul>${references}</ul></div>
    </aside>
  </main>
</div>
<script>
  const details = ${JSON.stringify(details).replaceAll("<", "\\u003c")};
  document.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => {
    const detail = details[button.dataset.node];
    document.getElementById("detail-type").textContent = detail.type;
    document.getElementById("detail-title").textContent = detail.title;
    document.getElementById("detail-explanation").textContent = detail.explanation;
    document.getElementById("detail-status").textContent = detail.status;
  }));
</script>
</body>
</html>`;
}

export function createPr32GovernanceScenario() {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const ref = (kind, value) => `${kind}:sha256:${hash(value)}`;
  const changeRef = ref("change", "pr-32-graph-of-bounded-loops");
  const baselineDigest = hash("pr32-baseline");
  const candidateDigest = hash("pr32-candidate");
  const riskAssessment = classifyGovernanceRisk({
    changeRef,
    candidateDigest,
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
  });
  const evidencePack = createChangeEvidencePack({
    changeRef,
    baselineDigest,
    candidateDigest,
    materialFiles: ["src/lib/execution-graph.mjs", "schemas/nodekit.execution-graph.v1.schema.json"],
    before: [{ ref: ref("evidence", "pr32-before-io"), digest: hash("pr32-before-io"), kind: "live-io", label: "Baseline request and response" }],
    after: [{ ref: ref("evidence", "pr32-after-io"), digest: hash("pr32-after-io"), kind: "live-io", label: "Candidate request and response" }],
    ui: {
      changed: false,
      mediaRefs: [],
      notApplicableReason: "The original PR changed a package runtime and had no product UI surface.",
    },
    rollbackTarget: { ref: ref("commit", "pr32-baseline"), digest: baselineDigest },
  });
  const rollbackReceipt = withDigest({
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.rollbackReceipt,
    receiptId: ref("rollback", "pr32-verified"),
    deploymentRef: ref("deployment", "pr32-candidate"),
    trigger: "pre-promotion rollback drill",
    rollbackTarget: { ref: ref("commit", "pr32-baseline"), digest: baselineDigest },
    observedHealth: { healthy: true, checks: ["exact baseline response restored"] },
    rollbackAttempted: true,
    actionRef: ref("rollback-action", "pr32-drill"),
    verification: { restored: true, checks: ["exact baseline response restored"] },
    status: "ROLLED_BACK",
  }, "rollbackReceiptDigest");
  const promotionReadiness = createPromotionReadinessReceipt({
    riskAssessment,
    evidencePack,
    rollbackReceipt,
    nodeProofReady: true,
    unresolvedMajorFindings: false,
    nodeProofDigest: hash("pr32-nodeproof"),
  });
  const graph = projectGovernanceGraph({ riskAssessment, evidencePack, promotionReadiness });
  return { riskAssessment, evidencePack, rollbackReceipt, promotionReadiness, graph };
}
