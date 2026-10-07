// Records the README first-win clip: the guided case page served by an app
// that `node src/cli.mjs create` just generated. Nothing staged — the page,
// the proposal, and the receipt are the created app's own demo runtime.
//
// Reproduce:
//   node src/cli.mjs create ../demo-app --name demo-app --brief "triage inbound support tickets"
//   cd ../demo-app && npm install && npm run compile && npm run demo   # "passed": true
//   PORT=4599 npm run dev                                             # serves the guided case
//   cd ../NodeKit && npm i --no-save playwright                       # recorder dep only
//   node scripts/record-readme-first-win.mjs                          # writes docs/media/*.webm
//   ffmpeg -i docs/media/readme-first-win.webm \
//     -vf "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
//     docs/media/readme-first-win.gif
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4599/";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "docs", "media");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

// The demo app keeps its case state across visits. Reset it (its own control,
// outside the recording) so the clip starts from the fresh guided case.
{
  const pre = await browser.newPage();
  await pre.goto(appUrl, { waitUntil: "networkidle" });
  const reset = pre.getByRole("button", { name: "Reset demonstration" }).first();
  if (await reset.isVisible().catch(() => false)) {
    await reset.click();
    await pre.waitForTimeout(1_500);
  }
  await pre.close();
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// First visible instance of a button name (the page repeats labels in the rail).
const visible = async (name) => {
  for (const el of await page.getByRole("button", { name }).all()) {
    if (await el.isVisible()) return el;
  }
  throw new Error(`no visible button: ${name}`);
};

await page.goto(appUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(3_000); // let the guided case read

(await visible("Confirm outcome")).click();
await page.waitForTimeout(3_500);

(await visible("Prepare proposal")).click();
await page.waitForTimeout(4_500); // agent prepares the scoped proposal

(await visible("Approve")).click();
await page.waitForTimeout(4_000); // verify-and-export completes

// Hold on the completed state: canonical artifact + content-addressed receipt.
await page.waitForTimeout(4_000);

const video = page.video();
await context.close();
await browser.close();
console.log("recorded:", await video.path());
console.log("rename to docs/media/readme-first-win.webm, then run the ffmpeg step above");
