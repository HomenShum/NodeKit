import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";
import {
  approvalSubject, evidenceManifestHash, sealEvolutionApproval, verifyEvolutionApproval, TRUST_LEVELS,
} from "../src/lib/evolution-approval.mjs";
import { sealRepairPromotionApproval } from "../src/lib/repair-approval.mjs";

// `evolution draft` wrote interpretation.status "human-reviewed" unconditionally and `record`
// promoted anything carrying that value, so two commands took an agent from nothing to canonical
// human-attested history with no human involved. These tests hold the replacement to the property
// that matters: the status is DERIVED from a verified credential and can never be supplied.

const KEY = generateKeyPairSync("ed25519");
const PRIVATE = KEY.privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC = KEY.publicKey.export({ type: "spki", format: "pem" });

const EVENT = {
  schemaVersion: "nodekit.evolution-event/v1",
  id: "evt:x",
  track: "harness",
  challenge: "c",
  resolution: "r",
  evidenceIds: ["evd:a", "evd:b"],
  interpretation: { status: "agent-proposed" },
};

const policyAt = (trustLevel, overrides = {}) => ({
  version: "trust-policy-test-1",
  requiredTrustLevel: "H2",
  credentials: {
    "cred-1": { publicKey: PUBLIC, algorithm: "Ed25519", reviewer: "the-owner", purposes: ["evolution-canonical-promotion"], trustLevel, ...overrides },
  },
});

const approve = (over = {}) => sealEvolutionApproval({
  repositoryId: "o/r", eventId: EVENT.id,
  subjectHash: approvalSubject(EVENT),
  evidenceManifestHash: evidenceManifestHash(EVENT.evidenceIds),
  commitSha: "a".repeat(40),
  trustPolicyVersion: "trust-policy-test-1",
  nonce: randomUUID(),
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600e3).toISOString(),
  ...over,
}, { privateKey: PRIVATE, credentialId: "cred-1" });

// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#status-is-derived
test("the status and reviewer are derived from the credential, not read from anything the caller wrote", () => {
  const derived = verifyEvolutionApproval(approve(), EVENT, { policy: policyAt("H2") });
  assert.equal(derived.interpretation.status, "human-reviewed");
  assert.equal(derived.interpretation.reviewedBy, "the-owner", "the reviewer comes from the trust policy");
  assert.equal(derived.trustLevel, "H2");
  assert.match(derived.assurance, /human-presence/, "the assurance reached must be stated, not assumed");
});

// The defect, as a test. A reviewer name in the record must carry no weight.
// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#record-claims-carry-no-weight
test("a reviewer named in the event itself has no effect on the derived reviewer", () => {
  const lying = { ...EVENT, interpretation: { status: "human-reviewed", reviewedBy: "somebody-else" } };
  // The subject hash excludes interpretation, so the approval still matches — and the derived
  // reviewer is still the credential's, never the record's.
  const derived = verifyEvolutionApproval(approve(), lying, { policy: policyAt("H2") });
  assert.equal(derived.interpretation.reviewedBy, "the-owner");
});

// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#no-silent-fallback
test("a weaker credential does not quietly satisfy a stronger requirement", () => {
  for (const weak of ["H0", "H1"]) {
    assert.throws(
      () => verifyEvolutionApproval(approve(), EVENT, { policy: policyAt(weak), requiredTrustLevel: "H2" }),
      /requires H2 or stronger/,
      `${weak} must not pass an H2 gate`,
    );
  }
  // And a stronger one does satisfy a weaker gate.
  assert.equal(verifyEvolutionApproval(approve(), EVENT, { policy: policyAt("H3"), requiredTrustLevel: "H2" }).trustLevel, "H3");
});

test("trust levels are ordered, so comparisons are meaningful", () => {
  assert.ok(TRUST_LEVELS.H0.rank < TRUST_LEVELS.H1.rank);
  assert.ok(TRUST_LEVELS.H1.rank < TRUST_LEVELS.H2.rank);
  assert.ok(TRUST_LEVELS.H2.rank < TRUST_LEVELS.H3.rank);
});

// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#bound-to-exact-bytes
test("an approval does not survive any change to what it approved", () => {
  const good = approve();
  assert.throws(() => verifyEvolutionApproval(good, { ...EVENT, resolution: "different" }, { policy: policyAt("H2") }),
    /draft changed after it was approved/);
  assert.throws(() => verifyEvolutionApproval(good, { ...EVENT, evidenceIds: ["evd:a"] }, { policy: policyAt("H2") }),
    /evidence set changed|draft changed/);
  assert.throws(() => verifyEvolutionApproval(good, { ...EVENT, id: "evt:other" }, { policy: policyAt("H2") }),
    /different event/);
});

// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#single-use
test("an approval is single use, so it is a decision rather than a standing grant", () => {
  const a = approve();
  assert.ok(verifyEvolutionApproval(a, EVENT, { policy: policyAt("H2") }));
  assert.throws(() => verifyEvolutionApproval(a, EVENT, { policy: policyAt("H2"), consumedNonces: new Set([a.nonce]) }),
    /already used|single use/);
});

test("an expired or not-yet-valid approval is refused", () => {
  const past = approve({ issuedAt: new Date(Date.now() - 7200e3).toISOString(), expiresAt: new Date(Date.now() - 3600e3).toISOString() });
  assert.throws(() => verifyEvolutionApproval(past, EVENT, { policy: policyAt("H2") }), /expired/);
  const future = approve({ issuedAt: new Date(Date.now() + 3600e3).toISOString(), expiresAt: new Date(Date.now() + 7200e3).toISOString() });
  assert.throws(() => verifyEvolutionApproval(future, EVENT, { policy: policyAt("H2") }), /not yet valid/);
});

// Domain separation. This is the whole reason the module has its own domain string.
// @nodekit-verifies inv:canonical-promotion-requires-verified-approval#domain-separation
test("a signature made for repair promotion cannot promote a ledger event", () => {
  const repair = sealRepairPromotionApproval(
    { gymVerdictHash: "b".repeat(64), repairId: "r1", approvedBy: "the-owner", issuedAt: new Date().toISOString() },
    { privateKey: PRIVATE, keyId: "cred-1" });
  // Same key, same owner, different purpose. Graft its attestation onto a ledger approval body.
  const grafted = { ...approve(), attestation: repair.attestation };
  assert.throws(() => verifyEvolutionApproval(grafted, EVENT, { policy: policyAt("H2") }),
    /not bound to this exact payload, purpose and credential/);
});

test("an untrusted credential, or one not authorized for this purpose, is refused", () => {
  assert.throws(() => verifyEvolutionApproval(approve(), EVENT, { policy: { version: "trust-policy-test-1", credentials: {} } }),
    /not in the trust policy/);
  assert.throws(
    () => verifyEvolutionApproval(approve(), EVENT, { policy: policyAt("H2", { purposes: ["something-else"] }) }),
    /not authorized to promote/);
});

test("an approval issued under a superseded trust policy is refused", () => {
  const policy = policyAt("H2");
  policy.version = "trust-policy-rotated-2";
  assert.throws(() => verifyEvolutionApproval(approve(), EVENT, { policy }), /issued under trust policy/);
});

test("a forged signature is refused", () => {
  const a = approve();
  const bad = { ...a, attestation: { ...a.attestation, signature: Buffer.alloc(64, 7).toString("base64url") } };
  assert.throws(() => verifyEvolutionApproval(bad, EVENT, { policy: policyAt("H2") }), /signature verification failed/);
});

test("editing an approved field breaks the approval's own hash", () => {
  const a = approve();
  assert.throws(() => verifyEvolutionApproval({ ...a, commitSha: "c".repeat(40) }, EVENT, { policy: policyAt("H2") }),
    /does not match its own hash/);
});

test("with no trust policy nothing can be promoted", () => {
  assert.throws(() => verifyEvolutionApproval(approve(), EVENT, { policy: null }), /no trust policy/);
});

test("every refusal exits 5, so a caller can tell it from an ordinary failure", () => {
  try { verifyEvolutionApproval(approve(), EVENT, { policy: policyAt("H1"), requiredTrustLevel: "H2" }); assert.fail("should have thrown"); }
  catch (error) { assert.equal(error.exitCode, 5); }
});
