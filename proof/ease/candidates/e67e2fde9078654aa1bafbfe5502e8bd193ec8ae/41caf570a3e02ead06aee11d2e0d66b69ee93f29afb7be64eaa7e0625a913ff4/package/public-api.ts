import * as nodekit from "@homenshum/nodekit";
import * as caseflow from "@homenshum/nodekit/caseflow";
import * as postgres from "@homenshum/nodekit/adapters/postgres";
import {
  SUBMISSION_ATTESTATION_SCHEMA_VERSION,
  canonicalizeAttestationPayload,
  type DetachedAttestation,
} from "@homenshum/nodekit/submission-attestation";
import * as convexClient from "@homenshum/nodekit/convex-caseflow";
import convexConfig from "@homenshum/nodekit/convex.config.js";
import type { ComponentApi } from "@homenshum/nodekit/_generated/component.js";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import * as convexTest from "@homenshum/nodekit/test";
void [nodekit, caseflow, postgres, convexClient, convexConfig, convexTest];
const attestationSchema: "nodekit.detached-attestation/v1" = SUBMISSION_ATTESTATION_SCHEMA_VERSION;
const canonicalPayload: string = canonicalizeAttestationPayload({ gate: "package-consumer" });
declare const detachedAttestation: DetachedAttestation;
type UpdateCaseInputArgs = FunctionArgs<ComponentApi["caseflow"]["updateCaseInput"]>;
const updateCaseInputWithoutPrimaryJob = { caseId: "case", scopeKey: "scope", title: "Updated" } satisfies UpdateCaseInputArgs;
type Completion = FunctionReturnType<ComponentApi["caseflow"]["completeRun"]>;
function assertReceiptV2(value: Completion) {
  const hashes: [string, string] = [value.receipt.caseHash, value.receipt.runHash];
  return hashes;
}
void [attestationSchema, canonicalPayload, detachedAttestation, updateCaseInputWithoutPrimaryJob, assertReceiptV2];
