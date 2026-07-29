#!/usr/bin/env node
/**
 * probe-propose-guards.mjs — attack every authority guard in propose-evolution.mjs,
 * and prove the attack actually REACHED the guard it is aiming at.
 *
 * WHY THIS EXISTS
 *
 * evolution/artifacts/propose-evolution-guards.md recorded four guards as
 * adversarially tested. Three of the four commands never reached the guard they
 * named. The old propose-evolution.mjs validated required arguments BEFORE it
 * checked kebab-case, materiality, or an existing draft, so:
 *
 *   propose-evolution.mjs --materiality made-up
 *     recorded as: "unknown materiality made-up"        exit=2
 *     actual:      "--id is required"                    exit=2
 *
 * Materiality was also a silent no-op: the event schema has no such field, so
 * even an allowed value disappeared from the written record. The repaired CLI
 * rejects unknown flags instead of letting callers believe ignored input was stored.
 *
 * The exit code matched. The cause did not. An exit code's value is not its
 * reason, and a probe that reads only the number cannot tell a fired guard from
 * an argument parser refusing to start.
 *
 * So this probe asserts on the MESSAGE as well as the code, and every case
 * supplies a complete, otherwise-valid argument set so that exactly one thing
 * is wrong at a time. A case whose message does not match is reported as
 * NOT-REACHED, which is a different failure from a guard that did not hold.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "propose-evolution.mjs");
const DRAFTS = path.resolve(HERE, "..", "evolution", "drafts");

/** A complete, valid invocation. Each case overrides exactly one field. */
const VALID = {
  "--track": "harness",
  "--id": "probe-guard-scratch",
  "--challenge": "probe",
  "--observed": "probe",
  "--resolution": "probe",
  "--evidence": "evd:cli-authority-bypass-and-repair",
};

function run(overrides, extra = []) {
  const args = [];
  for (const [k, v] of Object.entries({ ...VALID, ...overrides })) {
    if (v === null) continue;                       // null removes the flag
    args.push(k, v);
  }
  args.push(...extra);
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, text: out };
  } catch (e) {
    return { code: e.status ?? -1, text: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const CASES = [
  {
    name: "G1  self-approval  --status human-reviewed",
    overrides: { "--status": "human-reviewed" },
    wantCode: 5,
    wantMessage: /cannot write interpretation\.status=human-reviewed/,
  },
  {
    name: "G2  non-kebab id",
    overrides: { "--id": "Not_Kebab Case" },
    wantCode: 2,
    wantMessage: /--id must be kebab-case/,
  },
  {
    name: "G3  overwrite an existing draft",
    overrides: { "--id": "copy-as-proof-surface" },
    wantCode: 4,
    wantMessage: /already exists.*delete is prohibited/s,
  },
  {
    name: "G4  unknown flag",
    overrides: {},
    extra: ["--materiality", "made-up"],
    wantCode: 2,
    wantMessage: /unknown flag --materiality/,
  },
  {
    name: "G5  invented track",
    overrides: { "--track": "not-a-track" },
    wantCode: 2,
    wantMessage: /--track must be one of/,
  },
  {
    // The path-escape guard is unreachable through --id, because kebab-case
    // rejects a slash first. That is defence in depth, and the probe records
    // which guard actually fired rather than claiming the deeper one did.
    name: "G6  path escape via --id",
    overrides: { "--id": "../events/harness/pwned" },
    wantCode: 2,
    wantMessage: /--id must be kebab-case/,
    note: "kebab-case rejects it before the containment check; both are guards, only the first fires",
  },
];

let failed = 0;
for (const c of CASES) {
  const r = run(c.overrides, c.extra ?? []);
  const codeOk = r.code === c.wantCode;
  const msgOk = c.wantMessage.test(r.text);
  const verdict = codeOk && msgOk ? "HOLDS"
    : !msgOk ? "NOT-REACHED"                       // something else refused first
    : "WRONG-CODE";
  if (verdict !== "HOLDS") failed++;
  console.log(`${verdict.padEnd(12)} ${c.name}`);
  console.log(`             exit ${r.code} (want ${c.wantCode})  ${r.text.trim().split("\n")[0]?.slice(0, 96)}`);
  if (c.note) console.log(`             note: ${c.note}`);
}

// A guard probe that leaves a real draft behind has written to the ledger it
// was only supposed to attack.
const scratch = path.join(DRAFTS, "evt-probe-guard-scratch.json");
if (existsSync(scratch)) {
  console.log("\nWARNING: the probe created evt-probe-guard-scratch.json — removing it");
  rmSync(scratch);
  failed++;
}

console.log(`\n${CASES.length - failed}/${CASES.length} guards hold and were actually reached.`);
process.exit(failed ? 1 : 0);
