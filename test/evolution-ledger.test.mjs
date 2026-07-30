import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildEvolutionDocs,
  checkEvolutionMateriality,
  createDeferredEvolutionReview,
  draftEvolutionEvent,
  initializeEvolutionLedger,
  proposeEvolutionKnowledgePatch,
  queryEvolutionLedger,
  recordEvolutionRecord,
  verifyEvolutionLedger,
} from "../src/lib/evolution-ledger.mjs";
import { grantApproval, proposed } from "./helpers/evolution-approval-fixture.mjs";
import { initializeKnowledgeGraph } from "../src/lib/knowledge-evolution.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-evolution-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "nodekit@example.com"]);
  git(root, ["config", "user.name", "NodeKit Test"]);
  await writeFile(path.join(root, "verifier.txt"), "proposal-before-mutation verified\n");
  git(root, ["add", "verifier.txt"]);
  git(root, ["commit", "-m", "test invariant"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const bytes = await readFile(path.join(root, "verifier.txt"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await initializeEvolutionLedger(root);
  const records = [
    { schemaVersion: "nodekit.evolution-evidence/v1", id: "evd:test", kind: "test", artifactRef: "file:verifier.txt", sha256, sourceCommit: commit, generatedAt: new Date().toISOString(), command: "node --test", environment: { platform: process.platform }, verifiesInvariantIds: ["inv:test"], nodeProofReceiptId: "proof:test", result: "pass" },
    { schemaVersion: "nodekit.assumption/v1", id: "asm:test", statement: "Direct mutation was safe", scope: { applications: ["fixture"] }, status: "disproven", introducedByEventId: "evt:test", invalidatedByEventId: "evt:test", supportingEvidenceIds: [], contradictingEvidenceIds: ["evd:test"] },
    { schemaVersion: "nodekit.invariant-claim/v1", id: "inv:test", statement: "Agent writes remain proposals until approval", scope: { applications: ["fixture"] }, enforcement: "runtime-gate", verifierRefs: ["verifier.txt"], introducedByEventId: "evt:test", status: "verified" },
    { schemaVersion: "nodekit.evolution-event/v1", id: "evt:test", projectId: "fixture", repository: "local/fixture", source: { commitSha: commit, occurredAt: new Date().toISOString() }, track: "architecture", category: "runtime", challenge: "Direct mutation corrupted canonical state", observedFailure: "A stale agent write replaced newer work", resolution: "Introduced proposal validation and approval", assumptionIds: ["asm:test"], invariantIds: ["inv:test"], evidenceIds: ["evd:test"], knownLimitations: [], interpretation: { status: "agent-proposed" } },
    { schemaVersion: "nodekit.evolution-adoption/v1", id: "adp:test", invariantId: "inv:test", consumer: { repository: "local/fixture", application: "fixture" }, adoptedAtCommit: commit, evidenceIds: ["evd:test"], status: "verified" },
  ];
  await mkdir(path.join(root, "inputs"));
  for (const record of records) {
    const file = path.join(root, "inputs", `${record.id.replace(":", "-")}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    // Events now need a verified approval to become canonical; the other record types do not.
    const approval = record.schemaVersion === "nodekit.evolution-event/v1"
      ? await grantApproval(root, record)
      : null;
    await recordEvolutionRecord(root, path.relative(root, file), approval);
  }
  return { commit, records, root };
}

test("Evolution Ledger verifies causal records, immutable evidence, and consumer adoption", async () => {
  const { root } = await fixture();
  const verdict = await verifyEvolutionLedger(root);
  assert.equal(verdict.passed, true, verdict.issues.join("\n"));
  assert.deepEqual(verdict.counts, { events: 1, assumptions: 1, invariants: 1, evidence: 1, adoptions: 1 });
  const query = await queryEvolutionLedger(root, { invariantId: "inv:test" });
  assert.equal(query.events.length, 1);
  assert.equal(query.adoptions[0].status, "verified");
});

test("Evolution Ledger detects evidence drift and refuses canonical overwrite", async () => {
  const { records, root } = await fixture();
  await writeFile(path.join(root, "verifier.txt"), "drifted\n");
  const verdict = await verifyEvolutionLedger(root);
  assert.equal(verdict.passed, false);
  assert.match(verdict.issues.join("\n"), /hash mismatch/);
  const event = records.find((record) => record.schemaVersion === "nodekit.evolution-event/v1");
  event.resolution = "silently overwritten";
  const input = path.join(root, "inputs", "changed-event.json");
  await writeFile(input, `${JSON.stringify(event, null, 2)}\n`);
  await assert.rejects(() => recordEvolutionRecord(root, path.relative(root, input)), /immutable/);
});

test("verified evolution history generates projections and only proposes Knowledge Evolution changes", async () => {
  const { root } = await fixture();
  const docs = await buildEvolutionDocs(root);
  assert.match(await readFile(docs.output, "utf8"), /proposal validation and approval/i);
  await initializeKnowledgeGraph(root, { graphId: "fixture-evolution" });
  const { patch } = await proposeEvolutionKnowledgePatch(root);
  assert.equal(patch.status, "pending");
  assert.equal(patch.operations.some((operation) => operation.node?.kind === "evidence"), true);
  const graph = JSON.parse(await readFile(path.join(root, ".nodeagent", "knowledge", "graph.json"), "utf8"));
  assert.equal(graph.version, 0);
  assert.equal(graph.nodes.length, 0);
});

test("materiality gate blocks unrecorded system changes and accepts a reviewed event in range", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "runtime.mjs"), "export const version = 2;\n");
  git(root, ["add", "src/runtime.mjs"]);
  git(root, ["commit", "-m", "material runtime change"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const blocked = await checkEvolutionMateriality(root, before, after);
  assert.equal(blocked.passed, false);
  assert.deepEqual(blocked.materialFiles, ["src/runtime.mjs"]);

  const event = {
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:material-runtime-change",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "architecture",
    category: "runtime",
    challenge: "Runtime contract changed",
    resolution: "Recorded the reviewed material change",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: [],
    interpretation: { status: "agent-proposed" },
  };
  const input = path.join(root, "inputs", "material-event.json");
  await writeFile(input, `${JSON.stringify(event, null, 2)}\n`);
  await recordEvolutionRecord(root, path.relative(root, input), await grantApproval(root, event));
  const passed = await checkEvolutionMateriality(root, before, after);
  assert.equal(passed.passed, true);
  assert.equal(passed.events[0].id, event.id);
});

test("reversible package change continues with exact live I/O, human-goal proof, and no forged approval", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "session-resume.mjs"), "export const resume = (id) => ({ sessionId: id, resumed: true });\n");
  git(root, ["add", "src/session-resume.mjs"]);
  git(root, ["commit", "-m", "add resumable session runtime"]);
  const after = git(root, ["rev-parse", "HEAD"]);

  const event = {
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:resumable-session-runtime",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "architecture",
    category: "runtime",
    challenge: "A maintainer cannot safely resume the intended session after restart",
    observedFailure: "The old package has no resumable-session entry point",
    resolution: "Bind a session id to a deterministic resume result with rollback proof",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: ["Package-only change; no product UI surface exists"],
    interpretation: { status: "agent-proposed" },
  };
  const draftRef = path.join("evolution", "drafts", "evt-resumable-session-runtime.json");
  await mkdir(path.join(root, "evolution", "drafts"), { recursive: true });
  await writeFile(path.join(root, draftRef), `${JSON.stringify(event, null, 2)}\n`);

  const evidenceRoot = path.join(root, "evidence", "deferred-review");
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(
    path.join(evidenceRoot, "before-live.json"),
    `${JSON.stringify({ request: { operation: "resume", sessionId: "session-7" }, response: { error: "ERR_PACKAGE_PATH_NOT_EXPORTED" } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(evidenceRoot, "after-live.json"),
    `${JSON.stringify({ request: { operation: "resume", sessionId: "session-7" }, response: { sessionId: "session-7", resumed: true } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(evidenceRoot, "journey.md"),
    "# Resume the correct coding session\n\nBefore: restart loses the trustworthy continuation path.\n\nAfter: the same session id resumes deterministically.\n",
  );
  await writeFile(path.join(evidenceRoot, "rollback-test.log"), "PASS baseline import fails; candidate import succeeds; reverting restores baseline behavior\n");

  const relativeEvidence = (name) => path.join("evidence", "deferred-review", name).replaceAll("\\", "/");
  const created = await createDeferredEvolutionReview(root, {
    draftRefs: [draftRef],
    from: before,
    to: after,
    rollbackTarget: before,
    before: [{ ref: relativeEvidence("before-live.json"), kind: "live-io" }],
    after: [
      { ref: relativeEvidence("after-live.json"), kind: "live-io" },
      { ref: relativeEvidence("journey.md"), kind: "journey-card" },
      { ref: relativeEvidence("rollback-test.log"), kind: "test-log" },
    ],
    uiChanged: false,
    uiReason: "Package runtime only; the intended user goal is shown by the journey card and exact I/O.",
    rollbackVerificationRefs: [relativeEvidence("rollback-test.log")],
  });

  assert.equal(created.receipt.events[0].eventId, event.id);
  assert.equal(created.receipt.review.status, "deferred-human-review");
  assert.equal(event.interpretation.status, "agent-proposed");
  const passed = await checkEvolutionMateriality(root, before, after);
  assert.equal(passed.passed, true, passed.reason);
  assert.equal(passed.events.length, 0, "deferred review must not forge a canonical event");
  assert.equal(passed.deferredReviews.length, 1);

  await writeFile(path.join(evidenceRoot, "after-live.json"), "{\"tampered\":true}\n");
  const tampered = await checkEvolutionMateriality(root, before, after);
  assert.equal(tampered.passed, false);
  assert.equal(tampered.deferredReviews.length, 0);
  assert.match(tampered.rejectedDeferredReviews[0].findings.join("\n"), /evidence digest mismatch/);

  await writeFile(path.join(root, "src", "next-runtime.mjs"), "export const next = true;\n");
  git(root, ["add", "src/next-runtime.mjs"]);
  git(root, ["commit", "-m", "next unrelated material range"]);
  const next = git(root, ["rev-parse", "HEAD"]);
  const unrelatedRange = await checkEvolutionMateriality(root, after, next);
  assert.equal(unrelatedRange.passed, false);
  assert.equal(unrelatedRange.rejectedDeferredReviews.length, 0);
  assert.equal(unrelatedRange.historicalDeferredReviews[0].id, created.receipt.id);
});

test("deferred review refuses missing UI proof and evidence that is not bound to rollback", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "ui-runtime.mjs"), "export const changed = true;\n");
  git(root, ["add", "src/ui-runtime.mjs"]);
  git(root, ["commit", "-m", "change visible runtime"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const draftRef = path.join("evolution", "drafts", "evt-visible-runtime.json");
  await mkdir(path.join(root, "evolution", "drafts"), { recursive: true });
  await writeFile(path.join(root, draftRef), `${JSON.stringify({
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:visible-runtime",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "product",
    category: "ui",
    challenge: "Visible runtime changed",
    resolution: "Show the changed state",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: [],
    interpretation: { status: "agent-proposed" },
  }, null, 2)}\n`);
  await mkdir(path.join(root, "evidence"), { recursive: true });
  for (const name of ["before.json", "after.json", "journey.md", "rollback.log"]) {
    await writeFile(path.join(root, "evidence", name), `${name}\n`);
  }
  const input = {
    draftRefs: [draftRef],
    from: before,
    to: after,
    rollbackTarget: before,
    before: [{ ref: "evidence/before.json", kind: "live-io" }],
    after: [
      { ref: "evidence/after.json", kind: "live-io" },
      { ref: "evidence/journey.md", kind: "journey-card" },
    ],
    uiChanged: true,
    rollbackVerificationRefs: ["evidence/rollback.log"],
  };
  await assert.rejects(
    () => createDeferredEvolutionReview(root, input),
    /changed UI surface requires screenshot or clip/,
  );
  await assert.rejects(
    () => createDeferredEvolutionReview(root, { ...input, uiChanged: false, uiReason: "No UI" }),
    /must be content-bound in after evidence/,
  );
});

test("approval-architecture changes require a content-bound operator directive", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await writeFile(path.join(root, "src", "lib", "evolution-trust.mjs"), "export const mode = 'deferred-proof';\n");
  git(root, ["add", "src/lib/evolution-trust.mjs"]);
  git(root, ["commit", "-m", "change approval architecture"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const draftRef = path.join("evolution", "drafts", "evt-approval-architecture.json");
  await mkdir(path.join(root, "evolution", "drafts"), { recursive: true });
  await writeFile(path.join(root, draftRef), `${JSON.stringify({
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:approval-architecture",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "architecture",
    category: "security",
    challenge: "Approval architecture interrupts reversible work",
    resolution: "Bind an explicit operator directive to a reversible proof receipt",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: ["The directive is not a canonical-event signature"],
    interpretation: { status: "agent-proposed" },
  }, null, 2)}\n`);
  await mkdir(path.join(root, "evidence"), { recursive: true });
  for (const [name, value] of [
    ["before.json", "{}\n"],
    ["after.json", "{}\n"],
    ["journey.md", "# Before / after\n"],
    ["rollback.log", "PASS\n"],
    ["directive.md", "Operator directive: reversible architecture changes use proof plus rollback.\n"],
  ]) await writeFile(path.join(root, "evidence", name), value);
  const baseInput = {
    draftRefs: [draftRef],
    from: before,
    to: after,
    rollbackTarget: before,
    before: [{ ref: "evidence/before.json", kind: "live-io" }],
    after: [
      { ref: "evidence/after.json", kind: "live-io" },
      { ref: "evidence/journey.md", kind: "journey-card" },
      { ref: "evidence/rollback.log", kind: "test-log" },
    ],
    uiChanged: false,
    uiReason: "Trust-policy package runtime has no product UI.",
    rollbackVerificationRefs: ["evidence/rollback.log"],
  };
  await assert.rejects(
    () => createDeferredEvolutionReview(root, baseInput),
    /requires the operator directive/,
  );
  const created = await createDeferredEvolutionReview(root, {
    ...baseInput,
    before: [...baseInput.before, { ref: "evidence/directive.md", kind: "operator-directive" }],
    authorityDirectiveRef: "evidence/directive.md",
  });
  assert.equal(created.receipt.risk.effects.credentialOrAuthorityChange, true);
  assert.equal(created.receipt.risk.authorityDirective.assurance, "operator-directed-in-session");
});

test("deferred review cannot bypass pre-action review for migration paths", async () => {
  const { commit: before, root } = await fixture();
  await mkdir(path.join(root, "src", "migrations"), { recursive: true });
  await writeFile(path.join(root, "src", "migrations", "drop-state.mjs"), "export const destructive = true;\n");
  git(root, ["add", "src/migrations/drop-state.mjs"]);
  git(root, ["commit", "-m", "add destructive migration"]);
  const after = git(root, ["rev-parse", "HEAD"]);
  const draftRef = path.join("evolution", "drafts", "evt-destructive-migration.json");
  await mkdir(path.join(root, "evolution", "drafts"), { recursive: true });
  await writeFile(path.join(root, draftRef), `${JSON.stringify({
    schemaVersion: "nodekit.evolution-event/v1",
    id: "evt:destructive-migration",
    projectId: "fixture",
    repository: "local/fixture",
    source: { commitSha: after, occurredAt: new Date().toISOString() },
    track: "architecture",
    category: "runtime",
    challenge: "State layout changed",
    resolution: "Migrate state",
    assumptionIds: [],
    invariantIds: [],
    evidenceIds: ["evd:test"],
    knownLimitations: [],
    interpretation: { status: "agent-proposed" },
  }, null, 2)}\n`);
  await assert.rejects(
    () => createDeferredEvolutionReview(root, {
      draftRefs: [draftRef],
      from: before,
      to: after,
      rollbackTarget: before,
      before: [],
      after: [],
      uiChanged: false,
      uiReason: "No UI",
      rollbackVerificationRefs: [],
    }),
    /deferred review is forbidden for pre-action-review paths: src\/migrations\/drop-state\.mjs/,
  );
});

test("concurrent agent proposals with one id never become last-writer-wins", async () => {
  const { root } = await fixture();
  const input = {
    id: "evt:concurrent-maintainer-proposal",
    track: "harness",
    category: "evaluation",
    challenge: "Two maintainers propose the same event during a release burst",
    observedFailure: "A check-then-write lane can overwrite the first proposal",
    resolution: "Create draft files exclusively so exactly one proposal wins",
    evidenceIds: ["evd:test"],
  };

  const results = await Promise.allSettled([
    draftEvolutionEvent(root, input),
    draftEvolutionEvent(root, input),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "EEXIST");

  const stored = JSON.parse(await readFile(
    path.join(root, "evolution", "drafts", "evt-concurrent-maintainer-proposal.json"),
    "utf8",
  ));
  assert.equal(stored.id, input.id);
  assert.deepEqual(stored.evidenceIds, ["evd:test"]);
  assert.deepEqual(stored.interpretation, { status: "agent-proposed" });
});
