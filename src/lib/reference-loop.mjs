import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import referenceValidators from "./reference-schema-validators.cjs";

const {
  validateDesignRule,
  validateExternalReferenceRun,
  validateReferenceObservation,
  validateReferenceProfileManifest,
  validateReferenceScoreReceipt,
} = referenceValidators;

const STORE_ROOT = path.join(".nodekit", "references");
const CORPUS_ROOT = path.join("reference", "corpus");
const REFERENCE_TRUST_POLICY_FILE = "reference/trust-policy.json";
const REFERENCE_PROFILE_ROOT = "reference/profiles";
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_CANDIDATE_EVALUATIONS = 500;
const MAX_EXTERNAL_RUN_RECORDS = 500;
const MAX_EXTERNAL_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTESTATION_SKEW_MS = 5 * 60 * 1000;
const SERVICE_ATTESTATION_DOMAIN = "NODEKIT_REFERENCE_SERVICE_ATTESTATION_V1";
const HUMAN_ATTESTATION_DOMAIN = "NODEKIT_REFERENCE_HUMAN_ATTESTATION_V1";
const HUMAN_OVERRIDE_SUBJECT_SCHEMA = "nodekit.reference-human-override-subject/v1";
const RENDER_RECEIPT_SCHEMA = "nodekit.reference-render-receipt/v1";
const MOBBIN_ATTESTATION_PURPOSE = "mobbin-external-reference-run";
const HUMAN_OVERRIDE_PURPOSE = "reference-score-override";
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const BANNED_TAGS = new Set(["clean", "beautiful", "modern", "premium", "good ux"]);
const FORBIDDEN_MOBBIN_KEYS = new Set([
  "pixelpath",
  "screenshotpath",
  "imagebase64",
  "cachedscreenshoturl",
  "ocrtext",
  "domsnapshot",
  "embedding",
  "vectorid",
  "cachedresponsebody",
  "trainingused",
  "ragindexed",
  "sourcehtml",
  "sourcecontent",
  "rawpayload",
  "screenshot",
  "image",
  "cachekey",
]);
const OBSERVATION_SCHEMA = "nodekit.reference-loop-observation.v1.schema.json";
const RULE_SCHEMA = "nodekit.reference-loop-design-rule.v1.schema.json";
const SCORE_SCHEMA = "nodekit.reference-score-receipt.v1.schema.json";
const EXTERNAL_RUN_SCHEMA = "nodekit.external-reference-run.v1.schema.json";
const PROFILE_MANIFEST_SCHEMA = "nodekit.reference-profile-manifest.v1.schema.json";
const REFERENCE_VALIDATORS = new Map([
  [OBSERVATION_SCHEMA, validateReferenceObservation],
  [RULE_SCHEMA, validateDesignRule],
  [SCORE_SCHEMA, validateReferenceScoreReceipt],
  [EXTERNAL_RUN_SCHEMA, validateExternalReferenceRun],
  [PROFILE_MANIFEST_SCHEMA, validateReferenceProfileManifest],
]);
const execFileAsync = promisify(execFile);

export class ReferenceLoopError extends Error {
  constructor(code, message, exitCode = 5) {
    super(`${code}: ${message}`);
    this.name = "ReferenceLoopError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("REFERENCE_INVALID", "reference records require finite JSON numbers");
    return JSON.stringify(value);
  }
  if (["undefined", "bigint", "function", "symbol"].includes(typeof value)) {
    fail("REFERENCE_INVALID", `reference records cannot contain ${typeof value}`);
  }
  if (seen.has(value)) fail("REFERENCE_INVALID", "reference records cannot contain cycles");
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      keys.length !== value.length
      || keys.some((key, index) => key !== String(index))
    ) {
      fail("REFERENCE_INVALID", "reference record arrays cannot be sparse or carry named properties");
    }
    output = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("REFERENCE_INVALID", "reference records require plain JSON objects");
    }
    output = `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`,
    ).join(",")}}`;
  }
  seen.delete(value);
  return output;
}

export function referenceContentDigest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function fail(code, message, exitCode = 5) {
  throw new ReferenceLoopError(code, message, exitCode);
}

function normalizedTag(value) {
  return String(value).trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function assertTags(record) {
  for (const key of ["problemTags", "intentTags", "layoutTags", "interactionTags"]) {
    const tags = record[key];
    if (!Array.isArray(tags) || tags.length === 0) fail("REFERENCE_INVALID", `${key} must be non-empty`);
    const normalized = tags.map(normalizedTag);
    if (new Set(normalized).size !== normalized.length) fail("REFERENCE_INVALID", `${key} contains duplicates`);
    const banned = normalized.filter((tag) => BANNED_TAGS.has(tag));
    if (banned.length) fail("REFERENCE_INVALID", `${key} contains appearance-only tags: ${banned.join(", ")}`);
  }
}

function assertCanonicalInstant(value, label) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("REFERENCE_INVALID", `${label} must be a canonical ISO timestamp`);
  }
}

function findMobbinPolicyViolation(value, trail = []) {
  if (
    typeof value === "string"
    && (
      value.startsWith("data:image/")
      || /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(value)
      || /(?:^|[/_.-])screenshots?(?:[/_.?#-]|$)/i.test(value)
    )
  ) return trail.join(".") || "value";
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_MOBBIN_KEYS.has(normalized)) return [...trail, key].join(".");
    if (
      ["storedpixels", "cachedsourcepayload", "embeddingstored"].includes(normalized)
      && child !== false
    ) {
      return [...trail, key].join(".");
    }
    const nested = findMobbinPolicyViolation(child, [...trail, key]);
    if (nested) return nested;
  }
  return null;
}

function stripDerived(value, idField) {
  const { [idField]: suppliedId, contentDigest: suppliedDigest, ...body } = structuredClone(value);
  return { body, suppliedId, suppliedDigest };
}

function derivedRecord(value, idField, prefix) {
  const { body, suppliedId, suppliedDigest } = stripDerived(value, idField);
  const contentDigest = referenceContentDigest(body);
  const id = `${prefix}_${contentDigest.slice(0, 24)}`;
  if (suppliedDigest !== undefined && suppliedDigest !== contentDigest) {
    fail("REFERENCE_BINDING_INVALID", `${idField} contentDigest is stale`);
  }
  if (suppliedId !== undefined && suppliedId !== id) {
    fail("REFERENCE_BINDING_INVALID", `${idField} is not content-addressed`);
  }
  return { ...body, [idField]: id, contentDigest };
}

export function buildReferenceObservation(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    fail("REFERENCE_INVALID", "observation must be an object");
  }
  const source = draft.source;
  if (!source || typeof source !== "object") fail("REFERENCE_INVALID", "observation source is required");
  if (source.origin === "mobbin") {
    const violation = findMobbinPolicyViolation(draft);
    if (violation) fail("SOURCE_POLICY_VIOLATION", `Mobbin material is prohibited at ${violation}`);
    if (
      source.sourcePolicyId !== "atlas:mobbin/v1"
      || source.accessMode !== "remote-mcp"
      || !/^https:\/\/([a-z0-9-]+\.)?mobbin\.com\//i.test(String(source.sourceUrl ?? ""))
    ) {
      fail("SOURCE_POLICY_VIOLATION", "Mobbin observations require the attributed remote-MCP policy");
    }
  }
  assertCanonicalInstant(source.firstSeenAt, "source.firstSeenAt");
  assertCanonicalInstant(source.lastVerifiedAt, "source.lastVerifiedAt");
  if (Date.parse(source.firstSeenAt) > Date.parse(source.lastVerifiedAt)) {
    fail("REFERENCE_INVALID", "source.firstSeenAt must not follow source.lastVerifiedAt");
  }
  assertTags(draft);
  if (!Array.isArray(draft.facts) || draft.facts.length === 0) {
    fail("REFERENCE_INVALID", "an observation requires atomic facts");
  }
  const factIds = draft.facts.map((fact) => String(fact?.factId ?? ""));
  if (factIds.some((id) => !id) || new Set(factIds).size !== factIds.length) {
    fail("REFERENCE_INVALID", "atomic fact ids must be present and unique");
  }
  return derivedRecord(draft, "observationId", "observation");
}

export function buildDesignRule(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    fail("REFERENCE_INVALID", "design rule must be an object");
  }
  assertTags(draft);
  if (!Array.isArray(draft.sourceObservationRefs) || draft.sourceObservationRefs.length === 0) {
    fail("OBSERVATION_BINDING_INVALID", "a design rule requires an observation digest");
  }
  for (const ref of draft.sourceObservationRefs) {
    if (!ref?.observationId || !DIGEST.test(String(ref.observationDigest ?? ""))) {
      fail("OBSERVATION_BINDING_INVALID", "a design rule observation reference is incomplete");
    }
    if (!Array.isArray(ref.factIds) || ref.factIds.length === 0) {
      fail("OBSERVATION_BINDING_INVALID", "a design rule must cite atomic fact ids");
    }
  }
  return derivedRecord(draft, "ruleId", "rule");
}

function externalRunUnsignedBody(draft) {
  const {
    runId: _runId,
    subjectDigest: _subjectDigest,
    contentDigest: _contentDigest,
    attestation: _attestation,
    ...body
  } = structuredClone(draft);
  return body;
}

export function referenceExternalRunSubjectDigest(draft) {
  return referenceContentDigest(externalRunUnsignedBody(draft));
}

function serviceAttestationStatement(attestation) {
  return {
    domain: SERVICE_ATTESTATION_DOMAIN,
    purpose: attestation?.purpose,
    keyId: attestation?.keyId,
    subjectDigest: attestation?.subjectDigest,
    signedAt: attestation?.signedAt,
  };
}

export function referenceServiceAttestationSigningBytes(attestation) {
  return Buffer.from(canonical(serviceAttestationStatement(attestation)), "utf8");
}

function humanAttestationStatement(attestation) {
  return {
    domain: HUMAN_ATTESTATION_DOMAIN,
    purpose: attestation?.purpose,
    keyId: attestation?.keyId,
    subjectDigest: attestation?.subjectDigest,
    decision: attestation?.decision,
    reasonDigest: attestation?.reasonDigest,
    signedAt: attestation?.signedAt,
  };
}

export function referenceHumanAttestationSigningBytes(attestation) {
  return Buffer.from(canonical(humanAttestationStatement(attestation)), "utf8");
}

function humanOverrideSubjectBody(input) {
  const profile = String(input?.profile ?? "").trim();
  const decision = input?.decision;
  const reason = String(input?.reason ?? "");
  const candidateReceiptDigest = String(input?.candidateReceiptDigest ?? "");
  if (
    !profile
    || !DIGEST.test(candidateReceiptDigest)
    || !Array.isArray(input?.rules)
    || input.rules.length === 0
    || !input?.coverage
    || typeof input.coverage !== "object"
    || Array.isArray(input.coverage)
    || !["pass", "fail", "incomplete"].includes(input?.baseVerdict)
    || !["accept", "reject"].includes(decision)
    || !reason.trim()
  ) {
    fail("REFERENCE_OVERRIDE_INVALID", "human override subject context is incomplete");
  }
  return {
    schemaVersion: HUMAN_OVERRIDE_SUBJECT_SCHEMA,
    profile,
    candidateReceiptDigest,
    rules: structuredClone(input.rules),
    coverage: structuredClone(input.coverage),
    baseVerdict: input.baseVerdict,
    decision,
    reason,
    reasonDigest: referenceContentDigest(reason),
  };
}

export function referenceHumanOverrideSubjectDigest(input) {
  return referenceContentDigest(humanOverrideSubjectBody(input));
}

export function buildExternalReferenceRun(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "external reference run must be an object");
  }
  if (draft.status === "pass" && !draft.attestation) {
    fail(
      "EXTERNAL_REFERENCE_NOT_READY",
      "a PASS external reference run requires a detached service attestation",
    );
  }
  const unsignedBody = externalRunUnsignedBody(draft);
  const subjectDigest = referenceContentDigest(unsignedBody);
  const runId = `external_run_${subjectDigest.slice(0, 24)}`;
  if (draft.subjectDigest !== undefined && draft.subjectDigest !== subjectDigest) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "external reference run subject digest is stale");
  }
  if (draft.runId !== undefined && draft.runId !== runId) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "external reference run id is not content-addressed");
  }
  if (
    draft.attestation?.subjectDigest !== undefined
    && draft.attestation.subjectDigest !== subjectDigest
  ) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "external reference attestation binds a different subject");
  }
  const body = {
    ...unsignedBody,
    runId,
    subjectDigest,
    ...(draft.attestation ? { attestation: structuredClone(draft.attestation) } : {}),
  };
  const contentDigest = referenceContentDigest(body);
  if (draft.contentDigest !== undefined && draft.contentDigest !== contentDigest) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "external reference run content digest is stale");
  }
  return { ...body, contentDigest };
}

function storePaths(repoRoot) {
  const root = path.resolve(repoRoot, STORE_ROOT);
  const corpus = path.resolve(repoRoot, CORPUS_ROOT);
  return {
    root,
    corpus,
    observations: path.join(corpus, "observations"),
    rules: path.join(corpus, "rules"),
    scores: path.join(root, "scores"),
    externalRuns: path.join(corpus, "external-runs"),
  };
}

export async function initializeReferenceStore(repoRoot) {
  const store = storePaths(repoRoot);
  await Promise.all([
    mkdir(store.observations, { recursive: true }),
    mkdir(store.rules, { recursive: true }),
    mkdir(store.scores, { recursive: true }),
    mkdir(store.externalRuns, { recursive: true }),
  ]);
  return { referenceRoot: STORE_ROOT.replaceAll("\\", "/") };
}

function referenceSchemaFindings(schema, value, label) {
  const validator = REFERENCE_VALIDATORS.get(schema);
  if (!validator) fail("REFERENCE_INVALID", `unknown reference schema: ${schema}`);
  return validator(value)
    ? []
    : (validator.errors ?? []).map(
      (entry) => `${label}${entry.instancePath || "/"} ${entry.message}`,
    );
}

async function validateOrFail(schema, value, label, code = "REFERENCE_INVALID") {
  const findings = referenceSchemaFindings(schema, value, label);
  if (findings.length) fail(code, findings.join("; "));
}

async function writeImmutable(directory, record, label) {
  const output = path.join(directory, `${record.contentDigest}.json`);
  const serialized = `${canonical(record)}\n`;
  try {
    await writeFile(output, serialized, { encoding: "utf8", flag: "wx" });
    return { duplicate: false, output };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(output, "utf8");
    if (existing !== serialized) fail("REFERENCE_BINDING_INVALID", `${label} digest path contains different bytes`);
    return { duplicate: true, output };
  }
}

async function readJson(target, label) {
  const bytes = await readFile(target);
  if (bytes.length > MAX_RECORD_BYTES) fail("REFERENCE_INVALID", `${label} exceeds ${MAX_RECORD_BYTES} bytes`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("REFERENCE_INVALID", `${label} is not valid JSON`);
  }
}

async function readTrackedRepositoryJson(
  repoRoot,
  suppliedPath,
  label,
  missingCode = "REFERENCE_BINDING_INVALID",
  revision = "HEAD",
) {
  const relativePath = canonicalRepositoryPath(suppliedPath, `${label} path`);
  const absolutePath = resolveInsideRepository(repoRoot, relativePath, label);
  let metadata;
  let bytes;
  try {
    metadata = await lstat(absolutePath);
    bytes = await readFile(absolutePath);
  } catch {
    fail(missingCode, `${relativePath} is absent`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail("REFERENCE_BINDING_INVALID", `${relativePath} must be a regular tracked file`);
  }
  if (bytes.length > MAX_RECORD_BYTES) {
    fail("REFERENCE_BINDING_INVALID", `${label} exceeds ${MAX_RECORD_BYTES} bytes`);
  }
  const headBytes = await gitFileAtHead(repoRoot, relativePath, revision);
  if (!bytes.equals(headBytes)) {
    fail("REFERENCE_BINDING_INVALID", `${relativePath} differs from Git HEAD`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("REFERENCE_BINDING_INVALID", `${label} is not valid JSON`);
  }
  return {
    value,
    path: relativePath,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

function assertMobbinProvider(provider) {
  if (provider !== "mobbin") fail("REFERENCE_INVALID", `unsupported reference provider: ${provider}`);
}

async function readReferenceTrustPolicy(repoRoot, revision = "HEAD") {
  const binding = await readTrackedRepositoryJson(
    repoRoot,
    REFERENCE_TRUST_POLICY_FILE,
    "reference trust policy",
    "EXTERNAL_REFERENCE_NOT_READY",
    revision,
  );
  const policy = binding.value;
  if (
    policy?.schemaVersion !== "nodekit.reference-trust-policy/v1"
    || !policy.credentials
    || typeof policy.credentials !== "object"
    || Array.isArray(policy.credentials)
  ) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "reference trust policy is invalid");
  }
  return { ...binding, policy };
}

async function readReferenceProfileManifest(repoRoot, profile, revision = "HEAD") {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(profile)) {
    fail("REFERENCE_INVALID", "scoring profile must be a safe lowercase manifest id");
  }
  const manifestPath = path.posix.join(
    REFERENCE_PROFILE_ROOT.replaceAll("\\", "/"),
    `${profile}.json`,
  );
  const binding = await readTrackedRepositoryJson(
    repoRoot,
    manifestPath,
    "reference profile manifest",
    "REFERENCE_BINDING_INVALID",
    revision,
  );
  await validateOrFail(
    PROFILE_MANIFEST_SCHEMA,
    binding.value,
    "reference profile manifest",
    "REFERENCE_BINDING_INVALID",
  );
  if (binding.value.profile !== profile) {
    fail("REFERENCE_BINDING_INVALID", "reference profile manifest id does not match the requested profile");
  }
  const ruleIds = binding.value.rules.map((entry) => entry.ruleId);
  if (new Set(ruleIds).size !== ruleIds.length) {
    fail("REFERENCE_BINDING_INVALID", "reference profile manifest rule ids must be unique");
  }
  return { ...binding, manifest: binding.value };
}

async function verifyServiceAttestation(repoRoot, run, revision = "HEAD") {
  const { policy } = await readReferenceTrustPolicy(repoRoot, revision);
  const attestation = run.attestation;
  const credential = policy.credentials[attestation?.keyId];
  if (
    !credential
    || credential.algorithm !== "Ed25519"
    || !["S2", "S3"].includes(credential.assurance)
    || !Array.isArray(credential.purposes)
    || !credential.purposes.includes(MOBBIN_ATTESTATION_PURPOSE)
    || !Array.isArray(credential.producers)
    || !credential.producers.includes(`${run.producer.tool}@${run.producer.version}`)
  ) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "Mobbin producer is not authorized by the pinned service policy");
  }
  let key;
  try {
    key = createPublicKey(credential.publicKey);
  } catch {
    fail("EXTERNAL_REFERENCE_NOT_READY", "pinned Mobbin service public key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail("EXTERNAL_REFERENCE_NOT_READY", "pinned Mobbin service key must be Ed25519");
  }
  const signature = Buffer.from(String(attestation.signature ?? ""), "base64url");
  if (
    signature.length !== 64
    || signature.toString("base64url") !== attestation.signature
    || !verifySignature(
      null,
      referenceServiceAttestationSigningBytes(attestation),
      key,
      signature,
    )
  ) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "Mobbin service attestation signature verification failed");
  }
}

async function verifyHumanOverrideAttestation(repoRoot, humanOverride, scoreContext) {
  const attestation = humanOverride?.attestation;
  const reasonDigest = referenceContentDigest(String(humanOverride?.reason ?? ""));
  const expectedSubjectDigest = referenceHumanOverrideSubjectDigest({
    ...scoreContext,
    decision: humanOverride?.decision,
    reason: humanOverride?.reason,
  });
  if (
    !humanOverride
    || !["accept", "reject"].includes(humanOverride.decision)
    || !String(humanOverride.reason ?? "").trim()
    || humanOverride.reasonDigest !== reasonDigest
    || humanOverride.subjectDigest !== expectedSubjectDigest
    || attestation?.schemaVersion !== "nodekit.reference-human-attestation/v1"
    || attestation.purpose !== HUMAN_OVERRIDE_PURPOSE
    || attestation.subjectDigest !== expectedSubjectDigest
    || attestation.decision !== humanOverride.decision
    || attestation.reasonDigest !== reasonDigest
    || attestation.algorithm !== "Ed25519"
    || attestation.signatureEncoding !== "base64url"
  ) {
    fail(
      "REFERENCE_OVERRIDE_INVALID",
      "human override is not bound to the exact pre-override score, reason, and decision",
    );
  }
  assertCanonicalInstant(attestation.signedAt, "human override signedAt");
  if (Date.parse(attestation.signedAt) > Date.now() + MAX_ATTESTATION_SKEW_MS) {
    fail("REFERENCE_OVERRIDE_INVALID", "human override attestation is unacceptably far in the future");
  }
  const { policy } = await readReferenceTrustPolicy(repoRoot);
  const credential = policy.credentials[attestation.keyId];
  if (
    !credential
    || credential.algorithm !== "Ed25519"
    || !["H2", "H3"].includes(credential.assurance)
    || !Array.isArray(credential.purposes)
    || !credential.purposes.includes(HUMAN_OVERRIDE_PURPOSE)
  ) {
    fail("REFERENCE_OVERRIDE_INVALID", "human override credential is not an authorized H2/H3 key");
  }
  let key;
  try {
    key = createPublicKey(credential.publicKey);
  } catch {
    fail("REFERENCE_OVERRIDE_INVALID", "human override public key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail("REFERENCE_OVERRIDE_INVALID", "human override key must be Ed25519");
  }
  const signature = Buffer.from(String(attestation.signature ?? ""), "base64url");
  if (
    signature.length !== 64
    || signature.toString("base64url") !== attestation.signature
    || !verifySignature(
      null,
      referenceHumanAttestationSigningBytes(attestation),
      key,
      signature,
    )
  ) {
    fail("REFERENCE_OVERRIDE_INVALID", "human override signature verification failed");
  }
  return true;
}

function externalRunObservationFindings(run, observation) {
  const expectedRemoteObjectId = new URL(run.sourceUrl).pathname.split("/").filter(Boolean).at(-1);
  const expectedProhibitedMaterial = {
    storedPixels: false,
    cachedSourcePayload: false,
    embeddingStored: false,
    ragIndexed: false,
    trainingUsed: false,
  };
  const findings = [];
  if (run.checkedAt !== observation.source.lastVerifiedAt) findings.push("checkedAt");
  if (run.sourceUrl !== observation.source.sourceUrl) findings.push("sourceUrl");
  if (run.remoteObjectId !== expectedRemoteObjectId) findings.push("remoteObjectId");
  if (run.observationId !== observation.observationId) findings.push("observationId");
  if (run.observationDigest !== observation.contentDigest) findings.push("observationDigest");
  if (run.factsDigest !== referenceContentDigest(observation.facts)) findings.push("factsDigest");
  if (canonical(run.prohibitedMaterial) !== canonical(expectedProhibitedMaterial)) {
    findings.push("prohibitedMaterial");
  }
  return findings;
}

async function validateAuthenticatedExternalRun(
  repoRoot,
  inputRun,
  observation,
  now = Date.now(),
  revision = "HEAD",
) {
  const run = buildExternalReferenceRun(inputRun);
  await validateOrFail(
    EXTERNAL_RUN_SCHEMA,
    run,
    "external reference run",
    "EXTERNAL_REFERENCE_NOT_READY",
  );
  if (run.status !== "pass") {
    fail("EXTERNAL_REFERENCE_NOT_READY", run.reasonCode ?? "external reference run did not pass");
  }
  const checkedAt = Date.parse(run.checkedAt);
  const expiresAt = Date.parse(run.expiresAt);
  const signedAt = Date.parse(run.attestation.signedAt);
  if (
    !Number.isFinite(checkedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= checkedAt
    || expiresAt - checkedAt > MAX_EXTERNAL_RUN_TTL_MS
    || now > expiresAt
    || signedAt < checkedAt - MAX_ATTESTATION_SKEW_MS
    || signedAt > now + MAX_ATTESTATION_SKEW_MS
    || signedAt > expiresAt
  ) {
    fail("EXTERNAL_REFERENCE_NOT_READY", "Mobbin service attestation is stale or time-invalid");
  }
  const bindingFindings = externalRunObservationFindings(run, observation);
  if (bindingFindings.length) {
    fail(
      "EXTERNAL_REFERENCE_NOT_READY",
      `Mobbin run does not bind the exact sanitized observation: ${bindingFindings.join(", ")}`,
    );
  }
  await verifyServiceAttestation(repoRoot, run, revision);
  return run;
}

function externalNotRun(provider, reasonCode) {
  return buildExternalReferenceRun({
    schemaVersion: "nodekit.external-reference-run/v1",
    provider,
    operation: "authenticated-live-inspection",
    policyId: "nodekit.mobbin-remote-mcp/v1",
    status: "not-run",
    reasonCode,
  });
}

export async function getExternalReferenceStatus(repoRoot, provider) {
  assertMobbinProvider(provider);
  const store = storePaths(repoRoot);
  let entries;
  try {
    entries = await readdir(store.externalRuns);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return externalNotRun(provider, "VERIFIABLE_SERVICE_ATTESTATION_ABSENT");
  }
  const valid = [];
  for (const name of entries.filter((entry) => DIGEST.test(entry.replace(/\.json$/, ""))).sort()) {
    try {
      const run = await readJson(path.join(store.externalRuns, name), "external reference run");
      const observation = await readJson(
        path.join(store.observations, `${run.observationDigest}.json`),
        "reference observation",
      );
      const rebuiltObservation = buildReferenceObservation(observation);
      if (
        rebuiltObservation.observationId !== observation.observationId
        || rebuiltObservation.contentDigest !== observation.contentDigest
      ) {
        continue;
      }
      valid.push(await validateAuthenticatedExternalRun(repoRoot, run, observation));
    } catch {
      // An invalid, expired, or orphaned receipt can never make status PASS.
    }
  }
  if (!valid.length) {
    return externalNotRun(provider, "VERIFIABLE_SERVICE_ATTESTATION_ABSENT_OR_INVALID");
  }
  valid.sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
  return valid[0];
}

export async function recordReferenceObservation(repoRoot, input) {
  const envelope = input?.observation ? input : { observation: input };
  const observation = buildReferenceObservation(envelope.observation);
  let externalRun = envelope.externalRun;
  await validateOrFail(OBSERVATION_SCHEMA, observation, "reference observation");
  if (observation.source.origin === "mobbin") {
    if (!externalRun) externalRun = await getExternalReferenceStatus(repoRoot, "mobbin");
    externalRun = await validateAuthenticatedExternalRun(repoRoot, externalRun, observation);
  } else if (externalRun) {
    fail("REFERENCE_INVALID", "externalRun is only valid for an external Mobbin observation");
  }
  const store = storePaths(repoRoot);
  await initializeReferenceStore(repoRoot);
  if (externalRun) {
    await writeImmutable(store.externalRuns, externalRun, "external reference run");
  }
  const written = await writeImmutable(store.observations, observation, "reference observation");
  return {
    observation,
    externalRun,
    duplicate: written.duplicate,
    output: path.relative(path.resolve(repoRoot), written.output).replaceAll("\\", "/"),
  };
}

async function readObservationByRef(store, ref) {
  const observation = await readJson(
    path.join(store.observations, `${ref.observationDigest}.json`),
    "reference observation",
  );
  await validateOrFail(OBSERVATION_SCHEMA, observation, "reference observation", "OBSERVATION_BINDING_INVALID");
  const rebuilt = buildReferenceObservation(observation);
  if (
    rebuilt.contentDigest !== ref.observationDigest
    || rebuilt.observationId !== ref.observationId
  ) {
    fail("OBSERVATION_BINDING_INVALID", `observation ${ref.observationId} digest does not close`);
  }
  const facts = new Set(observation.facts.map((fact) => fact.factId));
  if (ref.factIds.some((factId) => !facts.has(factId))) {
    fail("OBSERVATION_BINDING_INVALID", `observation ${ref.observationId} is missing cited facts`);
  }
  return observation;
}

async function verifyRuleBindings(store, rule) {
  for (const ref of rule.sourceObservationRefs) await readObservationByRef(store, ref);
}

function corpusRecordPath(kind, digest) {
  return path.posix.join(
    CORPUS_ROOT.replaceAll("\\", "/"),
    kind,
    `${digest}.json`,
  );
}

async function findTrackedExternalRunForObservation(repoRoot, observation, revision) {
  const externalRunRoot = path.posix.join(
    CORPUS_ROOT.replaceAll("\\", "/"),
    "external-runs",
  );
  const treeOutput = await gitOutput(
    repoRoot,
    ["ls-tree", "-r", "--name-only", revision, "--", externalRunRoot],
    "candidate commit external-run corpus cannot be enumerated",
  );
  const candidatePaths = treeOutput
    ? treeOutput.split(/\r?\n/u).filter(Boolean)
    : [];
  if (candidatePaths.length > MAX_EXTERNAL_RUN_RECORDS) {
    fail(
      "EXTERNAL_REFERENCE_NOT_READY",
      `external reference corpus exceeds ${MAX_EXTERNAL_RUN_RECORDS} records`,
    );
  }
  const matches = [];
  for (const candidatePath of candidatePaths.sort()) {
    const expectedPrefix = `${externalRunRoot}/`;
    if (
      !candidatePath.startsWith(expectedPrefix)
      || candidatePath.slice(expectedPrefix.length).includes("/")
    ) {
      fail(
        "EXTERNAL_REFERENCE_NOT_READY",
        "candidate commit external-run corpus contains a non-canonical path",
      );
    }
    const name = candidatePath.slice(expectedPrefix.length);
    const digest = name.replace(/\.json$/, "");
    if (name !== `${digest}.json` || !DIGEST.test(digest)) {
      fail(
        "EXTERNAL_REFERENCE_NOT_READY",
        "candidate commit external-run corpus contains a non-content-addressed file",
      );
    }
    const binding = await readTrackedRepositoryJson(
      repoRoot,
      candidatePath,
      "external reference run",
      "EXTERNAL_REFERENCE_NOT_READY",
      revision,
    );
    if (
      binding.value?.observationId !== observation.observationId
      || binding.value?.observationDigest !== observation.contentDigest
    ) {
      continue;
    }
    const run = await validateAuthenticatedExternalRun(
      repoRoot,
      binding.value,
      observation,
      Date.now(),
      revision,
    );
    if (run.contentDigest !== digest) {
      fail(
        "EXTERNAL_REFERENCE_NOT_READY",
        `external run ${run.runId} is not stored at its content digest`,
      );
    }
    matches.push(run);
  }
  if (matches.length !== 1) {
    fail(
      "EXTERNAL_REFERENCE_NOT_READY",
      `Mobbin observation ${observation.observationId} requires exactly one tracked valid external run`,
    );
  }
  return matches[0];
}

async function readTrackedObservationByRef(repoRoot, ref, revision) {
  const binding = await readTrackedRepositoryJson(
    repoRoot,
    corpusRecordPath("observations", ref.observationDigest),
    "reference observation",
    "OBSERVATION_BINDING_INVALID",
    revision,
  );
  const observation = binding.value;
  await validateOrFail(
    OBSERVATION_SCHEMA,
    observation,
    "reference observation",
    "OBSERVATION_BINDING_INVALID",
  );
  const rebuilt = buildReferenceObservation(observation);
  if (
    rebuilt.contentDigest !== ref.observationDigest
    || rebuilt.observationId !== ref.observationId
  ) {
    fail(
      "OBSERVATION_BINDING_INVALID",
      `observation ${ref.observationId} digest does not close`,
    );
  }
  const facts = new Set(observation.facts.map((fact) => fact.factId));
  if (ref.factIds.some((factId) => !facts.has(factId))) {
    fail(
      "OBSERVATION_BINDING_INVALID",
      `observation ${ref.observationId} is missing cited facts`,
    );
  }
  if (observation.source.origin === "mobbin") {
    await findTrackedExternalRunForObservation(
      repoRoot,
      observation,
      revision,
    );
  }
  return observation;
}

async function verifyTrackedRuleBindings(repoRoot, rule, revision) {
  for (const ref of rule.sourceObservationRefs) {
    await readTrackedObservationByRef(repoRoot, ref, revision);
  }
}

export async function recordDesignRule(repoRoot, draft) {
  const rule = buildDesignRule(draft);
  await validateOrFail(RULE_SCHEMA, rule, "design rule", "OBSERVATION_BINDING_INVALID");
  const store = storePaths(repoRoot);
  await verifyRuleBindings(store, rule);
  await mkdir(store.rules, { recursive: true });
  const written = await writeImmutable(store.rules, rule, "design rule");
  return {
    rule,
    duplicate: written.duplicate,
    output: path.relative(path.resolve(repoRoot), written.output).replaceAll("\\", "/"),
  };
}

function candidateDigest(candidateReceipt) {
  return referenceContentDigest(candidateReceipt);
}

function canonicalRepositoryPath(value, label) {
  const candidate = String(value ?? "");
  if (
    !candidate
    || candidate.includes("\\")
    || candidate.startsWith("/")
    || /^[A-Za-z]:/.test(candidate)
    || path.posix.normalize(candidate) !== candidate
    || candidate === "."
    || candidate === ".."
    || candidate.startsWith("../")
    || candidate.includes("//")
  ) {
    fail("REFERENCE_INVALID", `${label} must be one canonical repository-relative POSIX path`);
  }
  return candidate;
}

function renderReceiptBody(candidateReceipt) {
  return {
    schemaVersion: RENDER_RECEIPT_SCHEMA,
    candidateId: candidateReceipt.candidateId,
    candidateCommit: candidateReceipt.candidateCommit,
    artifacts: structuredClone(candidateReceipt.renderArtifacts),
  };
}

export function referenceRenderReceiptDigest(candidateReceipt) {
  return referenceContentDigest(renderReceiptBody(candidateReceipt));
}

export function buildReferenceCandidateReceipt(candidateReceipt) {
  if (!candidateReceipt || typeof candidateReceipt !== "object" || Array.isArray(candidateReceipt)) {
    fail("REFERENCE_INVALID", "candidate receipt must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(candidateReceipt, "verdict")) {
    fail("REFERENCE_INVALID", "a caller cannot set the reference verdict");
  }
  if (
    candidateReceipt.schemaVersion !== "nodekit.reference-candidate-receipt/v1"
    || !String(candidateReceipt.candidateId ?? "").trim()
    || !COMMIT.test(String(candidateReceipt.candidateCommit ?? ""))
    || !Array.isArray(candidateReceipt.renderArtifacts)
    || candidateReceipt.renderArtifacts.length === 0
    || candidateReceipt.renderArtifacts.length > 1_000
    || !Array.isArray(candidateReceipt.evaluations)
    || candidateReceipt.evaluations.length > MAX_CANDIDATE_EVALUATIONS
  ) {
    fail("REFERENCE_INVALID", "candidate receipt identity or evaluations are invalid");
  }
  const artifactPaths = [];
  for (const artifact of candidateReceipt.renderArtifacts) {
    if (
      !artifact
      || typeof artifact !== "object"
      || Array.isArray(artifact)
      || Object.keys(artifact).sort().join(",") !== "bytes,path,sha256"
      || !DIGEST.test(String(artifact.sha256 ?? ""))
      || !Number.isSafeInteger(artifact.bytes)
      || artifact.bytes < 0
    ) {
      fail("REFERENCE_INVALID", "candidate render artifacts require exact path, sha256, and bytes");
    }
    artifactPaths.push(canonicalRepositoryPath(artifact.path, "candidate render artifact path"));
  }
  if (
    new Set(artifactPaths).size !== artifactPaths.length
    || artifactPaths.some((artifactPath, index) =>
      index > 0 && artifactPaths[index - 1].localeCompare(artifactPath) >= 0)
  ) {
    fail("REFERENCE_INVALID", "candidate render artifacts must be unique and sorted by path");
  }
  const evaluationIds = [];
  for (const entry of candidateReceipt.evaluations) {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "evidenceRefs,factIds,result,ruleId"
      || !/^rule_[0-9a-f]{24}$/u.test(String(entry.ruleId ?? ""))
      || !["satisfied", "violated", "not-observed", "not-applicable"].includes(entry.result)
      || !Array.isArray(entry.factIds)
      || entry.factIds.length > 500
      || entry.factIds.some((factId) => typeof factId !== "string" || factId.length === 0 || factId.length > 200)
      || new Set(entry.factIds).size !== entry.factIds.length
      || !Array.isArray(entry.evidenceRefs)
      || entry.evidenceRefs.length > 500
      || entry.evidenceRefs.some((reference) =>
        typeof reference !== "string" || reference.length === 0 || reference.length > 1_000)
      || new Set(entry.evidenceRefs).size !== entry.evidenceRefs.length
    ) {
      fail("REFERENCE_INVALID", "candidate evaluations require exact bounded rule results and evidence");
    }
    evaluationIds.push(entry.ruleId);
  }
  if (
    new Set(evaluationIds).size !== evaluationIds.length
  ) {
    fail("REFERENCE_INVALID", "candidate evaluations require unique rule ids");
  }
  const renderReceiptDigest = referenceRenderReceiptDigest(candidateReceipt);
  const renderReceiptId = `render_${renderReceiptDigest.slice(0, 24)}`;
  if (
    candidateReceipt.renderReceiptId !== undefined
    && candidateReceipt.renderReceiptId !== renderReceiptId
  ) {
    fail("REFERENCE_INVALID", "candidate render receipt id is stale or not content-addressed");
  }
  const built = {
    ...structuredClone(candidateReceipt),
    renderReceiptId,
  };
  canonical(built);
  return built;
}

async function gitOutput(repoRoot, args, label) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: path.resolve(repoRoot),
      encoding: "utf8",
      maxBuffer: MAX_RECORD_BYTES,
      timeout: 10_000,
      windowsHide: true,
    });
    return String(result.stdout ?? "").trim();
  } catch {
    fail("REFERENCE_BINDING_INVALID", label);
  }
}

async function gitFileAtHead(repoRoot, relativePath, revision = "HEAD") {
  if (revision !== "HEAD" && !COMMIT.test(revision)) {
    fail("REFERENCE_BINDING_INVALID", "repository binding revision is invalid");
  }
  try {
    const result = await execFileAsync("git", ["show", `${revision}:${relativePath}`], {
      cwd: path.resolve(repoRoot),
      encoding: "buffer",
      maxBuffer: MAX_RECORD_BYTES,
      timeout: 10_000,
      windowsHide: true,
    });
    return Buffer.from(result.stdout);
  } catch {
    fail(
      "REFERENCE_BINDING_INVALID",
      `${relativePath} is not tracked at Git HEAD`,
    );
  }
}

async function verifyCandidateRepositoryBinding(repoRoot, candidateReceipt) {
  const head = await gitOutput(
    repoRoot,
    ["rev-parse", "--verify", "HEAD"],
    "candidate repository has no verifiable Git HEAD",
  );
  if (head !== candidateReceipt.candidateCommit) {
    fail("REFERENCE_BINDING_INVALID", "candidate commit is not the repository's current Git HEAD");
  }
  for (const artifact of candidateReceipt.renderArtifacts) {
    const artifactPath = canonicalRepositoryPath(
      artifact.path,
      "candidate render artifact path",
    );
    const absolute = resolveInsideRepository(repoRoot, artifactPath, "candidate render artifact");
    let metadata;
    let bytes;
    try {
      metadata = await lstat(absolute);
      bytes = await readFile(absolute);
    } catch {
      fail("REFERENCE_BINDING_INVALID", `candidate render artifact is missing: ${artifactPath}`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail("REFERENCE_BINDING_INVALID", `candidate render artifact is not a regular file: ${artifactPath}`);
    }
    if (
      bytes.length !== artifact.bytes
      || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
    ) {
      fail("REFERENCE_BINDING_INVALID", `candidate render artifact bytes changed: ${artifactPath}`);
    }
    const headBytes = await gitFileAtHead(repoRoot, artifactPath);
    if (!bytes.equals(headBytes)) {
      fail("REFERENCE_BINDING_INVALID", `candidate render artifact differs from Git HEAD: ${artifactPath}`);
    }
  }
}

function deriveCoverage(rules) {
  return {
    requiredRuleCount: rules.length,
    evaluatedRuleCount: rules.filter((entry) => entry.result !== "not-observed").length,
    satisfiedRuleCount: rules.filter((entry) => entry.result === "satisfied").length,
    violatedRuleCount: rules.filter((entry) => entry.result === "violated").length,
    notObservedCount: rules.filter((entry) => entry.result === "not-observed").length,
    notApplicableCount: rules.filter((entry) => entry.result === "not-applicable").length,
  };
}

function deriveVerdict(coverage) {
  if (coverage.violatedRuleCount > 0) return "fail";
  if (
    coverage.evaluatedRuleCount !== coverage.requiredRuleCount
    || coverage.notObservedCount > 0
    || coverage.notApplicableCount > 0
  ) return "incomplete";
  return "pass";
}

function deriveVerdictWithOverride(coverage, humanOverride) {
  if (!humanOverride) return deriveVerdict(coverage);
  return humanOverride.decision === "accept" ? "pass" : "fail";
}

async function buildScoreRules(repoRoot, store, candidateReceipt, ruleBindings) {
  const evaluations = new Map(candidateReceipt.evaluations.map((entry) => [entry.ruleId, entry]));
  const results = [];
  for (const binding of ruleBindings) {
    const ruleId = binding.ruleId;
    const ruleBinding = await readTrackedRepositoryJson(
      repoRoot,
      corpusRecordPath("rules", binding.ruleDigest),
      "design rule",
      "REFERENCE_BINDING_INVALID",
      candidateReceipt.candidateCommit,
    );
    const rule = ruleBinding.value;
    await validateOrFail(RULE_SCHEMA, rule, "design rule", "REFERENCE_BINDING_INVALID");
    const rebuilt = buildDesignRule(rule);
    if (rebuilt.ruleId !== rule.ruleId || rebuilt.contentDigest !== rule.contentDigest) {
      fail("REFERENCE_BINDING_INVALID", `design rule ${rule.ruleId} digest does not close`);
    }
    if (rule.contentDigest !== binding.ruleDigest) {
      fail("REFERENCE_BINDING_INVALID", `design rule ${rule.ruleId} differs from the profile manifest`);
    }
    await verifyTrackedRuleBindings(
      repoRoot,
      rule,
      candidateReceipt.candidateCommit,
    );
    const evaluation = evaluations.get(ruleId);
    const citableFacts = new Set(rule.sourceObservationRefs.flatMap((ref) => ref.factIds));
    const factIds = [...new Set(evaluation?.factIds ?? [])];
    const evidenceRefs = [...new Set(evaluation?.evidenceRefs ?? [])];
    if (factIds.some((factId) => !citableFacts.has(factId))) {
      fail("REFERENCE_BINDING_INVALID", `evaluation for ${ruleId} cites an unknown atomic fact`);
    }
    const requestedResult = evaluation?.result;
    if (
      requestedResult !== undefined
      && !["satisfied", "violated", "not-observed", "not-applicable"].includes(requestedResult)
    ) {
      fail("REFERENCE_INVALID", `evaluation for ${ruleId} has an invalid result`);
    }
    const requiredEvidence = new Set(rule.requiredEvidence);
    const exactEvidencePresent = evidenceRefs.length > 0
      && [...requiredEvidence].every((reference) => evidenceRefs.includes(reference));
    const fullyObserved = requestedResult === "not-applicable"
      ? Boolean(evaluation && candidateReceipt.novelByIntent === true && exactEvidencePresent)
      : Boolean(evaluation && factIds.length > 0 && exactEvidencePresent);
    results.push({
      ruleId,
      ruleDigest: rule.contentDigest,
      result: fullyObserved ? requestedResult : "not-observed",
      factIds,
      evidenceRefs,
    });
  }
  return results;
}

export async function scoreReferenceCandidate(repoRoot, input) {
  const candidateReceipt = buildReferenceCandidateReceipt(input?.candidateReceipt);
  await verifyCandidateRepositoryBinding(repoRoot, candidateReceipt);
  if (
    !Array.isArray(input?.ruleIds)
    || input.ruleIds.length === 0
    || input.ruleIds.length > MAX_CANDIDATE_EVALUATIONS
  ) {
    fail("REFERENCE_INVALID", "one to 500 ordered reference rule ids are required");
  }
  const ruleIds = [];
  for (const ruleId of input.ruleIds) {
    if (!/^rule_[0-9a-f]{24}$/u.test(String(ruleId ?? ""))) {
      fail("REFERENCE_INVALID", "reference rule ids must be content-addressed rule ids");
    }
    ruleIds.push(ruleId);
  }
  if (new Set(ruleIds).size !== ruleIds.length) {
    fail("REFERENCE_INVALID", "reference rule ids must be unique");
  }
  const profile = String(input?.profile ?? "").trim();
  if (!profile) fail("REFERENCE_INVALID", "a scoring profile is required");
  const profileBinding = await readReferenceProfileManifest(
    repoRoot,
    profile,
    candidateReceipt.candidateCommit,
  );
  const manifestRuleIds = profileBinding.manifest.rules.map((entry) => entry.ruleId);
  if (
    ruleIds.length !== manifestRuleIds.length
    || ruleIds.some((ruleId, index) => ruleId !== manifestRuleIds[index])
  ) {
    fail(
      "REFERENCE_BINDING_INVALID",
      "requested rules must exactly match the profile manifest in order",
    );
  }
  const evaluationRuleIds = candidateReceipt.evaluations.map((entry) => entry.ruleId);
  if (
    evaluationRuleIds.length !== manifestRuleIds.length
    || evaluationRuleIds.some((ruleId, index) => ruleId !== manifestRuleIds[index])
  ) {
    fail(
      "REFERENCE_BINDING_INVALID",
      "candidate evaluations must exactly match the profile manifest in order",
    );
  }
  const trustPolicyBinding = await readReferenceTrustPolicy(
    repoRoot,
    candidateReceipt.candidateCommit,
  );
  const store = storePaths(repoRoot);
  const rules = await buildScoreRules(
    repoRoot,
    store,
    candidateReceipt,
    profileBinding.manifest.rules,
  );
  const coverage = deriveCoverage(rules);
  const renderReceiptDigest = referenceRenderReceiptDigest(candidateReceipt);
  const candidateReceiptDigest = candidateDigest(candidateReceipt);
  const baseVerdict = deriveVerdict(coverage);
  const humanOverride = input.humanOverride
    ? structuredClone(input.humanOverride)
    : undefined;
  if (humanOverride) {
    await verifyHumanOverrideAttestation(repoRoot, humanOverride, {
      profile,
      candidateReceiptDigest,
      rules,
      coverage,
      baseVerdict,
    });
  }
  const body = {
    schemaVersion: "nodekit.reference-score-receipt/v1",
    profile,
    profileManifest: {
      path: profileBinding.path,
      digest: profileBinding.digest,
    },
    trustPolicy: {
      path: trustPolicyBinding.path,
      digest: trustPolicyBinding.digest,
    },
    candidate: {
      candidateId: candidateReceipt.candidateId,
      renderReceiptId: candidateReceipt.renderReceiptId,
      renderReceiptDigest,
      candidateReceiptDigest,
      candidateCommit: candidateReceipt.candidateCommit,
    },
    rules,
    coverage,
    ...(humanOverride ? { humanOverride } : {}),
    verdict: deriveVerdictWithOverride(coverage, humanOverride),
  };
  const score = derivedRecord(body, "receiptId", "score");
  await validateOrFail(SCORE_SCHEMA, score, "reference score receipt");
  await mkdir(store.scores, { recursive: true });
  const written = await writeImmutable(store.scores, score, "reference score receipt");
  return {
    score,
    duplicate: written.duplicate,
    output: path.relative(path.resolve(repoRoot), written.output).replaceAll("\\", "/"),
  };
}

export async function verifyReferenceScoreReceipt(repoRoot, scoreOrPath, context = {}) {
  const findings = [];
  let score;
  try {
    score = typeof scoreOrPath === "string"
      ? await readJson(resolveInsideRepository(repoRoot, scoreOrPath, "reference score receipt"), "reference score receipt")
      : structuredClone(scoreOrPath);
    const schemaFindings = referenceSchemaFindings(SCORE_SCHEMA, score, "reference score receipt");
    findings.push(...schemaFindings);
    const rebuilt = derivedRecord(score, "receiptId", "score");
    if (rebuilt.receiptId !== score.receiptId || rebuilt.contentDigest !== score.contentDigest) {
      findings.push("score receipt digest does not close");
    }
    const store = storePaths(repoRoot);
    const profileBinding = await readReferenceProfileManifest(
      repoRoot,
      score.profile,
      score.candidate.candidateCommit,
    );
    const trustPolicyBinding = await readReferenceTrustPolicy(
      repoRoot,
      score.candidate.candidateCommit,
    );
    if (
      score.profileManifest.path !== profileBinding.path
      || score.profileManifest.digest !== profileBinding.digest
    ) {
      findings.push("profile manifest binding changed");
    }
    if (
      score.trustPolicy.path !== trustPolicyBinding.path
      || score.trustPolicy.digest !== trustPolicyBinding.digest
    ) {
      findings.push("reference trust policy binding changed");
    }
    const scoredRuleIds = score.rules.map((entry) => entry.ruleId);
    if (new Set(scoredRuleIds).size !== scoredRuleIds.length) {
      findings.push("score rule ids are not unique");
    }
    if (
      score.rules.length !== profileBinding.manifest.rules.length
      || score.rules.some((entry, index) =>
        entry.ruleId !== profileBinding.manifest.rules[index].ruleId
        || entry.ruleDigest !== profileBinding.manifest.rules[index].ruleDigest)
    ) {
      findings.push("score rules do not exactly match the ordered profile manifest");
    }
    for (const scoredRule of score.rules) {
      const ruleBinding = await readTrackedRepositoryJson(
        repoRoot,
        corpusRecordPath("rules", scoredRule.ruleDigest),
        "design rule",
        "REFERENCE_BINDING_INVALID",
        score.candidate.candidateCommit,
      );
      const rule = ruleBinding.value;
      await validateOrFail(
        RULE_SCHEMA,
        rule,
        "design rule",
        "REFERENCE_BINDING_INVALID",
      );
      const rebuiltRule = buildDesignRule(rule);
      if (
        rebuiltRule.ruleId !== scoredRule.ruleId
        || rebuiltRule.contentDigest !== scoredRule.ruleDigest
      ) {
        findings.push(`design rule ${scoredRule.ruleId} digest does not close`);
      }
      await verifyTrackedRuleBindings(
        repoRoot,
        rule,
        score.candidate.candidateCommit,
      );
    }
    const coverage = deriveCoverage(score.rules);
    if (canonical(coverage) !== canonical(score.coverage)) findings.push("coverage is not derived");
    const baseVerdict = deriveVerdict(coverage);
    if (score.humanOverride) {
      await verifyHumanOverrideAttestation(
        repoRoot,
        score.humanOverride,
        {
          profile: score.profile,
          candidateReceiptDigest: score.candidate.candidateReceiptDigest,
          rules: score.rules,
          coverage,
          baseVerdict,
        },
      );
    }
    if (deriveVerdictWithOverride(coverage, score.humanOverride) !== score.verdict) {
      findings.push("verdict is not derived");
    }
    if (!context.candidateReceipt) {
      findings.push("the exact current candidate receipt is required");
    } else {
      const candidateReceipt = buildReferenceCandidateReceipt(context.candidateReceipt);
      await verifyCandidateRepositoryBinding(repoRoot, candidateReceipt);
      const candidateRuleIds = candidateReceipt.evaluations.map((entry) => entry.ruleId);
      const manifestRuleIds = profileBinding.manifest.rules.map((entry) => entry.ruleId);
      if (
        candidateRuleIds.length !== manifestRuleIds.length
        || candidateRuleIds.some((ruleId, index) => ruleId !== manifestRuleIds[index])
      ) {
        findings.push("candidate evaluations do not exactly match the ordered profile manifest");
      }
      const replayedRules = await buildScoreRules(
        repoRoot,
        store,
        candidateReceipt,
        profileBinding.manifest.rules,
      );
      if (canonical(replayedRules) !== canonical(score.rules)) {
        findings.push("score rules are not derived from the exact candidate receipt");
      }
      if (
        referenceRenderReceiptDigest(candidateReceipt) !== score.candidate.renderReceiptDigest
        || candidateDigest(candidateReceipt) !== score.candidate.candidateReceiptDigest
        || candidateReceipt.candidateId !== score.candidate.candidateId
        || candidateReceipt.renderReceiptId !== score.candidate.renderReceiptId
        || candidateReceipt.candidateCommit !== score.candidate.candidateCommit
      ) {
        findings.push("candidate render receipt or commit changed");
      }
    }
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const verdict = findings.length ? "fail" : score.verdict;
  return { verdict, passed: verdict === "pass", findings };
}

function resolveInsideRepository(repoRoot, candidate, label) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, String(candidate));
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("REFERENCE_INVALID", `${label} must stay inside the repository`);
  }
  return absolute;
}
