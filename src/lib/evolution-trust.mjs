import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJson } from "./files.mjs";

/**
 * The trust policy: which credentials may promote a ledger event, and at what assurance.
 *
 * The repository stores ONLY public material — credential id, public key, reviewer identity,
 * permitted purposes, trust level. The private credential must never be readable by the coding
 * agent, because a key the agent can read is a key the agent can use to approve its own proposal.
 *
 * H1 is deliberately awkward to get. `trust init --dev` generates an exportable software key and
 * writes it OUTSIDE the repository, and the resulting policy still cannot promote a ledger that
 * requires H2, so a development shortcut cannot quietly become the production posture. Reaching H2
 * or H3 means registering a credential held by an OS keychain, a platform passkey, or a hardware
 * authenticator — none of which this file can create, by design.
 */

export const TRUST_POLICY_FILE = path.join("evolution", "trust-policy.json");
const PURPOSE = "evolution-canonical-promotion";

export async function readTrustPolicy(repoRoot) {
  const file = path.join(path.resolve(repoRoot), TRUST_POLICY_FILE);
  if (!(await pathExists(file))) return null;
  return readJson(file);
}

/**
 * Create a trust policy.
 *
 * @param {string} repoRoot
 * @param {{ reviewer: string, requiredTrustLevel?: string, dev?: boolean, credentialId?: string,
 *           publicKey?: string, trustLevel?: string, algorithm?: string }} input
 */
export async function initializeTrust(repoRoot, input) {
  const root = path.resolve(repoRoot);
  const file = path.join(root, TRUST_POLICY_FILE);
  if (await pathExists(file)) {
    throw new Error(`${TRUST_POLICY_FILE} already exists. Editing trust is not an init operation; change it deliberately.`);
  }
  if (!String(input?.reviewer ?? "").trim()) throw new Error("a trust policy must name the reviewer it authorizes");

  const credentials = {};
  let devPrivateKeyPath = null;

  if (input.dev) {
    // H1 only, and the private half lands outside the repository so it is never committed by
    // accident. This is still a key the agent can read; that is exactly why it is H1 and why a
    // ledger requiring H2 will refuse it.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const credentialId = input.credentialId ?? "dev-software-key";
    credentials[credentialId] = {
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      algorithm: "Ed25519",
      reviewer: input.reviewer,
      purposes: [PURPOSE],
      trustLevel: "H1",
      note: "Exportable software key. Credential-attested only; it does NOT prove a human acted.",
    };
    devPrivateKeyPath = path.join(root, "..", `.nodekit-dev-approval-${credentialId}.pem`);
    await writeFile(devPrivateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  } else {
    if (!input.publicKey || !input.credentialId) {
      throw new Error("registering a credential needs --credential-id and --public-key (a file path or PEM). " +
        "Use --dev only for a development H1 software key.");
    }
    const trustLevel = input.trustLevel ?? "H2";
    if (!["H2", "H3"].includes(trustLevel)) {
      throw new Error(`a registered credential must declare H2 or H3, not ${trustLevel}. ` +
        "H0 and H1 do not attest human presence, and claiming otherwise would be the fallback this design forbids.");
    }
    credentials[input.credentialId] = {
      publicKey: input.publicKey,
      algorithm: input.algorithm ?? "Ed25519",
      reviewer: input.reviewer,
      purposes: [PURPOSE],
      trustLevel,
    };
  }

  const policy = {
    schemaVersion: "nodekit.evolution-trust-policy/v1",
    version: `trust-policy-${new Date().toISOString().slice(0, 10)}-1`,
    requiredTrustLevel: input.requiredTrustLevel ?? (input.dev ? "H1" : "H2"),
    credentials,
    boundary:
      "This file holds public material only. It proves which credential is trusted; it cannot prove " +
      "the credential is out of the agent's reach. That property comes from where the private key " +
      "lives, which no file in this repository can attest to.",
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(policy, null, 2)}\n`);
  return { policy, file, devPrivateKeyPath };
}
