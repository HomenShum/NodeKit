// Journey J3 ("that is not what I asked for"): drive the generated application to the review
// stage in a real browser, press Reject, and read back every region that tells the user what to
// do next. Defect D1 was that two of the three still said a proposal was waiting, so this script
// asserts agreement rather than screenshotting and hoping someone looks.
//
//   node scripts/capture-reject-steering.mjs [--out <dir>] [--port 4309] [--app <existing app dir>]
//
// With no --app it runs `nodekit create` into a temp directory, so a fresh clone reproduces the
// whole chain. Exits 1 when the regions disagree.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(option("port", 4309));
const outputRoot = path.resolve(option("out", path.join(repoRoot, "promotion", "evidence", "reject-steering")));
const baseUrl = `http://127.0.0.1:${port}`;

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, shell: process.platform === "win32", stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The server starts concurrently; retry only inside this bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`generated app did not answer on ${baseUrl} within 10 seconds`);
}

// Every region of the page that answers "what am I supposed to do now?".
async function readDirection(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
    const visible = (id) => {
      const element = document.getElementById(id);
      return Boolean(element) && getComputedStyle(element).display !== "none" && !element.hidden;
    };
    return {
      stageBanner: { kind: text("state-kind"), title: text("state-title"), message: text("state-message") },
      primaryArtifact: { currentAction: text("current-action") },
      reviewPanel: { eyebrow: text("review-eyebrow"), title: text("review-title"), copy: text("review-copy") },
      activeStage: document.querySelector("#progress .step.active span")?.textContent?.trim() ?? null,
      visibleDecisionControls: ["propose", "approve", "reject"].filter(visible),
    };
  });
}

let appRoot = option("app", null);
let temporaryRoot = null;
if (!appRoot) {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "nodekit-reject-"));
  appRoot = path.join(temporaryRoot, "app");
  await run(process.execPath, [path.join(repoRoot, "src", "cli.mjs"), "create", appRoot,
    "--name", "reject-steering", "--brief", "triage inbound support tickets",
    "--no-install", "--no-git"], repoRoot);
}

await mkdir(outputRoot, { recursive: true });
const server = spawn(process.execPath, [path.join("apps", "web", "server.mjs")], {
  cwd: appRoot,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await fetch(`${baseUrl}/api/reset`, { method: "POST" });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#outcome").fill("Route billing tickets to the billing queue");
  await page.locator("#primary-input").evaluate((form) => form.requestSubmit());
  await page.getByText("Outcome confirmed", { exact: true }).waitFor({ state: "visible" });
  await page.locator("#propose").click();
  await page.getByText("Proposal ready for review", { exact: true }).waitFor({ state: "visible" });
  const before = await readDirection(page);
  await page.screenshot({ path: path.join(outputRoot, "j3-1-review-pending.png") });

  await page.locator("#reject").click();
  await page.locator("#reject").waitFor({ state: "hidden" });
  await page.waitForTimeout(1_200);
  const after = await readDirection(page);
  await page.screenshot({ path: path.join(outputRoot, "j3-2-after-reject.png") });

  // J3's "done when": every region agrees no proposal is waiting, and the offered next step is to
  // prepare a new one. A region that still repeats its pre-Reject copy is the defect.
  const stale = [
    ["stageBanner", after.stageBanner.title === before.stageBanner.title && after.stageBanner.message === before.stageBanner.message],
    ["primaryArtifact", after.primaryArtifact.currentAction === before.primaryArtifact.currentAction],
    ["reviewPanel", after.reviewPanel.title === before.reviewPanel.title],
    ["activeStage", after.activeStage === before.activeStage],
  ].filter(([, unchanged]) => unchanged).map(([region]) => region);
  // Phrases that describe a proposal still WAITING on the user. Deliberately not a bare /reject/:
  // "The rejected change was not applied" is the honest post-Reject copy and must not trip this.
  // Both pre-fix regions ("Proposal ready for review", "Approve or reject the proposed change")
  // still match, which is what keeps this from being a check weakened to fit the new behaviour.
  const mentionsDecision = /approve or reject|ready for review|awaiting|before deciding|approval is required/i;
  const contradictory = [
    ...(mentionsDecision.test(`${after.stageBanner.title} ${after.stageBanner.message}`) ? ["stageBanner"] : []),
    ...(mentionsDecision.test(after.primaryArtifact.currentAction ?? "") ? ["primaryArtifact"] : []),
  ];
  const offersRetry = after.visibleDecisionControls.includes("propose")
    && !after.visibleDecisionControls.includes("approve")
    && !after.visibleDecisionControls.includes("reject");

  // J3's goal is not only "see that it was not applied" but "get the agent to try again". Driving
  // the retry to completion also re-proves J2's done-when (v2 canonical artifact + receipt hash)
  // against this tree rather than quoting a measurement from before the change.
  await page.locator("#propose").click();
  await page.getByText("Proposal ready for review", { exact: true }).waitFor({ state: "visible" });
  await page.locator("#approve").click();
  await page.locator("#completion").waitFor({ state: "visible" });
  const revised = await page.evaluate(() => ({
    artifactVersion: document.getElementById("artifact-version")?.textContent?.trim() ?? null,
    receipt: document.getElementById("receipt-id")?.textContent?.trim() ?? null,
    stageBannerTitle: document.getElementById("state-title")?.textContent?.trim() ?? null,
  }));
  await page.screenshot({ path: path.join(outputRoot, "j3-3-revised-proposal-approved.png") });
  const retryCompleted = revised.artifactVersion === "v2" && /^Receipt [a-f0-9]{16}$/.test(revised.receipt ?? "");

  const receipt = {
    schemaVersion: "nodekit.reject-steering-proof/v1",
    journey: "J3 — reject the proposal and see unambiguously that it was not applied",
    generatedAt: new Date().toISOString(),
    producer: "scripts/capture-reject-steering.mjs",
    viewport: { width: 1280, height: 900 },
    before,
    after,
    staleRegionsAfterReject: stale,
    regionsStillDemandingADecision: contradictory,
    offersPrepareRevisedProposal: offersRetry,
    revisedProposalApproved: { ...revised, completed: retryCompleted },
    consoleErrors,
    screenshots: ["j3-1-review-pending.png", "j3-2-after-reject.png", "j3-3-revised-proposal-approved.png"],
    passed: stale.length === 0 && contradictory.length === 0 && offersRetry && retryCompleted && consoleErrors.length === 0,
  };
  await writeFile(path.join(outputRoot, "reject-steering.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await context.close();
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
}
