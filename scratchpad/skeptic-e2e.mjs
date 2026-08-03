// End-to-end through the REAL specialist entry point: evaluateFrontendTournament.
// Identical to test/frontend-specialist.test.mjs's happy path EXCEPT every
// screenshotSha256 / checkReportSha256 is a literal fabricated hex string.
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const stringifyYaml = createRequire(import.meta.url)("yaml").stringify;
import {
  FRONTEND_REQUIRED_STATES, FRONTEND_REQUIRED_VIEWS,
  compileFrontendPlan, createFrontendDirections, evaluateFrontendTournament, initializeFrontendHarness,
} from "../src/lib/frontend-specialist.mjs";
import { REQUIRED_RENDER_STATE_IDS, stateManifestHashOf, directionSetHashOf } from "../src/lib/frontend-render-contract.mjs";

const REPO_COMMIT = "a".repeat(40);
const FABRICATED = (n) => "f".repeat(63) + n.toString(16); // never hashed anything

// Absolute Windows path handed to node directly (bash /tmp is not node's /tmp).
const base = "D:\\VSCode Projects\\cafecorner_nodebench\\nodebench_ai4\\node-platform\\scratchpad\\e2e";
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, "run-"));
console.log("temp root:", root);

await mkdir(path.join(root, "harness"), { recursive: true });
await initializeFrontendHarness(root);

const contract = {
  schemaVersion: "nodekit.product-design-contract/v1",
  contractId: "contract-verified-business",
  product: { targetUser: "salon_owner", primaryJob: "understand_verified_profit", primaryArtifact: "verified_business_brief" },
  journey: ["orient", "connect_sources", "reconcile", "review_exceptions", "verify", "act", "export"],
  designIntent: { emotionalTarget: ["trustworthy", "calm", "operational"], dominantSurface: "verified_brief", dominantAction: "resolve_next_exception", density: "medium" },
  interfaceHypothesis: { artifactDominance: "brief occupies the primary stage", agentPlacement: "agent remains adjacent", reviewBoundary: "proposals remain distinct from canonical state", mobileTopology: "explicit artifact, review, and agent modes" },
  requiredDesktopSurfaces: ["navigation", "primary_artifact", "agent_review_rail", "current_action", "data_freshness"],
  requiredMobileSurfaces: ["today", "review", "business", "sources", "sticky_action"],
  avoid: ["generic_kpi_dashboard", "accounting_schema_as_interface", "decorative_chat", "all_workflow_states_expanded", "hidden_data_freshness"],
  requiredStates: [...FRONTEND_REQUIRED_STATES],
  protectedDecisions: { primaryUser: "nodekit", primaryJob: "nodekit", canonicalWorkflow: "nodekit", dataAuthority: "nodekit", permissionBoundaries: "nodekit", completionCriteria: "nodeproof", finalVerdict: "nodeproof" },
};
const contractPath = path.join(root, "harness", "frontend", "product-packets", "verified-business.yaml");
await writeFile(contractPath, stringifyYaml(contract));

const { output: planOutput } = await compileFrontendPlan(root, path.relative(root, contractPath));
const { directionSet, output: directionOutput } = await createFrontendDirections(root, path.relative(root, planOutput));
for (const candidate of directionSet.candidates) {
  candidate.status = "rendered";
  candidate.viewEvidence = Object.fromEntries(FRONTEND_REQUIRED_VIEWS.map((v) => [v, "proof/" + candidate.candidateId + "/" + v + ".png"]));
}
await writeFile(directionOutput, JSON.stringify(directionSet, null, 2) + "\n");

// ---- the fabricated render receipt ----
const renderedStates = REQUIRED_RENDER_STATE_IDS.map((stateId, i) => ({
  stateId,
  route: "/" + stateId,
  viewport: { width: stateId.startsWith("mobile") ? 375 : 1440, height: 812 },
  screenshotSha256: FABRICATED(i),
  checkReportSha256: FABRICATED(i + 6),
}));
const stateManifestHash = stateManifestHashOf(renderedStates);

await writeFile(path.join(root, "harness", "frontend", "render-receipt.json"), JSON.stringify({
  schemaVersion: "nodekit.frontend-render-receipt/v1",
  candidate: {
    candidateId: "direction-c",
    repositoryCommit: REPO_COMMIT,
    productContractHash: "c".repeat(64),
    directionSetHash: directionSetHashOf(directionSet),
    stateManifestHash,
  },
  verifier: {
    verifierId: "verifier-that-never-opened-a-browser",
    verifierCommit: "d".repeat(40),
    command: "true",
    browserName: "chromium",
    browserVersion: "1.61.1",
    startedAt: "2026-07-23T00:00:00.000Z",
    completedAt: "2026-07-23T00:02:00.000Z",
  },
  coverage: { requiredStateIds: [...REQUIRED_RENDER_STATE_IDS], renderedStates },
  checks: {
    browser: { status: "pass", pageErrors: 0, failedRequiredRequests: 0, missingRequiredStates: [] },
    accessibility: { status: "pass", seriousOrCriticalCount: 0, incompleteCount: 0 },
    overflow: { status: "pass", maxHorizontalOverflowPx: 0 },
    stateCommunication: { status: "pass", silentStates: [] },
  },
}, null, 2) + "\n");

await writeFile(path.join(root, "harness", "frontend", "review-receipt.json"), JSON.stringify({
  schemaVersion: "nodekit.frontend-review-receipt/v1",
  candidateId: "direction-c",
  reviewerId: "independent-critic",
  generatingModelId: "generating-model",
  reviewedStateManifestHash: stateManifestHash,
  verdict: "pass",
  unresolvedMajorFindings: [],
  reviewedAt: "2026-07-23T00:05:00.000Z",
}, null, 2) + "\n");

const dims = ["primaryJobClarity", "artifactDominance", "workflowHierarchy", "agentLegibility", "reviewSafety", "mobileOperation", "domainAppropriateness", "visualQuality"];
const score = (o) => Object.fromEntries(dims.map((k, i) => [k, Math.min(1, 0.7 + o + i * 0.005)]));

const benchmarkPath = path.join(root, "harness", "frontend", "benchmark.json");
await writeFile(benchmarkPath, JSON.stringify({
  schemaVersion: "nodekit.frontend-benchmark/v1",
  benchmarkId: "frontend-gym-1",
  directionSet: path.relative(root, directionOutput).replaceAll("\\", "/"),
  repositoryCommit: REPO_COMMIT,
  renderReceipt: "harness/frontend/render-receipt.json",
  reviewReceipt: "harness/frontend/review-receipt.json",
  scores: { "direction-a": score(0), "direction-b": score(0.05), "direction-c": score(0.1) },
  pairwiseResults: [
    { left: "direction-a", right: "direction-b", winner: "direction-b", evidenceRefs: ["critic-1"] },
    { left: "direction-a", right: "direction-c", winner: "direction-c", evidenceRefs: ["critic-2"] },
    { left: "direction-b", right: "direction-c", winner: "direction-c", evidenceRefs: ["critic-3"] },
  ],
  criticIndependent: true,
  majorFindings: [],
  freshUserEvidenceRefs: ["fresh-user-1"],
}, null, 2) + "\n");

// Prove no screenshot bytes exist anywhere under the repo root.
const walk = async (d) => {
  let out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    out = out.concat(e.isDirectory() ? await walk(p) : [p]);
  }
  return out;
};
const files = await walk(root);
console.log("image files present under repo root:", files.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).length);
console.log("total files under repo root       :", files.length);

const result = await evaluateFrontendTournament(root, path.relative(root, benchmarkPath));
console.log("selectedCandidateId :", result.decision.selectedCandidateId);
console.log("renderContract      :", JSON.stringify(result.renderContract));
console.log("decisive            :", result.decisive);
console.log("promotionAuthorized :", result.promotionAuthorized);
