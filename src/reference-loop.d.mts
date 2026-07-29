export type ReferenceOrigin = "nodekit-owned" | "workspace-private" | "public-web" | "mobbin";
export type ReferenceAccessMode = "owned" | "local" | "public" | "remote-mcp";
export type ReferenceFactKind =
  | "count"
  | "measurement"
  | "relationship"
  | "timing"
  | "easing"
  | "choreography"
  | "state-transition";
export type ReferenceResult = "satisfied" | "violated" | "not-observed" | "not-applicable";
export type ReferenceVerdict = "pass" | "fail" | "incomplete";

export interface ReferenceAtomicFactV1 {
  factId: string;
  kind: ReferenceFactKind;
  subject: string;
  relation: string;
  object: string | number;
  unit: string;
  locatorDescription: string;
}

export interface ReferenceObservationV1 {
  schemaVersion: "nodekit.reference-loop-observation/v1";
  observationId: string;
  source: {
    origin: ReferenceOrigin;
    sourceUrl: string;
    sourcePolicyId: string;
    firstSeenAt: string;
    lastVerifiedAt: string;
    accessMode: ReferenceAccessMode;
  };
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  facts: ReferenceAtomicFactV1[];
  prohibitedMaterial: {
    storedPixels: false;
    cachedSourcePayload: false;
    embeddingStored: false;
  };
  contentDigest: string;
}

export type ReferenceObservationDraftV1 = Omit<
  ReferenceObservationV1,
  "observationId" | "contentDigest"
> & Partial<Pick<ReferenceObservationV1, "observationId" | "contentDigest">>;

export interface DesignRuleV1 {
  schemaVersion: "nodekit.reference-loop-design-rule/v1";
  ruleId: string;
  sourceObservationRefs: Array<{
    observationId: string;
    observationDigest: string;
    factIds: string[];
  }>;
  statement: string;
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  mechanismHypothesis: string;
  appliesWhen: string[];
  doesNotApplyWhen: string[];
  confidence: {
    observation: "low" | "medium" | "high";
    audienceFit: "low" | "medium" | "high";
    causal: "none" | "low" | "medium" | "high";
  };
  requiredEvidence: string[];
  contentDigest: string;
}

export type DesignRuleDraftV1 = Omit<DesignRuleV1, "ruleId" | "contentDigest">
  & Partial<Pick<DesignRuleV1, "ruleId" | "contentDigest">>;

export interface ReferenceCandidateReceiptV1 {
  schemaVersion: "nodekit.reference-candidate-receipt/v1";
  candidateId: string;
  renderReceiptId: string;
  candidateCommit: string;
  renderArtifacts: Array<{
    path: string;
    sha256: string;
    bytes: number;
  }>;
  novelByIntent?: boolean;
  evaluations: Array<{
    ruleId: string;
    result: ReferenceResult;
    factIds: string[];
    evidenceRefs: string[];
  }>;
}

export interface ReferenceProfileManifestV1 {
  schemaVersion: "nodekit.reference-profile-manifest/v1";
  profile: string;
  rules: Array<{
    ruleId: string;
    ruleDigest: string;
  }>;
}

export interface ReferenceScoreReceiptV1 {
  schemaVersion: "nodekit.reference-score-receipt/v1";
  receiptId: string;
  profile: string;
  profileManifest: {
    path: string;
    digest: string;
  };
  trustPolicy: {
    path: "reference/trust-policy.json";
    digest: string;
  };
  candidate: {
    candidateId: string;
    renderReceiptId: string;
    renderReceiptDigest: string;
    candidateReceiptDigest: string;
    candidateCommit: string;
  };
  rules: Array<{
    ruleId: string;
    ruleDigest: string;
    result: ReferenceResult;
    factIds: string[];
    evidenceRefs: string[];
  }>;
  coverage: {
    requiredRuleCount: number;
    evaluatedRuleCount: number;
    satisfiedRuleCount: number;
    violatedRuleCount: number;
    notObservedCount: number;
    notApplicableCount: number;
  };
  humanOverride?: {
    decision: "accept" | "reject";
    reason: string;
    reasonDigest: string;
    subjectDigest: string;
    attestation: ReferenceHumanAttestationV1;
  };
  verdict: ReferenceVerdict;
  contentDigest: string;
}

export interface ReferenceServiceAttestationV1 {
  schemaVersion: "nodekit.reference-service-attestation/v1";
  purpose: "mobbin-external-reference-run";
  keyId: string;
  subjectDigest: string;
  signedAt: string;
  algorithm: "Ed25519";
  signatureEncoding: "base64url";
  signature: string;
}

export interface ReferenceHumanAttestationV1 {
  schemaVersion: "nodekit.reference-human-attestation/v1";
  purpose: "reference-score-override";
  keyId: string;
  subjectDigest: string;
  decision: "accept" | "reject";
  reasonDigest: string;
  signedAt: string;
  algorithm: "Ed25519";
  signatureEncoding: "base64url";
  signature: string;
}

interface ExternalReferenceRunBaseV1 {
  schemaVersion: "nodekit.external-reference-run/v1";
  runId: string;
  provider: "mobbin";
  operation: "authenticated-live-inspection";
  policyId: "nodekit.mobbin-remote-mcp/v1";
  subjectDigest: string;
  contentDigest: string;
}

export type ExternalReferenceRunV1 = ExternalReferenceRunBaseV1 & (
  | {
    status: "pass";
    checkedAt: string;
    expiresAt: string;
    sourceUrl: string;
    remoteObjectId: string;
    runNonce: string;
    producer: { tool: "mobbin/search_flows"; version: string };
    observationId: string;
    observationDigest: string;
    factsDigest: string;
    prohibitedMaterial: {
      storedPixels: false;
      cachedSourcePayload: false;
      embeddingStored: false;
      ragIndexed: false;
      trainingUsed: false;
    };
    attestation: ReferenceServiceAttestationV1;
  }
  | {
    status: "fail" | "not-run";
    reasonCode: string;
  }
);

export type ExternalReferenceRunUnsignedPassV1 =
  Omit<Extract<ExternalReferenceRunV1, { status: "pass" }>, "runId" | "subjectDigest" | "contentDigest" | "attestation">
  & {
    runId?: string;
    subjectDigest?: string;
    contentDigest?: string;
  };

export type ExternalReferenceRunDraftV1 =
  | ExternalReferenceRunUnsignedPassV1
    & { attestation: ReferenceServiceAttestationV1 }
  | Omit<Extract<ExternalReferenceRunV1, { status: "fail" | "not-run" }>, "runId" | "subjectDigest" | "contentDigest">
    & {
      runId?: string;
      subjectDigest?: string;
      contentDigest?: string;
    };

export class ReferenceLoopError extends Error {
  code: string;
  exitCode: number;
}

export function referenceContentDigest(value: unknown): string;
export function buildReferenceObservation(draft: ReferenceObservationDraftV1): ReferenceObservationV1;
export function buildDesignRule(draft: DesignRuleDraftV1): DesignRuleV1;
export function buildReferenceCandidateReceipt(
  draft: Omit<ReferenceCandidateReceiptV1, "renderReceiptId">
    & Partial<Pick<ReferenceCandidateReceiptV1, "renderReceiptId">>,
): ReferenceCandidateReceiptV1;
export function referenceRenderReceiptDigest(candidateReceipt: ReferenceCandidateReceiptV1): string;
export function buildExternalReferenceRun(draft: ExternalReferenceRunDraftV1): ExternalReferenceRunV1;
export function referenceExternalRunSubjectDigest(
  draft: ExternalReferenceRunDraftV1 | ExternalReferenceRunUnsignedPassV1,
): string;
export function referenceServiceAttestationSigningBytes(attestation: Omit<ReferenceServiceAttestationV1, "signature">): Uint8Array;
export function referenceHumanAttestationSigningBytes(attestation: Omit<ReferenceHumanAttestationV1, "signature">): Uint8Array;
export function referenceHumanOverrideSubjectDigest(input: {
  profile: string;
  candidateReceiptDigest: string;
  rules: ReferenceScoreReceiptV1["rules"];
  coverage: ReferenceScoreReceiptV1["coverage"];
  baseVerdict: ReferenceVerdict;
  decision: "accept" | "reject";
  reason: string;
}): string;
export function initializeReferenceStore(repoRoot: string): Promise<{ referenceRoot: string }>;
export function getExternalReferenceStatus(
  repoRoot: string,
  provider: "mobbin",
): Promise<ExternalReferenceRunV1>;
export function recordReferenceObservation(
  repoRoot: string,
  input:
    | ReferenceObservationDraftV1
    | { observation: ReferenceObservationDraftV1; externalRun?: ExternalReferenceRunV1 },
): Promise<{
  observation: ReferenceObservationV1;
  externalRun?: ExternalReferenceRunV1;
  duplicate: boolean;
  output: string;
}>;
export function recordDesignRule(
  repoRoot: string,
  draft: DesignRuleDraftV1,
): Promise<{ rule: DesignRuleV1; duplicate: boolean; output: string }>;
export function scoreReferenceCandidate(
  repoRoot: string,
  input: {
    candidateReceipt: ReferenceCandidateReceiptV1;
    ruleIds: string[];
    profile: string;
    humanOverride?: {
      decision: "accept" | "reject";
      reason: string;
      reasonDigest: string;
      subjectDigest: string;
      attestation: ReferenceHumanAttestationV1;
    };
  },
): Promise<{ score: ReferenceScoreReceiptV1; duplicate: boolean; output: string }>;
export function verifyReferenceScoreReceipt(
  repoRoot: string,
  scoreOrPath: ReferenceScoreReceiptV1 | string,
  context: {
    candidateReceipt: ReferenceCandidateReceiptV1;
  },
): Promise<{ verdict: ReferenceVerdict; passed: boolean; findings: string[] }>;
