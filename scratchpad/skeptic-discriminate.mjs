// Distinguish what the manifest check actually catches from what the claim says it misses.
import { REQUIRED_RENDER_STATE_IDS, stateManifestHashOf, evaluateFrontendRenderContract, assembleFrontendRenderReceipt } from "../src/lib/frontend-render-contract.mjs";

const expected = { candidateId: "direction-b", repositoryCommit: "a".repeat(40), directionSetHash: "b".repeat(64) };
const FAB = (n) => "f".repeat(63) + n.toString(16);

const build = (states) => ({
  schemaVersion: "nodekit.frontend-render-receipt/v1",
  candidate: { candidateId: expected.candidateId, repositoryCommit: expected.repositoryCommit, productContractHash: "c".repeat(64), directionSetHash: expected.directionSetHash, stateManifestHash: stateManifestHashOf(states) },
  verifier: { verifierId: "v", verifierCommit: "d".repeat(40), command: "true", browserName: "chromium", browserVersion: "1", startedAt: "2026-07-26T00:00:00.000Z", completedAt: "2026-07-26T00:00:01.000Z" },
  coverage: { requiredStateIds: [...REQUIRED_RENDER_STATE_IDS], renderedStates: states },
  checks: {
    browser: { status: "pass", pageErrors: 0, failedRequiredRequests: 0, missingRequiredStates: [] },
    accessibility: { status: "pass", seriousOrCriticalCount: 0, incompleteCount: 0 },
    overflow: { status: "pass", maxHorizontalOverflowPx: 0 },
    stateCommunication: { status: "pass", silentStates: [] },
  },
});
const review = (h) => ({ schemaVersion: "nodekit.frontend-review-receipt/v1", candidateId: expected.candidateId, reviewerId: "r", generatingModelId: "g", reviewedStateManifestHash: h, verdict: "pass", unresolvedMajorFindings: [], reviewedAt: "2026-07-26T00:00:02.000Z" });

const states = () => REQUIRED_RENDER_STATE_IDS.map((stateId, i) => ({
  stateId, route: "/" + stateId, viewport: { width: 1440, height: 900 },
  screenshotSha256: FAB(i), checkReportSha256: FAB(i + 6),
}));

// A: fabricated but self-consistent
const a = build(states());
console.log("A fabricated+self-consistent :", evaluateFrontendRenderContract({ renderReceipt: a, reviewReceipt: review(a.candidate.stateManifestHash), expected }).status);

// B: same, then ONE hash edited after the manifest was computed (post-hoc tamper)
const b = build(states());
const bHash = b.candidate.stateManifestHash;
b.coverage.renderedStates[0].screenshotSha256 = "e".repeat(64);
console.log("B post-hoc manifest tamper   :", evaluateFrontendRenderContract({ renderReceipt: b, reviewReceipt: review(bHash), expected }).status);

// => the manifest check is live, but it only detects edits made AFTER hashing.
//    A forger who recomputes the manifest (one function call) is not detected.

// C: does the per-state raw check report survive into the receipt at all?
const assembled = assembleFrontendRenderReceipt({
  candidate: { candidateId: "direction-b", repositoryCommit: expected.repositoryCommit, productContractHash: "c".repeat(64), directionSetHash: expected.directionSetHash },
  verifier: a.verifier,
  states: REQUIRED_RENDER_STATE_IDS.map((stateId) => ({ stateId, route: "/" + stateId, viewport: { width: 1440, height: 900 }, screenshotBytes: Buffer.from("shot-" + stateId), accessibilitySerious: 0 })),
});
console.log("C assembled per-state keys   :", JSON.stringify(Object.keys(assembled.coverage.renderedStates[0])));
console.log("C any per-state raw counts?  :", "_report" in assembled.coverage.renderedStates[0]);

// D: forge a receipt where a state DID have a serious a11y issue, but the summary says zero.
//    Nothing per-state contradicts it because no per-state counts are carried.
const d = build(states());
d.checks.accessibility = { status: "pass", seriousOrCriticalCount: 0, incompleteCount: 0 };
console.log("D summary-only a11y claim    :", evaluateFrontendRenderContract({ renderReceipt: d, reviewReceipt: review(d.candidate.stateManifestHash), expected }).status);
