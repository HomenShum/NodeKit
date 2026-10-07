// Promotion defect D5: the generated app's `/api/decide` announced completion for a decision the
// runtime had *contained*. A stale accept comes back as `proposal.status === "conflicted"` with no
// receipt, yet the stage banner read "Completion verified". This script drives the generated
// application and asserts the general invariant behind that defect: no status region may claim the
// case is complete unless the run really completed, the proposal really was accepted, and a receipt
// really exists. Not a string match on one sentence — a claim checked against the state it describes.
//
//   node scripts/capture-decide-outcome.mjs [--out <dir>] [--port 4401] [--app <existing app dir>]
//
// With no --app it runs `nodekit create` into a temp directory, so a fresh clone reproduces the
// whole chain. Exits 1 when a region claims a completion the state does not support.
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
const port = Number(option("port", 4401));
const outputRoot = path.resolve(option("out", path.join(repoRoot, "promotion", "evidence", "decide-outcome")));
const baseUrl = `http://127.0.0.1:${port}`;

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, shell: process.platform === "win32", stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function post(pathname, payload = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return { body: await response.json(), status: response.status };
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

// "The case is finished" is a claim. This is the state that would have to be true for it to hold.
function completionIsReal(state) {
  return state.run.status === "completed" && Boolean(state.receipt) && state.proposal?.status === "accepted";
}

// A banner claims completion through either half of its own vocabulary: the machine-readable kind
// the stylesheet paints green, or the sentence a person reads.
function claimsCompletion(presentation) {
  return presentation.kind === "complete" || /completion verified|case is complete/i.test(`${presentation.title} ${presentation.message}`);
}

// Every region of the page that answers "is this finished, and what do I do now?".
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
      completionBlockVisible: visible("completion"),
      receiptLine: text("receipt-id"),
      visibleDecisionControls: ["propose", "approve", "reject", "resolve-conflict"].filter(visible),
    };
  });
}

let appRoot = option("app", null);
let temporaryRoot = null;
if (!appRoot) {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "nodekit-decide-"));
  appRoot = path.join(temporaryRoot, "app");
  await run(process.execPath, [path.join(repoRoot, "src", "cli.mjs"), "create", appRoot,
    "--name", "decide-outcome", "--brief", "triage inbound support tickets",
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

  // Probe 1 — the contained conflict. `?scenario=conflict` leaves a stale proposal the runtime
  // already blocked; accepting it again is a no-op that must not be dressed as success. Not
  // click-reachable (app.js hides Approve unless a proposal is pending) but reachable by POST.
  await post("/api/reset");
  const staged = (await post("/api/scenario", { id: "conflict" })).body;
  const decided = await post("/api/decide", { decision: "accepted" });
  const conflict = {
    httpStatus: decided.status,
    presentation: decided.body.presentation,
    proposalStatus: decided.body.proposal?.status ?? null,
    receipt: decided.body.receipt,
    runStatus: decided.body.run.status,
    currentStageId: decided.body.run.currentStageId,
    nextAction: decided.body.run.nextAction,
    artifactVersion: decided.body.artifact.canonicalVersion,
    stagedProposalStatus: staged.proposal?.status ?? null,
    falseCompletionClaim: claimsCompletion(decided.body.presentation) && !completionIsReal(decided.body),
  };

  // Probe 2 — the honest accept still completes. A fix that silences the false claim by never
  // claiming completion at all would pass probe 1 and break the product.
  await post("/api/reset");
  await post("/api/confirm", { outcome: "Route billing tickets to the billing queue" });
  await post("/api/propose");
  const accepted = await post("/api/decide", { decision: "accepted" });
  const honestAccept = {
    httpStatus: accepted.status,
    presentation: accepted.body.presentation,
    proposalStatus: accepted.body.proposal?.status ?? null,
    receiptPresent: Boolean(accepted.body.receipt),
    runStatus: accepted.body.run.status,
    artifactVersion: accepted.body.artifact.canonicalVersion,
    completionClaimIsBacked: claimsCompletion(accepted.body.presentation) && completionIsReal(accepted.body),
  };

  // The rendered page, because a JSON field nobody paints is not the surface a user reads.
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await post("/api/reset");
  await post("/api/scenario", { id: "conflict" });
  await page.goto(`${baseUrl}/?scenario=conflict`, { waitUntil: "networkidle" });
  const beforeDecide = await readDirection(page);
  await page.screenshot({ path: path.join(outputRoot, "d5-1-conflict-contained.png") });

  await post("/api/decide", { decision: "accepted" });
  // Plain reload, no `?scenario=`: re-running the scenario would reset the very state under test.
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const afterDecide = await readDirection(page);
  await page.screenshot({ path: path.join(outputRoot, "d5-2-after-direct-accept.png") });
  const rendered = await (await fetch(`${baseUrl}/api/state`)).json();
  const renderedFalseClaim = (afterDecide.stageBanner.kind?.toLowerCase() === "complete"
    || /completion verified/i.test(afterDecide.stageBanner.title ?? ""))
    && !completionIsReal(rendered);
  // Two regions describing the same run must not disagree about whether it finished.
  const regionsAgree = afterDecide.reviewPanel.eyebrow === "CONFLICT CONTAINED"
    && afterDecide.stageBanner.kind?.toLowerCase() === "conflict"
    && afterDecide.completionBlockVisible === false;

  const receipt = {
    schemaVersion: "nodekit.decide-outcome-proof/v1",
    defect: "D5 — /api/decide presented the decision requested, not the outcome achieved",
    generatedAt: new Date().toISOString(),
    producer: "scripts/capture-decide-outcome.mjs",
    viewport: { width: 1280, height: 900 },
    conflict,
    honestAccept,
    browser: { beforeDecide, afterDecide, renderedFalseClaim, regionsAgree },
    consoleErrors,
    screenshots: ["d5-1-conflict-contained.png", "d5-2-after-direct-accept.png"],
    passed: conflict.falseCompletionClaim === false
      && honestAccept.completionClaimIsBacked === true
      && renderedFalseClaim === false
      && regionsAgree === true
      && consoleErrors.length === 0,
  };
  await writeFile(path.join(outputRoot, "decide-outcome.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await context.close();
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
}
