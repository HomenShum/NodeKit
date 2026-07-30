import { contentHash } from "./caseflow.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const WRITE_SCOPES = new Set([
  "read-only",
  "direct-worktree",
  "isolated-worktree",
]);
const MAX_RECORDS = 1_000;
const MAX_MIGRATION_ARTIFACTS = MAX_RECORDS * 3;
const MIGRATION_ARTIFACT_KINDS = Object.freeze({
  "nodekit.native-workspace/v1": "native-workspace",
  "nodekit.native-agent-session/v1": "native-agent-session",
  "nodekit.native-session-checkpoint/v1": "native-session-checkpoint",
});
const MIGRATION_ARTIFACT_ORDER = Object.freeze([
  "nodekit.native-workspace/v1",
  "nodekit.native-agent-session/v1",
  "nodekit.native-session-checkpoint/v1",
]);
const FORBIDDEN_CANONICAL_KEYS = new Set([
  "agentId",
  "credential",
  "generation",
  "host",
  "nativeSessionGeneration",
  "nativeSessionId",
  "owner",
  "providerSessionId",
  "rawProviderSessionId",
  "resumable",
  "sessionStatus",
  "status",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireText(value, label, maxLength = 2_048) {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be canonical UTC ISO-8601`);
  }
  return value;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)]),
  );
}

function normalizeRepository(value, label) {
  const repository = requireObject(value, label);
  const normalized = {
    canonicalRemote: requireText(
      repository.canonicalRemote,
      `${label}.canonicalRemote`,
    ),
    commit: requireText(repository.commit, `${label}.commit`, 64),
    treeHash: requireText(repository.treeHash, `${label}.treeHash`, 64),
    dirty: repository.dirty,
  };
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(normalized.commit)) {
    throw new TypeError(`${label}.commit must be an exact Git object ID`);
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(normalized.treeHash)) {
    throw new TypeError(`${label}.treeHash must be an exact Git object ID`);
  }
  if (typeof normalized.dirty !== "boolean") {
    throw new TypeError(`${label}.dirty must be boolean`);
  }
  if (normalized.dirty) {
    normalized.dirtyWorkingTreeHash = requireHash(
      repository.dirtyWorkingTreeHash,
      `${label}.dirtyWorkingTreeHash`,
    );
  } else if (repository.dirtyWorkingTreeHash !== undefined) {
    throw new TypeError(
      `${label}.dirtyWorkingTreeHash is forbidden for a clean tree`,
    );
  }
  return normalized;
}

function normalizeReceipt(value, label) {
  const receipt = requireObject(value, label);
  if (receipt.verified !== true) {
    throw new TypeError(`${label} must be verified by a trusted adapter`);
  }
  return {
    ref: requireText(receipt.ref, `${label}.ref`, 512),
    digest: requireHash(receipt.digest, `${label}.digest`),
  };
}

function artifact(body, prefix) {
  const artifactDigest = contentHash(body);
  return {
    ...body,
    artifactRef: `${prefix}:sha256:${artifactDigest}`,
    artifactDigest,
  };
}

function workspaceArtifact(record, migratedAt) {
  const repository = normalizeRepository(record.repository, "record.repository");
  const writeMode = requireText(record.writeMode, "record.writeMode", 64);
  if (!WRITE_SCOPES.has(writeMode)) {
    throw new TypeError("record.writeMode is invalid");
  }
  const authorityReceipt = normalizeReceipt(
    record.workspaceAuthorityReceipt,
    "record.workspaceAuthorityReceipt",
  );
  const ownerRef = requireText(record.authenticatedOwnerRef, "record.authenticatedOwnerRef", 512);
  const caseId = requireText(record.caseId, "record.caseId", 512);
  const workspaceId = `workspace:sha256:${contentHash({
    schemaVersion: "nodekit.native-workspace-scope/v1",
    ownerRef,
    caseId,
    repository,
    writeMode,
  })}`;
  return artifact({
    schemaVersion: "nodekit.native-workspace/v1",
    workspaceId,
    ownerRef,
    caseId,
    repository,
    writeMode,
    authorityReceiptRef: authorityReceipt.ref,
    createdAt: migratedAt,
  }, "native-workspace");
}

function fullSessionArtifacts(record, workspace, migratedAt) {
  const providerSessionIdHash = requireHash(
    record.providerSessionIdHash,
    "record.providerSessionIdHash",
  );
  const creationReceipt = normalizeReceipt(
    record.sessionCreationReceipt,
    "record.sessionCreationReceipt",
  );
  const adapter = requireObject(record.adapter, "record.adapter");
  const adapterIdentity = {
    adapterId: requireText(adapter.adapterId, "record.adapter.adapterId", 512),
    adapterVersion: requireText(
      adapter.adapterVersion,
      "record.adapter.adapterVersion",
      512,
    ),
    harnessVersion: requireText(
      adapter.harnessVersion,
      "record.adapter.harnessVersion",
      512,
    ),
  };
  const writeScope = requireText(record.writeScope, "record.writeScope", 64);
  if (!WRITE_SCOPES.has(writeScope)) {
    throw new TypeError("record.writeScope is invalid");
  }
  if (writeScope !== "read-only" && writeScope !== workspace.writeMode) {
    throw new TypeError("record.writeScope exceeds the workspace binding");
  }
  const sessionId = `session:sha256:${contentHash({
    schemaVersion: "nodekit.native-agent-session-scope/v1",
    workspaceArtifactDigest: workspace.artifactDigest,
    adapterId: adapterIdentity.adapterId,
    providerSessionIdHash,
  })}`;
  const session = artifact({
    schemaVersion: "nodekit.native-agent-session/v1",
    sessionId,
    workspaceArtifactRef: workspace.artifactRef,
    workspaceArtifactDigest: workspace.artifactDigest,
    adapter: adapterIdentity,
    providerSessionIdHash,
    writeScope,
    creationReceiptRef: creationReceipt.ref,
    creationReceiptDigest: creationReceipt.digest,
    createdAt: migratedAt,
  }, "native-agent-session");
  const source = requireObject(record.checkpoint, "record.checkpoint");
  const checkpointReceipt = normalizeReceipt(
    source.receipt,
    "record.checkpoint.receipt",
  );
  const artifactDigests = source.artifactDigests ?? [];
  if (!Array.isArray(artifactDigests) || artifactDigests.length > 256) {
    throw new TypeError("record.checkpoint.artifactDigests exceeds 256");
  }
  const checkpoint = artifact({
    schemaVersion: "nodekit.native-session-checkpoint/v1",
    sessionArtifactRef: session.artifactRef,
    sessionArtifactDigest: session.artifactDigest,
    sequence: 0,
    resumeCursorHash: requireHash(
      source.resumeCursorHash,
      "record.checkpoint.resumeCursorHash",
    ),
    repository: normalizeRepository(
      source.repository,
      "record.checkpoint.repository",
    ),
    traceDigest: requireHash(
      source.traceDigest,
      "record.checkpoint.traceDigest",
    ),
    artifactDigests: artifactDigests
      .map((value, index) =>
        requireHash(value, `record.checkpoint.artifactDigests[${index}]`))
      .sort(),
    adapterReceiptRef: checkpointReceipt.ref,
    adapterReceiptDigest: checkpointReceipt.digest,
    operationNonceHash: requireHash(
      source.operationNonceHash,
      "record.checkpoint.operationNonceHash",
    ),
    createdAt: migratedAt,
  }, "native-session-checkpoint");
  if (contentHash(checkpoint.repository) !== contentHash(workspace.repository)) {
    throw new TypeError("checkpoint repository does not match the workspace");
  }
  return { checkpoint, session };
}

function hasFullEvidence(record) {
  return Boolean(
    record.providerSessionIdHash
    && record.repository
    && record.workspaceAuthorityReceipt
    && record.sessionCreationReceipt
    && record.adapter
    && record.checkpoint,
  );
}

function assertCanonicalBoundary(value, path = "bundle") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CANONICAL_KEYS.has(key)) {
      throw new TypeError(`${path}.${key} is forbidden in migrated canonical output`);
    }
    assertCanonicalBoundary(child, `${path}.${key}`);
  }
}

export function planLegacySessionMigration(input) {
  const source = requireObject(input, "input");
  const migratedAt = requireTimestamp(source.migratedAt, "input.migratedAt");
  if (!Array.isArray(source.records) || source.records.length > MAX_RECORDS) {
    throw new TypeError(`input.records must contain at most ${MAX_RECORDS} records`);
  }
  const outcomes = [];
  const artifacts = [];
  const seenRecordIds = new Map();
  const providerIdentity = new Map();

  for (let index = 0; index < source.records.length; index += 1) {
    const record = requireObject(source.records[index], `input.records[${index}]`);
    const recordId = requireText(record.recordId, `input.records[${index}].recordId`, 512);
    const recordDigest = contentHash(stripUndefined(record));
    const duplicate = seenRecordIds.get(recordId);
    if (duplicate) {
      outcomes.push({
        recordId,
        outcome: duplicate === recordDigest ? "deduplicated" : "rejected",
        reasonCode: duplicate === recordDigest ? "DUPLICATE_INPUT" : "IDENTITY_CONFLICT",
        resumable: false,
      });
      continue;
    }
    seenRecordIds.set(recordId, recordDigest);
    if (
      record.ownerRef !== undefined
      && record.ownerRef !== record.authenticatedOwnerRef
    ) {
      outcomes.push({
        recordId,
        outcome: "rejected",
        reasonCode: "OWNER_MISMATCH",
        resumable: false,
      });
      continue;
    }
    try {
      if (!record.repository || !record.workspaceAuthorityReceipt) {
        outcomes.push({
          recordId,
          outcome: "not_resumable",
          reasonCode: "INSUFFICIENT_WORKSPACE_EVIDENCE",
          resumable: false,
        });
        continue;
      }
      const workspace = workspaceArtifact(record, migratedAt);
      if (!hasFullEvidence(record)) {
        artifacts.push(workspace);
        outcomes.push({
          recordId,
          outcome: "workspace_only",
          reasonCode: "HISTORY_ONLY",
          resumable: false,
          workspaceArtifactRef: workspace.artifactRef,
        });
        continue;
      }
      const scopeKey = `${record.authenticatedOwnerRef}|${workspace.workspaceId}`;
      const existingScope = providerIdentity.get(record.providerSessionIdHash);
      if (existingScope && existingScope !== scopeKey) {
        outcomes.push({
          recordId,
          outcome: "rejected",
          reasonCode: "IDENTITY_CONFLICT",
          resumable: false,
        });
        continue;
      }
      providerIdentity.set(record.providerSessionIdHash, scopeKey);
      const { checkpoint, session } = fullSessionArtifacts(
        record,
        workspace,
        migratedAt,
      );
      artifacts.push(workspace, session, checkpoint);
      outcomes.push({
        recordId,
        outcome: "migrated",
        reasonCode: "EXACT_TRUSTED_EVIDENCE",
        resumable: true,
        workspaceArtifactRef: workspace.artifactRef,
        sessionArtifactRef: session.artifactRef,
        checkpointArtifactRef: checkpoint.artifactRef,
      });
    } catch (error) {
      outcomes.push({
        recordId,
        outcome: "rejected",
        reasonCode: "INVALID_EVIDENCE",
        resumable: false,
        detail: error instanceof Error ? error.message : "invalid evidence",
      });
    }
  }

  const uniqueArtifacts = [...new Map(
    artifacts.map((entry) => [entry.artifactRef, entry]),
  ).values()];
  const body = {
    schemaVersion: "nodekit.native-session-migration-bundle/v1",
    migratedAt,
    sourceDigest: contentHash(stripUndefined(source.records)),
    outcomes,
    artifacts: uniqueArtifacts,
  };
  assertCanonicalBoundary(body.artifacts);
  return Object.freeze({
    ...body,
    bundleDigest: contentHash(body),
  });
}

export function verifyLegacySessionMigration(bundle) {
  const value = requireObject(bundle, "bundle");
  const expected = contentHash(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "bundleDigest"),
    ),
  );
  const findings = [];
  if (value.schemaVersion !== "nodekit.native-session-migration-bundle/v1") {
    findings.push("schemaVersion is invalid");
  }
  if (value.bundleDigest !== expected) findings.push("bundleDigest is invalid");
  try {
    assertCanonicalBoundary(value.artifacts);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : "canonical boundary failed");
  }
  if (
    !Array.isArray(value.artifacts)
    || value.artifacts.length > MAX_MIGRATION_ARTIFACTS
  ) {
    findings.push(
      `artifacts must contain at most ${MAX_MIGRATION_ARTIFACTS} entries`,
    );
  }
  const refs = new Set();
  for (const artifactValue of value.artifacts ?? []) {
    const artifactEntry = requireObject(artifactValue, "bundle artifact");
    if (!MIGRATION_ARTIFACT_KINDS[artifactEntry.schemaVersion]) {
      findings.push(
        `unsupported artifact schema: ${artifactEntry.schemaVersion ?? "unknown"}`,
      );
    }
    if (refs.has(artifactEntry.artifactRef)) findings.push("duplicate artifactRef");
    refs.add(artifactEntry.artifactRef);
    const expectedArtifactDigest = contentHash(
      Object.fromEntries(
        Object.entries(artifactEntry).filter(
          ([key]) => key !== "artifactRef" && key !== "artifactDigest",
        ),
      ),
    );
    if (artifactEntry.artifactDigest !== expectedArtifactDigest) {
      findings.push(`artifactDigest is invalid: ${artifactEntry.artifactRef ?? "unknown"}`);
    }
  }
  const passed = findings.length === 0;
  return Object.freeze({
    schemaVersion: "nodekit.native-session-migration-verification/v1",
    bundleDigest: value.bundleDigest,
    passed,
    findings,
  });
}

export async function importLegacySessionMigration({
  context,
  caseId,
  runId,
  bundle,
  approvedBundleDigest,
}) {
  const runtime = requireObject(context, "context").caseflow;
  if (
    !runtime
    || typeof runtime.createArtifact !== "function"
    || typeof runtime.getCase !== "function"
    || typeof runtime.getRun !== "function"
  ) {
    throw new TypeError(
      "context.caseflow must provide createArtifact, getCase, and getRun",
    );
  }
  const verification = verifyLegacySessionMigration(bundle);
  if (!verification.passed) {
    throw new Error(
      `migration bundle failed verification: ${verification.findings.join("; ")}`,
    );
  }
  requireHash(approvedBundleDigest, "approvedBundleDigest");
  if (approvedBundleDigest !== bundle.bundleDigest) {
    throw new Error("approvedBundleDigest does not match the migration bundle");
  }
  const canonicalCaseId = requireText(caseId, "caseId", 512);
  const canonicalRunId = requireText(runId, "runId", 512);
  const ownerRef = requireText(runtime.ownerId, "context.caseflow.ownerId", 512);
  const caseRecord = runtime.getCase(canonicalCaseId);
  const runRecord = runtime.getRun(canonicalRunId);
  if (runRecord.caseId !== canonicalCaseId) {
    throw new Error("migration run does not belong to the selected Caseflow case");
  }
  if (caseRecord.currentRunId !== canonicalRunId) {
    throw new Error("migration requires the selected Caseflow case's active run");
  }

  const artifactsByRef = new Map(
    bundle.artifacts.map((entry) => [entry.artifactRef, entry]),
  );
  for (const entry of bundle.artifacts) {
    if (entry.schemaVersion === "nodekit.native-workspace/v1") {
      if (entry.ownerRef !== ownerRef) {
        throw new Error("migration workspace owner does not match Caseflow authority");
      }
      if (entry.caseId !== canonicalCaseId) {
        throw new Error("migration workspace does not belong to the selected case");
      }
      continue;
    }
    if (entry.schemaVersion === "nodekit.native-agent-session/v1") {
      const workspace = artifactsByRef.get(entry.workspaceArtifactRef);
      if (
        workspace?.schemaVersion !== "nodekit.native-workspace/v1"
        || workspace.artifactDigest !== entry.workspaceArtifactDigest
      ) {
        throw new Error("migration session has no exact workspace dependency");
      }
      continue;
    }
    const session = artifactsByRef.get(entry.sessionArtifactRef);
    if (
      session?.schemaVersion !== "nodekit.native-agent-session/v1"
      || session.artifactDigest !== entry.sessionArtifactDigest
    ) {
      throw new Error("migration checkpoint has no exact session dependency");
    }
  }

  const orderedArtifacts = [...bundle.artifacts].sort(
    (left, right) =>
      MIGRATION_ARTIFACT_ORDER.indexOf(left.schemaVersion)
      - MIGRATION_ARTIFACT_ORDER.indexOf(right.schemaVersion),
  );
  const importedArtifactRefs = [];
  for (const entry of orderedArtifacts) {
    const stored = await Promise.resolve(runtime.createArtifact({
      caseId: canonicalCaseId,
      runId: canonicalRunId,
      kind: MIGRATION_ARTIFACT_KINDS[entry.schemaVersion],
      title: `Migrated ${entry.schemaVersion}`,
      content: entry,
      actor: { type: "system", id: "nodekit:native-session-migration" },
      idempotencyKey: `native-session-migration:${bundle.bundleDigest}:${entry.artifactRef}`,
    }));
    const canonical = stored.versions.find(
      (candidate) => candidate.version === stored.canonicalVersion,
    )?.content;
    if (contentHash(canonical) !== contentHash(entry)) {
      throw new Error(
        `Caseflow did not persist the exact migration artifact: ${entry.artifactRef}`,
      );
    }
    importedArtifactRefs.push(entry.artifactRef);
  }
  const receiptBody = {
    schemaVersion: "nodekit.native-session-migration-import-receipt/v1",
    bundleDigest: bundle.bundleDigest,
    caseId: canonicalCaseId,
    runId: canonicalRunId,
    importedArtifactRefs,
  };
  return Object.freeze({
    ...receiptBody,
    receiptDigest: contentHash(receiptBody),
  });
}
