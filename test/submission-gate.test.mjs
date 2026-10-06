import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, open, cp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  evidenceContractPasses,
  evaluateSubmissionManifest,
  parseGitStatusZ,
  portableEvidencePath,
  readSubmissionEvidenceFile,
  requiredSubmissionGates,
  resolveSubmissionEvidenceClosure,
  submissionEvidenceRootSha256,
  transitiveSubmissionEvidence,
  validateSubmissionScreenshotPng,
} from "../src/lib/submission-gate.mjs";
import { computeNodeKitSourceHash } from "../src/lib/source-hash.mjs";
import { knowledgeRuntimeHash } from "../src/lib/knowledge-runtime.mjs";
import { exactSubmissionVerdicts, submissionEvidenceFixtureBytes, submissionEvidenceFixtureClosure, submissionFixtureTrustedKeys } from "./submission-fixtures.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
let testPngCrcTable;
function testPngCrc32(bytes) {
  testPngCrcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = testPngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function testPngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(testPngCrc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return chunk;
}
const canonicalGatePaths = {
  developerTimingMatrix: "proof/ease/developer-timing-verdict.json",
  freshAgentHeldout: "proof/ease/fresh-agent-verdict.json",
  freshHumanUsability: "proof/ease/fresh-users-verdict.json",
  threeConvexConsumers: "proof/convex-consumers-verdict.json",
  previewDeployment: "proof/preview-verdict.json",
  managedSupabasePortability: "proof/managed-supabase-portability-verdict.json",
  knowledgeEvolutionAdoption: "proof/knowledge-evolution-adoption-verdict.json",
  modelIntelligenceHarness: "proof/model-intelligence-harness-verdict.json",
  engineeringHealth: "proof/engineering-health-verdict.json",
  proofloopEaseVerification: "proof/proofloop-final.json",
  packageInstallProof: "proof/package-install-verdict.json",
  publicationApproval: "proof/publication-approval.json",
};

async function writeGateEvidence(root, id, value, relative = canonicalGatePaths[id], { includeBrowserClosure = true } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), bytes);
  const evidence = [{ path: relative, sha256: digest(bytes) }];
  const deferredBrowserClosure = [];
  const deferredProtectedManifests = [];
  for (const reference of transitiveSubmissionEvidence(id, value)) {
    const candidateCommit = value.nodekitCommit ?? value.candidateCommit ?? value.subject?.repository?.candidateCommit;
    const sourceHash = value.nodekitSourceHash ?? value.subject?.repository?.nodekitSourceHash;
    const isDecisiveCrossReference = Object.values(canonicalGatePaths).includes(reference.path);
    const nestedBytes = isDecisiveCrossReference ? null : submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    if (nestedBytes) {
      await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
      await writeFile(path.join(root, reference.path), nestedBytes);
    }
    evidence.push({ path: reference.path, sha256: reference.sha256 });
    // Candidate-authored browser bytes are diagnostic only for freshAgentHeldout:
    // the decisive UI closure hangs off the protected evaluator instead, so
    // declaring these children would surface as undeclared extra evidence.
    if (includeBrowserClosure && reference.kind === "screenshot-manifest" && id !== "freshAgentHeldout") {
      for (const child of submissionEvidenceFixtureClosure(reference.path, candidateCommit, sourceHash)) {
        const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), childBytes);
        deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
      }
    }
    // The protected browser manifest is synthesized by the closure walker from
    // the protected evaluation rather than named by the verdict, so it has to be
    // materialized here even though nothing in the verdict points at it.
    if (includeBrowserClosure && id === "freshAgentHeldout" && reference.kind === "protected-evaluation") {
      const evaluation = JSON.parse(submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash).toString("utf8"));
      deferredProtectedManifests.push(path.posix.join(path.posix.dirname(reference.path), evaluation.protectedBrowserManifestFile));
    }
    if (reference.kind === "protected-comparison") {
      for (const child of submissionEvidenceFixtureClosure(reference.path, candidateCommit, sourceHash)) {
        const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
        await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
        await writeFile(path.join(root, child.path), childBytes);
        deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
      }
    }
  }
  // The walker only discovers these while draining the direct references, so
  // they land after all of them and ahead of their own screenshot children.
  for (const protectedManifestPath of deferredProtectedManifests) {
    const candidateCommit = value.nodekitCommit ?? value.candidateCommit ?? value.subject?.repository?.candidateCommit;
    const sourceHash = value.nodekitSourceHash ?? value.subject?.repository?.nodekitSourceHash;
    const protectedManifestBytes = submissionEvidenceFixtureBytes(protectedManifestPath, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, protectedManifestPath)), { recursive: true });
    await writeFile(path.join(root, protectedManifestPath), protectedManifestBytes);
    evidence.push({ path: protectedManifestPath, sha256: digest(protectedManifestBytes) });
    for (const child of submissionEvidenceFixtureClosure(protectedManifestPath, candidateCommit, sourceHash)) {
      const childBytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
      await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
      await writeFile(path.join(root, child.path), childBytes);
      deferredBrowserClosure.push({ path: child.path, sha256: digest(childBytes) });
    }
  }
  evidence.push(...deferredBrowserClosure);
  return evidence;
}

function submissionManifest(candidateCommit, candidateSourceHash, gates, releaseCandidate = null) {
  const manifest = {
    schemaVersion: "nodekit.submission-manifest/v1",
    candidateCommit,
    candidateSourceHash,
    releaseCandidate: releaseCandidate ?? {
      nodekitCommit: candidateCommit,
      nodekitSourceHash: candidateSourceHash,
      nodekitTarballSha256: "0".repeat(64),
      packageName: "@homenshum/nodekit",
      packageVersion: "0.0.0-unverified",
    },
    gates,
  };
  return { ...manifest, evidenceRootSha256: submissionEvidenceRootSha256(gates) };
}

// @nodekit-verifies inv:exact-candidate-evidence#candidate-identity-bound
test("decisive evidence contracts reject shallow counts and unproven live adoption", () => {
  const candidateCommit = "a".repeat(40);
  const verdicts = exactSubmissionVerdicts(candidateCommit);
  for (const id of requiredSubmissionGates) assert.equal(evidenceContractPasses(id, verdicts[id]), true, id);
  for (const id of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    const unsigned = structuredClone(exactSubmissionVerdicts(candidateCommit)[id]);
    delete unsigned.attestationPayload;
    delete unsigned.attestation;
    assert.equal(evidenceContractPasses(id, unsigned), false, `${id} accepted candidate-authored evidence without external trust`);
  }
  assert.equal(evidenceContractPasses("developerTimingMatrix", { schemaVersion: "nodekit.developer-timing-verdict/v1", passed: true, observedRuns: 60 }), false);
  assert.equal(evidenceContractPasses("freshHumanUsability", { schemaVersion: "nodekit.fresh-user-verdict/v1", passed: true, metrics: { participantCount: 5 } }), false);
  const aggregateOnlyTiming = structuredClone(verdicts.developerTimingMatrix);
  delete aggregateOnlyTiming.selectedRuns;
  assert.equal(evidenceContractPasses("developerTimingMatrix", aggregateOnlyTiming), false);
  const unboundHumanEvidence = structuredClone(verdicts.freshHumanUsability);
  unboundHumanEvidence.selectedParticipants[0].evidenceRefs = [];
  assert.equal(evidenceContractPasses("freshHumanUsability", unboundHumanEvidence), false);
  assert.equal(evidenceContractPasses("threeConvexConsumers", { schemaVersion: "nodekit.convex-consumers-verdict/v1", candidateCommit, passed: true, qualifyingConsumers: 3 }), false);
  verdicts.freshAgentHeldout.selectedRuns.pop();
  verdicts.freshAgentHeldout.observedTrials = 14;
  assert.equal(evidenceContractPasses("freshAgentHeldout", verdicts.freshAgentHeldout), false);
  verdicts.freshAgentHeldout = exactSubmissionVerdicts(candidateCommit).freshAgentHeldout;
  verdicts.freshAgentHeldout.selectedRuns.find((entry) => entry.agentProfile === "lower-cost").agentModel = null;
  assert.equal(evidenceContractPasses("freshAgentHeldout", verdicts.freshAgentHeldout), false);
  verdicts.threeConvexConsumers.consumers[0].liveFlowAdoption.passed = false;
  assert.equal(evidenceContractPasses("threeConvexConsumers", verdicts.threeConvexConsumers), false);
  const packageProof = exactSubmissionVerdicts(candidateCommit).packageInstallProof;
  packageProof.checks.candidateIdentityStable = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.checks.candidateIdentityStable = true;
  packageProof.checks.unreportedCheck = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  delete packageProof.checks.unreportedCheck;
  packageProof.distributionChecks.convexComponentRuntime = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.distributionChecks.convexComponentRuntime = true;
  packageProof.distributionChecks.builderGym = false;
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  packageProof.distributionChecks.builderGym = true;
  packageProof.supportingEvidence.pop();
  assert.equal(evidenceContractPasses("packageInstallProof", packageProof), false);
  const timing = exactSubmissionVerdicts(candidateCommit).developerTimingMatrix;
  timing.supportingEvidence = [];
  assert.equal(evidenceContractPasses("developerTimingMatrix", timing), false);
  const preview = exactSubmissionVerdicts(candidateCommit).previewDeployment;
  preview.screenshotCount = 12;
  assert.equal(evidenceContractPasses("previewDeployment", preview), false);
  const supabase = exactSubmissionVerdicts(candidateCommit).managedSupabasePortability;
  supabase.exportImport.targetReceiptSha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("managedSupabasePortability", supabase), false, "managed portability must preserve exact receipt identity");
  const selfHostedLookalike = exactSubmissionVerdicts(candidateCommit).managedSupabasePortability;
  selfHostedLookalike.projectUrl = "https://supabase.example.test";
  assert.equal(evidenceContractPasses("managedSupabasePortability", selfHostedLookalike), false, "the managed-service gate cannot be satisfied by an arbitrary HTTPS endpoint");
  const evolution = exactSubmissionVerdicts(candidateCommit).knowledgeEvolutionAdoption;
  evolution.comparison.evolvingGraphScore = 0.6;
  assert.equal(evidenceContractPasses("knowledgeEvolutionAdoption", evolution), false, "evolving knowledge must not underperform either protected baseline");
  const model = exactSubmissionVerdicts(candidateCommit).modelIntelligenceHarness;
  model.promotionStatus = "promoted";
  assert.equal(evidenceContractPasses("modelIntelligenceHarness", model), false, "an observation cannot self-promote a model");
  const engineering = exactSubmissionVerdicts(candidateCommit).engineeringHealth;
  engineering.unresolved.p1 = 1;
  assert.equal(evidenceContractPasses("engineeringHealth", engineering), false, "engineering health requires zero unresolved P0/P1 issues");
  for (const [id, field] of [
    ["managedSupabasePortability", "testedAt"],
    ["knowledgeEvolutionAdoption", "completedAt"],
    ["modelIntelligenceHarness", "observedAt"],
    ["engineeringHealth", "completedAt"],
  ]) {
    const invalidTimestamp = exactSubmissionVerdicts(candidateCommit)[id];
    invalidTimestamp[field] = "2026-02-30T00:00:00.000Z";
    assert.equal(evidenceContractPasses(id, invalidTimestamp), false, `${id} accepted a non-existent calendar timestamp`);
  }
  const alteredHumanOutcome = exactSubmissionVerdicts(candidateCommit).freshHumanUsability;
  alteredHumanOutcome.selectedParticipants[0].wrongTurns = 1;
  assert.equal(evidenceContractPasses("freshHumanUsability", alteredHumanOutcome), false, "signed verdict body cannot be rewritten");
  const alteredConsumerEvidence = exactSubmissionVerdicts(candidateCommit).threeConvexConsumers;
  alteredConsumerEvidence.consumers[0].evidence[1].sha256 = "f".repeat(64);
  alteredConsumerEvidence.consumers[0].verdictSha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("threeConvexConsumers", alteredConsumerEvidence), false, "signed evidence root cannot be rewritten");
  const proofLoop = exactSubmissionVerdicts(candidateCommit).proofloopEaseVerification;
  proofLoop.extensions.decisiveEvidence[0].sha256 = "f".repeat(64);
  assert.equal(evidenceContractPasses("proofloopEaseVerification", proofLoop), false, "ProofLoop signature must bind the ordered decisive evidence set");
  const malformedProofLoop = exactSubmissionVerdicts(candidateCommit).proofloopEaseVerification;
  malformedProofLoop.extensions.decisiveEvidence[0].candidateAuthoredKey = true;
  assert.equal(evidenceContractPasses("proofloopEaseVerification", malformedProofLoop), false, "malformed ProofLoop evidence must fail closed without throwing");
});

// @nodekit-verifies inv:source-bound-decisive-verdicts#evidence-source-bound
test("evidence paths are canonical and browser certification closes over every byte", async () => {
  for (const alias of ["./proof/x", "proof/./x", "proof//x", "proof/x/", "proof/../x", "C:/proof/x", "proof\\x"]) {
    assert.equal(portableEvidencePath(alias), false, alias);
  }
  assert.equal(portableEvidencePath("proof/browser/screenshot-manifest.json"), true);

  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-browser-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const manifestPath = "proof/preview/browser/screenshot-manifest.json";
  const manifestBytes = submissionEvidenceFixtureBytes(manifestPath, candidateCommit, sourceHash);
  await mkdir(path.dirname(path.join(root, manifestPath)), { recursive: true });
  await writeFile(path.join(root, manifestPath), manifestBytes);
  const children = submissionEvidenceFixtureClosure(manifestPath, candidateCommit, sourceHash);
  await Promise.all(children.map(async (child) => {
    const bytes = submissionEvidenceFixtureBytes(child.path, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, child.path)), { recursive: true });
    await writeFile(path.join(root, child.path), bytes);
  }));
  const browserManifest = JSON.parse(manifestBytes.toString("utf8"));
  const value = {
    applicationHash: browserManifest.applicationHash,
    configHash: browserManifest.configHash,
    deploymentCommit: browserManifest.generatedCandidateCommit,
    evidence: [{ kind: "screenshot-manifest", path: manifestPath, sha256: digest(manifestBytes) }],
    nodekitCommit: candidateCommit,
    nodekitIdentity: `${candidateCommit}/${sourceHash}`,
    nodekitSourceHash: sourceHash,
    releaseCandidate: {
      nodekitCommit: candidateCommit,
      nodekitSourceHash: sourceHash,
      nodekitTarballSha256: browserManifest.nodekitTarballSha256,
      packageName: "@homenshum/nodekit",
      packageVersion: "0.2.1",
    },
  };
  const closure = await resolveSubmissionEvidenceClosure(root, "previewDeployment", value);
  assert.equal(closure.length, 1 + 180 * 2 + 5);
  const tampered = children.find((entry) => entry.path.endsWith("first_arrival--desktop--light.png"));
  await writeFile(path.join(root, tampered.path), "tampered\n");
  await assert.rejects(() => resolveSubmissionEvidenceClosure(root, "previewDeployment", value), /hash mismatch/);
});

test("engineering health recomputes command identity and unresolved P0/P1 from machine evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-engineering-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).engineeringHealth;
  for (const reference of transitiveSubmissionEvidence("engineeringHealth", verdict)) {
    const bytes = submissionEvidenceFixtureBytes(reference.path, candidateCommit, sourceHash);
    await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
    await writeFile(path.join(root, reference.path), bytes);
  }
  assert.equal((await resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict)).length, 11);

  const command = verdict.commands[0];
  const validCommandBytes = submissionEvidenceFixtureBytes(command.path, candidateCommit, sourceHash);
  const invalidCommandReceipt = JSON.parse(validCommandBytes.toString("utf8"));
  invalidCommandReceipt.startedAt = "2026-02-30T00:00:00.000Z";
  const invalidCommandBytes = Buffer.from(`${JSON.stringify(invalidCommandReceipt)}\n`);
  await writeFile(path.join(root, command.path), invalidCommandBytes);
  command.sha256 = digest(invalidCommandBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /engineering check receipt does not match/,
  );
  await writeFile(path.join(root, command.path), validCommandBytes);
  command.sha256 = digest(validCommandBytes);

  const invalidTimestampInventory = {
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    generatedAt: "2026-02-30T00:00:00.000Z",
    counts: { p0: 0, p1: 0 },
    issues: [],
  };
  const invalidTimestampInventoryBytes = Buffer.from(`${JSON.stringify(invalidTimestampInventory)}\n`);
  await writeFile(path.join(root, verdict.issueInventory.path), invalidTimestampInventoryBytes);
  verdict.issueInventory.sha256 = digest(invalidTimestampInventoryBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /does not prove zero unresolved/,
  );

  const inventory = {
    schemaVersion: "nodekit.engineering-issue-inventory/v1",
    candidateCommit,
    nodekitSourceHash: sourceHash,
    generatedAt: "2026-07-22T00:00:01.000Z",
    counts: { p0: 0, p1: 1 },
    issues: [{ id: "P1-OPEN", severity: "p1", status: "open", source: "independent issue inventory" }],
  };
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory)}\n`);
  await writeFile(path.join(root, verdict.issueInventory.path), inventoryBytes);
  verdict.issueInventory.sha256 = digest(inventoryBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "engineeringHealth", verdict),
    /does not prove zero unresolved P0\/P1 issues/,
  );
});

test("knowledge adoption closure recomputes protected cases, aggregates, and execution bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-closure-"));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).knowledgeEvolutionAdoption;
  await writeGateEvidence(root, "knowledgeEvolutionAdoption", verdict);
  const complete = await resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict);
  assert.equal(complete.length, 18);

  const comparisonPath = path.join(root, "proof/evolution/protected-comparison.json");
  const comparison = JSON.parse(await readFile(comparisonPath, "utf8"));
  comparison.profiles.flat.successRate = 0.5;
  const { resultSha256: ignoredResultSha256, ...comparisonBody } = comparison;
  comparison.resultSha256 = knowledgeRuntimeHash(comparisonBody);
  const alteredBytes = Buffer.from(`${JSON.stringify(comparison)}\n`);
  await writeFile(comparisonPath, alteredBytes);
  verdict.evidence.find((entry) => entry.kind === "protected-comparison").sha256 = digest(alteredBytes);
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict),
    /not reproducible from its exact graph, definition, and execution receipts|aggregate does not match its cases/,
  );

  const originalBytes = submissionEvidenceFixtureBytes("proof/evolution/protected-comparison.json", candidateCommit, sourceHash);
  await writeFile(comparisonPath, originalBytes);
  verdict.evidence.find((entry) => entry.kind === "protected-comparison").sha256 = digest(originalBytes);
  const executionPath = path.join(root, "proof/evolution/executions/flat-direct-fact.json");
  await writeFile(executionPath, "tampered execution\n");
  await assert.rejects(
    () => resolveSubmissionEvidenceClosure(root, "knowledgeEvolutionAdoption", verdict),
    /execution receipt evidence hash mismatch|evidence closure hash mismatch/,
  );
});

// A maintainer must be able to hand the complete native-shaped report to the
// existing consumer. These synthetic records certify shape/admission, not SQL.
test("a maintainer hands current and legacy PostgreSQL reports through strict repeated admission", async (t) => {
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-postgres-report-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidateCommit = "a".repeat(40);
  const sourceHash = "b".repeat(64);
  const schemaName = "nodekit.postgres-conformance.v2.schema.json";
  const reportPath = "proof/postgres-conformance.json";
  const verdict = exactSubmissionVerdicts(candidateCommit, sourceHash).managedSupabasePortability;
  await writeGateEvidence(root, "managedSupabasePortability", verdict);
  const report = JSON.parse(submissionEvidenceFixtureBytes(reportPath, candidateCommit, sourceHash).toString("utf8"));
  const reference = verdict.evidence.find((entry) => entry.kind === "postgres-conformance");
  assert.ok(reference);
  const schemaErrors = (value) => validateSchema(schemaName, value, reportPath);
  const closure = () => resolveSubmissionEvidenceClosure(root, "managedSupabasePortability", verdict);
  async function store(value) {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(path.join(root, reportPath), bytes);
    reference.sha256 = digest(bytes);
    verdict.postgresConformance.sha256 = reference.sha256;
    // This low-level closure scenario does not grant or replace the unchanged
    // protected attestation. The full signed-fixture gate below still tests it.
  }
  assert.deepEqual(await schemaErrors(report), []);
  const expectedClosure = await closure();
  assert.equal(expectedClosure.length, 8);
  assert.ok(expectedClosure.some((entry) => entry.path === reportPath && entry.sha256 === reference.sha256));
  assert.equal(Object.keys(report.assertions).length, 25);
  assert.equal(Object.keys(report.conformance.assertions).length, 39);
  assert.equal(report.guardedCompletion.schedules.length, 7);
  assert.equal(report.exceptionOwnership.rollbacks.length, 2);
  assert.equal(report.exceptionOwnership.refusals.length, 7);
  assert.deepEqual(report.exceptionOwnership, report.guardedCompletion.exceptionOwnership);
  assert.equal(report.lifecycleFailureScenarios.cleanupAfterPass.passed, false);
  assert.equal(report.lifecycleFailureScenarios.cleanupAfterPass.exitCode, 1);
  assert.equal(report.lifecycleFailureScenarios.primaryAndCleanup.primaryError.code, "PROOF_PRIMARY");
  assert.equal(report.lifecycleFailureScenarios.primaryAndCleanup.cleanup[0].error.code, "PROOF_CLEANUP");
  assert.deepEqual(report.cleanup.map((entry) => entry.name), [
    "settle-scenario-clients", "exact-owned-fixtures", "pool-and-clients", "exact-disposable-installation",
  ]);
  assert.equal(report.postgres.serverVersion, "16.15 (Debian 16.15-1.pgdg13+2)");

  const legacy = structuredClone(report);
  for (const key of ["guardedCompletion", "knowledgeFirstCreateRace", "lifecycleFailureScenarios", "namedProof", "limits", "finalizedAt",
    "primaryError", "failedAssertions", "cleanup", "poolErrorCount", "poolErrors", "exceptionOwnership"]) delete legacy[key];
  delete legacy.conformance.actorMode;
  const oldTop = ["artifactCompletionRaceAtomic", "crossOwnerDenied", "ownerIsolation", "receiptIntegrity", "reloadPreservedState",
    "sameBaseRaceFailedClosed", "sharedConformancePassed", "knowledgeFirstCreateRaceAtomic", "knowledgeOwnerIsolation",
    "knowledgePackageExportsResolved", "knowledgeProjectionApplied", "knowledgeProjectionReloaded", "knowledgeRetrievalReceiptDurable"];
  const oldShared = ["activeRunStartIsIdempotent", "canonicalVersionAdvancedOnce", "contentAddressedReceipt", "exceptionStatePreserved",
    "nextActionOwnerExplicit", "oneAuthoritativeCase", "repeatedCompletionIsIdempotent", "repeatedDecisionIsIdempotent", "staleProposalFailedClosed"];
  legacy.assertions = Object.fromEntries(oldTop.map((name) => [name, legacy.assertions[name]]));
  legacy.conformance.assertions = Object.fromEntries(oldShared.map((name) => [name, legacy.conformance.assertions[name]]));
  legacy.postgres = { serverVersion: "17.10", serverVersionNum: 170010 };
  verdict.postgresConformance.serverVersionNum = 170010;
  await store(legacy);
  assert.deepEqual(await schemaErrors(legacy), []);
  assert.equal((await closure()).length, 8);
  verdict.postgresConformance.serverVersionNum = report.postgres.serverVersionNum;
  await store(report);
  assert.deepEqual(await closure(), expectedClosure);

  async function rejectShape(label, mutate, pattern) {
    const changed = structuredClone(report);
    mutate(changed);
    await store(changed);
    const errors = await schemaErrors(changed);
    assert.ok(errors.length > 0, `${label}: schema admitted a changed claim`);
    assert.match(errors.join("\n"), pattern, label);
    await assert.rejects(closure, pattern, `${label}: actual consumer admitted the changed record`);
  }
  for (const [label, select] of [
    ["root", (value) => value],
    ["conformance", (value) => value.conformance],
    ["top assertions", (value) => value.assertions],
    ["shared assertions", (value) => value.conformance.assertions],
    ["guarded observation", (value) => value.guardedCompletion],
    ["guard assertions", (value) => value.guardedCompletion.assertions],
    ["schedule", (value) => value.guardedCompletion.schedules[0]],
    ["cleanup detail", (value) => value.cleanup[0].detail],
    ["root ownership", (value) => value.exceptionOwnership],
    ["nested ownership", (value) => value.guardedCompletion.exceptionOwnership],
  ]) await rejectShape(`unknown ${label}`, (value) => { select(value).unknownClaim = true; }, /must NOT have additional properties/);
  // Every recorded success predicate must remain honest, including new names.
  for (const name of Object.keys(report.assertions)) {
    await rejectShape(`false top assertion ${name}`, (value) => { value.assertions[name] = false; }, /must be equal to constant/);
  }
  for (const name of Object.keys(report.conformance.assertions)) {
    await rejectShape(`false shared assertion ${name}`, (value) => { value.conformance.assertions[name] = false; }, /must be equal to constant/);
  }
  for (const [label, mutate, pattern] of [
    ["failed actual cleanup", (value) => { value.cleanup[0].passed = false; }, /must be equal to constant/],
    ["missing cleanup kind", (value) => { value.cleanup = Array.from({ length: 4 }, () => structuredClone(value.cleanup[0])); }, /must contain at least 1 and no more than 1 valid item/],
    ["remaining owned rows", (value) => { value.cleanup[1].detail.counts.artifacts = 1; }, /must be equal to constant/],
    ["late primary failure", (value) => { value.primaryError = { name: "Error", code: "PROOF_PRIMARY", message: "primary failure" }; }, /must be null/],
    ["pool failure", (value) => { value.poolErrorCount = 1; }, /must be equal to constant/],
    ["malformed rollback hash", (value) => { value.guardedCompletion.rollbackObservation.before.hash = "not-a-hash"; }, /must match pattern/],
    ["unsupported actor mode", (value) => { value.conformance.actorMode = "trusted-anyone"; }, /must be equal to one of the allowed values/],
    ["schedule overflow", (value) => { value.guardedCompletion.schedules.push(structuredClone(value.guardedCompletion.schedules[0])); }, /must NOT have more than 7 items/],
    ["missing rollback receipt", (value) => { delete value.guardedCompletion.rollbackObservation.rollbackCommand; }, /must have required property 'rollbackCommand'/],
    ["changed bound", (value) => { value.limits.clients = 9; }, /must be equal to constant/],
    ["long vendor version", (value) => { value.postgres.serverVersion = `16.15 ${"A".repeat(128)}`; }, /must NOT have more than 128 characters/],
    ["invalid finalization time", (value) => { value.finalizedAt = "not-a-time"; }, /must match pattern/],
    ["erased child failure", (value) => { value.lifecycleFailureScenarios.cleanupAfterPass.passed = true; }, /must be equal to constant/],
    ["missing child cleanup error", (value) => { delete value.lifecycleFailureScenarios.primaryAndCleanup.cleanup[0].error; }, /must have required property 'error'/],
    ["lost original primary error", (value) => { value.lifecycleFailureScenarios.primaryAndCleanup.primaryError = null; }, /must be object/],
    ["overlong refusal error", (value) => { value.exceptionOwnership.refusals[0].error.message = "A".repeat(1025); }, /must NOT have more than 1024 characters/],
    ["failed report", (value) => { value.passed = false; value.errors.push({ name: "Error", code: "PROOF_FAILURE", message: "observed failure" }); }, /must be equal to constant/],
    ["checkout runtime import", (value) => { value.packageInstallation.sourceCheckoutImported = true; }, /must be equal to constant/],
  ]) await rejectShape(label, mutate, pattern);

  const identityFailure = /live PostgreSQL conformance does not match the exact managed-portability release candidate/;
  for (const [label, mutate] of [
    ["candidate commit", (value) => { value.candidateCommit = "c".repeat(40); }],
    ["NodeKit commit", (value) => { value.nodekitCommit = "c".repeat(40); }],
    ["source hash", (value) => { value.nodekitSourceHash = "c".repeat(64); }],
    ["combined identity", (value) => { value.nodekitIdentity = `${"c".repeat(40)}/${sourceHash}`; }],
    ["tarball", (value) => { value.releaseCandidate.nodekitTarballSha256 = "c".repeat(64); }],
    ["package version", (value) => { value.releaseCandidate.packageVersion = "0.2.2"; }],
    ["server version identity", (value) => { value.postgres.serverVersionNum += 1; }],
    ["future test time", (value) => { value.testedAt = "2099-07-22T00:00:00.000Z"; }],
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    await store(changed);
    assert.deepEqual(await schemaErrors(changed), [], `${label}: intended identity failure stopped at shape`);
    await assert.rejects(closure, identityFailure, label);
  }
  await store(report);
  const burst = await Promise.all(Array.from({ length: 8 }, () => closure()));
  for (const result of burst) assert.deepEqual(result, expectedClosure);
  for (let index = 0; index < 16; index += 1) {
    const restored = index % 2 === 0 ? structuredClone(report) : structuredClone(legacy);
    verdict.postgresConformance.serverVersionNum = restored.postgres.serverVersionNum;
    await store(restored);
    assert.deepEqual(await schemaErrors(restored), []);
    assert.equal((await closure()).length, 8);
    const unknown = structuredClone(restored);
    unknown.unknownClaim = index;
    await store(unknown);
    await assert.rejects(closure, /must NOT have additional properties/, `successive admission ${index}`);
    await store(restored);
    assert.equal((await closure()).length, 8);
    const falseClaim = structuredClone(restored);
    falseClaim.assertions.sharedConformancePassed = false;
    await store(falseClaim);
    await assert.rejects(closure, /must be equal to constant/, `successive false claim ${index}`);
    await store(restored);
    assert.equal((await closure()).length, 8);
  }
  verdict.postgresConformance.serverVersionNum = report.postgres.serverVersionNum;
  await store(report);
  assert.deepEqual(await closure(), expectedClosure);
});

test("submission gate requires all evidence, hashes, and explicit approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  const freshAgentSources = [
    "evals/ease/heldout-tasks.json",
    "scripts/run-agent-ease-trial.mjs",
    "scripts/run-protected-browser-lane.mjs",
    "scripts/run-agent-provider-broker.mjs",
    "scripts/run-protected-agent-evaluator.mjs",
  ];
  for (const relative of freshAgentSources) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), submissionEvidenceFixtureBytes(relative));
  }
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json", ...freshAgentSources], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) {
    gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id]) });
  }
  const manifest = submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate);
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const ready = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(ready.submissionReady, true, ready.errors.join("\n"));
  const noTrustStore = await evaluateSubmissionManifest(root, "proof/submission-manifest.json");
  assert.equal(noTrustStore.submissionReady, false);
  for (const id of [
    "developerTimingMatrix", "freshAgentHeldout", "freshHumanUsability", "threeConvexConsumers", "previewDeployment",
    "managedSupabasePortability", "knowledgeEvolutionAdoption", "modelIntelligenceHarness",
  ]) {
    assert.match(noTrustStore.errors.join("\n"), new RegExp(`${id}: trusted detached attestation failed`));
  }
  const candidatePath = path.join(root, "proof", "submission-candidate.json");
  const candidateBytes = await readFile(candidatePath);
  await writeFile(candidatePath, `${candidateBytes.toString("utf8").trim()} \n`);
  const candidateTampered = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(candidateTampered.submissionReady, false);
  assert.match(candidateTampered.errors.join("\n"), /submission-candidate\.json|signed submission candidate/);
  await writeFile(candidatePath, candidateBytes);
  manifest.gates.at(-1).passed = false;
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const blocked = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(blocked.submissionReady, false);
  assert.match(blocked.errors.join("\n"), /publicationApproval: not passed/);
});

test("submission gate rejects stale source revisions and evidence without decisive contracts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-stale-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "changed.mjs"), "export default true;\n");
  execFileSync("git", ["add", "src/changed.mjs"], { cwd: root });
  execFileSync("git", ["commit", "-m", "source changed"], { cwd: root, stdio: "ignore" });
  const evidence = Buffer.from(`${JSON.stringify({ schemaVersion: "nodekit.developer-timing-verdict/v1", nodekitCommit: candidateCommit, passed: true, observedRuns: 60 })}\n`);
  await writeFile(path.join(root, "proof", "shared.json"), evidence);
  const manifest = submissionManifest(candidateCommit, candidateSourceHash,
    requiredSubmissionGates.map((id) => ({ id, passed: true, evidence: [{ path: "proof/shared.json", sha256: digest(evidence) }] })));
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(manifest));
  const verdict = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /candidateCommit is stale/);
  assert.match(verdict.errors.join("\n"), /requires exactly one exact-candidate decisive verdict/);
});

test("submission gate rejects uncommitted source and incomplete package proof", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-dirty-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "proof"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "candidate.txt", "schemas", "package.json"], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  verdicts.packageInstallProof.checks = {};
  const gates = [];
  for (const id of requiredSubmissionGates) {
    gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  }
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  await writeFile(path.join(root, "src", "dirty.mjs"), "export default true;\n");
  const verdict = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.equal(verdict.submissionReady, false);
  assert.match(verdict.errors.join("\n"), /working tree contains uncommitted source changes/);
  assert.match(verdict.errors.join("\n"), /packageInstallProof: requires exactly one exact-candidate decisive verdict/);
});

test("submission gate rejects tampered, omitted, and extra transitive evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-transitive-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  const manifestPath = path.join(root, "proof", "submission-manifest.json");
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  const packageGate = gates.find((gate) => gate.id === "packageInstallProof");
  const tamperedPath = verdicts.packageInstallProof.supportingEvidence[0].path;
  await writeFile(path.join(root, tamperedPath), "tampered\n");
  let result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /evidence hash mismatch/);
  await writeFile(path.join(root, tamperedPath), submissionEvidenceFixtureBytes(tamperedPath));
  packageGate.evidence = packageGate.evidence.filter((entry) => entry.path !== tamperedPath);
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /transitive evidence is missing from the submission manifest/);
  packageGate.evidence.push({ path: "proof/extra.txt", sha256: digest("extra\n") });
  await writeFile(path.join(root, "proof", "extra.txt"), "extra\n");
  await writeFile(manifestPath, JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /undeclared extra evidence/);
});

test("submission gate rejects evidence reached through an escaping junction", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-symlink-"));
  await mkdir(path.join(root, "schemas"), { recursive: true });
  await cp(path.resolve("schemas", "nodekit.submission-manifest.v1.schema.json"), path.join(root, "schemas", "nodekit.submission-manifest.v1.schema.json"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nodekit@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await writeFile(path.join(root, "candidate.txt"), "candidate\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ files: ["candidate.txt", "schemas"] })}\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: root, stdio: "ignore" });
  const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidateSourceHash = await computeNodeKitSourceHash(root);
  const verdicts = exactSubmissionVerdicts(candidateCommit, candidateSourceHash);
  const gates = [];
  for (const id of requiredSubmissionGates) gates.push({ id, passed: true, evidence: await writeGateEvidence(root, id, verdicts[id], canonicalGatePaths[id], { includeBrowserClosure: false }) });
  const target = verdicts.previewDeployment.evidence.at(-1);
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-outside-"));
  await writeFile(path.join(outside, "cleanup-receipt.json"), submissionEvidenceFixtureBytes(target.path));
  const parent = path.dirname(path.join(root, target.path));
  await rm(parent, { recursive: true, force: true });
  try {
    await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }
  await writeFile(path.join(root, "proof", "submission-manifest.json"), JSON.stringify(submissionManifest(candidateCommit, candidateSourceHash, gates, verdicts.packageInstallProof.releaseCandidate)));
  const result = await evaluateSubmissionManifest(root, "proof/submission-manifest.json", { trustedAttestationKeys: submissionFixtureTrustedKeys });
  assert.match(result.errors.join("\n"), /symlink escapes repository|evidence unavailable/);
});

test("submission evidence reader rejects a single hard-linked path to outside mutable bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-hardlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "nodekit-submission-hardlink-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const source = path.join(outside, "outside.json");
  const target = path.join(root, "evidence.json");
  await writeFile(source, "{\"forged\":true}\n");
  try {
    await link(source, target);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error?.code)) return t.skip(`hard links unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(() => readSubmissionEvidenceFile(root, "evidence.json"), /regular unaliased|multiple hard links/);
});

test("submission evidence reader rejects oversized sparse files before reading their bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-evidence-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "proof"), { recursive: true });
  const target = path.join(root, "proof", "oversized.bin");
  const handle = await open(target, "w");
  try {
  await handle.truncate((32 * 1024 * 1024) + 1);
  } finally {
    await handle.close();
  }
  await assert.rejects(
    () => readSubmissionEvidenceFile(root, "proof/oversized.bin"),
    /exceeds the 33554432-byte verifier limit/,
  );
});

test("screenshot validation canonicalizes metadata-only PNG changes to one decoded pixel identity", () => {
  const original = submissionEvidenceFixtureBytes("proof/preview/browser/screenshots/first_arrival--desktop--light.png");
  const iend = original.subarray(original.length - 12);
  const changedMetadata = Buffer.concat([
    original.subarray(0, original.length - 12),
    testPngChunk("tEXt", Buffer.from("extra-proof-label\0different-file-bytes", "utf8")),
    iend,
  ]);
  assert.notEqual(digest(original), digest(changedMetadata));
  const expectation = { tuple: "first_arrival/desktop/light", screenshot: { viewport: { width: 1440, height: 900 } } };
  assert.equal(
    validateSubmissionScreenshotPng(original, expectation).pixelSha256,
    validateSubmissionScreenshotPng(changedMetadata, expectation).pixelSha256,
  );
});

test("screenshot validation rejects oversized PNG input before decoding or concatenating chunks", () => {
  const oversized = Buffer.alloc((25 * 1024 * 1024) + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);
  assert.throws(
    () => validateSubmissionScreenshotPng(oversized, { tuple: "oversized/desktop/light", screenshot: { viewport: { width: 1440, height: 900 } } }),
    /exceeds the 26214400-byte verifier limit/,
  );
});

test("null-delimited Git status parsing preserves rename endpoints and embedded newlines", () => {
  const paths = parseGitStatusZ(Buffer.from("R  docs/new\nname.txt\0src/old name.txt\0?? src/untracked\nfile.mjs\0"));
  assert.deepEqual(paths, ["docs/new\nname.txt", "src/old name.txt", "src/untracked\nfile.mjs"]);
});
