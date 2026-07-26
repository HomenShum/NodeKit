import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { approvalSubject, evidenceManifestHash, sealEvolutionApproval } from "../../src/lib/evolution-approval.mjs";

/**
 * Promote an event the way the ledger now requires: an agent-proposed draft plus a signed approval
 * from a credential registered in a trust policy.
 *
 * Before 2026-07-26 a test could hand-write `interpretation.status: "human-reviewed"` and call
 * recordEvolutionRecord, because that is exactly what the product allowed. That was the defect, so
 * the fixtures had to change with it — a test that keeps using the bypass is asserting the bug.
 *
 * H1 here on purpose. These are throwaway repositories, and an H1 credential with a matching
 * requiredTrustLevel exercises the whole verification path without pretending a software key in a
 * temp directory attests human presence.
 */
export async function grantApproval(root, event, { reviewer = "reviewer", trustLevel = "H1" } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const credentialId = "test-credential";
  const version = "trust-policy-fixture-1";

  await mkdir(path.join(root, "evolution"), { recursive: true });
  await writeFile(path.join(root, "evolution", "trust-policy.json"), `${JSON.stringify({
    schemaVersion: "nodekit.evolution-trust-policy/v1",
    version,
    requiredTrustLevel: trustLevel,
    credentials: {
      [credentialId]: {
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        algorithm: "Ed25519",
        reviewer,
        purposes: ["evolution-canonical-promotion"],
        trustLevel,
      },
    },
  }, null, 2)}\n`);

  const approval = sealEvolutionApproval({
    repositoryId: event.repository ?? "local/fixture",
    projectId: event.projectId ?? "nodekit",
    eventId: event.id,
    subjectHash: approvalSubject(event),
    evidenceManifestHash: evidenceManifestHash(event.evidenceIds),
    commitSha: event.source?.commitSha ?? "0".repeat(40),
    trustPolicyVersion: version,
    nonce: randomUUID(),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600e3).toISOString(),
  }, { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), credentialId });

  const file = path.join(root, "evolution", `approval-${event.id.replaceAll(":", "-")}.json`);
  await writeFile(file, `${JSON.stringify(approval, null, 2)}\n`);
  return path.relative(root, file);
}

/** A draft as `evolution draft` now produces one: proposed, never pre-approved. */
export function proposed(event) {
  return { ...event, interpretation: { status: "agent-proposed" } };
}
