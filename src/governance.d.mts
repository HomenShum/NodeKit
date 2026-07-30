export const GOVERNANCE_MODES: readonly [
  "AUTO_CONTINUE",
  "AUTO_PROMOTE_WITH_ROLLBACK",
  "DEFERRED_HUMAN_REVIEW",
  "PRE_ACTION_HUMAN_GATE",
];

export type GovernanceMode = typeof GOVERNANCE_MODES[number];

export interface GovernanceRiskInput {
  changeRef: string;
  candidateDigest: string;
  effects?: Partial<Record<
    | "destructiveWrite"
    | "credentialOrAuthorityChange"
    | "irreversibleMigration"
    | "materialSpend"
    | "externalCommunication"
    | "legalOrComplianceCommitment"
    | "irreversiblePromotion",
    boolean
  >>;
  evidence?: Partial<Record<
    | "exactRollbackTarget"
    | "rollbackVerified"
    | "forwardCompatible"
    | "rollbackCompatible"
    | "observationConfigured"
    | "nodeProofPromotionReady"
    | "unresolvedMajorFindings",
    boolean
  >>;
  context?: Partial<Record<
    | "architectureChanged"
    | "publicContractChanged"
    | "materiallySubjectiveProductEffect"
    | "isolatedEngineeringOnly"
    | "standingPromotionPolicy",
    boolean
  >>;
}

export function classifyGovernanceRisk(input: GovernanceRiskInput): {
  schemaVersion: "nodekit.governance-risk-assessment/v1";
  assessmentId: string;
  changeRef: string;
  candidateDigest: string;
  mode: GovernanceMode;
  decidingRiskInputs: string[];
  codeMayContinue: boolean;
  promotionRequiresHuman: boolean;
  protectedActionMayRun: boolean;
  riskAssessmentDigest: string;
  facts: {
    effects: Record<string, boolean>;
    evidence: Record<string, boolean>;
    context: Record<string, boolean>;
  };
};

export function createChangeEvidencePack(input: Record<string, unknown>): Record<string, unknown>;
export function createPromotionReadinessReceipt(input: Record<string, unknown>): Record<string, unknown>;
export function createHumanFeedbackEvent(input: Record<string, unknown>): Record<string, unknown>;
export function runRollbackAdapter(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function projectGovernanceGraph(input: Record<string, unknown>): Record<string, unknown>;
export function renderGovernanceGraphHtml(input: Record<string, unknown>): string;
export function createPr32GovernanceScenario(): Record<string, unknown>;
