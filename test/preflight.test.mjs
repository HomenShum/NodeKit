// The install worked. Its own suite passed. It was inert for six hours. Preflight exists to turn
// that into a message at minute zero instead of a discovery at hour six.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluatePreflight, formatPreflight, LIVENESS_TTL_MS, PREFLIGHT_FILE, readHarnessManifest } from "../src/lib/preflight.mjs";

const SESSION_START = "2026-08-02T09:00:00.000Z";
const NOW = Date.parse("2026-08-02T15:00:00.000Z");

async function manifestDir(yaml) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "preflight-"));
  if (yaml !== undefined) await writeFile(path.join(dir, PREFLIGHT_FILE), yaml, "utf8");
  return dir;
}

const plugin = (extra) => `harness:
  - id: ponytail
    kind: plugin
    verifyBefore: npm test
    installedAt: "${extra.installedAt}"
    activation:
      requires: restart
      blocking: true
${extra.confirmedActive ? "      confirmedActive: true\n" : ""}`;

test("a plugin installed during the session is inert, and preflight says so before the work", async () => {
  // Installed at 10:00, session began at 09:00 — the exact case that reads as a successful install.
  const dir = await manifestDir(plugin({ installedAt: "2026-08-02T10:00:00.000Z" }));
  try {
    const verdict = evaluatePreflight(await readHarnessManifest(dir), { sessionStartedAt: SESSION_START, now: NOW });
    assert.equal(verdict.passed, false);
    assert.ok(verdict.blockers.some((b) => /inert right now/.test(b)), verdict.blockers.join("; "));
    assert.match(formatPreflight(verdict), /BLOCKED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plugin installed before the session, or confirmed active, passes", async () => {
  for (const yaml of [
    plugin({ installedAt: "2026-08-01T10:00:00.000Z" }),
    plugin({ installedAt: "2026-08-02T10:00:00.000Z", confirmedActive: true }),
  ]) {
    const dir = await manifestDir(yaml);
    try {
      const verdict = evaluatePreflight(await readHarnessManifest(dir), { sessionStartedAt: SESSION_START, now: NOW });
      assert.equal(verdict.passed, true, verdict.blockers.join("; "));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a non-blocking activation requirement warns instead of stopping the work", async () => {
  const dir = await manifestDir(`harness:
  - id: codex-hooks
    kind: plugin
    verifyBefore: npm test
    installedAt: "2026-08-02T10:00:00.000Z"
    activation:
      requires: interactive-trust
      blocking: false
`);
  try {
    const verdict = evaluatePreflight(await readHarnessManifest(dir), { sessionStartedAt: SESSION_START, now: NOW });
    assert.equal(verdict.passed, true, "a non-blocking dependency must not stop the session");
    assert.equal(verdict.warnings.length, 1, "but it must still be said out loud");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an external generator is unusable until probed, and a stale probe is a memory", async () => {
  const service = (checkedAt) => `harness:
  - id: v0
    kind: external-service
    livenessProbe: "curl -s https://v0.dev/api/health"
${checkedAt ? `    livenessCheckedAt: "${checkedAt}"\n` : ""}    activation:
      requires: none
      blocking: true
`;
  const cases = [
    { yaml: service(null), pattern: /never probed for liveness/ },
    { yaml: service(new Date(NOW - LIVENESS_TTL_MS - 3600000).toISOString()), pattern: /credit and quota do not persist/ },
  ];
  for (const { yaml, pattern } of cases) {
    const dir = await manifestDir(yaml);
    try {
      const verdict = evaluatePreflight(await readHarnessManifest(dir), { sessionStartedAt: SESSION_START, now: NOW });
      assert.equal(verdict.passed, false);
      assert.ok(verdict.blockers.some((b) => pattern.test(b)), verdict.blockers.join("; "));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const fresh = await manifestDir(service(new Date(NOW - 3600000).toISOString()));
  try {
    assert.equal(evaluatePreflight(await readHarnessManifest(fresh), { sessionStartedAt: SESSION_START, now: NOW }).passed, true);
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
});

test("the manifest refuses declarations that would read as complete", async () => {
  const cases = [
    { yaml: "harness:\n  - id: x\n    kind: plugin\n    activation:\n      requires: restart\n      blocking: true\n", pattern: /must declare verifyBefore/ },
    { yaml: "harness:\n  - id: x\n    kind: external-service\n    activation:\n      requires: none\n      blocking: true\n", pattern: /must declare a livenessProbe/ },
    { yaml: "harness:\n  - id: x\n    kind: plugin\n    verifyBefore: npm test\n    activation:\n      requires: someday\n      blocking: true\n", pattern: /activation.requires/ },
    { yaml: "harness:\n  - id: x\n    kind: gadget\n    activation:\n      requires: none\n      blocking: true\n", pattern: /kind must be one of/ },
    { yaml: "harness: nope\n", pattern: /must be a list/ },
  ];
  for (const { yaml, pattern } of cases) {
    const dir = await manifestDir(yaml);
    try {
      await assert.rejects(() => readHarnessManifest(dir), pattern, yaml);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const missing = await manifestDir();
  try {
    const manifest = await readHarnessManifest(missing);
    assert.equal(manifest.present, false);
    assert.equal(evaluatePreflight(manifest, { sessionStartedAt: SESSION_START }).passed, true, "no declared harness is not a failure");
  } finally {
    await rm(missing, { recursive: true, force: true });
  }
});
