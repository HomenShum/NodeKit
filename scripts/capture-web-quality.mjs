// PROMOTION condition 8 — "Web-quality audit (accessibility, performance, Core Web Vitals): no
// major unresolved finding." This is the audit, not a summary of one: it runs the two external
// toolchains by pinned version and keeps their raw JSON.
//
//   node scripts/capture-web-quality.mjs [--out <dir>] [--port 4908] [--app <existing app dir>]
//
// With no --app it runs `nodekit create` into a temp directory, so a fresh clone reproduces the
// whole chain. Exits 1 when any threshold below is missed.
//
// Why the third phase exists. The two CLIs audit ONE page in ONE colour scheme — whatever the
// headless default happens to be. That is how a serious contrast defect shipped: the Wave 1 axe
// run swept light only, and `.step.active` painted --ink (which flips to near-white in dark) on
// --lime (which does not flip), giving 1.26:1 against a required 4.5:1. So phase 3 sweeps every
// scenario state across both schemes and both widths with the same axe engine. Committed
// artefacts: promotion/evidence/web-quality/{lighthouse-app,axe-app,axe-sweep,web-quality}.json.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const port = Number(option("port", 4908));
const outputRoot = path.resolve(option("out", path.join(repoRoot, "promotion", "evidence", "web-quality")));
const baseUrl = `http://127.0.0.1:${port}`;

// Pinned so a re-run measures the same rules. An unpinned audit tool is a moving assertion.
const LIGHTHOUSE = "lighthouse@13.4.1";
const AXE_CLI = "@axe-core/cli@4.13.0";

// Every state the generated app can be driven to, from the evaluator contract in
// scripts/run-protected-browser-lane.mjs. Kept in sync deliberately: a state that exists but is
// never audited is exactly the gap this script was written to close.
const STATES = Object.freeze([
  "first_arrival", "orientation", "input", "validation_error", "running", "partial_result",
  "external_wait", "proposal_pending", "approval", "conflict", "recoverable_failure",
  "reload_resume", "completed_receipt", "receipt_inspection", "export_share",
]);
const SCHEMES = Object.freeze(["light", "dark"]);
const WIDTHS = Object.freeze([{ height: 900, id: "desktop", width: 1280 }, { height: 812, id: "mobile", width: 375 }]);

// A finding at these impacts is "major" for condition 8. Moderate/minor are recorded, not gating.
const MAJOR_IMPACTS = new Set(["critical", "serious"]);
const THRESHOLDS = Object.freeze({
  accessibility: 1, "best-practices": 1, performance: 0.9, seo: 0.9,
  // Core Web Vitals, "good" boundaries: web.dev/vitals. LCP is measured under Lighthouse's own
  // simulated mobile throttle, not on the bare localhost clock.
  cls: 0.1, lcpMs: 2500, tbtMs: 200,
});

function run(command, commandArgs, cwd, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, shell: process.platform === "win32", stdio: quiet ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The server starts concurrently; retry only inside this bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`generated app did not answer on ${baseUrl} within 20 seconds`);
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  let appDir = option("app", null);
  let temporaryRoot = null;
  let server = null;
  const cleanup = [];

  try {
    if (!appDir) {
      temporaryRoot = await mkdtemp(path.join(tmpdir(), "nodekit-web-quality-"));
      appDir = path.join(temporaryRoot, "app");
      await run(process.execPath, [path.join(repoRoot, "src", "cli.mjs"), "create", appDir, "--name", "audit-app", "--brief", "triage inbound support tickets"], repoRoot, { quiet: true });
      await run("npm", ["install", "--no-audit", "--no-fund"], appDir, { quiet: true });
    }
    server = spawn(process.execPath, [path.join(appDir, "apps", "web", "server.mjs")], {
      cwd: appDir, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
    });
    cleanup.push(() => server.kill());
    await waitForServer();

    // Phase 1 — Lighthouse. Performance, accessibility, best practices, SEO, Core Web Vitals.
    const lighthousePath = path.join(outputRoot, "lighthouse-app.json");
    await run("npx", ["--yes", LIGHTHOUSE, `${baseUrl}/`, "--output=json", `--output-path=${lighthousePath}`, "--chrome-flags=--headless"], repoRoot, { quiet: true });
    const lighthouse = JSON.parse(await readFile(lighthousePath, "utf8"));
    const categories = Object.fromEntries(Object.entries(lighthouse.categories).map(([id, category]) => [id, category.score]));
    const metrics = lighthouse.audits.metrics.details.items[0];
    const vitals = {
      cls: metrics.cumulativeLayoutShift, fcpMs: metrics.firstContentfulPaint,
      lcpMs: metrics.largestContentfulPaint, tbtMs: metrics.totalBlockingTime,
    };
    const consoleErrors = lighthouse.audits["errors-in-console"].details?.items ?? [];

    // Phase 2 — axe-core CLI. An independent engine and an independent process from phase 3, so a
    // mistake in this script's own injection cannot manufacture a clean result.
    // --save is resolved against the process cwd, not as an absolute path, so the CLI runs from
    // the output directory and names the file relatively. Passing an absolute path here produces
    // `<cwd>\<abs path>` and an ENOENT that the CLI reports on stdout while still exiting 1.
    const axeCliPath = path.join(outputRoot, "axe-app.json");
    await run("npx", ["--yes", AXE_CLI, `${baseUrl}/`, "--save", "axe-app.json"], outputRoot, { quiet: true });
    const axeCli = JSON.parse(await readFile(axeCliPath, "utf8"));
    const axeCliViolations = axeCli.flatMap((page) => page.violations ?? []);
    // The CLI package version and the rule engine it bundles are different numbers: @axe-core/cli
    // 4.13.0 ships axe-core 4.12.1. Record the engine, because the engine is what has the rules.
    const axeCliEngine = axeCli[0]?.testEngine?.version ?? null;

    // Phase 3 — the sweep the two CLIs cannot do: every state, both schemes, both widths.
    const axeSource = await readFile(path.join(repoRoot, "node_modules", "axe-core", "axe.min.js"), "utf8");
    const browser = await chromium.launch();
    cleanup.push(() => browser.close());
    let sweepEngine = null;
    const sweep = [];
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({ colorScheme: scheme, viewport: { height: width.height, width: width.width } });
        const page = await context.newPage();
        for (const state of STATES) {
          await page.goto(`${baseUrl}/?scenario=${state}`, { waitUntil: "networkidle" });
          await page.addScriptTag({ content: axeSource });
          const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ["violations"] }));
          sweepEngine ??= result.testEngine?.version ?? null;
          const violations = result.violations.map((violation) => ({
            help: violation.help, id: violation.id, impact: violation.impact,
            nodes: violation.nodes.map((node) => ({ data: node.any?.[0]?.data ?? null, target: node.target })),
          }));
          sweep.push({ scheme, state, violations, width: width.id });
          if (violations.some((violation) => MAJOR_IMPACTS.has(violation.impact))) {
            await page.screenshot({ path: path.join(outputRoot, `violation--${state}--${width.id}--${scheme}.png`) });
          }
        }
        await context.close();
      }
    }
    await writeFile(path.join(outputRoot, "axe-sweep.json"), `${JSON.stringify(sweep, null, 2)}\n`);

    // Two proof screenshots for the defect this script was written around: the same element, the
    // same scheme, before and after. `before/` is committed from the pre-fix tree.
    const proofContext = await browser.newContext({ colorScheme: "dark", viewport: { height: 900, width: 1280 } });
    const proofPage = await proofContext.newPage();
    await proofPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await proofPage.locator("#progress").screenshot({ path: path.join(outputRoot, "contrast-dark-active-step.png") });
    await proofContext.close();

    const sweepMajor = sweep.flatMap(({ scheme, state, violations, width }) =>
      violations.filter((violation) => MAJOR_IMPACTS.has(violation.impact)).map((violation) => ({ id: violation.id, impact: violation.impact, scheme, state, width })));
    const cliMajor = axeCliViolations.filter((violation) => MAJOR_IMPACTS.has(violation.impact)).map((violation) => ({ id: violation.id, impact: violation.impact }));

    const failures = [];
    for (const [id, minimum] of Object.entries(THRESHOLDS)) {
      if (id in categories && categories[id] < minimum) failures.push(`lighthouse ${id} ${categories[id]} < ${minimum}`);
    }
    if (vitals.cls > THRESHOLDS.cls) failures.push(`CLS ${vitals.cls} > ${THRESHOLDS.cls}`);
    if (vitals.lcpMs > THRESHOLDS.lcpMs) failures.push(`LCP ${vitals.lcpMs}ms > ${THRESHOLDS.lcpMs}ms`);
    if (vitals.tbtMs > THRESHOLDS.tbtMs) failures.push(`TBT ${vitals.tbtMs}ms > ${THRESHOLDS.tbtMs}ms`);
    if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console error(s): ${consoleErrors.map((item) => item.description).join("; ")}`);
    for (const violation of cliMajor) failures.push(`axe CLI ${violation.impact} ${violation.id}`);
    for (const violation of sweepMajor) failures.push(`axe sweep ${violation.impact} ${violation.id} at ${violation.state}/${violation.width}/${violation.scheme}`);

    const summary = {
      axe: {
        cliEngineVersion: axeCliEngine,
        cliPackage: AXE_CLI,
        cliViolations: axeCliViolations.length,
        majorFindings: [...cliMajor, ...sweepMajor],
        sweepCells: sweep.length,
        sweepEngineVersion: sweepEngine,
        sweepViolations: sweep.reduce((total, cell) => total + cell.violations.length, 0),
      },
      commands: [
        `npx --yes ${LIGHTHOUSE} ${baseUrl}/ --output=json --output-path=promotion/evidence/web-quality/lighthouse-app.json --chrome-flags="--headless"`,
        `npx --yes ${AXE_CLI} ${baseUrl}/ --save promotion/evidence/web-quality/axe-app.json`,
        "node scripts/capture-web-quality.mjs",
      ],
      consoleErrors,
      lighthouse: { categories, lighthouseVersion: lighthouse.lighthouseVersion, userAgent: lighthouse.environment?.hostUserAgent ?? null, vitals },
      measuredAt: new Date().toISOString(),
      passed: failures.length === 0,
      failures,
      surface: `${baseUrl}/ (application produced by \`nodekit create\`)`,
      thresholds: THRESHOLDS,
    };
    await writeFile(path.join(outputRoot, "web-quality.json"), `${JSON.stringify(summary, null, 2)}\n`);

    console.log(JSON.stringify({ axe: summary.axe, failures, lighthouse: categories, passed: summary.passed, vitals }, null, 2));
    if (!summary.passed) process.exitCode = 1;
  } finally {
    for (const step of cleanup.reverse()) {
      try { await step(); } catch { /* best effort teardown */ }
    }
    if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
  }
}

await main();
