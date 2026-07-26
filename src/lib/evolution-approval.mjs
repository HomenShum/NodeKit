import { createHash, createPublicKey, createPrivateKey, sign, verify as verifySignature } from "node:crypto";

/**
 * Promotion of an evolution event to canonical history.
 *
 * WHY THIS EXISTS
 *
 * `evolution draft` wrote `interpretation.status: "human-reviewed"` unconditionally, and
 * `evolution record` promoted any record carrying that value. The gate read a field the caller
 * wrote. Two commands took an agent from nothing to canonical, human-attested history with no
 * human involved, proven end to end on 2026-07-26.
 *
 * The rule this breaks is the oldest one in the project: the agent proposes, the agent does not
 * approve.
 *
 * THE PRIMITIVE IS NOT JUST A SIGNATURE
 *
 * A signature proves control of a credential. It does not prove a human acted. A private key in the
 * repository, the environment, the home directory, or an agent-reachable keychain changes nothing —
 * the agent signs its own proposal and the ledger reads as attested.
 *
 * The trust boundary does not need to be a different machine. It must be a different PROTECTION
 * DOMAIN. That distinction is what the trust levels below encode, and why a level is recorded on
 * every promotion rather than assumed.
 *
 *   H0  unsigned, development only            not human-attested
 *   H1  exportable software key               credential-attested
 *   H2  OS-backed credential, user verified   human-presence attested
 *   H3  hardware or remote signer, user verified   strong human-presence attested
 *
 * A protected ledger requires H2 or H3. There is NO silent fallback: a weaker level does not
 * quietly satisfy a stronger requirement, and the level reached is stated on the receipt so a
 * reader never has to assume which one applied.
 *
 * ALGORITHM NEUTRAL ON PURPOSE
 *
 * Ed25519 is the first implementation, not the contract. Platform passkeys and hardware
 * authenticators sign with other algorithms, and binding the schema to one of them would force
 * every future credential back down to an exportable software key — the weakest level — to stay
 * compatible. New algorithms register here; nothing else changes.
 */

/** Refusal of authority. Carries exit 5 so a caller can tell it from an ordinary failure. */
export class ApprovalRefused extends Error {
  constructor(message) { super(message); this.name = "ApprovalRefused"; this.exitCode = 5; }
}

const APPROVAL_SCHEMA = "nodekit.evolution-approval/v1";
const ATTESTATION_SCHEMA = "nodekit.evolution-detached-attestation/v1";
// Its own domain and purpose. A signature trusted to promote a repair must not also promote a
// ledger event; reusing a domain is privilege escalation by accident.
const DOMAIN = "nodekit.evolution-canonical-promotion.v1\n";
const PURPOSE = "evolution-canonical-promotion";

export const TRUST_LEVELS = Object.freeze({
  H0: { rank: 0, meaning: "unsigned development approval; NOT human-attested" },
  H1: { rank: 1, meaning: "exportable software key; credential-attested only" },
  H2: { rank: 2, meaning: "OS-backed credential with user verification; human-presence attested" },
  H3: { rank: 3, meaning: "hardware or remote signer with user verification; strong human-presence attested" },
});

/** Registry keyed by algorithm name. Add an entry to support a new authenticator. */
const ALGORITHMS = Object.freeze({
  Ed25519: {
    expectedKeyType: "ed25519",
    signatureBytes: 64,
    verify(publicKey, bytes, signature) { return verifySignature(null, bytes, publicKey, signature); },
    sign(privateKey, bytes) { return sign(null, bytes, privateKey); },
  },
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/**
 * What is actually being approved. `interpretation` is excluded deliberately: it is the FIELD the
 * approval derives, so including it would let a reviewer's signature cover the very claim the
 * signature is supposed to establish.
 */
export function approvalSubject(event) {
  const { interpretation, ...subject } = event ?? {};
  return hash(subject);
}

/** Binds the exact evidence set. Swapping evidence after approval must invalidate it. */
export function evidenceManifestHash(evidenceIds) {
  return hash([...(evidenceIds ?? [])].sort());
}

function approvalBody(input) {
  const required = ["repositoryId", "eventId", "subjectHash", "evidenceManifestHash", "commitSha",
    "reviewerCredentialId", "trustPolicyVersion", "nonce", "issuedAt", "expiresAt"];
  for (const field of required) {
    if (!String(input?.[field] ?? "").trim()) throw new Error(`evolution approval must carry ${field}`);
  }
  if (!/^[a-f0-9]{64}$/.test(input.subjectHash)) throw new Error("subjectHash must be a sha256 hex digest");
  if (Number.isNaN(Date.parse(input.issuedAt))) throw new Error("evolution approval issuedAt is not a valid time");
  if (Number.isNaN(Date.parse(input.expiresAt))) throw new Error("evolution approval expiresAt is not a valid time");
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) throw new Error("evolution approval expires before it is issued");
  return {
    schemaVersion: APPROVAL_SCHEMA,
    purpose: PURPOSE,
    repositoryId: input.repositoryId,
    projectId: input.projectId ?? "nodekit",
    eventId: input.eventId,
    subjectHash: input.subjectHash,
    evidenceManifestHash: input.evidenceManifestHash,
    commitSha: input.commitSha,
    reviewerCredentialId: input.reviewerCredentialId,
    trustPolicyVersion: input.trustPolicyVersion,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
}

function statementOf({ algorithm, credentialId, payloadSha256, signedAt }) {
  return {
    algorithm,
    credentialId,
    payloadSha256,
    purpose: PURPOSE,
    schemaVersion: ATTESTATION_SCHEMA,
    signatureEncoding: "base64url",
    signedAt,
  };
}

/** The domain prefix is what makes these bytes meaningful only for this purpose. */
function bytesOf(statement) {
  return Buffer.from(`${DOMAIN}${canonical(statement)}`, "utf8");
}

/**
 * Seal an approval. In production the signing half runs inside the authenticator, not here — this
 * exists so the format is testable and so an H1 development credential has a reference signer.
 */
export function sealEvolutionApproval(input, { privateKey, credentialId, algorithm = "Ed25519", signedAt = new Date().toISOString() }) {
  const alg = ALGORITHMS[algorithm];
  if (!alg) throw new Error(`unsupported approval algorithm ${algorithm}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(credentialId ?? "")) throw new Error("approval credentialId is invalid");
  const body = approvalBody({ ...input, reviewerCredentialId: credentialId });
  const approvalHash = hash(body);
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== alg.expectedKeyType) throw new Error(`approval key must be ${algorithm}`);
  const statement = statementOf({ algorithm, credentialId, payloadSha256: approvalHash, signedAt });
  return {
    ...body,
    approvalId: `evolution-approval:sha256:${approvalHash}`,
    approvalHash,
    attestation: { ...statement, signature: alg.sign(key, bytesOf(statement)).toString("base64url") },
  };
}

/**
 * Verify an approval against the draft it claims to approve, and DERIVE the interpretation.
 *
 * Throws on every failure. A caller must not be able to mistake a falsy return for a pass, and
 * must not be able to supply the reviewer or the status — both are returned from here, computed
 * from the verified credential, never read from the record.
 *
 * @param {object} approval
 * @param {object} event the draft being promoted
 * @param {{ policy: object, now?: string, consumedNonces?: Set<string>, requiredTrustLevel?: string }} context
 */
// @nodekit-behavior inv:canonical-promotion-requires-verified-approval owner
export function verifyEvolutionApproval(approval, event, { policy, now = new Date().toISOString(), consumedNonces = new Set(), requiredTrustLevel = "H2" } = {}) {
  if (!approval || approval.schemaVersion !== APPROVAL_SCHEMA) throw new ApprovalRefused("not an evolution approval");
  if (!policy || !policy.credentials) throw new ApprovalRefused("no trust policy: nothing can be promoted without one");

  const { approvalId, approvalHash, attestation, ...body } = approval;

  // Recomputed from the body, so editing any approved field breaks both the hash and the signature.
  const recomputed = hash(approvalBody(body));
  if (recomputed !== approvalHash || approvalId !== `evolution-approval:sha256:${recomputed}`) {
    throw new ApprovalRefused("evolution approval body does not match its own hash");
  }

  // Bound to THIS draft. Approving one event must never promote another.
  if (body.eventId !== event?.id) throw new ApprovalRefused("approval names a different event and cannot be replayed here");
  const subject = approvalSubject(event);
  if (body.subjectHash !== subject) {
    throw new ApprovalRefused("the draft changed after it was approved; the approval covers different bytes");
  }
  if (body.evidenceManifestHash !== evidenceManifestHash(event?.evidenceIds)) {
    throw new ApprovalRefused("the evidence set changed after it was approved");
  }
  if (body.trustPolicyVersion !== policy.version) {
    throw new ApprovalRefused(`approval was issued under trust policy ${body.trustPolicyVersion}, current is ${policy.version}`);
  }

  // Expiry and single use. An approval that can be replayed is a standing grant, not a decision.
  if (Date.parse(now) > Date.parse(body.expiresAt)) throw new ApprovalRefused("evolution approval has expired");
  if (Date.parse(now) < Date.parse(body.issuedAt)) throw new ApprovalRefused("evolution approval is not yet valid");
  if (consumedNonces.has(body.nonce)) throw new ApprovalRefused("this approval was already used; approvals are single use");

  const credential = policy.credentials[body.reviewerCredentialId];
  if (!credential) throw new ApprovalRefused(`credential ${body.reviewerCredentialId} is not in the trust policy`);
  if (!Array.isArray(credential.purposes) || !credential.purposes.includes(PURPOSE)) {
    throw new ApprovalRefused(`credential ${body.reviewerCredentialId} is not authorized to promote ledger events`);
  }

  const level = TRUST_LEVELS[credential.trustLevel];
  const required = TRUST_LEVELS[requiredTrustLevel];
  if (!level) throw new ApprovalRefused(`credential ${body.reviewerCredentialId} declares unknown trust level ${credential.trustLevel}`);
  if (!required) throw new ApprovalRefused(`unknown required trust level ${requiredTrustLevel}`);
  // No silent fallback. A weaker credential does not quietly satisfy a stronger requirement.
  if (level.rank < required.rank) {
    throw new ApprovalRefused(`credential ${body.reviewerCredentialId} is ${credential.trustLevel} (${level.meaning}); this ledger requires ${requiredTrustLevel} or stronger`);
  }

  if (!attestation || attestation.schemaVersion !== ATTESTATION_SCHEMA || attestation.purpose !== PURPOSE
    || attestation.payloadSha256 !== approvalHash || attestation.credentialId !== body.reviewerCredentialId
    || attestation.signatureEncoding !== "base64url") {
    throw new ApprovalRefused("attestation is not bound to this exact payload, purpose and credential");
  }
  const alg = ALGORITHMS[attestation.algorithm];
  if (!alg) throw new ApprovalRefused(`unsupported approval algorithm ${attestation.algorithm}`);
  if (credential.algorithm && credential.algorithm !== attestation.algorithm) {
    throw new ApprovalRefused(`credential ${body.reviewerCredentialId} signs with ${credential.algorithm}, not ${attestation.algorithm}`);
  }

  const publicKey = createPublicKey(credential.publicKey);
  if (publicKey.asymmetricKeyType !== alg.expectedKeyType) throw new ApprovalRefused(`trusted credential must be ${attestation.algorithm}`);
  const signature = Buffer.from(attestation.signature, "base64url");
  if (signature.length !== alg.signatureBytes || signature.toString("base64url") !== attestation.signature
    || !alg.verify(publicKey, bytesOf(statementOf(attestation)), signature)) {
    throw new ApprovalRefused("evolution approval signature verification failed");
  }

  // DERIVED, never read from the record. This is the whole point of the module.
  return {
    interpretation: {
      status: "human-reviewed",
      reviewedBy: credential.reviewer,
      reviewedAt: body.issuedAt,
    },
    trustLevel: credential.trustLevel,
    assurance: level.meaning,
    credentialId: body.reviewerCredentialId,
    nonce: body.nonce,
    approvalHash,
  };
}

export const EVOLUTION_APPROVAL_PURPOSE = PURPOSE;
