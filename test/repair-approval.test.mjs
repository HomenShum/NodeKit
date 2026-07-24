import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { sealRepairPromotionApproval, verifyRepairPromotionApproval } from "../src/lib/repair-approval.mjs";

const VERDICT_HASH = "a".repeat(64);
const REPAIR_ID = "repair-F5";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function trust(publicKey, purposes = ["repair-promotion-approval"]) {
  return { "owner-key": { publicKey, purposes } };
}

function seal(keys, overrides = {}) {
  return sealRepairPromotionApproval(
    { gymVerdictHash: VERDICT_HASH, repairId: REPAIR_ID, approvedBy: "project-owner", issuedAt: "2026-07-24T15:00:00.000Z", ...overrides },
    { privateKey: keys.privateKey, keyId: "owner-key", signedAt: "2026-07-24T15:00:01.000Z" },
  );
}

const expect = (keys, overrides = {}) => ({ gymVerdictHash: VERDICT_HASH, repairId: REPAIR_ID, trustedKeys: trust(keys.publicKey), ...overrides });

test("a correctly signed approval from a trusted key verifies and names its approver", () => {
  const keys = keypair();
  const approval = seal(keys);
  assert.match(approval.approvalId, /^repair-promotion-approval:sha256:[a-f0-9]{64}$/);
  assert.equal(approval.attestation.purpose, "repair-promotion-approval");
  const verified = verifyRepairPromotionApproval(approval, expect(keys));
  assert.equal(verified.approvedBy, "project-owner");
  assert.equal(verified.keyId, "owner-key");
});

// Each of these is a way an unsigned approval could previously have been forged or reused.
test("editing any approved field breaks the binding", () => {
  const keys = keypair();
  for (const field of ["approvedBy", "repairId", "gymVerdictHash"]) {
    const approval = seal(keys);
    approval[field] = field === "gymVerdictHash" ? "b".repeat(64) : "tampered";
    assert.throws(() => verifyRepairPromotionApproval(approval, expect(keys)), /does not match its own hash|different/, `${field} must be covered`);
  }
});

test("an approval for another comparison or another repair cannot be replayed", () => {
  const keys = keypair();
  const approval = seal(keys);
  assert.throws(() => verifyRepairPromotionApproval(approval, expect(keys, { gymVerdictHash: "c".repeat(64) })), /different comparison/);
  assert.throws(() => verifyRepairPromotionApproval(approval, expect(keys, { repairId: "repair-other" })), /different repair/);
});

test("an untrusted key, or a trusted key not authorized for this purpose, is refused", () => {
  const owner = keypair();
  const stranger = keypair();
  const approval = seal(owner);
  assert.throws(() => verifyRepairPromotionApproval(approval, expect(owner, { trustedKeys: {} })), /not trusted/);
  // A key trusted only for skill promotion must not be able to promote a repair.
  assert.throws(
    () => verifyRepairPromotionApproval(approval, expect(owner, { trustedKeys: trust(owner.publicKey, ["skill-promotion-approval"]) })),
    /not authorized to approve repair promotion/,
  );
  // Right shape, wrong signer.
  assert.throws(() => verifyRepairPromotionApproval(approval, expect(owner, { trustedKeys: trust(stranger.publicKey) })), /signature verification failed/);
});

// THE attack domain separation exists to stop. Without the domain prefix the signed bytes are just
// a hash, so a signature produced for a different purpose would verify here and one approval
// authority would silently become another.
test("a signature made over the same payload for a DIFFERENT purpose does not verify here", () => {
  const keys = keypair();
  const approval = seal(keys);
  const payloadSha256 = approval.approvalHash;

  // Forge an attestation signed with the same key over the same payload, under a foreign domain.
  const foreignStatement = {
    algorithm: "Ed25519",
    keyId: "owner-key",
    payloadSha256,
    purpose: "repair-promotion-approval",
    schemaVersion: "nodekit.repair-detached-attestation/v1",
    signatureEncoding: "base64url",
    signedAt: approval.attestation.signedAt,
  };
  const canonical = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`);
  const foreignBytes = Buffer.from(`nodekit.skill-attestation.v1\n${canonical(foreignStatement)}`, "utf8");
  const forged = { ...approval, attestation: { ...foreignStatement, signature: sign(null, foreignBytes, createPrivateKey(keys.privateKey)).toString("base64url") } };

  assert.throws(() => verifyRepairPromotionApproval(forged, expect(keys)), /signature verification failed/);
});

test("an approval must name a verdict, a repair, an approver, and a valid issue time", () => {
  const keys = keypair();
  const signing = { privateKey: keys.privateKey, keyId: "owner-key" };
  const base = { gymVerdictHash: VERDICT_HASH, repairId: REPAIR_ID, approvedBy: "project-owner", issuedAt: "2026-07-24T15:00:00.000Z" };
  assert.throws(() => sealRepairPromotionApproval({ ...base, gymVerdictHash: "short" }, signing), /gym verdict hash/);
  assert.throws(() => sealRepairPromotionApproval({ ...base, repairId: " " }, signing), /name the repair/);
  assert.throws(() => sealRepairPromotionApproval({ ...base, approvedBy: "" }, signing), /who approved it/);
  assert.throws(() => sealRepairPromotionApproval({ ...base, issuedAt: "not-a-date" }, signing), /valid issuedAt/);
  assert.throws(() => sealRepairPromotionApproval(base, { ...signing, keyId: "bad key!" }), /keyId is invalid/);
});

test("the approval hash is the sha256 of its canonical body, so it is independently checkable", () => {
  const keys = keypair();
  const approval = seal(keys);
  const { approvalId: _id, approvalHash, attestation: _a, ...body } = approval;
  const canonical = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`);
  assert.equal(createHash("sha256").update(canonical(body)).digest("hex"), approvalHash);
});
