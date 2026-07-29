#!/usr/bin/env node
// Fixture slice: `salon-brief week` — the only entrypoint the owner touches.

import { buildWeeklyBrief } from "./weekly-brief.mjs";

export function renderBrief(brief) {
  const lines = [
    brief.label,
    `estimated operating profit: ${brief.estimatedOperatingProfit}`,
    `receipt coverage: ${Math.round(brief.receiptCoverage * 100)}%`,
    `items blocking verification: ${brief.verificationQueue.length}`,
  ];
  return lines.join("\n");
}

export function main(payload) {
  return renderBrief(buildWeeklyBrief(payload));
}
