import { randomUUID } from "node:crypto";

import { contentHash } from "./caseflow.mjs";
import { validateSchema } from "./schema-validation.mjs";

const SCHEMAS = Object.freeze({
  workspace: "nodekit.native-workspace.v1.schema.json",
  session: "nodekit.native-agent-session.v1.schema.json",
  checkpoint: "nodekit.native-session-checkpoint.v1.schema.json",
});
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const WRITE_SCOPES = new Set([
  "read-only",
  "direct-worktree",
  "isolated-worktree",
]);
const FORBIDDEN_PROVIDER_KEYS = new Set([
  "credential",
  "generation",
  "host",
  "nativeSessionId",
  "ownerRef",
  "providerSessionId",
  "rawProviderSessionId",
  "sessionStatus",
  "status",
]);
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_ARTIFACT_DIGESTS = 256;

export class NativeAgentSessionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "NativeAgentSessionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NativeAgentSessionError(code, message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("NATIVE_FIELD_INVALID", `${label} must be an object.`);
  }
  return value;
}

function requireIdentifier(value, label, maxLength = 512) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || !IDENTIFIER.test(value)
  ) {
    fail("NATIVE_FIELD_INVALID", `${label} must be a bounded identifier.`);
  }
  return value;
}

function requireText(value, label, maxLength = 2_048) {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > maxLength
  ) {
    fail("NATIVE_FIELD_INVALID", `${label} must be bounded non-empty text.`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("NATIVE_HASH_INVALID", `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requireGitObject(value, label) {
  if (typeof value !== "string" || !GIT_OBJECT.test(value)) {
    fail(
      "REPOSITORY_IDENTITY_INVALID",
      `${label} must be an exact Git object ID.`,
    );
  }
  return value;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string") {
    fail("NATIVE_TIMESTAMP_INVALID", `${label} must be canonical UTC ISO-8601.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("NATIVE_TIMESTAMP_INVALID", `${label} must be canonical UTC ISO-8601.`);
  }
  return value;
}

function requireScope(value, label) {
  if (!WRITE_SCOPES.has(value)) {
    fail(
      "WRITE_SCOPE_INVALID",
      `${label} must be read-only, direct-worktree, or isolated-worktree.`,
    );
  }
  return value;
}

function normalizeRepository(value, label = "repository") {
  const repository = requireObject(value, label);
  const dirty = repository.dirty;
  if (typeof dirty !== "boolean") {
    fail("REPOSITORY_IDENTITY_INVALID", `${label}.dirty must be boolean.`);
  }
  const normalized = {
    canonicalRemote: requireText(
      repository.canonicalRemote,
      `${label}.canonicalRemote`,
    ),
    commit: requireGitObject(repository.commit, `${label}.commit`),
    treeHash: requireGitObject(repository.treeHash, `${label}.treeHash`),
    dirty,
  };
  if (dirty) {
    normalized.dirtyWorkingTreeHash = requireHash(
      repository.dirtyWorkingTreeHash,
      `${label}.dirtyWorkingTreeHash`,
    );
  } else if (repository.dirtyWorkingTreeHash !== undefined) {
    fail(
      "REPOSITORY_IDENTITY_INVALID",
      `${label}.dirtyWorkingTreeHash is forbidden for a clean tree.`,
    );
  }
  return normalized;
}

function normalizeReceipt(value, label, operationNonceHash) {
  const receipt = requireObject(value, label);
  if (receipt.verified !== true) {
    fail("TRUSTED_RECEIPT_INVALID", `${label} is not verified.`);
  }
  if (
    operationNonceHash !== undefined
    && receipt.operationNonceHash !== operationNonceHash
  ) {
    fail(
      "TRUSTED_RECEIPT_INVALID",
      `${label} is not bound to the operation nonce.`,
    );
  }
  return {
    ref: requireIdentifier(receipt.ref, `${label}.ref`),
    digest: requireHash(receipt.digest, `${label}.digest`),
  };
}

function assertNoRawProviderIdentity(value, path = "adapter output") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROVIDER_KEYS.has(key)) {
      fail(
        "RAW_PROVIDER_IDENTITY_EXPOSED",
        `${path}.${key} is forbidden outside the trusted adapter.`,
      );
    }
    assertNoRawProviderIdentity(child, `${path}.${key}`);
  }
}

function artifactBody(body, prefix) {
  const artifactDigest = contentHash(body);
  return Object.freeze({
    ...body,
    artifactRef: `${prefix}:sha256:${artifactDigest}`,
    artifactDigest,
  });
}

async function validateArtifact(schema, value, label) {
  const findings = await validateSchema(schema, value, label);
  if (findings.length > 0) {
    fail("NATIVE_SCHEMA_INVALID", findings.join("\n"));
  }
  const expected = contentHash(
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => key !== "artifactRef" && key !== "artifactDigest",
      ),
    ),
  );
  if (
    value.artifactDigest !== expected
    || value.artifactRef.split(":sha256:")[1] !== expected
  ) {
    fail("NATIVE_ARTIFACT_DIGEST_MISMATCH", `${label} digest is invalid.`);
  }
  return value;
}

function now(context) {
  return requireTimestamp(
    (context.clock ?? (() => new Date().toISOString()))(),
    "clock result",
  );
}

function operationNonce() {
  return randomUUID();
}

function operationNonceHash(nonce) {
  return contentHash({
    schemaVersion: "nodekit.native-operation-nonce/v1",
    nonce,
  });
}

function timeoutBudget(context) {
  const value = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value)
    || value <= 0
    || value > MAX_TIMEOUT_MS
  ) {
    fail(
      "TIMEOUT_BUDGET_INVALID",
      `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return value;
}

async function boundedCall(context, label, operation) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new NativeAgentSessionError(
              "BLOCKED_EXTERNAL",
              `${label} exceeded the execution budget.`,
            ),
          );
        }, timeoutBudget(context));
      }),
    ]);
  } catch (error) {
    if (error instanceof NativeAgentSessionError) throw error;
    fail("BLOCKED_EXTERNAL", `${label} failed.`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function caseflowSnapshot(context) {
  const caseflow = requireObject(context.caseflow, "context.caseflow");
  if (typeof caseflow.snapshot !== "function") {
    fail("CASEFLOW_REQUIRED", "context.caseflow.snapshot is required.");
  }
  return caseflow.snapshot();
}

function canonicalContents(context) {
  if (
    typeof context.caseflow?.listCanonicalArtifactContents === "function"
  ) {
    return context.caseflow.listCanonicalArtifactContents({ limit: 4_096 });
  }
  const snapshot = caseflowSnapshot(context);
  return snapshot.artifacts
    .map((artifact) => {
      const version = artifact.versions.find(
        (candidate) => candidate.version === artifact.canonicalVersion,
      );
      return version?.content;
    })
    .filter(Boolean);
}

function activeRunForCase(context, caseId) {
  if (
    typeof context.caseflow?.getCase === "function"
    && typeof context.caseflow?.getRun === "function"
  ) {
    const caseRecord = context.caseflow.getCase(caseId);
    const run = caseRecord.currentRunId === null
      ? undefined
      : context.caseflow.getRun(caseRecord.currentRunId);
    if (!run || run.status !== "active") {
      fail("CASE_RUN_INACTIVE", "The Caseflow case has no active run.");
    }
    return run;
  }
  const snapshot = caseflowSnapshot(context);
  const caseRecord = snapshot.cases.find((entry) => entry.caseId === caseId);
  if (!caseRecord) fail("CASE_NOT_FOUND", `Caseflow case not found: ${caseId}`);
  const run = snapshot.runs.find(
    (entry) => entry.runId === caseRecord.currentRunId,
  );
  if (!run || run.status !== "active") {
    fail("CASE_RUN_INACTIVE", "The Caseflow case has no active run.");
  }
  return run;
}

function findByRef(context, schemaVersion, artifactRef, label) {
  const matches = canonicalContents(context).filter(
    (entry) =>
      entry.schemaVersion === schemaVersion
      && entry.artifactRef === artifactRef,
  );
  if (matches.length !== 1) {
    fail(
      "CANONICAL_ARTIFACT_NOT_FOUND",
      `${label} must resolve to exactly one canonical Caseflow artifact.`,
    );
  }
  return matches[0];
}

function findSessionById(context, sessionId) {
  const matches = canonicalContents(context).filter(
    (entry) =>
      entry.schemaVersion === "nodekit.native-agent-session/v1"
      && entry.sessionId === sessionId,
  );
  if (matches.length !== 1) {
    fail(
      "SESSION_NOT_FOUND",
      "sessionId must resolve to exactly one canonical session artifact.",
    );
  }
  return matches[0];
}

function checkpointsForSession(context, session) {
  return canonicalContents(context)
    .filter(
      (entry) =>
        entry.schemaVersion === "nodekit.native-session-checkpoint/v1"
        && entry.sessionArtifactRef === session.artifactRef,
    )
    .sort((left, right) => left.sequence - right.sequence);
}

async function verifyCheckpointChain(context, session) {
  const checkpoints = checkpointsForSession(context, session);
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    await validateArtifact(
      SCHEMAS.checkpoint,
      checkpoint,
      "native session checkpoint",
    );
    if (checkpoint.sequence !== index) {
      fail(
        "CHECKPOINT_INVALID",
        "Checkpoint sequence must be contiguous from zero.",
      );
    }
    if (index === 0) continue;
    const previous = checkpoints[index - 1];
    if (
      checkpoint.previousCheckpointRef !== previous.artifactRef
      || checkpoint.previousCheckpointDigest !== previous.artifactDigest
    ) {
      fail(
        "CHECKPOINT_INVALID",
        "Checkpoint predecessor binding is invalid.",
      );
    }
  }
  return checkpoints;
}

async function storeArtifact(
  context,
  { caseId, runId, kind, title, content },
) {
  const createArtifact = context.caseflow?.createArtifact;
  if (typeof createArtifact !== "function") {
    fail("CASEFLOW_REQUIRED", "context.caseflow.createArtifact is required.");
  }
  const stored = createArtifact({
    caseId,
    runId,
    kind,
    title,
    content,
    actor: { type: "system", id: "nodekit:native-session" },
    idempotencyKey: `${kind}:${content.artifactDigest}`,
  });
  const canonical = stored.versions.find(
    (candidate) => candidate.version === stored.canonicalVersion,
  )?.content;
  if (contentHash(canonical) !== contentHash(content)) {
    fail(
      "CASEFLOW_WRITE_MISMATCH",
      "Caseflow did not persist the exact canonical artifact.",
    );
  }
  return stored;
}

async function recordTrace(context, event) {
  if (typeof context.trace?.record !== "function") {
    fail("NODETRACE_REQUIRED", "context.trace.record is required.");
  }
  await boundedCall(context, "NodeTrace record", (signal) =>
    context.trace.record(event, signal));
}

function repositoryEquals(left, right) {
  return contentHash(left) === contentHash(right);
}

function normalizeAdapter(context, adapterId) {
  const id = requireIdentifier(adapterId, "adapterId");
  const adapter = context.adapters?.get?.(id);
  if (!adapter) fail("ADAPTER_NOT_FOUND", `Trusted adapter not found: ${id}`);
  return adapter;
}

function normalizeCheckpointOutput(output, nonceHash, label) {
  assertNoRawProviderIdentity(output);
  const value = requireObject(output, label);
  const receipt = normalizeReceipt(value.receipt, `${label}.receipt`, nonceHash);
  const artifactDigests = value.artifactDigests ?? [];
  if (
    !Array.isArray(artifactDigests)
    || artifactDigests.length > MAX_ARTIFACT_DIGESTS
  ) {
    fail(
      "BOUND_READ_EXCEEDED",
      `${label}.artifactDigests exceeds ${MAX_ARTIFACT_DIGESTS}.`,
    );
  }
  return {
    resumeCursorHash: requireHash(
      value.resumeCursorHash,
      `${label}.resumeCursorHash`,
    ),
    repository: normalizeRepository(value.repository, `${label}.repository`),
    traceDigest: requireHash(value.traceDigest, `${label}.traceDigest`),
    artifactDigests: artifactDigests.map((digest, index) =>
      requireHash(digest, `${label}.artifactDigests[${index}]`)),
    receipt,
    ...(value.runHandle === undefined
      ? {}
      : { runHandle: requireIdentifier(value.runHandle, `${label}.runHandle`) }),
  };
}

async function createCheckpoint(
  context,
  { session, workspace, previous, output, nonceHash },
) {
  const sequence = previous === undefined ? 0 : previous.sequence + 1;
  const body = {
    schemaVersion: "nodekit.native-session-checkpoint/v1",
    sessionArtifactRef: session.artifactRef,
    sessionArtifactDigest: session.artifactDigest,
    sequence,
    ...(previous === undefined
      ? {}
      : {
          previousCheckpointRef: previous.artifactRef,
          previousCheckpointDigest: previous.artifactDigest,
        }),
    resumeCursorHash: output.resumeCursorHash,
    repository: output.repository,
    traceDigest: output.traceDigest,
    artifactDigests: [...output.artifactDigests].sort(),
    adapterReceiptRef: output.receipt.ref,
    adapterReceiptDigest: output.receipt.digest,
    operationNonceHash: nonceHash,
    createdAt: now(context),
  };
  const checkpoint = artifactBody(body, "native-session-checkpoint");
  await validateArtifact(
    SCHEMAS.checkpoint,
    checkpoint,
    "native session checkpoint",
  );
  const run = activeRunForCase(context, workspace.caseId);
  await storeArtifact(context, {
    caseId: workspace.caseId,
    runId: run.runId,
    kind: "native-session-checkpoint",
    title: `Native session checkpoint ${sequence}`,
    content: checkpoint,
  });
  await recordTrace(context, {
    eventType: "native_session.checkpoint_created",
    workspaceId: workspace.workspaceId,
    sessionId: session.sessionId,
    checkpointRef: checkpoint.artifactRef,
    checkpointDigest: checkpoint.artifactDigest,
    sequence,
  });
  return checkpoint;
}

export async function workspace_bind(context, input) {
  const args = requireObject(input, "input");
  if (args.ownerRef !== undefined) {
    fail(
      "CALLER_OWNER_FORBIDDEN",
      "workspace_bind does not accept caller-provided owner identity.",
    );
  }
  const caseId = requireIdentifier(args.caseId, "caseId");
  const canonicalRemote = requireText(
    args.canonicalRemote,
    "canonicalRemote",
  );
  const writeMode = requireScope(args.writeMode, "writeMode");
  const run = activeRunForCase(context, caseId);
  const ownerRef = requireIdentifier(
    context.caseflow.ownerId,
    "authenticated Caseflow owner",
  );
  const nonce = operationNonce();
  const nonceHash = operationNonceHash(nonce);
  const measured = await boundedCall(
    context,
    "repository measurement",
    (signal) =>
      context.repository?.measure?.(
        { caseId, canonicalRemote, writeMode, operationNonce: nonce },
        signal,
      ),
  );
  assertNoRawProviderIdentity(measured, "repository measurement");
  const measurement = requireObject(measured, "repository measurement");
  const repository = normalizeRepository(
    measurement.repository,
    "repository measurement.repository",
  );
  if (repository.canonicalRemote !== canonicalRemote) {
    fail(
      "REPOSITORY_MISMATCH",
      "Measured canonical remote does not match workspace_bind.",
    );
  }
  const authorityReceipt = normalizeReceipt(
    measurement.receipt,
    "repository measurement.receipt",
    nonceHash,
  );
  const workspaceId = `workspace:sha256:${contentHash({
    schemaVersion: "nodekit.native-workspace-scope/v1",
    ownerRef,
    caseId,
    repository,
    writeMode,
  })}`;
  const existingWorkspaces = canonicalContents(context).filter(
    (entry) =>
      entry.schemaVersion === "nodekit.native-workspace/v1"
      && entry.workspaceId === workspaceId,
  );
  if (existingWorkspaces.length > 1) {
    fail(
      "IDENTITY_CONFLICT",
      "workspaceId resolves to multiple canonical workspace artifacts.",
    );
  }
  if (existingWorkspaces.length === 1) {
    const existing = existingWorkspaces[0];
    await validateArtifact(SCHEMAS.workspace, existing, "native workspace");
    await recordTrace(context, {
      eventType: "native_workspace.deduplicated",
      workspaceId,
      workspaceArtifactRef: existing.artifactRef,
      workspaceArtifactDigest: existing.artifactDigest,
    });
    return Object.freeze({
      disposition: "deduplicated",
      workspaceId,
      workspaceArtifactRef: existing.artifactRef,
      workspaceArtifactDigest: existing.artifactDigest,
    });
  }
  const body = {
    schemaVersion: "nodekit.native-workspace/v1",
    workspaceId,
    ownerRef,
    caseId,
    repository,
    writeMode,
    authorityReceiptRef: authorityReceipt.ref,
    createdAt: now(context),
  };
  const workspace = artifactBody(body, "native-workspace");
  await validateArtifact(SCHEMAS.workspace, workspace, "native workspace");
  await storeArtifact(context, {
    caseId,
    runId: run.runId,
    kind: "native-workspace",
    title: "Native workspace",
    content: workspace,
  });
  await recordTrace(context, {
    eventType: "native_workspace.bound",
    workspaceId,
    workspaceArtifactRef: workspace.artifactRef,
    workspaceArtifactDigest: workspace.artifactDigest,
  });
  return Object.freeze({
    disposition: "created",
    workspaceId,
    workspaceArtifactRef: workspace.artifactRef,
    workspaceArtifactDigest: workspace.artifactDigest,
  });
}

export async function session_start(context, input) {
  const args = requireObject(input, "input");
  const workspaceId = requireIdentifier(args.workspaceId, "workspaceId");
  const writeScope = requireScope(args.writeScope, "writeScope");
  const workspaces = canonicalContents(context).filter(
    (entry) =>
      entry.schemaVersion === "nodekit.native-workspace/v1"
      && entry.workspaceId === workspaceId,
  );
  if (workspaces.length !== 1) {
    fail(
      "WORKSPACE_NOT_FOUND",
      "workspaceId must resolve to exactly one canonical workspace.",
    );
  }
  const workspace = workspaces[0];
  await validateArtifact(SCHEMAS.workspace, workspace, "native workspace");
  if (
    writeScope !== "read-only"
    && writeScope !== workspace.writeMode
  ) {
    fail(
      "WRITE_SCOPE_INVALID",
      "Session write scope exceeds the workspace binding.",
    );
  }
  const adapter = normalizeAdapter(context, args.adapterId);
  const nonce = operationNonce();
  const nonceHash = operationNonceHash(nonce);
  const started = await boundedCall(context, "adapter session start", (signal) =>
    adapter.start(
      {
        workspace,
        writeScope,
        operationNonce: nonce,
      },
      signal,
    ));
  assertNoRawProviderIdentity(started);
  const output = requireObject(started, "adapter start output");
  const providerSessionIdHash = requireHash(
    output.providerSessionIdHash,
    "adapter start output.providerSessionIdHash",
  );
  const creationReceipt = normalizeReceipt(
    output.creationReceipt,
    "adapter start output.creationReceipt",
    nonceHash,
  );
  const adapterIdentity = {
    adapterId: requireIdentifier(args.adapterId, "adapterId"),
    adapterVersion: requireIdentifier(
      output.adapterVersion,
      "adapter start output.adapterVersion",
    ),
    harnessVersion: requireIdentifier(
      output.harnessVersion,
      "adapter start output.harnessVersion",
    ),
  };
  const sessionId = `session:sha256:${contentHash({
    schemaVersion: "nodekit.native-agent-session-scope/v1",
    workspaceArtifactDigest: workspace.artifactDigest,
    adapterId: adapterIdentity.adapterId,
    providerSessionIdHash,
  })}`;
  const checkpointOutput = normalizeCheckpointOutput(
    output.initialCheckpoint,
    nonceHash,
    "adapter start output.initialCheckpoint",
  );
  if (!repositoryEquals(checkpointOutput.repository, workspace.repository)) {
    fail(
      "REPOSITORY_MISMATCH",
      "Initial checkpoint repository does not match the workspace binding.",
    );
  }
  const runHandle = requireIdentifier(
    output.runHandle,
    "adapter start output.runHandle",
  );
  const existingSessions = canonicalContents(context).filter(
    (entry) =>
      entry.schemaVersion === "nodekit.native-agent-session/v1"
      && entry.sessionId === sessionId,
  );
  if (existingSessions.length > 1) {
    fail(
      "IDENTITY_CONFLICT",
      "sessionId resolves to multiple canonical session artifacts.",
    );
  }
  if (existingSessions.length === 1) {
    const existing = existingSessions[0];
    await validateArtifact(SCHEMAS.session, existing, "native agent session");
    const existingCheckpoints = await verifyCheckpointChain(context, existing);
    const initialCheckpoint = existingCheckpoints[0];
    if (!initialCheckpoint) {
      fail(
        "CHECKPOINT_INVALID",
        "Deduplicated session has no durable initial checkpoint.",
      );
    }
    await recordTrace(context, {
      eventType: "native_session.deduplicated",
      workspaceId: workspace.workspaceId,
      sessionId,
      sessionArtifactRef: existing.artifactRef,
    });
    return Object.freeze({
      disposition: "deduplicated",
      sessionId,
      sessionArtifactRef: existing.artifactRef,
      initialCheckpointRef: initialCheckpoint.artifactRef,
      runHandle,
    });
  }
  const session = artifactBody(
    {
      schemaVersion: "nodekit.native-agent-session/v1",
      sessionId,
      workspaceArtifactRef: workspace.artifactRef,
      workspaceArtifactDigest: workspace.artifactDigest,
      adapter: adapterIdentity,
      providerSessionIdHash,
      writeScope,
      creationReceiptRef: creationReceipt.ref,
      creationReceiptDigest: creationReceipt.digest,
      createdAt: now(context),
    },
    "native-agent-session",
  );
  await validateArtifact(SCHEMAS.session, session, "native agent session");
  const run = activeRunForCase(context, workspace.caseId);
  await storeArtifact(context, {
    caseId: workspace.caseId,
    runId: run.runId,
    kind: "native-agent-session",
    title: "Native agent session",
    content: session,
  });
  await recordTrace(context, {
    eventType: "native_session.started",
    workspaceId: workspace.workspaceId,
    sessionId,
    sessionArtifactRef: session.artifactRef,
  });
  const checkpoint = await createCheckpoint(context, {
    session,
    workspace,
    previous: undefined,
    output: checkpointOutput,
    nonceHash,
  });
  return Object.freeze({
    disposition: "created",
    sessionId,
    sessionArtifactRef: session.artifactRef,
    initialCheckpointRef: checkpoint.artifactRef,
    runHandle,
  });
}

export async function session_checkpoint(context, input) {
  const args = requireObject(input, "input");
  const session = findSessionById(
    context,
    requireIdentifier(args.sessionId, "sessionId"),
  );
  await validateArtifact(SCHEMAS.session, session, "native agent session");
  const workspace = findByRef(
    context,
    "nodekit.native-workspace/v1",
    session.workspaceArtifactRef,
    "native workspace",
  );
  const checkpoints = await verifyCheckpointChain(context, session);
  const previous = checkpoints.at(-1);
  if (
    !previous
    || args.expectedPreviousCheckpointDigest !== previous.artifactDigest
  ) {
    fail(
      "CHECKPOINT_STALE",
      "expectedPreviousCheckpointDigest does not match the verified frontier.",
    );
  }
  const adapter = normalizeAdapter(context, session.adapter.adapterId);
  const nonce = operationNonce();
  const nonceHash = operationNonceHash(nonce);
  const rawOutput = await boundedCall(
    context,
    "adapter checkpoint",
    (signal) =>
      adapter.checkpoint(
        {
          workspace,
          session,
          previousCheckpoint: previous,
          operationNonce: nonce,
        },
        signal,
      ),
  );
  const output = normalizeCheckpointOutput(
    rawOutput,
    nonceHash,
    "adapter checkpoint output",
  );
  const checkpoint = await createCheckpoint(context, {
    session,
    workspace,
    previous,
    output,
    nonceHash,
  });
  if (rawOutput.paused === true) {
    await recordTrace(context, {
      eventType: "native_session.paused",
      workspaceId: workspace.workspaceId,
      sessionId: session.sessionId,
      checkpointRef: checkpoint.artifactRef,
    });
  }
  return Object.freeze({
    checkpointRef: checkpoint.artifactRef,
    checkpointDigest: checkpoint.artifactDigest,
    sequence: checkpoint.sequence,
  });
}

function blockedState(error) {
  const code = error instanceof NativeAgentSessionError
    ? error.code
    : "BLOCKED_EXTERNAL";
  const allowed = new Set([
    "SESSION_BUSY",
    "HISTORY_ONLY",
    "AUTH_REQUIRED",
    "REPOSITORY_MISMATCH",
    "CHECKPOINT_INVALID",
    "BLOCKED_EXTERNAL",
  ]);
  return {
    state: allowed.has(code) ? code : "BLOCKED_EXTERNAL",
    reasonCode: code,
  };
}

export async function session_resume(context, input) {
  const args = requireObject(input, "input");
  let lease;
  let workspaceLease;
  let session;
  let workspace;
  try {
    session = findSessionById(
      context,
      requireIdentifier(args.sessionId, "sessionId"),
    );
    await validateArtifact(SCHEMAS.session, session, "native agent session");
    workspace = findByRef(
      context,
      "nodekit.native-workspace/v1",
      session.workspaceArtifactRef,
      "native workspace",
    );
    const checkpoints = await verifyCheckpointChain(context, session);
    const previous = checkpoints.at(-1);
    if (
      !previous
      || args.expectedCheckpointDigest !== previous.artifactDigest
    ) {
      fail(
        "CHECKPOINT_INVALID",
        "expectedCheckpointDigest does not match the verified frontier.",
      );
    }
    const nonce = operationNonce();
    const nonceHash = operationNonceHash(nonce);
    const leaseKeys = [`session:${session.sessionId}`];
    if (session.writeScope === "direct-worktree") {
      leaseKeys.push(`workspace:${workspace.workspaceId}:direct-worktree`);
    }
    const leaseResult = await boundedCall(
      context,
      "lease acquire",
      (signal) =>
        context.leases?.acquire?.(
          { keys: leaseKeys, owner: nonceHash, ttlMs: timeoutBudget(context) * 4 },
          signal,
        ),
    );
    if (!leaseResult?.acquired) fail("SESSION_BUSY", "Session lease is busy.");
    lease = leaseResult;
    workspaceLease = leaseKeys.length > 1;
    await recordTrace(context, {
      eventType: "native_session.lease_acquired",
      workspaceId: workspace.workspaceId,
      sessionId: session.sessionId,
      leaseScope: workspaceLease ? "session+direct-worktree" : "session",
    });
    const measured = await boundedCall(
      context,
      "repository measurement",
      (signal) =>
        context.repository?.measureCurrent?.(
          { workspace, operationNonce: nonce },
          signal,
        ),
    );
    assertNoRawProviderIdentity(measured, "repository measurement");
    const repository = normalizeRepository(
      measured?.repository,
      "repository measurement.repository",
    );
    normalizeReceipt(
      measured?.receipt,
      "repository measurement.receipt",
      nonceHash,
    );
    if (!repositoryEquals(repository, previous.repository)) {
      fail(
        "REPOSITORY_MISMATCH",
        "Repository changed after the verified checkpoint.",
      );
    }
    const adapter = normalizeAdapter(context, session.adapter.adapterId);
    const rawOutput = await boundedCall(
      context,
      "adapter resume",
      (signal) =>
        adapter.resume(
          {
            workspace,
            session,
            checkpoint: previous,
            operationNonce: nonce,
          },
          signal,
        ),
    );
    assertNoRawProviderIdentity(rawOutput);
    if (
      rawOutput.providerSessionIdHash !== session.providerSessionIdHash
      || rawOutput.resumeCursorHash !== previous.resumeCursorHash
    ) {
      fail(
        "CHECKPOINT_INVALID",
        "Adapter resume receipt does not prove the exact provider session frontier.",
      );
    }
    const output = normalizeCheckpointOutput(
      rawOutput.newCheckpoint,
      nonceHash,
      "adapter resume output.newCheckpoint",
    );
    if (!repositoryEquals(output.repository, previous.repository)) {
      fail(
        "REPOSITORY_MISMATCH",
        "Resumed checkpoint repository changed.",
      );
    }
    const adapterReceipt = normalizeReceipt(
      rawOutput.resumeReceipt,
      "adapter resume output.resumeReceipt",
      nonceHash,
    );
    const checkpoint = await createCheckpoint(context, {
      session,
      workspace,
      previous,
      output,
      nonceHash,
    });
    await recordTrace(context, {
      eventType: "native_session.resumed",
      workspaceId: workspace.workspaceId,
      sessionId: session.sessionId,
      checkpointRef: checkpoint.artifactRef,
      adapterReceiptRef: adapterReceipt.ref,
    });
    return Object.freeze({
      state: "RESUMED",
      runHandle: requireIdentifier(
        rawOutput.runHandle,
        "adapter resume output.runHandle",
      ),
      adapterReceiptRef: adapterReceipt.ref,
      newCheckpointRef: checkpoint.artifactRef,
    });
  } catch (error) {
    if (lease?.acquired) {
      try {
        await context.leases.release(lease);
        if (session && workspace) {
          await recordTrace(context, {
            eventType: "native_session.lease_released",
            workspaceId: workspace.workspaceId,
            sessionId: session.sessionId,
            outcome: "resume_blocked",
          });
        }
      } catch {
        return Object.freeze({
          state: "BLOCKED_EXTERNAL",
          reasonCode: "LEASE_RELEASE_FAILED",
        });
      }
    }
    return Object.freeze(blockedState(error));
  }
}

export async function session_status(context, input) {
  const args = requireObject(input, "input");
  let session;
  try {
    session = findSessionById(
      context,
      requireIdentifier(args.sessionId, "sessionId"),
    );
    await validateArtifact(SCHEMAS.session, session, "native agent session");
    const checkpoints = await verifyCheckpointChain(context, session);
    const latest = checkpoints.at(-1);
    const busy = await Promise.resolve(
      context.leases?.isBusy?.(`session:${session.sessionId}`),
    );
    const events = typeof context.trace?.list === "function"
      ? await Promise.resolve(context.trace.list(session.sessionId))
      : [];
    const eventTypes = new Set(
      events
        .filter((event) => event.sessionId === session.sessionId)
        .map((event) => event.eventType),
    );
    let derivedState = latest ? "CHECKPOINTED" : "CREATED";
    if (eventTypes.has("native_session.paused")) derivedState = "PAUSED";
    if (eventTypes.has("native_session.resumed")) derivedState = "RESUMED";
    if (eventTypes.has("native_session.completed")) derivedState = "COMPLETED";
    if (busy) derivedState = "BUSY";
    return Object.freeze({
      derivedState,
      ...(latest === undefined
        ? {}
        : { latestVerifiedCheckpointRef: latest.artifactRef }),
      limitations: [],
    });
  } catch (error) {
    return Object.freeze({
      derivedState: "INVALID",
      limitations: [
        error instanceof NativeAgentSessionError
          ? error.code
          : "NATIVE_STATE_INVALID",
      ],
    });
  }
}
