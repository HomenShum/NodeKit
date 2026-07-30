import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { contentHash } from "./caseflow.mjs";
import { validateSchema } from "./schema-validation.mjs";

const IDENTITY_SCHEMA = "nodekit.native-agent-session-identity.v1.schema.json";
const CONTINUATION_SCHEMA = "nodekit.native-agent-continuation-grant.v1.schema.json";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const RAW_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CONTINUATION_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_CONSUME_TIMEOUT_MS = 5_000;
const MAX_CONSUME_TIMEOUT_MS = 30_000;

export class NativeAgentIdentityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "NativeAgentIdentityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NativeAgentIdentityError(code, message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("native_identity_field_invalid", `${label} must be an object.`);
  }
  return value;
}

function requireIdentifier(value, label, maxLength = 256) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || !ID_PATTERN.test(value)
  ) {
    fail(
      "native_identity_field_invalid",
      `${label} must be a non-empty bounded identifier.`,
    );
  }
  return value;
}

function requireGeneration(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "native_session_generation_invalid",
      `${label} must be a non-negative safe integer.`,
    );
  }
  return value;
}

function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string") {
    fail("native_identity_timestamp_invalid", `${label} must be canonical UTC ISO-8601.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("native_identity_timestamp_invalid", `${label} must be canonical UTC ISO-8601.`);
  }
  return value;
}

function requireRawSha256(value, label) {
  if (typeof value !== "string" || !RAW_SHA256_PATTERN.test(value)) {
    fail("native_identity_hash_invalid", `${label} must be a lowercase raw SHA-256 digest.`);
  }
  return value;
}

function normalizeHost(host) {
  const value = requireObject(host, "host");
  return {
    hostId: requireIdentifier(value.hostId, "host.hostId"),
    instanceId: requireIdentifier(value.instanceId, "host.instanceId"),
    authorityRef: requireIdentifier(value.authorityRef, "host.authorityRef"),
  };
}

function normalizeCredential(credential) {
  const value = requireObject(credential, "credential");
  return {
    credentialRef: requireIdentifier(value.credentialRef, "credential.credentialRef"),
    generation: requireGeneration(value.generation, "credential.generation"),
    ...(value.expiresAt === undefined
      ? {}
      : {
          expiresAt: requireCanonicalTimestamp(
            value.expiresAt,
            "credential.expiresAt",
          ),
        }),
  };
}

function normalizeCandidate(candidate) {
  const value = requireObject(candidate, "candidate");
  return {
    ownerRef: requireIdentifier(value.ownerRef, "ownerRef"),
    workspaceId: requireIdentifier(value.workspaceId, "workspaceId"),
    agentId: requireIdentifier(value.agentId, "agentId", 128),
    nativeSessionId: requireIdentifier(value.nativeSessionId, "nativeSessionId"),
    nativeSessionGeneration: requireGeneration(
      value.nativeSessionGeneration,
      "nativeSessionGeneration",
    ),
    host: normalizeHost(value.host),
    credential: normalizeCredential(value.credential),
    ...(value.peerId === undefined
      ? {}
      : { peerId: requireIdentifier(value.peerId, "peerId") }),
  };
}

function identityScope(candidate) {
  return {
    schemaVersion: "nodekit.native-agent-identity-scope/v1",
    ownerRef: candidate.ownerRef,
    workspaceId: candidate.workspaceId,
    agentId: candidate.agentId,
  };
}

function identityRef(candidate) {
  return `native-agent-identity:sha256:${contentHash(identityScope(candidate))}`;
}

function snapshotBody(candidate, options = {}) {
  return {
    schemaVersion: "nodekit.native-agent-session-identity/v1",
    identityRef: options.identityRef ?? identityRef(candidate),
    ownerRef: candidate.ownerRef,
    workspaceId: candidate.workspaceId,
    agentId: candidate.agentId,
    nativeSessionId: candidate.nativeSessionId,
    nativeSessionGeneration: candidate.nativeSessionGeneration,
    host: candidate.host,
    credential: candidate.credential,
    ...(candidate.peerId === undefined ? {} : { peerId: candidate.peerId }),
    ...(options.previousSnapshotHash === undefined
      ? {}
      : { previousSnapshotHash: options.previousSnapshotHash }),
    authority: {
      canAssertReviewIndependence: false,
      canIssueNodeProofVerdict: false,
    },
  };
}

async function validateOrThrow(schema, value, label) {
  const findings = await validateSchema(schema, value, label);
  if (findings.length > 0) throw new Error(findings.join("\n"));
}

function withoutDerived(value, fields) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.includes(key)),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertCredentialActive(credential, now) {
  if (
    credential.expiresAt !== undefined
    && new Date(now).getTime() >= new Date(credential.expiresAt).getTime()
  ) {
    fail(
      "native_credential_expired",
      "The credential bound to the native session has expired.",
    );
  }
}

function assertScopeMatches(currentSnapshot, nextCandidate) {
  if (
    currentSnapshot.ownerRef !== nextCandidate.ownerRef
    || currentSnapshot.workspaceId !== nextCandidate.workspaceId
    || currentSnapshot.agentId !== nextCandidate.agentId
    || currentSnapshot.identityRef !== identityRef(nextCandidate)
  ) {
    fail(
      "native_identity_scope_mismatch",
      "A native session cannot cross an owner, workspace, or agent identity boundary.",
    );
  }
}

function assertReconnectAuthority(currentSnapshot, nextCandidate) {
  if (currentSnapshot.nativeSessionId !== nextCandidate.nativeSessionId) {
    fail(
      "native_session_collision",
      "One native session generation cannot identify two different sessions.",
    );
  }
  if (
    currentSnapshot.peerId !== undefined
    && currentSnapshot.peerId !== nextCandidate.peerId
  ) {
    fail(
      "native_peer_mismatch",
      "A reconnect cannot replace the peer bound to the active native session.",
    );
  }
  if (contentHash(currentSnapshot.host) !== contentHash(nextCandidate.host)) {
    fail(
      "native_host_mismatch",
      "A reconnect cannot replace the host authority bound to the active native session.",
    );
  }
  if (
    contentHash(currentSnapshot.credential)
    !== contentHash(nextCandidate.credential)
  ) {
    fail(
      "native_credential_mismatch",
      "A reconnect cannot replace the credential bound to the active native session.",
    );
  }
}

function assertRotationGeneration(currentSnapshot, nextCandidate) {
  if (
    nextCandidate.nativeSessionGeneration
    < currentSnapshot.nativeSessionGeneration
  ) {
    fail(
      "native_session_stale",
      "The native session generation is older than the persisted identity state.",
    );
  }
  if (
    nextCandidate.nativeSessionGeneration
    > currentSnapshot.nativeSessionGeneration + 1
  ) {
    fail(
      "native_session_generation_gap",
      "A native session rotation must advance exactly one generation.",
    );
  }
}

function assertCredentialNotStale(currentSnapshot, nextCandidate) {
  if (
    nextCandidate.credential.generation
    < currentSnapshot.credential.generation
  ) {
    fail(
      "native_credential_stale",
      "A native session rotation cannot roll back credential authority.",
    );
  }
}

function grantTarget(candidate) {
  return {
    nativeSessionId: candidate.nativeSessionId,
    nativeSessionGeneration: candidate.nativeSessionGeneration,
    host: candidate.host,
    credential: candidate.credential,
    ...(candidate.peerId === undefined ? {} : { peerId: candidate.peerId }),
  };
}

function sha256Utf8(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function equalHash(left, right) {
  if (!RAW_SHA256_PATTERN.test(left) || !RAW_SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function createNativeAgentIdentitySnapshot(input) {
  const candidate = normalizeCandidate(input);
  const body = snapshotBody(candidate);
  const snapshot = {
    ...body,
    snapshotHash: contentHash(body),
  };
  await validateOrThrow(IDENTITY_SCHEMA, snapshot, "native agent identity snapshot");
  return deepFreeze(snapshot);
}

export async function verifyNativeAgentIdentitySnapshot(snapshot) {
  if (
    snapshot?.authority?.canAssertReviewIndependence !== false
    || snapshot?.authority?.canIssueNodeProofVerdict !== false
  ) {
    fail(
      "native_identity_authority_invalid",
      "Continuity metadata cannot assert review independence or a NodeProof verdict.",
    );
  }
  await validateOrThrow(IDENTITY_SCHEMA, snapshot, "native agent identity snapshot");
  const candidate = normalizeCandidate(snapshot);
  const expectedIdentityRef = identityRef(candidate);
  if (snapshot.identityRef !== expectedIdentityRef) {
    fail(
      "native_identity_ref_mismatch",
      "The identity reference does not bind the owner, workspace, and agent scope.",
    );
  }
  if (snapshot.previousSnapshotHash !== undefined) {
    requireRawSha256(snapshot.previousSnapshotHash, "previousSnapshotHash");
  }
  const expectedHash = contentHash(withoutDerived(snapshot, ["snapshotHash"]));
  if (snapshot.snapshotHash !== expectedHash) {
    fail(
      "native_identity_hash_mismatch",
      "The identity snapshot hash does not match its canonical body.",
    );
  }
  return { snapshot, snapshotHash: expectedHash, verified: true };
}

export async function issueNativeAgentContinuationGrant(input) {
  const currentSnapshot = (
    await verifyNativeAgentIdentitySnapshot(input.currentSnapshot)
  ).snapshot;
  const nextCandidate = normalizeCandidate(input.candidate);
  assertScopeMatches(currentSnapshot, nextCandidate);
  assertRotationGeneration(currentSnapshot, nextCandidate);
  if (
    nextCandidate.nativeSessionGeneration
    === currentSnapshot.nativeSessionGeneration
  ) {
    fail(
      "native_continuation_not_rotation",
      "A continuation grant is issued only for the next native session generation.",
    );
  }
  assertCredentialNotStale(currentSnapshot, nextCandidate);

  const issuedAt = requireCanonicalTimestamp(input.issuedAt, "issuedAt");
  const expiresAt = requireCanonicalTimestamp(input.expiresAt, "expiresAt");
  const ttlMs = new Date(expiresAt).getTime() - new Date(issuedAt).getTime();
  if (ttlMs <= 0 || ttlMs > MAX_CONTINUATION_TTL_MS) {
    fail(
      "native_continuation_ttl_invalid",
      "A continuation grant must expire after issuance within 24 hours.",
    );
  }

  const token = randomBytes(32).toString("base64url");
  const body = {
    schemaVersion: "nodekit.native-agent-continuation-grant/v1",
    identityRef: currentSnapshot.identityRef,
    currentSnapshotHash: currentSnapshot.snapshotHash,
    target: grantTarget(nextCandidate),
    tokenHash: sha256Utf8(token),
    issuedAt,
    expiresAt,
  };
  const grantHash = contentHash(body);
  const grant = {
    ...body,
    grantId: `native-agent-continuation:sha256:${grantHash}`,
    grantHash,
  };
  await validateOrThrow(
    CONTINUATION_SCHEMA,
    grant,
    "native agent continuation grant",
  );
  return deepFreeze({ token, grant });
}

export async function verifyNativeAgentContinuationGrant(grant) {
  await validateOrThrow(
    CONTINUATION_SCHEMA,
    grant,
    "native agent continuation grant",
  );
  const body = withoutDerived(grant, ["grantId", "grantHash"]);
  const expectedHash = contentHash(body);
  if (
    grant.grantHash !== expectedHash
    || grant.grantId !== `native-agent-continuation:sha256:${expectedHash}`
  ) {
    fail(
      "native_continuation_hash_mismatch",
      "The continuation grant hash does not match its canonical body.",
    );
  }
  return { grant, grantHash: expectedHash, verified: true };
}

function assertGrantBindings(grant, currentSnapshot, nextCandidate) {
  if (
    grant.identityRef !== currentSnapshot.identityRef
    || grant.currentSnapshotHash !== currentSnapshot.snapshotHash
    || contentHash(grant.target) !== contentHash(grantTarget(nextCandidate))
  ) {
    fail(
      "native_continuation_binding_mismatch",
      "The continuation grant does not bind the exact current identity and target session.",
    );
  }
}

function assertGrantTime(grant, now) {
  const nowMs = new Date(now).getTime();
  if (nowMs < new Date(grant.issuedAt).getTime()) {
    fail(
      "native_continuation_not_yet_valid",
      "The continuation grant is not valid yet.",
    );
  }
  if (nowMs >= new Date(grant.expiresAt).getTime()) {
    fail(
      "native_continuation_expired",
      "The continuation grant has expired.",
    );
  }
}

async function consumeContinuationWithTimeout(input, tokenHash, grant) {
  const timeoutMs = input.consumeTimeoutMs ?? DEFAULT_CONSUME_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_CONSUME_TIMEOUT_MS
  ) {
    fail(
      "native_continuation_consume_timeout_invalid",
      `consumeTimeoutMs must be between 1 and ${MAX_CONSUME_TIMEOUT_MS}.`,
    );
  }
  const controller = new AbortController();
  let timeout;
  try {
    const consumed = await Promise.race([
      Promise.resolve().then(() =>
        input.consumeContinuationToken(tokenHash, grant, controller.signal)),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => {
            controller.abort();
            reject(
              new NativeAgentIdentityError(
                "native_continuation_consume_timeout",
                "The consumed-once token store exceeded its execution budget.",
              ),
            );
          },
          timeoutMs,
        );
      }),
    ]);
    return consumed;
  } catch (error) {
    if (error instanceof NativeAgentIdentityError) throw error;
    fail(
      "native_continuation_consume_failed",
      "The consumed-once token store failed.",
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function resolveNativeAgentSessionIdentity(input) {
  const now = requireCanonicalTimestamp(input.now, "now");
  const currentSnapshot = input.currentSnapshot === undefined
    ? undefined
    : (await verifyNativeAgentIdentitySnapshot(input.currentSnapshot)).snapshot;

  if (input.providerAvailable !== true) {
    return deepFreeze({
      status: "degraded",
      reasonCode: "IDENTITY_PROVIDER_UNAVAILABLE",
      writable: false,
      ...(currentSnapshot === undefined ? {} : { snapshot: currentSnapshot }),
    });
  }

  const nextCandidate = normalizeCandidate(input.candidate);
  assertCredentialActive(nextCandidate.credential, now);

  if (currentSnapshot === undefined) {
    return deepFreeze({
      status: "ready",
      continuity: "created",
      hostChanged: false,
      writable: true,
      snapshot: await createNativeAgentIdentitySnapshot(nextCandidate),
    });
  }

  assertScopeMatches(currentSnapshot, nextCandidate);
  assertRotationGeneration(currentSnapshot, nextCandidate);
  if (
    nextCandidate.nativeSessionGeneration
    === currentSnapshot.nativeSessionGeneration
  ) {
    assertReconnectAuthority(currentSnapshot, nextCandidate);
    return deepFreeze({
      status: "ready",
      continuity: "reconnect",
      hostChanged: false,
      writable: true,
      snapshot: currentSnapshot,
    });
  }

  assertCredentialNotStale(currentSnapshot, nextCandidate);
  if (
    !input.continuation
    || typeof input.continuation.token !== "string"
    || !input.continuation.grant
  ) {
    fail(
      "native_continuation_required",
      "Rotating a native session requires a bound continuation grant.",
    );
  }
  if (typeof input.consumeContinuationToken !== "function") {
    fail(
      "native_continuation_consumer_required",
      "Rotating a native session requires an atomic consumed-once token store.",
    );
  }
  const grant = (
    await verifyNativeAgentContinuationGrant(input.continuation.grant)
  ).grant;
  assertGrantBindings(grant, currentSnapshot, nextCandidate);
  assertGrantTime(grant, now);
  const presentedHash = sha256Utf8(input.continuation.token);
  if (!equalHash(presentedHash, grant.tokenHash)) {
    fail(
      "native_continuation_token_mismatch",
      "The continuation token does not match the bound grant.",
    );
  }
  const consumed = await consumeContinuationWithTimeout(
    input,
    grant.tokenHash,
    grant,
  );
  if (consumed !== true) {
    fail(
      "native_continuation_replayed",
      "The continuation token was already consumed or could not be consumed atomically.",
    );
  }

  const body = snapshotBody(nextCandidate, {
    identityRef: currentSnapshot.identityRef,
    previousSnapshotHash: currentSnapshot.snapshotHash,
  });
  const snapshot = deepFreeze({
    ...body,
    snapshotHash: contentHash(body),
  });
  await verifyNativeAgentIdentitySnapshot(snapshot);
  return deepFreeze({
    status: "ready",
    continuity: "rotate",
    hostChanged:
      contentHash(currentSnapshot.host) !== contentHash(nextCandidate.host),
    writable: true,
    snapshot,
  });
}
