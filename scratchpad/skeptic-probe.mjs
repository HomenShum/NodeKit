import { REQUIRED_RENDER_STATE_IDS, stateManifestHashOf, evaluateFrontendRenderContract } from "../src/lib/frontend-render-contract.mjs";

// Every hash below is a literal fabricated hex string. No bytes exist anywhere.
const fake = (n) => "f".repeat(63) + n.toString(16); // single hex digit, always 64 chars

const renderedStates = REQUIRED_RENDER_STATE_IDS.map((stateId, i) => ({
  stateId,
  route: "/salon",
  viewport: { width: 1440, height: 900 },
  screenshotSha256: fake(i),
  checkReportSha256: fake(i + 6),
}));

// Assert every fabricated hash still satisfies the schema's sha256 pattern.
const pat = /^[a-f0-9]{64}$/;
const allMatch = renderedStates.every((s) => pat.test(s.screenshotSha256) && pat.test(s.checkReportSha256));
console.log("all fabricated hashes match ^[a-f0-9]{64}$ :", allMatch);
console.log("sample screenshotSha256:", renderedStates[0].screenshotSha256);

const expected = {
  candidateId: "direction-b",
  repositoryCommit: "a".repeat(40),
  directionSetHash: "b".repeat(64),
};

const renderReceipt = {
  schemaVersion: "nodekit.frontend-render-receipt/v1",
  candidate: {
    candidateId: expected.candidateId,
    repositoryCommit: expected.repositoryCommit,
    productContractHash: "c".repeat(64),
    directionSetHash: expected.directionSetHash,
    stateManifestHash: stateManifestHashOf(renderedStates), // self-consistent by construction
  },
  verifier: {
    verifierId: "verifier-that-never-ran",
    verifierCommit: "d".repeat(40),
    command: "echo did-not-run",
    browserName: "chromium",
    browserVersion: "0.0.0",
    startedAt: "2026-07-26T00:00:00.000Z",
    completedAt: "2026-07-26T00:00:01.000Z",
  },
  coverage: { requiredStateIds: [...REQUIRED_RENDER_STATE_IDS], renderedStates },
  checks: {
    browser: { status: "pass", pageErrors: 0, failedRequiredRequests: 0, missingRequiredStates: [] },
    accessibility: { status: "pass", seriousOrCriticalCount: 0, incompleteCount: 0 },
    overflow: { status: "pass", maxHorizontalOverflowPx: 0 },
    stateCommunication: { status: "pass", silentStates: [] },
  },
};

const reviewReceipt = {
  schemaVersion: "nodekit.frontend-review-receipt/v1",
  candidateId: expected.candidateId,
  reviewerId: "reviewer-x",
  generatingModelId: "generator-y",
  reviewedStateManifestHash: renderReceipt.candidate.stateManifestHash,
  verdict: "pass",
  unresolvedMajorFindings: [],
  reviewedAt: "2026-07-26T00:00:02.000Z",
};

const verdict = evaluateFrontendRenderContract({ renderReceipt, reviewReceipt, expected });
console.log("VERDICT:", JSON.stringify(verdict));

// Now validate the same receipt against the real schema validator the specialist uses.
const { validateSchema } = await import("../src/lib/schema-validation.mjs");
const rf = await validateSchema("nodekit.frontend-render-receipt.v1.schema.json", renderReceipt, "render receipt");
const vf = await validateSchema("nodekit.frontend-review-receipt.v1.schema.json", reviewReceipt, "review receipt");
console.log("render receipt schema findings:", JSON.stringify(rf));
console.log("review receipt schema findings:", JSON.stringify(vf));

// Prove the schema rejects any attempt to name the bytes.
const withPath = structuredClone(renderReceipt);
withPath.coverage.renderedStates[0].screenshotPath = "proof/x.png";
const pf = await validateSchema("nodekit.frontend-render-receipt.v1.schema.json", withPath, "render receipt with path");
console.log("adding screenshotPath ->", JSON.stringify(pf));
