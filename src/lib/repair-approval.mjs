import { createHash, createPrivateKey, createPublicKey, sign, verify as verifySignature } from "node:crypto";

// A signed promotion approval for a repair. The Builder Gym proves a candidate is better; this
// records that a human decided the better candidate should ship. Until now the approval was checked
// only for shape and binding, so anyone able to construct an object could grant it.
//
// Mirrors the Ed25519 detached-attestation pattern the skill promotion path already uses, with ONE
// deliberate difference: its own domain string and its own purpose. Reusing the skill purpose would
// let a key trusted to promote a skill also promote a repair, which is privilege escalation by
// accident. Domain separation makes a signature from another purpose unreplayable here.

const ATTESTATION_SCHEMA_VERSION = "nodekit.repair-detached-attestation/v1";
const ATTESTATION_DOMAIN = "nodekit.repair-promotion-approval.v1\n";
const PURPOSE = "repair-promotion-approval";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function statementOf({ keyId, payloadSha256, signedAt }) {
  return {
    algorithm: "Ed25519",
    keyId,
    payloadSha256,
    purpose: PURPOSE,
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    signatureEncoding: "base64url",
    signedAt,
  };
}

// The domain prefix is what makes a signature meaningful only for this purpose. Without it, the
// signed bytes are just a hash, and a hash signed for one purpose verifies for any other.
function bytesOf(statement) {
  return Buffer.from(`${ATTESTATION_DOMAIN}${canonical(statement)}`, "utf8");
}

function approvalBody({ gymVerdictHash, repairId, approvedBy, issuedAt }) {
  if (!/^[a-f0-9]{64}$/.test(String(gymVerdictHash ?? ""))) throw new Error("a repair approval must name the gym verdict hash it approves");
  if (!String(repairId ?? "").trim()) throw new Error("a repair approval must name the repair it approves");
  if (!String(approvedBy ?? "").trim()) throw new Error("a repair approval must name who approved it");
  if (Number.isNaN(Date.parse(issuedAt ?? ""))) throw new Error("a repair approval must carry a valid issuedAt");
  return {
    schemaVersion: "nodekit.repair-promotion-approval/v1",
    purpose: PURPOSE,
    gymVerdictHash,
    repairId,
    approvedBy,
    issuedAt,
  };
}

/**
 * Seal and sign a repair promotion approval.
 * @param {{ gymVerdictHash: string, repairId: string, approvedBy: string, issuedAt: string }} input
 * @param {{ privateKey: string, keyId: string, signedAt?: string }} signingOptions
 */
export function sealRepairPromotionApproval(input, { privateKey, keyId, signedAt = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(keyId ?? "")) throw new Error("repair approval keyId is invalid");
  const body = approvalBody(input);
  const approvalHash = hash(body);
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("repair approval private key must be Ed25519");
  const statement = statementOf({ keyId, payloadSha256: approvalHash, signedAt });
  return {
    ...body,
    approvalId: `repair-promotion-approval:sha256:${approvalHash}`,
    approvalHash,
    attestation: { ...statement, signature: sign(null, bytesOf(statement), key).toString("base64url") },
  };
}

/**
 * Verify a repair promotion approval against the comparison it claims to approve.
 * Throws on any failure so a caller cannot mistake a falsy return for a pass.
 * @param {object} approval
 * @param {{ gymVerdictHash: string, repairId: string, trustedKeys: Record<string, { publicKey: string, purposes: string[] }> }} expectations
 */
export function verifyRepairPromotionApproval(approval, { gymVerdictHash, repairId, trustedKeys }) {
  if (!approval || approval.schemaVersion !== "nodekit.repair-promotion-approval/v1") {
    throw new Error("not a repair promotion approval");
  }
  const { approvalId, approvalHash, attestation, ...body } = approval;

  // Recomputed from the body, so editing any approved field invalidates the hash and the signature.
  const recomputed = hash(approvalBody(body));
  if (recomputed !== approvalHash || approvalId !== `repair-promotion-approval:sha256:${recomputed}`) {
    throw new Error("repair approval body does not match its own hash");
  }
  if (body.gymVerdictHash !== gymVerdictHash) {
    throw new Error("repair approval is bound to a different comparison and cannot be replayed here");
  }
  if (body.repairId !== repairId) {
    throw new Error("repair approval is bound to a different repair and cannot be replayed here");
  }
  if (!attestation || attestation.schemaVersion !== ATTESTATION_SCHEMA_VERSION
    || attestation.algorithm !== "Ed25519" || attestation.signatureEncoding !== "base64url"
    || attestation.purpose !== PURPOSE || attestation.payloadSha256 !== approvalHash) {
    throw new Error("repair approval attestation is not bound to this exact payload and purpose");
  }

  const entry = trustedKeys?.[attestation.keyId];
  if (!entry) throw new Error(`repair approval key ${attestation.keyId} is not trusted`);
  if (!Array.isArray(entry.purposes) || !entry.purposes.includes(PURPOSE)) {
    throw new Error(`key ${attestation.keyId} is not authorized to approve repair promotion`);
  }
  const publicKey = createPublicKey(entry.publicKey);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("trusted repair approval key must be Ed25519");

  const signature = Buffer.from(attestation.signature, "base64url");
  const statement = statementOf(attestation);
  if (signature.length !== 64 || signature.toString("base64url") !== attestation.signature
    || !verifySignature(null, bytesOf(statement), publicKey, signature)) {
    throw new Error("repair approval signature verification failed");
  }
  return { approvedBy: body.approvedBy, keyId: attestation.keyId, approvalHash };
}
