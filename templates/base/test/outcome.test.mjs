import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { appendOutcome, initializeOutcome, LIMITS, readOutcome, renderOutcome } from "../scripts/outcome.mjs";

const script = fileURLToPath(new URL("../scripts/outcome.mjs", import.meta.url));
const contract = () => ({
  schemaVersion: "app.coding-outcome/v1", runId: "sourcing-pilot-01",
  userJob: "A maker compares supplier quotes and reopens the accepted sourcing packet.",
  target: "Preserve source terms and revised sample evidence after restart.",
  currentVersion: { app: "baseline-commit-a", generator: "generator-commit-a", environment: "node22-lockfile-a" },
  candidateVersion: { app: "candidate-tree-b", generator: "generator-commit-a", environment: "node22-lockfile-a" },
  context: { scope: "Quote comparison and failed-sample revision only", sourceRefs: ["product/BRIEF.md@sha256:example"] },
  cases: [
    { id: "quote-terms", description: "A maker sees unavailable shipping costs as unknown.", required: true },
    { id: "restart", description: "A second agent reopens the exact accepted packet and failed sample.", required: true },
  ],
  invariants: ["Supplier claims remain attributed and cannot authorize a purchase."],
  budgets: { timeMs: 3600000, costUsd: 1, attemptsPerCase: 4 },
});
const caseRecord = (caseId, status = "passed", ref = "proof/evidence.json") => ({
  type: "case", caseId, status, summary: `${caseId} exercised with the maker's saved packet`,
  evidence: { kind: "observed", ref }, measurements: [{ name: "reopened_packets", value: 1, unit: "count" }],
});
const complete = { type: "complete", summary: "All required local evidence is attached; release verification remains separate." };
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-outcome-"));
  await mkdir(path.join(root, "proof"));
  await writeFile(path.join(root, "proof", "evidence.json"), JSON.stringify({ shippingCost: null, sample: "failed", revision: 2 }));
  return root;
}
const logPath = (root) => path.join(root, "proof", "outcome", "events.jsonl");
async function cli(root, command, value) {
  const args = [script, command];
  if (value) {
    const file = path.join(root, `input-${command}.json`);
    await writeFile(file, JSON.stringify(value));
    args.push(file);
  }
  return spawnSync(process.execPath, [...args, "--root", root], { encoding: "utf8", timeout: 15000 });
}

test("a maker's packet survives new CLI processes; both reports reproduce the same log without rewriting it", async () => {
  const root = await workspace();
  assert.equal((await cli(root, "init", contract())).status, 0);
  const first = await readFile(logPath(root), "utf8");
  assert.equal((await cli(root, "append", caseRecord("quote-terms"))).status, 0);
  assert.equal((await cli(root, "append", caseRecord("restart"))).status, 0);
  assert.equal((await cli(root, "append", complete)).status, 0);
  const beforeReport = await readFile(logPath(root), "utf8");
  assert.ok(beforeReport.startsWith(first));
  const output = await cli(root, "report");
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /COMPLETE \(local evidence gate only\)/);
  const { events, logHash } = await readOutcome(root);
  assert.equal(events.length, 4);
  assert.equal(events[2].payload.previousHash, events[1].payload.contentHash);
  const ascii = await readFile(path.join(root, "proof", "outcome", "report.txt"), "utf8");
  const html = await readFile(path.join(root, "proof", "outcome", "report.html"), "utf8");
  assert.ok(ascii.includes(logHash) && html.includes(logHash));
  assert.match(ascii, /not independent verification, approval, or deployment proof/);
  assert.match(ascii, /restart: passed \(self-reported\); evidence: observed/);
  assert.equal(await readFile(logPath(root), "utf8"), beforeReport);
  await assert.rejects(appendOutcome(root, caseRecord("restart")), /already complete/);
  await assert.rejects(initializeOutcome(root, contract()), /EEXIST/);
});

test("an agent cannot close missing, failed, claim-only, or subsequently changed supplier evidence", async () => {
  const root = await workspace();
  await initializeOutcome(root, contract());
  await assert.rejects(appendOutcome(root, complete), /quote-terms, restart/);
  await appendOutcome(root, caseRecord("quote-terms", "failed"));
  await appendOutcome(root, { ...caseRecord("restart"), evidence: { kind: "self-reported", ref: "I believe reload works" } });
  await assert.rejects(appendOutcome(root, complete), /quote-terms, restart/);
  await appendOutcome(root, caseRecord("quote-terms"));
  await appendOutcome(root, caseRecord("restart"));
  await writeFile(path.join(root, "proof", "evidence.json"), "changed supplier data");
  await assert.rejects(appendOutcome(root, complete), /evidence changed/);
  await appendOutcome(root, caseRecord("quote-terms"));
  await appendOutcome(root, caseRecord("restart"));
  await appendOutcome(root, complete);
  assert.equal((await readOutcome(root)).events.filter((event) => event.payload.record.status === "failed").length, 1);
});

test("a later failed retest replaces an earlier passing case for completion without deleting either assessment", async () => {
  const root = await workspace();
  await initializeOutcome(root, contract());
  await appendOutcome(root, caseRecord("quote-terms"));
  await appendOutcome(root, caseRecord("restart"));
  await appendOutcome(root, caseRecord("restart", "failed"));
  await assert.rejects(appendOutcome(root, complete), /restart/);
  const report = await renderOutcome(root);
  assert.match(report.ascii, /restart \[required\]: failed/);
  assert.match(report.ascii, /restart: passed/);
  assert.match(report.ascii, /restart: failed/);
});

test("a reviewer detects edits, reordered history and interrupted writes before another append or report", async () => {
  const root = await workspace();
  await initializeOutcome(root, contract());
  await appendOutcome(root, caseRecord("quote-terms", "failed"));
  const original = await readFile(logPath(root), "utf8");
  for (const corrupted of [original.replace('"status":"failed"', '"status":"passed"'), original.trimEnd().split("\n").reverse().join("\n") + "\n", original.slice(0, -3)]) {
    await writeFile(logPath(root), corrupted);
    await assert.rejects(readOutcome(root), /invalid|incomplete/);
    await assert.rejects(appendOutcome(root, caseRecord("restart")), /invalid|incomplete/);
    await assert.rejects(renderOutcome(root), /invalid|incomplete/);
    assert.equal(await readFile(logPath(root), "utf8"), corrupted);
  }
});

test("supplier-controlled markup and terminal controls remain inert in the human report", async () => {
  const root = await workspace();
  const input = contract();
  input.target = '<script>alert("supplier")</script> & \u001b[31m bilingual 中文';
  await initializeOutcome(root, input);
  await appendOutcome(root, { type: "decision", decision: "propose", summary: '<img src=x onerror="alert(1)"> never authorizes ordering' });
  const { ascii, html } = await renderOutcome(root);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(ascii, /[^\x0a\x20-\x7e]/);
  assert.match(ascii, /Decision: propose \(recorded intent; no authority granted\)/);
});

test("the builder rejects ambiguous contracts and out-of-scope or oversized evidence before persistence", async () => {
  const root = await workspace();
  for (const change of [
    (input) => { input.currentVersion = {}; },
    (input) => { input.cases[1].id = input.cases[0].id; },
    (input) => { input.cases.forEach((item) => { item.required = false; }); },
    (input) => { input.budgets.attemptsPerCase = 0; },
    (input) => { input.unknownApproval = true; },
    (input) => { input.target = "x".repeat(LIMITS.inputBytes); },
  ]) {
    const input = contract(); change(input);
    await assert.rejects(initializeOutcome(root, input));
  }
  await initializeOutcome(root, contract());
  const before = await readFile(logPath(root), "utf8");
  await assert.rejects(appendOutcome(root, caseRecord("unknown")), /unknown case/);
  await writeFile(path.join(root, "proof", "huge.txt"), Buffer.alloc(LIMITS.artifactBytes + 1));
  await assert.rejects(appendOutcome(root, caseRecord("restart", "passed", "proof/huge.txt")), /at most/);
  await writeFile(path.join(root, ".env"), "test fixture, not a credential");
  await assert.rejects(appendOutcome(root, caseRecord("restart", "passed", ".env")), /credential files/);
  const outside = await workspace();
  await assert.rejects(appendOutcome(root, caseRecord("restart", "passed", path.join(outside, "proof", "evidence.json"))), /inside the project/);
  assert.equal(await readFile(logPath(root), "utf8"), before);
});

test("sustained agent attempts stop at the frozen budget and retained history remains reportable", async () => {
  const root = await workspace();
  await initializeOutcome(root, contract());
  for (let index = 0; index < 4; index++) await appendOutcome(root, caseRecord("restart", "failed"));
  await assert.rejects(appendOutcome(root, caseRecord("restart")), /attempt budget exceeded/);
  for (let index = 5; index < LIMITS.events - 1; index++) await appendOutcome(root, { type: "decision", decision: "continue", summary: `Retained diagnostic observation ${index}` });
  await assert.rejects(appendOutcome(root, { type: "decision", decision: "continue", summary: "over limit" }), /event limit/);
  assert.equal((await readOutcome(root)).events.length, LIMITS.events - 1);
  assert.ok(Buffer.byteLength((await renderOutcome(root)).html) < LIMITS.reportBytes);
});

test("burst writers cannot fork the chain; failed writers leave explicit retryable errors", async () => {
  const root = await workspace();
  await initializeOutcome(root, contract());
  const files = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const file = path.join(root, `decision-${index}.json`);
    await writeFile(file, JSON.stringify({ type: "decision", decision: "continue", summary: `Parallel worker ${index}` }));
    return file;
  }));
  const results = await Promise.all(files.map((file) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "append", file, "--root", root], { stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("close", (code) => resolve({ code, error }));
  })));
  for (const result of results) assert.ok(result.code === 0 || /writer busy/.test(result.error), result.error);
  const successful = results.filter((result) => result.code === 0).length;
  assert.ok(successful > 0);
  assert.equal((await readOutcome(root)).events.length, successful + 1);
  await appendOutcome(root, { type: "decision", decision: "continue", summary: "Next session resumes the verified chain" });
  assert.equal((await readOutcome(root)).events.length, successful + 2);
});
