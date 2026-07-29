import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../../src/lib/journey-chain-gate.mjs";
import { validateSchema } from "../../../src/lib/schema-validation.mjs";

// LAUNCH-stage producer for the mew migration. The deploy premise was tested for real and FAILED
// (no Convex account, no deploy key — proof/mew-migration/convex-deploy-receipt.json), so this
// manifest's liveness claim is deploy-failed and the green claim is structurally out of reach:
// no rendered-DOM probe ran, because no deployment exists to render.
//
// What IS recorded truthfully: the release identity (commit + digest of the source archive that
// WOULD have shipped), the target that was aimed at and never created, authority H0 with no human
// presence, a spend ledger that closes at zero (there is no account to bill), and the promised
// signal a future green claim must observe in a rendered DOM.
//
//   node scripts/produce-launch-manifest.mjs [--chain-dir <dir>] [--out <path>]

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const chainDir = path.resolve(opt("--chain-dir", path.join(repoRoot, "proof", "mew-migration", "chain")));
const outPath = path.resolve(opt("--out", path.join(chainDir, "mew-migration.launch-manifest.json")));
const CASE_ID = "mew-migration";

const bep = JSON.parse(await readFile(path.join(chainDir, "mew-migration.build-evidence-pack.json"), "utf8"));
const receiptPath = path.join(repoRoot, "proof", "mew-migration", "convex-deploy-receipt.json");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

const deployAttempt = receipt.attempts.find((a) => a.outcome === "kill-receipt-for-cloud-deploy");
if (!deployAttempt || deployAttempt.exitCode === 0) {
  throw new Error("REFUSED: the deploy receipt does not record a failed cloud deploy; this producer only knows how to write the manifest for the failure that actually happened");
}

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const commitInstant = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const buildCompletedAt = new Date(commitInstant).toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
const archive = execFileSync("git", ["archive", "HEAD", "--", "apps/mew-migration"], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
const artifactSha256 = createHash("sha256").update(archive).digest("hex");
const producedAt = new Date().toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");

const manifest = {
  schemaVersion: "nodekit.launch-manifest/v1",
  caseId: CASE_ID,
  stage: "launch",
  producedAt,
  inputs: [
    {
      schemaVersion: "nodekit.build-evidence-pack/v1",
      caseId: CASE_ID,
      sha256: canonicalSha256(bep),
    },
  ],
  content: {
    release: {
      artifactName: "mew-migration source archive (git archive HEAD -- apps/mew-migration); built, tested, never shipped to any cloud target",
      sourceRepository: "HomenShum/node-platform",
      sourceCommit,
      sourceRef: "feat/mew-waves1-4",
      artifactSha256,
      buildCompletedAt,
    },
    target: {
      provider: "convex",
      environment: "production",
      accountIdentity: "none-no-convex-account-on-this-machine",
      projectIdentity: "none-project-never-created",
      deploymentId: "none-deployment-never-created",
      url: "https://dashboard.convex.dev",
      deployedAt: receipt.recordedAt.replace(/\.(\d{3})\d*Z$/, ".$1Z"),
      publicReachability: "unknown",
    },
    authority: {
      mode: "none",
      actor: { id: "claude-fable-5/mew-waves1-4", type: "agent" },
      keyKind: "none",
      trustLevel: "H0",
      trustLevelBasis: "No capability grant artifact exists in this repository, no human approved this specific launch, and the deploy command ran under ambient session authority only; it failed before any resource was created.",
      humanPresenceProven: false,
      withinGrant: "unknown",
      outsideGrantDisclosure: "There is no standing grant to be inside of. Whether the owner would authorize a Convex cloud deployment is owner input #2, unanswered; the attempt created nothing and spent nothing.",
    },
    spend: {
      currency: "USD",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      grantCapMinorUnits: 10000,
      priorPeriodSpendMinorUnits: 0,
      thisLaunchMinorUnits: 0,
      remainingAfterMinorUnits: 10000,
      meteringBasis: "free-tier-no-charge",
      capExceeded: false,
      entries: [
        {
          label: "convex anonymous local dev backend (schema validation only) — no account exists, nothing is billable, nothing was billed",
          minorUnits: 0,
          meteringBasis: "free-tier-no-charge",
          receiptRef: "proof/mew-migration/convex-deploy-receipt.json",
          receiptSha256: createHash("sha256").update(await readFile(receiptPath)).digest("hex"),
        },
      ],
    },
    liveness: {
      claim: "deploy-failed",
      notObservedDisclosure: `The cloud deploy was attempted and failed: \`${deployAttempt.command.trim()}\` exited ${deployAttempt.exitCode} requiring \`npx convex login\` (no Convex account, no deploy key — owner input #2 absent). No deployment exists, so no signal was observed anywhere, and the anonymous LOCAL backend that convex dev provisioned is a localhost schema-validation aid, not a launch.`,
      promisedSignals: [
        {
          signalId: "mew-agent-surface-attr",
          kind: "attribute",
          expected: 'data-nodekit-artifact="mew-migration-agent-surface"',
          whyThisProvesTheApp: "Only the app's own served page emits this attribute on its body, with data-store-notes carrying the mounted store's count; a hosting shell, provider error page, or unhydrated SPA skeleton contains neither.",
          presentInUnbuiltShell: false,
          probeIds: ["probe-cloud-dom"],
        },
      ],
      probes: [
        {
          probeId: "probe-cloud-dom",
          signalId: "mew-agent-surface-attr",
          method: "raw-http",
          urlFetched: "https://dashboard.convex.dev",
          authenticatedSession: false,
          observation: "not-attempted",
          notAttemptedReason: "No deployment URL exists to fetch — the deploy failed before a project was created, so the only recordable URL is the provider console the CLI pointed at. A future green claim additionally requires a rendered-DOM probe (Playwright is a devDependency here but its browser binaries are not provisioned in this environment; use scripts/ui-gates/playwright-peer.mjs when re-running after owner input #2).",
        },
      ],
    },
  },
  completeness: {
    claimed: [
      "The cloud deploy path was exercised for real, not assumed: npx convex deploy -y exited 1 with the login requirement, recorded with sanitized output in proof/mew-migration/convex-deploy-receipt.json.",
      "The hand-written convex/schema.ts was accepted by a real Convex backend (anonymous local dev): tables notes/links/tags with five by_sourceId/by_sourceDigest/by_name indexes created.",
      "The release is identified by commit and by digest of the exact source archive that would have shipped.",
      "The spend ledger closes at zero against the USD 100.00 monthly cap: no Convex account exists to be billed.",
    ],
    notRun: [
      "No rendered-DOM probe ran anywhere: there is no deployment to render.",
      "No raw-http probe of a deployment ran: there is no deployment URL.",
      "The local anonymous backend was not probed as a launch surface; localhost is not a launch and its coordinates in .env.local are deliberately untracked.",
    ],
    refused: [
      {
        item: "Recording the anonymous local dev deployment as the launch target",
        reason: "A backend on 127.0.0.1 with no account behind it is reachable by exactly one machine. Calling it a launch would satisfy the schema while meaning nothing; the target recorded is the cloud deployment that was aimed at and never created.",
      },
      {
        item: "Writing any liveness claim other than deploy-failed",
        reason: "deployed-signal-not-observed would imply something was deployed; not-attempted would erase the real attempt and its receipt. The command ran and failed, so deploy-failed is the only claim that matches the receipt.",
      },
    ],
  },
};

const errors = await validateSchema("nodekit.launch-manifest.v1.schema.json", manifest, "launch-manifest");
if (errors.length > 0) {
  console.error("REFUSED: produced launch manifest does not validate; nothing written:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`LAUNCH MANIFEST written: ${outPath}`);
console.log(`  claim ${manifest.content.liveness.claim}; release ${sourceCommit.slice(0, 12)}… archive ${artifactSha256.slice(0, 12)}…`);
console.log(`  spend 0 of 10000 minor units; authority H0, humanPresenceProven false`);
