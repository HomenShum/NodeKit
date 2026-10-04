import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { validateSchema } from "../src/lib/schema-validation.mjs";
import { readJson, pathExists } from "../src/lib/files.mjs";
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
import { applyGraphPatch, decideGraphPatch, initializeKnowledgeGraph, proposeGraphPatch,
  queryKnowledgeGraph, readKnowledgeGraph, validateGraphPatch } from "../src/lib/knowledge-evolution.mjs";

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

// Eight sequential calls that drew no complaint were read as "no meaningful rate limiting", and the
// next thing to run was twelve concurrent requests, which got a 429. The measurement was real; it
// just answered a different question than the one the claim was later asked. So a claim that
// generalises has to name the axis it was measured on.
test("an assumption that generalises must name the dimension its evidence measured", async () => {
  const { validateSchema } = await import("../src/lib/schema-validation.mjs");
  const SCHEMA = "nodekit.assumption.v1.schema.json";
  const base = {
    schemaVersion: "nodekit.assumption/v1",
    id: "asm:rate-limit",
    statement: "The API applies no meaningful rate limiting",
    scope: { applications: ["fixture"] },
    introducedByEventId: "evt:test",
    supportingEvidenceIds: ["evd:test"],
    contradictingEvidenceIds: [],
  };
  const errors = (doc) => validateSchema(SCHEMA, doc, "assumption");

  for (const status of ["supported", "scope-limited"]) {
    assert.ok(
      (await errors({ ...base, status })).length > 0,
      `${status} without a named dimension is a measurement travelling to a question it never asked`,
    );
    assert.ok((await errors({ ...base, status, dimensionsTested: [] })).length > 0, "an empty axis list is the same silence");
    assert.deepEqual(await errors({ ...base, status, dimensionsTested: ["8 sequential requests"] }), []);
  }

  // untested/disproven/superseded make no generalising claim, so they owe no axis.
  for (const status of ["untested", "disproven", "superseded"]) {
    assert.deepEqual(
      await errors({ ...base, status, contradictingEvidenceIds: status === "untested" ? [] : ["evd:test"] }),
      [],
      `${status} should not require a dimension`,
    );
  }
});

test("repository assumptions preserve authored provenance without certifying unmeasured historical scope", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const verdict = await verifyEvolutionLedger(root);
  assert.equal(verdict.passed, true, verdict.issues.join("\n"));
  const query = await queryEvolutionLedger(root);
  assert.equal(query.passed, true, query.issues.join("\n"));
  assert.ok(query.assumptions.length > 0, "a pass over zero assumptions measures nothing");
  const qualifications = new Map(query.historicalQualifications.map((entry) => [entry.id, entry]));
  let generalising = 0;
  for (const record of query.assumptions) {
    if (!["supported", "scope-limited"].includes(record.status)) continue;
    generalising += 1;
    if (record.dimensionsTested?.length > 0) {
      assert.equal(qualifications.has(record.id), false);
      continue;
    }
    const origin = qualifications.get(record.id);
    assert.ok(origin, `${record.id} lacks mandatory authored qualification`);
    assert.equal(origin.classification, "authored-historical-unscoped");
    assert.equal(origin.currentDimensionsCertified, false);
    assert.equal(origin.originalSchemaSha256, "4d2998bf89b4eb2c1caf3cf5b2a95b600f68ed1565b0cb87a4aca2837526922f");
    assert.match(origin.introducedIn, /^[a-f0-9]{40}$/);
    assert.equal(origin.payloadSha256, origin.originalPayloadSha256);
    const original = JSON.parse(git(root, ["show", `${origin.introducedIn}:${origin.file}`]));
    assert.deepEqual(record, original, "all original claims, not only an id or epoch, must match");
  }
  assert.ok(generalising > 0, "no generalising assumption was checked");

  // An actual new scoped control prevents historical-only success from replacing strict admission.
  const f = await fixture();
  const control = { ...f.records.find((record) => record.id === "asm:test"), id: "asm:current-scope-control",
    status: "scope-limited", dimensionsTested: ["8 concurrent fixture queries", "16 sustained fixture queries"] };
  const input = path.join(f.root, "inputs", "current-scope-control.json");
  await writeFile(input, `${JSON.stringify(control, null, 2)}\n`);
  await recordEvolutionRecord(f.root, path.relative(f.root, input));
  const burst = await Promise.all(Array.from({ length: 8 }, () => queryEvolutionLedger(f.root)));
  for (const result of burst) {
    assert.equal(result.passed, true, result.issues.join("\n"));
    assert.ok(result.assumptions.some((record) => record.id === control.id && record.dimensionsTested.length === 2));
    assert.equal(result.historicalQualifications.length, 0);
  }
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const result = await queryEvolutionLedger(f.root);
    assert.equal(result.passed, true, result.issues.join("\n"));
    assert.equal(result.assumptions.filter((record) => record.id === control.id).length, 1);
    assert.equal(result.historicalQualifications.length, 0);
  }
  await rm(f.root, { recursive: true, force: true });
});

test("a new author missing measured scope is rejected by admission and every current projection", async (t) => {
  for (const status of ["supported", "scope-limited"]) {
    for (const dimensions of [undefined, []]) {
      const f = await fixture();
      t.after(() => rm(f.root, { recursive: true, force: true }));
      const record = { ...f.records.find((record) => record.id === "asm:test"), id: "asm:unknown-current", status };
      if (dimensions !== undefined) record.dimensionsTested = dimensions;
      const input = path.join(f.root, "inputs", "unknown-current.json");
      await writeFile(input, `${JSON.stringify(record, null, 2)}\n`);
      await assert.rejects(() => recordEvolutionRecord(f.root, path.relative(f.root, input)), /validation failed/);
      await writeFile(path.join(f.root, "evolution", "assumptions", "asm-unknown-current.json"), `${JSON.stringify(record, null, 2)}\n`);
      const query = await queryEvolutionLedger(f.root);
      assert.equal(query.passed, false);
      assert.equal(query.historicalQualifications.length, 0);
      assert.ok(query.issues.some((issue) => /dimension/i.test(issue)));
      await assert.rejects(() => buildEvolutionDocs(f.root), /must verify before documentation/);
      assert.equal(await pathExists(path.join(f.root, "evolution", "projections", "EVOLUTION.md")), false);
      await assert.rejects(() => proposeEvolutionKnowledgePatch(f.root), /must verify before graph/);
      assert.equal(await pathExists(path.join(f.root, ".nodeagent", "knowledge", "graph.json")), false);
    }
  }
});

async function authoredConsumerFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-authored-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", sourceRoot, root], { stdio: "ignore" });
  const original = git(root, ["show", "5b9c4d73c286020fe7b7c52d208d7e0cbfeef626:evolution/assumptions/asm-strong-model-infers-topology.json"]);
  await writeFile(path.join(root, "evolution", "assumptions", "asm-strong-model-infers-topology.json"), `${original}\n`);
  return { root, original: JSON.parse(original) };
}

test("historical query and documentation keep unmeasured scope visible beside the unchanged claim", async (t) => {
  const f = await authoredConsumerFixture(t);
  const query = await queryEvolutionLedger(f.root);
  assert.equal(query.passed, true, query.issues.join("\n"));
  assert.deepEqual(query.assumptions.find((record) => record.id === f.original.id), f.original);
  const qualification = query.historicalQualifications.find((entry) => entry.id === f.original.id);
  assert.equal(qualification.currentDimensionsCertified, false);
  const docs = await buildEvolutionDocs(f.root);
  const markdown = await readFile(docs.output, "utf8");
  assert.match(markdown, /current measured scope is unknown \(currentDimensionsCertified: false\)/);
  assert.ok(markdown.includes(qualification.introducedIn));
  assert.ok(markdown.includes(qualification.readSchema));
  assert.ok(markdown.includes(qualification.originalSchemaSha256));
  assert.equal(docs.verdict.historicalQualifications.find((entry) => entry.id === f.original.id).currentDimensionsCertified, false);
});

async function acceptFixturePatch(root, patch) {
  const checked = await validateGraphPatch(root, patch.patchId);
  assert.deepEqual(checked.validation.errors, []);
  await assert.rejects(() => applyGraphPatch(root, patch.patchId), /only accepted/);
  await assert.rejects(() => decideGraphPatch(root, patch.patchId, { decision: "accept" }), /principalId/);
  await decideGraphPatch(root, patch.patchId, { decision: "accept", principalId: "human:fixture-reviewer", reason: "Review fixture grounding and retirement" });
  return applyGraphPatch(root, patch.patchId);
}

test("a populated graph retires the old current claim and causal edge only through grounded approval", async (t) => {
  const f = await authoredConsumerFixture(t);
  await initializeKnowledgeGraph(f.root, { graphId: "fixture:authored-retirement" });
  const initial = await proposeEvolutionKnowledgePatch(f.root);
  const legacyId = `evolution:${f.original.id}`;
  assert.equal(initial.patch.operations.some((operation) => operation.node?.id === legacyId), false);
  assert.equal(initial.patch.operations.some((operation) => operation.hyperedge?.participants.some((participant) => participant.nodeId === legacyId)), false);
  assert.equal((await readKnowledgeGraph(f.root)).nodes.length, 0, "proposal must not mutate canonical graph");
  await acceptFixturePatch(f.root, initial.patch);
  const graph = await readKnowledgeGraph(f.root);
  const evidence = graph.nodes.find((node) => node.kind === "evidence" && node.properties?.evolutionRecordId === "evd:nodevideo-topology-failure");
  const event = graph.nodes.find((node) => node.id === "evolution:evt:nodevideo-topology-contract");
  const invariant = graph.nodes.find((node) => node.id === "evolution:inv:major-frontend-direction-tournament");
  assert.ok(evidence && event && invariant, "use authenticated existing evolution source and current entities");
  const retiredEdgeId = "evolution:fixture:legacy-causal";
  const unrelatedEdgeId = "evolution:fixture:unrelated-causal";
  const seed = await proposeGraphPatch(f.root, {
    graphId: graph.graphId, baseVersion: graph.version,
    operations: [
      { type: "INSERT", node: { id: legacyId, kind: "assumption", label: f.original.statement, layer: "derived", confidence: 0.8, evidenceRefs: [evidence.id], metadata: f.original } },
      { type: "INSERT", hyperedge: { id: retiredEdgeId, predicate: "evolution-causal-chain", layer: "derived", participants: [{ nodeId: event.id, role: "event" }, { nodeId: legacyId, role: "challenged-assumption" }], confidence: 1, evidenceRefs: [evidence.id], createdAt: new Date().toISOString() } },
      { type: "INSERT", hyperedge: { id: unrelatedEdgeId, predicate: "evolution-causal-chain", layer: "derived", participants: [{ nodeId: event.id, role: "event" }, { nodeId: invariant.id, role: "introduced-invariant" }], confidence: 1, evidenceRefs: [evidence.id], createdAt: new Date().toISOString() } },
    ],
    evidenceRefs: [evidence.id], contradictionRefs: [], confidence: 1,
    proposedBy: { agentId: "fixture:old-projector", modelRoute: "deterministic", resolvedModel: "none", harnessVersion: "fixture" },
  });
  await acceptFixturePatch(f.root, seed);
  const before = queryKnowledgeGraph(await readKnowledgeGraph(f.root), event.label);
  assert.ok(before.supportingHyperedges.some((edge) => edge.id === retiredEdgeId), "reproduce the real surviving-edge consumer seam");
  const retirement = await proposeEvolutionKnowledgePatch(f.root);
  const targets = retirement.patch.operations.filter((operation) => operation.type === "DEPRECATE").map((operation) => operation.targetId);
  assert.equal(targets.filter((id) => id === legacyId).length, 1);
  assert.equal(targets.filter((id) => id === retiredEdgeId).length, 1);
  assert.equal(targets.includes(unrelatedEdgeId), false);
  assert.equal(targets.includes(evidence.id), false);
  for (const operation of retirement.patch.operations.filter((operation) => operation.type === "DEPRECATE")) {
    assert.ok(operation.evidenceRefs.includes(evidence.id));
  }
  assert.equal((await readKnowledgeGraph(f.root)).nodes.find((node) => node.id === legacyId).deprecatedAt, undefined);
  await acceptFixturePatch(f.root, retirement.patch);
  const after = await readKnowledgeGraph(f.root);
  assert.ok(after.nodes.find((node) => node.id === legacyId).deprecatedAt);
  assert.ok(after.hyperedges.find((edge) => edge.id === retiredEdgeId).deprecatedAt);
  assert.equal(after.hyperedges.find((edge) => edge.id === unrelatedEdgeId).deprecatedAt, undefined);
  assert.equal(after.nodes.find((node) => node.id === evidence.id).deprecatedAt, undefined);
  const current = queryKnowledgeGraph(after, event.label);
  assert.equal(current.results.some(({ entity }) => entity.id === legacyId), false);
  assert.equal(current.supportingHyperedges.some((edge) => edge.id === retiredEdgeId), false);
  assert.ok(current.supportingHyperedges.some((edge) => edge.id === unrelatedEdgeId));
  await assert.rejects(() => proposeEvolutionKnowledgePatch(f.root), /no new evidence-grounded records.*historicalQualifications=/);
});

async function readerAtActualSeam(root, replaceAfterLoad) {
  // Evaluate the actual existing owner bodies with reader instrumentation. There is no
  // production test hook, second implementation, reduced schema or caller provenance override.
  const source = await readFile(new URL("../src/lib/evolution-ledger.mjs", import.meta.url), "utf8");
  const slice = (from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `${from} reader seam must exist`);
    return source.slice(start, end);
  };
  const body = [
    slice("function digest(", "const DEFERRED_REVIEW_SCHEMA"),
    slice("function resolveInside(", "// Bound the buffer"),
    slice("function commitExists(", "const MAX_LEDGER_RECORDS"),
    slice("const MAX_LEDGER_RECORDS", "export async function initializeEvolutionLedger"),
    slice("function hasCycle(", "async function inspectEvolutionLedger"),
    slice("async function inspectEvolutionLedger", "export async function diffEvolutionLedger"),
    source.slice(source.indexOf("export async function buildEvolutionDocs")),
  ].join("\n").replace(/^export /gm, "");
  const reads = new Map();
  let inspected = 0;
  const { EVOLUTION_EVENT_SCHEMA, EVOLUTION_RECORD_TYPES } = await import("../src/lib/evolution-ledger.mjs");
  const { describeMutations } = await import("../src/lib/evolution-immutability.mjs");
  const { readdir } = await import("node:fs/promises");
  const { evidenceSnapshotToGraphNode, ingestEvidenceBytes, readEvidenceSnapshot } = await import("../src/lib/evidence-snapshots.mjs");
  const readers = vm.runInNewContext(`${body}\n({ verifyEvolutionLedger, queryEvolutionLedger, buildEvolutionDocs, proposeEvolutionKnowledgePatch })`, {
    createHash, execFileSync, mkdir, readFile, readdir, writeFile, path, pathExists,
    readJson: async (file) => { reads.set(file, (reads.get(file) ?? 0) + 1); return readJson(file); },
    EVOLUTION_EVENT_SCHEMA, EVOLUTION_RECORD_TYPES, validateSchema, describeMutations,
    detectLedgerMutations: async (_root, loaded) => {
      inspected += 1;
      await replaceAfterLoad(inspected);
      return { gitAvailable: true, observedHead: git(root, ["rev-parse", "HEAD"]), checked: loaded.length,
        mutations: [], bindingRepairs: [], origins: [], failures: [] };
    },
    evidenceSnapshotToGraphNode, ingestEvidenceBytes, readEvidenceSnapshot, proposeGraphPatch, readKnowledgeGraph,
    now: () => new Date().toISOString(),
  });
  return { readers, reads, inspections: () => inspected };
}

test("concurrent replacement after inspection cannot leak later bytes through verify, query, docs or graph", async (t) => {
  for (const operation of ["verifyEvolutionLedger", "queryEvolutionLedger", "buildEvolutionDocs", "proposeEvolutionKnowledgePatch"]) {
    const f = await fixture();
    t.after(() => rm(f.root, { recursive: true, force: true }));
    const assumptionFile = path.join(f.root, "evolution", "assumptions", "asm-test.json");
    const scoped = { ...f.records.find((record) => record.id === "asm:test"), status: "scope-limited", dimensionsTested: ["the originally loaded scoped payload"] };
    await writeFile(assumptionFile, `${JSON.stringify(scoped, null, 2)}\n`);
    if (operation === "proposeEvolutionKnowledgePatch") await initializeKnowledgeGraph(f.root, { graphId: "fixture:snapshot" });
    const seam = await readerAtActualSeam(f.root, async (inspection) => {
      if (inspection !== 1) return;
      const { dimensionsTested, ...laterUnscoped } = scoped;
      await writeFile(assumptionFile, `${JSON.stringify(laterUnscoped, null, 2)}\n`);
    });
    const result = await seam.readers[operation](f.root);
    assert.equal(seam.inspections(), 1, operation);
    assert.equal(seam.reads.get(assumptionFile), 1, "exact reader boundary must load this record once");
    assert.equal(JSON.parse(await readFile(assumptionFile, "utf8")).dimensionsTested, undefined, "prove competing bytes actually changed");
    if (operation === "verifyEvolutionLedger") assert.equal(result.passed, true);
    if (operation === "queryEvolutionLedger") {
      assert.equal(result.passed, true);
      assert.deepEqual(result.assumptions.find((record) => record.id === scoped.id), scoped);
    }
    if (operation === "buildEvolutionDocs") assert.equal(result.verdict.passed, true);
    if (operation === "proposeEvolutionKnowledgePatch") {
      assert.equal(result.verdict.passed, true);
      const node = result.patch.operations.find((entry) => entry.node?.id === "evolution:asm:test").node;
      assert.deepEqual(node.metadata.dimensionsTested, scoped.dimensionsTested);
    }
    const next = await seam.readers.queryEvolutionLedger(f.root);
    assert.equal(next.passed, false, "a later operation must inspect the new unscoped payload afresh");
    assert.equal(next.historicalQualifications.length, 0);
  }
});

test("reader burst and sustained calls do not share a mutable snapshot or accumulate qualification state", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const seam = await readerAtActualSeam(f.root, async () => {});
  const burst = await Promise.all(Array.from({ length: 32 }, () => seam.readers.queryEvolutionLedger(f.root)));
  for (const result of burst) {
    assert.equal(result.passed, true, Array.from(result.issues).join("\n"));
    assert.equal(result.assumptions.length, 1);
    assert.equal(result.historicalQualifications.length, 0);
  }
  burst[0].assumptions[0].statement = "consumer mutated its own result";
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const result = await seam.readers.queryEvolutionLedger(f.root);
    assert.equal(result.assumptions[0].statement, "Direct mutation was safe");
    assert.equal(result.assumptions.length, 1);
    assert.equal(result.historicalQualifications.length, 0);
    assert.equal(result.passed, true);
  }
  assert.equal(seam.inspections(), 132);
  assert.equal(seam.reads.get(path.join(f.root, "evolution", "assumptions", "asm-test.json")), 132);
});
