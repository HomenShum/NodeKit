/**
 * Playwright is a PEER of these gates, never a dependency of the platform.
 *
 * NodeKit core ships dependency-free — that is the whole claim, and it is the same split the
 * motion ladder draws: the platform owns the grammar and the gate, the consuming application owns
 * the runtime that executes it. A UI gate that drags a browser engine into the platform's
 * dependency tree has traded the claim for a bundle.
 *
 * So these scripts resolve `playwright` at run time from the CONSUMER's tree.
 *
 * The important half is the failure mode. A missing browser must fail CLOSED and loudly. The
 * tempting alternative — skip the check, report nothing, exit 0 — is precisely the vacuous pass
 * (docs/VACUOUS_PASS.md): a green result from an instrument that measured nothing. "No browser, so
 * no findings, so PASS" is the exact shape this repository spent a day cataloguing.
 */

export async function requireChromium(toolName) {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    throw new Error(
      [
        `${toolName} requires Playwright, which NodeKit deliberately does not depend on.`,
        "",
        "  Install it in the repository being audited, not in the platform:",
        "      npm install --save-dev playwright && npx playwright install chromium",
        "",
        "  This exits non-zero rather than skipping. A gate that cannot reach a browser has",
        "  NOT RUN, and not-run is never a pass.",
      ].join("\n"),
    );
  }
}
