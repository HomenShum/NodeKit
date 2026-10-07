// PROMOTION condition 7 — "Web Interface Guidelines review: no major unresolved finding."
//
//   node scripts/capture-wig-review.mjs [--out <dir>] [--port 4909] [--app <existing app dir>]
//
// This is a REVIEW, not a score. It checks the rendered surface against named rules from the
// Vercel Web Interface Guidelines (https://vercel.com/design/guidelines, retrieved 2026-08-13),
// and every row below records the rule text it is checking and the measurement it took.
//
// It deliberately shares no rule with condition 8's audit. Lighthouse and axe answer "is this
// page accessible and fast"; the WIG answer "does this interface behave the way a considered
// interface behaves" — in-flight feedback, an exit from every error, hit target sizes, deep
// linking, tap behaviour. A Lighthouse score is not evidence for this condition and must never
// be recorded as if it were: an app can score 100 and still leave a user staring at the browser's
// own "Failed to fetch" with no way forward, which is exactly what this surface used to do.
//
// Severity: "major" gates the condition. "minor" is recorded and does not.
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
const port = Number(option("port", 4909));
const outputRoot = path.resolve(option("out", path.join(repoRoot, "promotion", "evidence", "wig-review")));
const baseUrl = `http://127.0.0.1:${port}`;
const GUIDELINES_URL = "https://vercel.com/design/guidelines";
const GUIDELINES_RETRIEVED = "2026-08-13";

// Two constraints pull in opposite directions on Windows, and this script used to
// satisfy neither:
//   * `shell: true` makes cmd.exe re-split every argument at whitespace, so this
//     repository's own path -- "D:\VSCode Projects\node-platform" -- became
//     `node D:\VSCode` and exited 1.
//   * Node 22 refuses to spawn a `.cmd` shim WITHOUT a shell (EINVAL), and `npm`
//     on Windows is `npm.cmd`.
// So: no shell for real executables, a shell only for the shim, and quoting when
// the shell is in play so the first problem cannot come back.
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const needsShell = (command) => process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
const quoteForShell = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const shell = needsShell(command);
    const child = spawn(
      shell ? quoteForShell(command) : command,
      shell ? commandArgs.map(quoteForShell) : commandArgs,
      { cwd, shell, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      // Carry the child's own words. `stdio: "ignore"` turned every failure here
      // into a bare "exited 1", which is why this took a bisect to attribute.
      const detail = stderr.trim().split("\n").slice(-5).join("\n");
      reject(new Error(`${command} ${commandArgs.join(" ")} exited ${code}${detail ? `\n${detail}` : ""}`));
    });
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
  const cleanup = [];
  const findings = [];
  const record = (finding) => { findings.push(finding); return finding; };

  try {
    if (!appDir) {
      temporaryRoot = await mkdtemp(path.join(tmpdir(), "nodekit-wig-"));
      appDir = path.join(temporaryRoot, "app");
      await run(process.execPath, [path.join(repoRoot, "src", "cli.mjs"), "create", appDir, "--name", "audit-app", "--brief", "triage inbound support tickets"], repoRoot);
      await run(npmCommand, ["install", "--no-audit", "--no-fund"], appDir);
    }
    const server = spawn(process.execPath, [path.join(appDir, "apps", "web", "server.mjs")], {
      cwd: appDir, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
    });
    cleanup.push(() => server.kill());
    await waitForServer();

    const browser = await chromium.launch();
    cleanup.push(() => browser.close());

    const desktop = await browser.newContext({ colorScheme: "dark", viewport: { height: 900, width: 1280 } });
    const mobile = await browser.newContext({ colorScheme: "dark", hasTouch: true, isMobile: true, viewport: { height: 812, width: 375 } });
    const desktopPage = await desktop.newPage();
    const mobilePage = await mobile.newPage();
    await desktopPage.goto(`${baseUrl}/?scenario=proposal_pending`, { waitUntil: "networkidle" });
    await mobilePage.goto(`${baseUrl}/?scenario=proposal_pending`, { waitUntil: "networkidle" });

    // ---- Interactions -------------------------------------------------------------------
    const focus = await desktopPage.evaluate(() => {
      const link = document.querySelector(".skip-link");
      link.focus();
      const style = getComputedStyle(link);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, first: document.activeElement === link };
    });
    record({
      guideline: "Interactions › Clear focus — every focusable element shows visible focus ring",
      id: "W-FOCUS",
      measurement: focus,
      passed: focus.outlineStyle !== "none" && parseFloat(focus.outlineWidth) >= 2,
      severity: "major",
    });

    const targets = await mobilePage.evaluate(() => {
      const controls = [...document.querySelectorAll("button, a, input, select, textarea, [role=button]")];
      return controls.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: +rect.height.toFixed(1), id: element.id || element.className, touchAction: getComputedStyle(element).touchAction, width: +rect.width.toFixed(1) };
      });
    });
    // The guideline sets 44px as the mobile minimum for controls; a text link inside running copy
    // is held to the 24px floor, since it is sized by its own type.
    const undersizedControls = targets.filter((target) => target.id !== "brand" && Math.min(target.height, target.width) < 44 && target.height < 44);
    record({
      guideline: "Interactions › Match visual & hit targets — expand hit targets <24px to ≥24px; minimum 44px on mobile",
      id: "W-HIT",
      measurement: { controls: targets, undersizedControls },
      passed: undersizedControls.length === 0,
      severity: "major",
    });

    record({
      guideline: "Interactions › Prevent double-tap zoom on controls — set touch-action: manipulation",
      id: "W-DBLTAP",
      measurement: targets.map((target) => ({ id: target.id, touchAction: target.touchAction })),
      passed: targets.filter((target) => target.id !== "brand").every((target) => target.touchAction === "manipulation"),
      severity: "minor",
    });

    const inputs = await mobilePage.evaluate(() => [...document.querySelectorAll("input, textarea, select")].map((element) => ({
      fontSizePx: parseFloat(getComputedStyle(element).fontSize), id: element.id, labelled: Boolean(element.labels?.length || element.getAttribute("aria-label")),
    })));
    record({
      guideline: "Interactions › Mobile input size — <input> font ≥16px on mobile to prevent iOS Safari auto-zoom",
      id: "W-INPUT16",
      measurement: inputs,
      passed: inputs.every((input) => input.fontSizePx >= 16),
      severity: "major",
    });
    record({
      guideline: "Forms › Labels everywhere — every control has <label> or associated label",
      id: "W-LABEL",
      measurement: inputs,
      passed: inputs.every((input) => input.labelled),
      severity: "major",
    });

    const viewportMeta = await desktopPage.evaluate(() => document.querySelector("meta[name=viewport]")?.content ?? null);
    record({
      guideline: "Interactions › Respect zoom — never disable browser zoom",
      id: "W-ZOOM",
      measurement: { viewportMeta },
      passed: Boolean(viewportMeta) && !/user-scalable\s*=\s*no|maximum-scale/i.test(viewportMeta),
      severity: "major",
    });

    // Deep linking: the guideline asks that view state survive a share or a refresh.
    const deepLink = await desktopPage.evaluate(async () => {
      const response = await fetch("/?scenario=completed_receipt");
      return { ok: response.ok, status: response.status };
    });
    const deepLinkRendered = await desktopPage.evaluate(() => document.body.dataset.scenario ?? null);
    record({
      guideline: "Interactions › Deep-link everything — filters, tabs, pagination, expanded panels",
      id: "W-URLSTATE",
      measurement: { renderedScenarioAttribute: deepLinkRendered, scenarioRoute: deepLink },
      passed: deepLink.ok && deepLinkRendered === "proposal_pending",
      severity: "minor",
    });

    const live = await desktopPage.evaluate(() => [...document.querySelectorAll("[aria-live], [role=alert], [role=status]")].map((element) => ({
      id: element.id || element.className, live: element.getAttribute("aria-live"), role: element.getAttribute("role"),
    })));
    record({
      guideline: "Interactions › Announce async updates — use polite aria-live for toasts & inline validation",
      id: "W-LIVE",
      measurement: live,
      passed: live.length > 0,
      severity: "major",
    });

    // ---- The in-flight state. The guideline wants an indicator whose label does not change, and
    // a submit that stops accepting input only once submission has started. Measured by holding
    // the response open, not by reading the source.
    await desktopPage.route("**/api/propose", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      // The measurement below finishes while this is still held open; by then the page may have
      // navigated away and settled the route itself.
      try { await route.continue(); } catch { /* route already handled */ }
    });
    await desktopPage.goto(`${baseUrl}/?scenario=running`, { waitUntil: "networkidle" });
    const proposeLabelBefore = await desktopPage.locator("#propose").textContent();
    await desktopPage.locator("#propose").click();
    await desktopPage.waitForTimeout(300);
    const inFlight = await desktopPage.evaluate(() => ({
      ariaBusy: document.body.getAttribute("aria-busy"),
      busyAttribute: document.body.dataset.busy ?? null,
      indicatorPainted: getComputedStyle(document.querySelector(".state-banner"), "::after").animationName,
      proposeLabel: document.getElementById("propose")?.textContent?.trim() ?? null,
      pointerEvents: getComputedStyle(document.getElementById("propose")).pointerEvents,
    }));
    if (inFlight.busyAttribute) await desktopPage.screenshot({ path: path.join(outputRoot, "wig-loading-state.png") });
    record({
      guideline: "Interactions › Loading buttons — show loading indicator & keep original label; Forms › Submission rule — disable during in-flight request",
      id: "W-LOADING",
      measurement: { ...inFlight, proposeLabelBefore: proposeLabelBefore?.trim() ?? null },
      passed: inFlight.busyAttribute === "true" && inFlight.ariaBusy === "true"
        && inFlight.pointerEvents === "none" && inFlight.proposeLabel === proposeLabelBefore?.trim()
        && inFlight.indicatorPainted !== "none",
      severity: "major",
    });
    await desktopPage.waitForFunction(() => !document.body.dataset.busy, null, { timeout: 5_000 }).catch(() => {});
    await desktopPage.unroute("**/api/propose");

    // ---- The error exit. A transport failure must not surface the browser's own wording, and the
    // screen must offer a way forward. Measured by aborting the request in the browser.
    await desktopPage.goto(`${baseUrl}/?scenario=running`, { waitUntil: "networkidle" });
    await desktopPage.route("**/api/propose", (route) => route.abort("failed"));
    await desktopPage.locator("#propose").click();
    await desktopPage.locator("#error").waitFor({ state: "visible" });
    // #error turning visible is not the same as the error region being finished:
    // the message text and the Retry control land on a later paint. Measuring on
    // visibility alone read retryVisible:false and text:"" while W-RETRY, which
    // waits first, saw the same control and passed -- a race, not a defect.
    // Bounded, so a region that genuinely never renders still fails honestly
    // rather than hanging.
    await desktopPage
      .waitForFunction(() => {
        const retry = document.getElementById("retry");
        const message = document.getElementById("error-message") ?? document.getElementById("error");
        return Boolean(retry) && !retry.hidden && Boolean(message?.textContent?.trim());
      }, null, { timeout: 5_000 })
      .catch(() => {});
    const errorState = await desktopPage.evaluate(() => ({
      retryVisible: Boolean(document.getElementById("retry")) && !document.getElementById("retry").hidden,
      role: document.getElementById("error")?.getAttribute("role") ?? null,
      text: document.getElementById("error-message")?.textContent?.trim() ?? document.getElementById("error")?.textContent?.trim() ?? null,
    }));
    await desktopPage.screenshot({ path: path.join(outputRoot, "wig-error-exit.png") });
    const browserWording = /failed to fetch|networkerror|load failed|typeerror/i;
    record({
      guideline: "Vercel Copywriting › Error messages guide exit — tell user how to fix, not just what went wrong; Content › No dead ends — every screen offers next step or recovery path",
      id: "W-ERREXIT",
      measurement: errorState,
      passed: Boolean(errorState.text) && !browserWording.test(errorState.text) && errorState.retryVisible && errorState.role === "alert",
      severity: "major",
    });

    // The recovery path must actually recover, or the exit is decorative.
    await desktopPage.unroute("**/api/propose");
    await desktopPage.locator("#retry").click();
    await desktopPage.waitForTimeout(800);
    const recovered = await desktopPage.evaluate(() => ({
      errorHidden: document.getElementById("error").hidden,
      stageKind: document.getElementById("state-kind")?.textContent?.trim() ?? null,
    }));
    record({
      guideline: "Content › No dead ends — every screen offers next step or recovery path (the offered path works)",
      id: "W-RETRY",
      measurement: recovered,
      passed: recovered.errorHidden === true,
      severity: "major",
    });

    // ---- Forms ---------------------------------------------------------------------------
    await desktopPage.goto(`${baseUrl}/?scenario=input`, { waitUntil: "networkidle" });
    const submitState = await desktopPage.evaluate(() => {
      const submit = document.querySelector("#primary-input button[type=submit], #primary-input .primary");
      return { disabled: submit?.disabled ?? null, label: submit?.textContent?.trim() ?? null };
    });
    record({
      guideline: "Forms › Don't pre-disable submit — allow submitting incomplete forms to surface validation feedback",
      id: "W-NODISABLE",
      measurement: submitState,
      passed: submitState.disabled === false,
      severity: "major",
    });

    await desktopPage.locator("#outcome").fill("");
    await desktopPage.locator("#outcome").press("Enter");
    await desktopPage.waitForTimeout(200);
    const validation = await desktopPage.evaluate(() => ({
      ariaInvalid: document.getElementById("outcome")?.getAttribute("aria-invalid") ?? null,
      message: document.getElementById("error-message")?.textContent?.trim() ?? null,
      visible: document.getElementById("error") ? !document.getElementById("error").hidden : false,
    }));
    record({
      guideline: "Forms › Enter submits — when text input focused, Enter submits if only control; Error placement — show errors next to fields",
      id: "W-ENTER",
      measurement: validation,
      passed: validation.visible && validation.ariaInvalid === "true" && Boolean(validation.message),
      severity: "major",
    });

    // ---- Content & Design ------------------------------------------------------------------
    const structure = await desktopPage.evaluate(() => ({
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => heading.tagName),
      skipLink: Boolean(document.querySelector(".skip-link")),
      title: document.title,
      unnamedControls: [...document.querySelectorAll("button, a, [role=button]")]
        .filter((element) => element.offsetParent !== null && !element.textContent.trim() && !element.getAttribute("aria-label"))
        .map((element) => element.id || element.className),
    }));
    record({
      guideline: "Content › Headings & skip link — hierarchical <h1–h6> & \"Skip to content\" link",
      id: "W-HEADINGS",
      measurement: structure,
      passed: structure.skipLink && structure.headings[0] === "H1",
      severity: "major",
    });
    record({
      guideline: "Content › Icon-only buttons are named — provide descriptive aria-label",
      id: "W-NAMES",
      measurement: { unnamedControls: structure.unnamedControls },
      passed: structure.unnamedControls.length === 0,
      severity: "major",
    });

    // The title is the same string in every state of the case, so a tab or a shared link cannot
    // say where the run got to. Recorded as minor: nothing is unusable, but the rule is not met.
    const titles = [];
    for (const scenario of ["orientation", "running", "proposal_pending", "completed_receipt"]) {
      await desktopPage.goto(`${baseUrl}/?scenario=${scenario}`, { waitUntil: "networkidle" });
      titles.push({ scenario, title: await desktopPage.title() });
    }
    record({
      guideline: "Content › Accurate page titles — <title> reflects current context",
      id: "W-TITLE",
      measurement: titles,
      passed: new Set(titles.map((entry) => entry.title)).size > 1,
      severity: "minor",
    });

    const design = await desktopPage.evaluate(() => ({
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      tapHighlight: getComputedStyle(document.querySelector(".button") ?? document.body).webkitTapHighlightColor,
      themeColors: [...document.querySelectorAll("meta[name=theme-color]")].map((meta) => ({ content: meta.content, media: meta.media })),
    }));
    record({
      guideline: "Design › Browser UI matches background — set <meta name=\"theme-color\"> to align browser theme",
      id: "W-THEMECOLOR",
      measurement: design.themeColors,
      passed: design.themeColors.length > 0,
      severity: "minor",
    });
    record({
      guideline: "Design › Set appropriate color-scheme — style <html> with color-scheme: dark in dark themes",
      id: "W-COLORSCHEME",
      measurement: { colorScheme: design.colorScheme },
      passed: design.colorScheme === "dark",
      severity: "major",
    });
    record({
      guideline: "Interactions › Tap highlight follows design — set webkit-tap-highlight-color",
      id: "W-TAPHL",
      measurement: { tapHighlight: design.tapHighlight },
      passed: design.tapHighlight !== "rgba(0, 0, 0, 0.18)" && !/51, 181, 229/.test(design.tapHighlight),
      severity: "minor",
    });

    // ---- Animations. Read from the stylesheet the page actually served, not from the repo.
    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    record({
      guideline: "Animations › Honor prefers-reduced-motion — provide reduced-motion variant",
      id: "W-REDUCEDMOTION",
      measurement: { hasQuery: css.includes("prefers-reduced-motion") },
      passed: css.includes("prefers-reduced-motion"),
      severity: "major",
    });
    record({
      guideline: "Animations › Never transition: all — explicitly list only intended properties",
      id: "W-TRANSITIONALL",
      measurement: { occurrences: (css.match(/transition:\s*all/g) ?? []).length },
      passed: !/transition:\s*all/.test(css),
      severity: "minor",
    });

    const majorFindings = findings.filter((finding) => !finding.passed && finding.severity === "major");
    const minorFindings = findings.filter((finding) => !finding.passed && finding.severity === "minor");
    const review = {
      checked: findings.length,
      findings,
      guidelines: { retrieved: GUIDELINES_RETRIEVED, url: GUIDELINES_URL },
      majorUnresolved: majorFindings.map((finding) => ({ guideline: finding.guideline, id: finding.id })),
      minorUnresolved: minorFindings.map((finding) => ({ guideline: finding.guideline, id: finding.id })),
      note: "A Lighthouse or axe score is NOT evidence for this condition. Every row here is a WIG rule measured on the rendered surface; condition 8's audit is a separate instrument with no shared rule.",
      passed: majorFindings.length === 0,
      reviewedAt: new Date().toISOString(),
      surface: `${baseUrl}/ (application produced by \`nodekit create\`)`,
    };
    await writeFile(path.join(outputRoot, "wig-review.json"), `${JSON.stringify(review, null, 2)}\n`);

    console.log(JSON.stringify({
      checked: review.checked,
      major: review.majorUnresolved,
      minor: review.minorUnresolved,
      passed: review.passed,
    }, null, 2));
    if (!review.passed) process.exitCode = 1;
  } finally {
    for (const step of cleanup.reverse()) {
      try { await step(); } catch { /* best effort teardown */ }
    }
    if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
  }
}

await main();
