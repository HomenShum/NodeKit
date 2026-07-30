import assert from "node:assert/strict";
import test from "node:test";

import {
  contentHash,
  createMemoryCaseflow,
} from "../src/lib/caseflow.mjs";
import {
  importLegacySessionMigration,
  planLegacySessionMigration,
  verifyLegacySessionMigration,
} from "../src/lib/native-agent-migration.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const hash = (value) => contentHash({ value });
const migratedAt = "2026-07-30T12:00:00.000Z";
const repository = {
  canonicalRemote: "https://github.com/example/repo.git",
  commit: "a".repeat(40),
  treeHash: "b".repeat(40),
  dirty: false,
};
const trusted = (kind) => ({
  ref: `receipt:${kind}`,
  digest: hash(kind),
  verified: true,
});

function fullRecord(overrides = {}) {
  return {
    recordId: "legacy:1",
    ownerRef: "owner:one",
    authenticatedOwnerRef: "owner:one",
    caseId: "case:one",
    repository,
    writeMode: "isolated-worktree",
    workspaceAuthorityReceipt: trusted("workspace"),
    providerSessionIdHash: hash("provider"),
    sessionCreationReceipt: trusted("session"),
    adapter: {
      adapterId: "claude-code",
      adapterVersion: "adapter:1",
      harnessVersion: "harness:1",
    },
    writeScope: "isolated-worktree",
    checkpoint: {
      resumeCursorHash: hash("cursor"),
      repository,
      traceDigest: hash("trace"),
      artifactDigests: [hash("artifact")],
      receipt: trusted("checkpoint"),
      operationNonceHash: hash("nonce"),
    },
    legacyIdentity: {
      nativeSessionId: "raw-provider-id-that-must-not-migrate",
      generation: 4,
      status: "resumed",
    },
    legacyGrants: [{ status: "active", credential: "secret-ref" }],
    ...overrides,
  };
}

test("migration matrix keeps exact trusted evidence resumable and strips legacy authority", async () => {
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [fullRecord()],
  });
  assert.equal(bundle.outcomes[0].outcome, "migrated");
  assert.equal(bundle.outcomes[0].resumable, true);
  assert.deepEqual(
    bundle.artifacts.map((entry) => entry.schemaVersion),
    [
      "nodekit.native-workspace/v1",
      "nodekit.native-agent-session/v1",
      "nodekit.native-session-checkpoint/v1",
    ],
  );
  const serialized = JSON.stringify(bundle.artifacts);
  assert.equal(serialized.includes("raw-provider-id-that-must-not-migrate"), false);
  assert.equal(serialized.includes("credential"), false);
  assert.equal(serialized.includes("generation"), false);
  assert.equal(serialized.includes('"status"'), false);
  const schemas = [
    "nodekit.native-workspace.v1.schema.json",
    "nodekit.native-agent-session.v1.schema.json",
    "nodekit.native-session-checkpoint.v1.schema.json",
  ];
  for (let index = 0; index < bundle.artifacts.length; index += 1) {
    assert.deepEqual(
      await validateSchema(schemas[index], bundle.artifacts[index], `artifact ${index}`),
      [],
    );
  }
  assert.equal(verifyLegacySessionMigration(bundle).passed, true);
});

test("migration matrix makes incomplete evidence history-only or explicitly not resumable", () => {
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [
      fullRecord({
        recordId: "legacy:workspace-only",
        providerSessionIdHash: undefined,
        sessionCreationReceipt: undefined,
        checkpoint: undefined,
      }),
      {
        recordId: "legacy:grant-only",
        authenticatedOwnerRef: "owner:one",
        caseId: "case:one",
        legacyGrants: [{ status: "active" }],
      },
    ],
  });
  assert.deepEqual(
    bundle.outcomes.map(({ outcome, reasonCode, resumable }) => ({
      outcome,
      reasonCode,
      resumable,
    })),
    [
      {
        outcome: "workspace_only",
        reasonCode: "HISTORY_ONLY",
        resumable: false,
      },
      {
        outcome: "not_resumable",
        reasonCode: "INSUFFICIENT_WORKSPACE_EVIDENCE",
        resumable: false,
      },
    ],
  );
});

test("migration matrix rejects owner mismatch, cross-identity provider reuse, and conflicting duplicates", () => {
  const first = fullRecord();
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [
      fullRecord({
        recordId: "legacy:owner-mismatch",
        ownerRef: "owner:attacker",
      }),
      first,
      fullRecord({
        recordId: "legacy:cross-identity",
        authenticatedOwnerRef: "owner:two",
        ownerRef: "owner:two",
        caseId: "case:two",
      }),
      { ...first },
      fullRecord({
        providerSessionIdHash: hash("different-provider"),
      }),
    ],
  });
  assert.deepEqual(
    bundle.outcomes.map((entry) => [entry.outcome, entry.reasonCode]),
    [
      ["rejected", "OWNER_MISMATCH"],
      ["migrated", "EXACT_TRUSTED_EVIDENCE"],
      ["rejected", "IDENTITY_CONFLICT"],
      ["deduplicated", "DUPLICATE_INPUT"],
      ["rejected", "IDENTITY_CONFLICT"],
    ],
  );
});

test("verification fails closed after bundle or artifact tampering", () => {
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [fullRecord()],
  });
  const tampered = structuredClone(bundle);
  tampered.artifacts[0].repository.treeHash = "c".repeat(40);
  const result = verifyLegacySessionMigration(tampered);
  assert.equal(result.passed, false);
  assert.ok(result.findings.some((finding) => finding.includes("bundleDigest")));
  assert.ok(result.findings.some((finding) => finding.includes("artifactDigest")));
});

test("privileged importer writes the verified dependency chain into the active Caseflow run exactly once", async () => {
  const caseflow = createMemoryCaseflow({
    ownerId: "owner:one",
    clock: () => migratedAt,
  });
  const caseRecord = caseflow.createCase({
    title: "Migrate exact native session evidence",
    primaryJob: "Preserve only canonical workspace, session, and checkpoint facts",
  });
  const run = caseflow.startRun({
    caseId: caseRecord.caseId,
    stages: [{ id: "migrate", label: "Migrate", owner: "operator" }],
  });
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [fullRecord({ caseId: caseRecord.caseId })],
  });
  const input = {
    context: { caseflow },
    caseId: caseRecord.caseId,
    runId: run.runId,
    bundle,
    approvedBundleDigest: bundle.bundleDigest,
  };
  const first = await importLegacySessionMigration(input);
  const repeated = await importLegacySessionMigration(input);
  assert.deepEqual(repeated, first);
  assert.deepEqual(
    caseflow.listCanonicalArtifactContents({
      caseId: caseRecord.caseId,
      limit: 10,
    }).map((entry) => entry.schemaVersion),
    [
      "nodekit.native-workspace/v1",
      "nodekit.native-agent-session/v1",
      "nodekit.native-session-checkpoint/v1",
    ],
  );
  assert.equal(first.importedArtifactRefs.length, 3);
  assert.match(first.receiptDigest, /^[a-f0-9]{64}$/);
});

test("privileged importer rejects wrong authority, wrong approval, and broken dependencies before writes", async () => {
  const caseflow = createMemoryCaseflow({ ownerId: "owner:other" });
  const caseRecord = caseflow.createCase({
    title: "Reject unsafe migration",
    primaryJob: "Keep foreign identity evidence out of Caseflow",
  });
  const run = caseflow.startRun({
    caseId: caseRecord.caseId,
    stages: [{ id: "migrate", label: "Migrate", owner: "operator" }],
  });
  const bundle = planLegacySessionMigration({
    migratedAt,
    records: [fullRecord({ caseId: caseRecord.caseId })],
  });
  await assert.rejects(
    importLegacySessionMigration({
      context: { caseflow },
      caseId: caseRecord.caseId,
      runId: run.runId,
      bundle,
      approvedBundleDigest: hash("wrong approval"),
    }),
    /approvedBundleDigest/,
  );
  await assert.rejects(
    importLegacySessionMigration({
      context: { caseflow },
      caseId: caseRecord.caseId,
      runId: run.runId,
      bundle,
      approvedBundleDigest: bundle.bundleDigest,
    }),
    /owner does not match/,
  );
  assert.deepEqual(
    caseflow.listCanonicalArtifactContents({
      caseId: caseRecord.caseId,
      limit: 10,
    }),
    [],
  );
});
