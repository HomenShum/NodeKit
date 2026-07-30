import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, readJson } from "./files.mjs";
import { evidenceSnapshotToGraphNode, ingestEvidenceBytes, readEvidenceSnapshot } from "./evidence-snapshots.mjs";
import { describeMutations, detectLedgerMutations } from "./evolution-immutability.mjs";
import { verifyEvolutionApproval } from "./evolution-approval.mjs";
import { proposeGraphPatch, readKnowledgeGraph } from "./knowledge-evolution.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const EVOLUTION_EVENT_SCHEMA = "nodekit.evolution-event/v1";
export const EVOLUTION_RECORD_TYPES = Object.freeze({
  [EVOLUTION_EVENT_SCHEMA]: { directory: "events", schema: "nodekit.evolution-event.v1.schema.json", plural: "events" },
  "nodekit.assumption/v1": { directory: "assumptions", schema: "nodekit.assumption.v1.schema.json", plural: "assumptions" },
  "nodekit.invariant-claim/v1": { directory: "invariants", schema: "nodekit.invariant-claim.v1.schema.json", plural: "invariants" },
  "nodekit.evolution-evidence/v1": { directory: "evidence", schema: "nodekit.evolution-evidence.v1.schema.json", plural: "evidence" },
  "nodekit.evolution-adoption/v1": { directory: "adoptions", schema: "nodekit.evolution-adoption.v1.schema.json", plural: "adoptions" },
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const DEFERRED_REVIEW_SCHEMA = "nodekit.evolution-deferred-review.v1.schema.json";
const DEFERRED_REVIEW_ROOT = path.join("evolution", "deferred-reviews");
const MAX_DEFERRED_EVIDENCE_BYTES = 2 * 1024 * 1024;
const AUTHORITY_PATHS = Object.freeze([
  /^src\/lib\/evolution-(?:approval|ledger|trust)\.mjs$/u,
  /^schemas\/nodekit\.evolution-(?:approval|deferred-review|trust-policy)\./u,
  /^evolution\/trust-policy\.json$/u,
]);
const PRE_ACTION_REVIEW_PATHS = Object.freeze([
  /^\.github\/workflows\//u,
  /(?:^|\/)(?:credentials?|secrets?|migrations?|billing|payments?|deploy|publishing?)(?:\/|\.|$)/iu,
]);

async function evidenceRef(root, ref, kind) {
  const absolute = resolveInside(root, ref, "deferred-review evidence");
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_DEFERRED_EVIDENCE_BYTES) {
    throw new Error(`deferred-review evidence exceeds ${MAX_DEFERRED_EVIDENCE_BYTES} bytes: ${ref}`);
  }
  return { ref: ref.replaceAll("\\", "/"), sha256: digest(bytes), kind };
}

function receiptDigest(receipt) {
  const { receiptDigest: ignored, ...subject } = receipt;
  return digest(canonical(subject));
}

function commitsInRange(root, from, to) {
  return new Set(git(root, ["rev-list", `${from}..${to}`]).split(/\r?\n/).filter(Boolean));
}

function isAncestor(root, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export async function createDeferredEvolutionReview(repoRoot, input) {
  const root = path.resolve(repoRoot);
  const from = git(root, ["rev-parse", input.from]);
  const reviewedTo = git(root, ["rev-parse", input.to]);
  const rollbackTarget = git(root, ["rev-parse", input.rollbackTarget]);
  if (!isAncestor(root, from, reviewedTo)) {
    throw new Error("deferred review requires from to be an ancestor of reviewedTo");
  }
  if (rollbackTarget !== from) {
    throw new Error("deferred review rollback target must be the exact baseline commit");
  }
  const draftRefs = [...new Set(input.draftRefs ?? (input.draftRef ? [input.draftRef] : []))];
  if (draftRefs.length === 0 || draftRefs.length > 16) {
    throw new Error("deferred review requires between 1 and 16 event drafts");
  }
  const rangeCommits = commitsInRange(root, from, reviewedTo);
  const events = [];
  for (const requestedRef of draftRefs) {
    const draftRef = path.relative(root, resolveInside(root, requestedRef, "deferred-review draft"))
      .replaceAll("\\", "/");
    const draftBytes = await readFile(path.join(root, draftRef));
    const draft = JSON.parse(draftBytes.toString("utf8"));
    const draftFindings = await validateSchema(
      EVOLUTION_RECORD_TYPES[EVOLUTION_EVENT_SCHEMA].schema,
      draft,
      `deferred-review event ${draft.id ?? draftRef}`,
    );
    if (draftFindings.length > 0) {
      throw new Error(`deferred-review event validation failed:\n${draftFindings.join("\n")}`);
    }
    if (draft.interpretation?.status !== "agent-proposed") {
      throw new EvolutionAuthorityError("deferred review preserves agent-proposed status; it cannot accept a promoted event");
    }
    if (!rangeCommits.has(draft.source.commitSha)) {
      throw new Error(`deferred-review event source commit is not in the reviewed range: ${draft.id}`);
    }
    events.push({
      eventId: draft.id,
      draftRef,
      draftDigest: digest(draftBytes),
      sourceCommit: draft.source.commitSha,
    });
  }
  events.sort((left, right) => left.eventId.localeCompare(right.eventId));
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("deferred review event ids must be unique");
  }
  const changedFiles = git(root, ["diff", "--name-only", `${from}..${reviewedTo}`])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
  const materialFiles = changedFiles
    .filter((file) => MATERIAL_PATHS.some((pattern) => pattern.test(file)))
    .sort();
  if (materialFiles.length === 0) throw new Error("deferred review requires at least one material file");
  const preActionReviewFiles = changedFiles.filter((file) =>
    PRE_ACTION_REVIEW_PATHS.some((pattern) => pattern.test(file)));
  if (preActionReviewFiles.length > 0) {
    throw new EvolutionAuthorityError(
      `deferred review is forbidden for pre-action-review paths: ${preActionReviewFiles.join(", ")}`,
    );
  }
  const authorityChanged = changedFiles.some((file) =>
    AUTHORITY_PATHS.some((pattern) => pattern.test(file)));

  const before = await Promise.all((input.before ?? []).map((entry) =>
    evidenceRef(root, entry.ref, entry.kind)));
  const after = await Promise.all((input.after ?? []).map((entry) =>
    evidenceRef(root, entry.ref, entry.kind)));
  if (before.length === 0 || after.length === 0) {
    throw new Error("deferred review requires before and after evidence");
  }
  if (!before.some((entry) => entry.kind === "live-io")
      || !after.some((entry) => entry.kind === "live-io")) {
    throw new Error("deferred review requires exact before and after live request/response evidence");
  }
  if (!after.some((entry) => entry.kind === "journey-card")) {
    throw new Error("deferred review requires an at-a-glance intended-goal journey card");
  }
  const mediaRefs = after
    .filter((entry) => ["ui-screenshot", "ui-clip"].includes(entry.kind))
    .map((entry) => entry.ref);
  if (input.uiChanged && mediaRefs.length === 0) {
    throw new Error("a changed UI surface requires screenshot or clip evidence");
  }
  if (!input.uiChanged && !String(input.uiReason ?? "").trim()) {
    throw new Error("a non-UI change requires a human-readable intended-goal reason");
  }
  const verificationRefs = [...new Set((input.rollbackVerificationRefs ?? []).map((ref) =>
    path.relative(root, resolveInside(root, ref, "rollback verification")).replaceAll("\\", "/")))];
  if (verificationRefs.length === 0) {
    throw new Error("deferred review requires rollback verification evidence");
  }
  const afterRefs = new Set(after.map((entry) => entry.ref));
  if (verificationRefs.some((ref) => !afterRefs.has(ref))) {
    throw new Error("rollback verification evidence must be content-bound in after evidence");
  }
  let authorityDirective;
  if (authorityChanged) {
    if (!input.authorityDirectiveRef) {
      throw new EvolutionAuthorityError("an authority-sensitive change requires the operator directive that authorized this policy change");
    }
    const directive = await evidenceRef(root, input.authorityDirectiveRef, "operator-directive");
    authorityDirective = {
      ref: directive.ref,
      sha256: directive.sha256,
      assurance: "operator-directed-in-session",
    };
    if (![...before, ...after].some((entry) =>
      entry.ref === directive.ref && entry.sha256 === directive.sha256 && entry.kind === directive.kind)) {
      throw new Error("operator directive must be content-bound in before or after evidence");
    }
  } else if (input.authorityDirectiveRef) {
    throw new Error("authority directive supplied but the reviewed range does not change an authority-sensitive path");
  }

  const receipt = {
    schemaVersion: "nodekit.evolution-deferred-review/v1",
    id: `deferred-review:sha256:${digest(canonical({
      eventIds: events.map((event) => event.eventId),
      from,
      reviewedTo,
    }))}`,
    events,
    range: { from, reviewedTo },
    risk: {
      classification: "reversible",
      effects: {
        destructiveWrite: false,
        credentialOrAuthorityChange: authorityChanged,
        irreversibleMigration: false,
        materialSpend: false,
        externalCommunication: false,
        legalOrComplianceCommitment: false,
        unverifiedRollback: false,
      },
      ...(authorityDirective ? { authorityDirective } : {}),
    },
    coverage: { materialFiles },
    evidence: { before, after },
    uiSurface: input.uiChanged
      ? { changed: true, mediaRequired: true, mediaRefs }
      : {
          changed: false,
          mediaRequired: false,
          reason: input.uiReason.trim(),
          mediaRefs: [],
        },
    rollback: {
      targetCommit: rollbackTarget,
      strategy: "git-revert-range",
      verificationRefs,
    },
    review: {
      status: "deferred-human-review",
      feedbackChannel: input.feedbackChannel ?? "pull-request",
    },
  };
  receipt.receiptDigest = receiptDigest(receipt);
  const findings = await validateSchema(DEFERRED_REVIEW_SCHEMA, receipt, receipt.id);
  if (findings.length > 0) throw new Error(`deferred-review receipt validation failed:\n${findings.join("\n")}`);
  const output = path.join(root, DEFERRED_REVIEW_ROOT, `${receipt.id.replaceAll(":", "-")}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return { output, receipt };
}

export async function verifyDeferredEvolutionReview(repoRoot, receipt, from, to, materialFiles) {
  const root = path.resolve(repoRoot);
  const findings = await validateSchema(DEFERRED_REVIEW_SCHEMA, receipt, receipt.id ?? "deferred review");
  if (findings.length > 0) return { passed: false, findings };
  if (receipt.receiptDigest !== receiptDigest(receipt)) findings.push("receiptDigest mismatch");
  if (receipt.range.from !== from) findings.push("baseline commit does not match materiality range");
  if (!isAncestor(root, receipt.range.reviewedTo, to)) findings.push("reviewed candidate is not an ancestor of the tested head");
  if (!isAncestor(root, from, receipt.range.reviewedTo)) findings.push("reviewed candidate is outside the baseline range");
  if (receipt.rollback.targetCommit !== from) findings.push("rollback target is not the exact baseline");
  if (canonical(receipt.coverage.materialFiles) !== canonical([...materialFiles].sort())) {
    findings.push("material file coverage does not match the tested range");
  }
  const rangeCommits = commitsInRange(root, from, receipt.range.reviewedTo);
  for (const eventRef of receipt.events) {
    const draftPath = resolveInside(root, eventRef.draftRef, "deferred-review draft");
    if (!(await pathExists(draftPath))) findings.push(`event draft is missing: ${eventRef.draftRef}`);
    else {
      const draftBytes = await readFile(draftPath);
      const draft = JSON.parse(draftBytes.toString("utf8"));
      if (digest(draftBytes) !== eventRef.draftDigest) findings.push(`event draft digest mismatch: ${eventRef.eventId}`);
      if (draft.id !== eventRef.eventId) findings.push(`event id mismatch: ${eventRef.eventId}`);
      if (draft.source?.commitSha !== eventRef.sourceCommit) findings.push(`event source commit mismatch: ${eventRef.eventId}`);
      if (draft.interpretation?.status !== "agent-proposed") findings.push(`deferred event is not agent-proposed: ${eventRef.eventId}`);
      if (!rangeCommits.has(eventRef.sourceCommit)) {
        findings.push(`event source commit is outside the reviewed range: ${eventRef.eventId}`);
      }
    }
  }
  const allEvidence = [...receipt.evidence.before, ...receipt.evidence.after];
  for (const item of allEvidence) {
    try {
      const actual = await evidenceRef(root, item.ref, item.kind);
      if (actual.sha256 !== item.sha256) findings.push(`evidence digest mismatch: ${item.ref}`);
    } catch (error) {
      findings.push(error.message);
    }
  }
  const authorityChanged = materialFiles.some((file) =>
    AUTHORITY_PATHS.some((pattern) => pattern.test(file)));
  if (receipt.risk.effects.credentialOrAuthorityChange !== authorityChanged) {
    findings.push("authority-sensitive file classification does not match the tested range");
  }
  if (authorityChanged) {
    const directive = receipt.risk.authorityDirective;
    const bound = allEvidence.find((entry) =>
      entry.kind === "operator-directive" && entry.ref === directive?.ref && entry.sha256 === directive?.sha256);
    if (!bound) findings.push("operator authority directive is not content-bound to the receipt evidence");
  }
  if (!receipt.evidence.before.some((entry) => entry.kind === "live-io")
      || !receipt.evidence.after.some((entry) => entry.kind === "live-io")) {
    findings.push("exact before or after live request/response evidence is missing");
  }
  if (!receipt.evidence.after.some((entry) => entry.kind === "journey-card")) {
    findings.push("at-a-glance intended-goal journey card is missing");
  }
  if (receipt.uiSurface.changed) {
    const media = new Set(receipt.evidence.after
      .filter((entry) => ["ui-screenshot", "ui-clip"].includes(entry.kind))
      .map((entry) => entry.ref));
    if (receipt.uiSurface.mediaRefs.some((ref) => !media.has(ref))) {
      findings.push("UI media refs are not bound to after evidence");
    }
  }
  const afterRefs = new Set(receipt.evidence.after.map((entry) => entry.ref));
  for (const ref of receipt.rollback.verificationRefs) {
    if (!afterRefs.has(ref)) findings.push(`rollback verification is not bound to after evidence: ${ref}`);
  }
  return { passed: findings.length === 0, findings, receipt };
}

function now() {
  return new Date().toISOString();
}

function resolveInside(repoRoot, relative, label) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, String(relative));
  const relation = path.relative(root, target);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`${label} must stay inside the repository: ${relative}`);
  }
  return target;
}

// Bound the buffer explicitly: Node's 1 MB execFileSync default overflows on a large
// working tree or a large `git show` payload, turning a readable ledger error into ENOBUFS.
function git(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function commitExists(repoRoot, commitSha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commitSha}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function jsonFiles(directory) {
  if (!(await pathExists(directory))) return [];
  const output = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.name.endsWith(".json")) output.push(target);
    }
  }
  await visit(directory);
  return output;
}

async function readLedger(repoRoot) {
  const root = path.join(repoRoot, "evolution");
  const ledger = { events: [], assumptions: [], invariants: [], evidence: [], adoptions: [], filesById: new Map() };
  for (const definition of Object.values(EVOLUTION_RECORD_TYPES)) {
    for (const file of await jsonFiles(path.join(root, definition.directory))) {
      const value = await readJson(file);
      ledger[definition.plural].push(value);
      ledger.filesById.set(value.id, file);
    }
  }
  return ledger;
}

export async function initializeEvolutionLedger(repoRoot) {
  const root = path.resolve(repoRoot);
  const evolutionRoot = path.join(root, "evolution");
  const directories = ["events/product", "events/architecture", "events/harness", "assumptions", "invariants", "evidence", "adoptions", "drafts", "projections", "artifacts"];
  for (const directory of directories) await mkdir(path.join(evolutionRoot, directory), { recursive: true });
  const manifestPath = path.join(evolutionRoot, "ledger.json");
  if (!(await pathExists(manifestPath))) {
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: "nodekit.evolution-ledger/v1",
      authority: { canonicalRecords: "human-reviewed-only", mutation: "append-or-supersede", delete: "prohibited" },
      materiality: ["primary-user-workflow", "public-contract", "architectural-ownership", "security-authority", "proof-requirement", "model-routing", "harness-behavior", "benchmark-conclusion", "downstream-guarantee"],
      recordSchemas: Object.keys(EVOLUTION_RECORD_TYPES),
    }, null, 2)}\n`);
  }
  return { evolutionRoot, manifestPath };
}

export async function draftEvolutionEvent(repoRoot, input) {
  const root = path.resolve(repoRoot);
  // Refuse elevation loudly rather than ignoring it. A caller passing --status or --reviewed-by is
  // trying to assert review, and silently dropping the flag would let them believe it worked.
  if (input.status && input.status !== "agent-proposed") {
    throw new EvolutionAuthorityError(
      `refused: draft cannot write interpretation.status=${input.status}. A draft is a proposal. ` +
      "human-reviewed is derived only by verifying a signed approval at record time.");
  }
  if (input.reviewedBy) {
    throw new EvolutionAuthorityError(
      "refused: draft cannot name a reviewer. The reviewer identity is derived from the verified " +
      "approval credential, never supplied by the caller. An author identity may be supplied.");
  }
  await initializeEvolutionLedger(root);
  const commitSha = input.commitSha ?? git(root, ["rev-parse", "HEAD"]);
  const event = {
    schemaVersion: EVOLUTION_EVENT_SCHEMA,
    id: input.id ?? `evt:${String(input.track ?? "architecture")}:${digest(canonical(input)).slice(0, 12)}`,
    projectId: input.projectId ?? "nodekit",
    repository: input.repository ?? "HomenShum/node-platform",
    source: { commitSha, ...(input.pullRequest ? { pullRequest: Number(input.pullRequest) } : {}), occurredAt: input.occurredAt ?? now() },
    track: input.track ?? "architecture",
    category: input.category ?? "runtime",
    challenge: input.challenge,
    ...(input.observedFailure ? { observedFailure: input.observedFailure } : {}),
    resolution: input.resolution,
    assumptionIds: input.assumptionIds ?? [],
    invariantIds: input.invariantIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    ...(input.predecessorIds?.length ? { predecessorIds: input.predecessorIds } : {}),
    ...(input.supersedesIds?.length ? { supersedesIds: input.supersedesIds } : {}),
    knownLimitations: input.knownLimitations ?? [],
    // A draft is a PROPOSAL. This used to write "human-reviewed" unconditionally, so every draft
    // NodeKit produced was born approved and `record` promoted it on the strength of a field the
    // caller had just written. The status is now derivable only by verifying a signed approval,
    // in recordEvolutionRecord. Nothing here can grant it.
    interpretation: { status: "agent-proposed" },
  };
  const findings = await validateSchema("nodekit.evolution-event.v1.schema.json", event, "evolution event draft");
  if (findings.length > 0) throw new Error(`evolution event draft validation failed:\n${findings.join("\n")}`);
  const output = path.join(root, "evolution", "drafts", `${event.id.replaceAll(":", "-")}.json`);
  // The CLI's exists check is only an ergonomic fast path. Exclusive creation is the authority
  // boundary: two agents proposing the same id concurrently must never race into last-writer-wins.
  await writeFile(output, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });
  return { event, output };
}

/** Raised when a caller tries to assert authority it does not hold. Distinct so the CLI can exit 5. */
export class EvolutionAuthorityError extends Error {
  constructor(message) { super(message); this.name = "EvolutionAuthorityError"; this.exitCode = 5; }
}

const TRUST_POLICY = path.join("evolution", "trust-policy.json");
const CONSUMED = path.join("evolution", "approvals", "consumed.json");

/**
 * Derive the interpretation from a verified approval. Nothing here reads a status off the record.
 * A missing policy or a missing approval is a refusal, never a downgrade to unattested — the whole
 * defect being repaired was an absent check reading as a pass.
 */
async function deriveInterpretation(root, record, approvalFile) {
  if (!approvalFile) {
    throw new EvolutionAuthorityError(
      "refused: promoting an event to canonical history requires a signed approval. " +
      "Pass --approval <file>. The agent proposes; it does not approve.");
  }
  const policyPath = path.join(root, TRUST_POLICY);
  if (!(await pathExists(policyPath))) {
    throw new EvolutionAuthorityError(
      `refused: no trust policy at ${TRUST_POLICY}. Run 'nodekit trust init' first. Without one ` +
      "there is no credential to verify against, and an unverifiable approval is not an approval.");
  }
  const policy = await readJson(policyPath);
  const approval = await readJson(resolveInside(root, approvalFile, "evolution approval"));

  let consumed = [];
  if (await pathExists(path.join(root, CONSUMED))) consumed = (await readJson(path.join(root, CONSUMED))).nonces ?? [];

  const verified = verifyEvolutionApproval(approval, record, {
    policy,
    consumedNonces: new Set(consumed),
    requiredTrustLevel: policy.requiredTrustLevel ?? "H2",
  });

  // Single use. Burn the nonce before the record is written, so a crash between the two cannot
  // leave a spent approval reusable.
  await mkdir(path.dirname(path.join(root, CONSUMED)), { recursive: true });
  await writeFile(path.join(root, CONSUMED),
    `${JSON.stringify({ schemaVersion: "nodekit.evolution-approval-nonces/v1", nonces: [...consumed, verified.nonce] }, null, 2)}\n`);

  return verified;
}

export async function recordEvolutionRecord(repoRoot, recordFile, approvalFile = null) {
  const root = path.resolve(repoRoot);
  await initializeEvolutionLedger(root);
  const source = resolveInside(root, recordFile, "evolution record");
  const record = await readJson(source);
  const definition = EVOLUTION_RECORD_TYPES[record.schemaVersion];
  if (!definition) throw new Error(`unsupported evolution record schema: ${record.schemaVersion}`);
  const findings = await validateSchema(definition.schema, record, `evolution record ${record.id ?? source}`);
  if (findings.length > 0) throw new Error(`evolution record validation failed:\n${findings.join("\n")}`);
  const isEvent = record.schemaVersion === EVOLUTION_EVENT_SCHEMA;

  // A record arriving already stamped human-reviewed is refused outright. That stamp can only be
  // the product of the bypass this replaces: the status is not an input.
  if (isEvent && record.interpretation?.status === "human-reviewed") {
    throw new EvolutionAuthorityError(
      "refused: this record already claims human-reviewed. That status is not an input. Submit an " +
      "agent-proposed draft together with a signed approval, and it will be derived.");
  }

  const subtype = isEvent ? `${definition.directory}/${record.track}` : definition.directory;
  const output = path.join(root, "evolution", subtype, `${record.id.replaceAll(":", "-")}.json`);

  // Idempotence and immutability are settled BEFORE any approval is consumed. Two reasons, both
  // found by a test: approvals are single use, so deriving first burned a nonce on a re-record that
  // was going to be a no-op; and the incoming event carries `agent-proposed` while the stored one
  // carries the derived `human-reviewed`, so a whole-record comparison would call an identical
  // re-record a mutation. Comparing the SUBJECT — everything except the derived interpretation —
  // asks the real question: did the substance change?
  if (await pathExists(output)) {
    const existing = await readJson(output);
    const subjectOf = (value) => { const { interpretation, ...rest } = value; return canonical(rest); };
    if (subjectOf(existing) !== subjectOf(record)) {
      throw new Error(`evolution records are immutable; supersede instead of overwriting ${record.id}`);
    }
    return { duplicate: true, output, record: existing, promotion: null };
  }

  // Promotion. The old gate read `record.interpretation.status` — the same field draft had just
  // written — so anyone who could write a file could write canonical history. It is now DERIVED
  // from a verified approval, and the record's own copy is replaced by the derived one.
  let promotion = null;
  if (isEvent) {
    promotion = await deriveInterpretation(root, record, approvalFile);
    record.interpretation = {
      ...promotion.interpretation,
      approvalHash: promotion.approvalHash,
      trustLevel: promotion.trustLevel,
    };
  }

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
  return { duplicate: false, output, record, promotion };
}

function hasCycle(events) {
  const links = new Map(events.map((event) => [event.id, [...(event.predecessorIds ?? []), ...(event.supersedesIds ?? [])]]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of links.get(id) ?? []) if (links.has(next) && visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return [...links.keys()].some(visit);
}

const SECRET_PATTERN = /(sk-[a-z0-9_-]{16,}|api[_-]?key\s*[:=]\s*["']?[a-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

async function evidenceBytes(repoRoot, artifactRef) {
  if (artifactRef.startsWith("git:")) {
    const match = /^git:([a-f0-9]{40}):(.+)$/.exec(artifactRef);
    if (!match) throw new Error(`invalid git artifactRef: ${artifactRef}`);
    return execFileSync("git", ["show", `${match[1]}:${match[2]}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
  }
  const relative = artifactRef.startsWith("file:") ? artifactRef.slice(5) : artifactRef;
  return readFile(resolveInside(repoRoot, relative, "evolution evidence"));
}

export async function verifyEvolutionLedger(repoRoot) {
  const root = path.resolve(repoRoot);
  const ledger = await readLedger(root);
  const issues = [];
  const warnings = [];
  const all = [...ledger.events, ...ledger.assumptions, ...ledger.invariants, ...ledger.evidence, ...ledger.adoptions];
  const byId = new Map();
  for (const record of all) {
    const definition = EVOLUTION_RECORD_TYPES[record.schemaVersion];
    if (!definition) { issues.push(`unsupported schema ${record.schemaVersion} for ${record.id}`); continue; }
    const findings = await validateSchema(definition.schema, record, record.id ?? definition.plural);
    issues.push(...findings);
    if (byId.has(record.id)) issues.push(`duplicate evolution id: ${record.id}`);
    byId.set(record.id, record);
    if (SECRET_PATTERN.test(JSON.stringify(record))) issues.push(`possible secret in evolution record ${record.id}`);
  }
  const ids = new Set(byId.keys());
  const requireRefs = (owner, refs, expected) => {
    for (const id of refs ?? []) {
      const target = byId.get(id);
      if (!target) issues.push(`${owner} references missing ${id}`);
      else if (expected && !expected.includes(target.schemaVersion)) issues.push(`${owner} references ${id} with unexpected schema ${target.schemaVersion}`);
    }
  };
  for (const event of ledger.events) {
    if (!commitExists(root, event.source.commitSha)) issues.push(`${event.id} source commit does not exist: ${event.source.commitSha}`);
    requireRefs(event.id, event.assumptionIds, ["nodekit.assumption/v1"]);
    requireRefs(event.id, event.invariantIds, ["nodekit.invariant-claim/v1"]);
    requireRefs(event.id, event.evidenceIds, ["nodekit.evolution-evidence/v1"]);
    requireRefs(event.id, event.predecessorIds, [EVOLUTION_EVENT_SCHEMA]);
    requireRefs(event.id, event.supersedesIds, [EVOLUTION_EVENT_SCHEMA]);
    if (event.modelContext && !(event.modelContext.requestedRoute && event.modelContext.resolvedModel && event.modelContext.provider)) {
      issues.push(`${event.id} modelContext requires requestedRoute, resolvedModel, and provider together`);
    }
  }
  if (hasCycle(ledger.events)) issues.push("evolution predecessor/supersession graph is circular");
  for (const assumption of ledger.assumptions) {
    requireRefs(assumption.id, assumption.supportingEvidenceIds, ["nodekit.evolution-evidence/v1"]);
    requireRefs(assumption.id, assumption.contradictingEvidenceIds, ["nodekit.evolution-evidence/v1"]);
    if (["disproven", "superseded"].includes(assumption.status) && assumption.contradictingEvidenceIds.length === 0) issues.push(`${assumption.id} is ${assumption.status} without contradicting evidence`);
  }
  for (const invariant of ledger.invariants) {
    requireRefs(invariant.id, [invariant.introducedByEventId], [EVOLUTION_EVENT_SCHEMA]);
    if (invariant.status === "verified" && invariant.verifierRefs.length === 0) issues.push(`${invariant.id} is verified without a verifier`);
    if (invariant.status === "verified" && !ledger.evidence.some((evidence) => evidence.result === "pass" && evidence.verifiesInvariantIds.includes(invariant.id))) {
      issues.push(`${invariant.id} is verified without passing evidence`);
    }
  }
  for (const evidence of ledger.evidence) {
    requireRefs(evidence.id, evidence.verifiesInvariantIds, ["nodekit.invariant-claim/v1"]);
    if (!commitExists(root, evidence.sourceCommit)) issues.push(`${evidence.id} source commit does not exist: ${evidence.sourceCommit}`);
    try {
      const bytes = await evidenceBytes(root, evidence.artifactRef);
      const actual = digest(bytes);
      if (actual !== evidence.sha256) issues.push(`${evidence.id} hash mismatch: expected ${evidence.sha256}, got ${actual}`);
      if (SECRET_PATTERN.test(bytes.toString("utf8"))) issues.push(`${evidence.id} artifact may contain a secret`);
    } catch (error) {
      issues.push(`${evidence.id} evidence cannot be read: ${error.message}`);
    }
    if (evidence.kind === "benchmark" && !(evidence.environment?.benchmarkIdentity && evidence.environment?.sampleSize)) issues.push(`${evidence.id} benchmark evidence requires benchmarkIdentity and sampleSize`);
    if (evidence.kind === "screenshot" && !(evidence.environment?.viewport && evidence.environment?.candidateIdentity)) issues.push(`${evidence.id} screenshot evidence requires viewport and candidateIdentity`);
    if (["deployment", "interaction-clip"].includes(evidence.kind) && !evidence.nodeProofReceiptId) warnings.push(`${evidence.id} should reference a NodeProof receipt`);
  }
  for (const adoption of ledger.adoptions) {
    requireRefs(adoption.id, [adoption.invariantId], ["nodekit.invariant-claim/v1"]);
    requireRefs(adoption.id, adoption.evidenceIds, ["nodekit.evolution-evidence/v1"]);
    if (adoption.status === "verified" && adoption.evidenceIds.length === 0) issues.push(`${adoption.id} verified adoption requires consumer-side evidence`);
    const invariant = byId.get(adoption.invariantId);
    if (invariant?.status === "superseded" && ["declared", "verified"].includes(adoption.status)) warnings.push(`${adoption.id} still adopts superseded invariant ${adoption.invariantId}`);
  }
  for (const invariant of ledger.invariants) {
    const adopters = ledger.adoptions.filter((adoption) => adoption.invariantId === invariant.id && adoption.status === "verified");
    if (invariant.scope.applications?.length > adopters.length && invariant.status === "verified") warnings.push(`${invariant.id} scope names more applications than verified adoptions`);
  }

  // Immutability was declared in ledger.json and enforced only inside
  // recordEvolutionEvent, which nothing writes evidence through. A committed
  // record edited in place from result "partial" to "pass" passed this very
  // function. Verify now compares every record against the revision that
  // introduced it, so the authority rule is checked on the path people use.
  // @nodekit-behavior inv:ledger-records-are-immutable owner
  const loadedRecords = all
    .filter((record) => ledger.filesById.has(record.id))
    .map((record) => ({
      file: path.relative(root, ledger.filesById.get(record.id)).split(path.sep).join("/"),
      record,
    }));
  // Which canonical events actually carry a verified approval. Silence here would be the original
  // defect all over again: 22 events say human-reviewed because a command wrote that string, and a
  // reader must be able to tell those apart from ones a credential signed. Reported, never
  // back-filled — inventing an approvalHash for a review that was never signed is fabrication.
  const unattested = ledger.events.filter((event) =>
    event.interpretation?.status === "human-reviewed" && !event.interpretation?.approvalHash);
  if (unattested.length > 0) {
    warnings.push(
      `${unattested.length} canonical event(s) claim human-reviewed with no verified approval, ` +
      "promoted before approval enforcement landed on 2026-07-26. Their status is a string a command " +
      "wrote, not an attestation. They are reported rather than back-filled, because inventing an " +
      `approval for a review that was never signed is fabrication: ${unattested.slice(0, 3).map((e) => e.id).join(", ")}` +
      (unattested.length > 3 ? `, and ${unattested.length - 3} more` : ""));
  }

  const mutationResult = await detectLedgerMutations(root, loadedRecords);
  const mutationReport = describeMutations(mutationResult);
  issues.push(...mutationReport.issues);
  warnings.push(...mutationReport.warnings);

  return {
    schemaVersion: "nodekit.evolution-verdict/v1",
    counts: { events: ledger.events.length, assumptions: ledger.assumptions.length, invariants: ledger.invariants.length, evidence: ledger.evidence.length, adoptions: ledger.adoptions.length },
    immutability: {
      checked: mutationResult.checked,
      gitAvailable: mutationResult.gitAvailable,
      claimMutations: mutationResult.mutations.length,
      bindingRepairs: mutationResult.bindingRepairs.length,
    },
    authority: {
      canonicalEvents: ledger.events.length,
      attested: ledger.events.length - unattested.length,
      unattested: unattested.length,
      unattestedIds: unattested.map((event) => event.id),
    },
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    passed: issues.length === 0,
  };
}

export async function queryEvolutionLedger(repoRoot, { track, since, invariantId } = {}) {
  const ledger = await readLedger(path.resolve(repoRoot));
  const events = ledger.events.filter((event) => (!track || event.track === track) && (!since || Date.parse(event.source.occurredAt) >= Date.parse(since)) && (!invariantId || event.invariantIds.includes(invariantId)));
  return {
    events,
    assumptions: invariantId ? ledger.assumptions.filter((assumption) => events.some((event) => event.assumptionIds.includes(assumption.id))) : ledger.assumptions,
    invariants: invariantId ? ledger.invariants.filter((invariant) => invariant.id === invariantId) : ledger.invariants,
    evidence: ledger.evidence.filter((evidence) => !invariantId || evidence.verifiesInvariantIds.includes(invariantId)),
    adoptions: ledger.adoptions.filter((adoption) => !invariantId || adoption.invariantId === invariantId),
  };
}

export async function diffEvolutionLedger(repoRoot, from, to) {
  const root = path.resolve(repoRoot);
  if (!/^[a-f0-9]{7,40}$/.test(from) || !/^[a-f0-9]{7,40}$/.test(to)) throw new Error("evolution diff requires git commit identifiers");
  const commits = new Set(git(root, ["rev-list", `${from}..${to}`]).split(/\r?\n/).filter(Boolean));
  const ledger = await readLedger(root);
  const events = ledger.events.filter((event) => commits.has(event.source.commitSha));
  return { schemaVersion: "nodekit.evolution-diff/v1", from, to, commits: commits.size, events };
}

const MATERIAL_PATHS = [
  /^(?:src|schemas|templates\/base|harness)\//,
  /^(?:nodekit\.yaml|ownership\.yaml)$/,
  /^\.github\/workflows\//,
];

export async function checkEvolutionMateriality(repoRoot, from, to) {
  const root = path.resolve(repoRoot);
  if (!/^[a-f0-9]{7,40}$/.test(from) || !/^[a-f0-9]{7,40}$/.test(to)) {
    throw new Error("evolution materiality requires git commit identifiers");
  }
  const changedFiles = git(root, ["diff", "--name-only", `${from}..${to}`]).split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
  const materialFiles = changedFiles.filter((file) => MATERIAL_PATHS.some((pattern) => pattern.test(file)));
  const diff = await diffEvolutionLedger(root, from, to);
  const deferredReviews = [];
  const rejectedDeferredReviews = [];
  for (const file of await jsonFiles(path.join(root, DEFERRED_REVIEW_ROOT))) {
    try {
      const receipt = await readJson(file);
      const verdict = await verifyDeferredEvolutionReview(root, receipt, from, to, materialFiles);
      if (verdict.passed) deferredReviews.push({
        id: receipt.id,
        receiptDigest: receipt.receiptDigest,
        reviewedTo: receipt.range.reviewedTo,
        reviewStatus: receipt.review.status,
      });
      else rejectedDeferredReviews.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        id: receipt.id ?? null,
        findings: verdict.findings,
      });
    } catch (error) {
      rejectedDeferredReviews.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        id: null,
        findings: [error.message],
      });
    }
  }
  const passed = materialFiles.length === 0 || diff.events.length > 0 || deferredReviews.length > 0;
  return {
    schemaVersion: "nodekit.evolution-materiality-verdict/v1",
    from,
    to,
    changedFiles,
    materialFiles,
    events: diff.events,
    deferredReviews,
    rejectedDeferredReviews,
    passed,
    reason: passed
      ? materialFiles.length === 0
        ? "No material NodeKit surfaces changed."
        : diff.events.length > 0
          ? "Material changes are linked to at least one human-reviewed evolution event."
          : "Material changes have exact proof-backed reversible evidence and remain pending deferred human review."
      : "Material NodeKit surfaces changed without a human-reviewed event or valid proof-backed reversible review receipt.",
  };
}

export async function buildEvolutionDocs(repoRoot) {
  const root = path.resolve(repoRoot);
  const ledger = await readLedger(root);
  const byEvidence = new Map(ledger.evidence.map((record) => [record.id, record]));
  const byInvariant = new Map(ledger.invariants.map((record) => [record.id, record]));
  const lines = ["# NodeKit Evolution Ledger", "", "Canonical JSON records remain authoritative. This projection explains why material system guarantees exist.", ""];
  for (const track of ["product", "architecture", "harness"]) {
    lines.push(`## ${track[0].toUpperCase()}${track.slice(1)} evolution`, "");
    for (const event of ledger.events.filter((entry) => entry.track === track).sort((a, b) => a.source.occurredAt.localeCompare(b.source.occurredAt))) {
      lines.push(`### ${event.challenge}`, "", `- Event: \`${event.id}\``, `- Source: \`${event.source.commitSha}\``, `- Resolution: ${event.resolution}`);
      if (event.observedFailure) lines.push(`- Observed failure: ${event.observedFailure}`);
      if (event.invariantIds.length) lines.push(`- Invariants: ${event.invariantIds.map((id) => `\`${id}\` (${byInvariant.get(id)?.status ?? "missing"})`).join(", ")}`);
      lines.push(`- Evidence: ${event.evidenceIds.map((id) => `\`${id}\` (${byEvidence.get(id)?.result ?? "missing"})`).join(", ")}`);
      if (event.knownLimitations.length) lines.push(`- Known limitations: ${event.knownLimitations.join("; ")}`);
      lines.push("");
    }
  }
  const output = path.join(root, "evolution", "projections", "EVOLUTION.md");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${lines.join("\n")}\n`);
  const adoptionMap = ledger.adoptions.map((adoption) => ({ invariantId: adoption.invariantId, consumer: adoption.consumer, status: adoption.status, evidenceIds: adoption.evidenceIds }));
  await writeFile(path.join(root, "evolution", "projections", "adoption-map.json"), `${JSON.stringify(adoptionMap, null, 2)}\n`);
  return { adoptionMap, output };
}

export async function proposeEvolutionKnowledgePatch(repoRoot, { graphPath } = {}) {
  const root = path.resolve(repoRoot);
  const verdict = await verifyEvolutionLedger(root);
  if (!verdict.passed) throw new Error(`evolution ledger must verify before graph projection:\n${verdict.issues.join("\n")}`);
  const ledger = await readLedger(root);
  const graph = await readKnowledgeGraph(root, { graphPath });
  const existing = new Set([...graph.nodes, ...graph.hyperedges].map((entity) => entity.id));
  const timestamp = now();
  const operations = [];
  const evidenceNodeIds = new Map();
  for (const evidence of ledger.evidence) {
    const bytes = await evidenceBytes(root, evidence.artifactRef);
    const rawSha256 = digest(bytes);
    const sourceUri = `https://nodekit.local/evolution/${encodeURIComponent(evidence.id)}`;
    const id = `evidence_${digest(canonical({ sourceUri, capturedAt: evidence.generatedAt, rawSha256 })).slice(0, 24)}`;
    evidenceNodeIds.set(evidence.id, id);
    if (!existing.has(id)) {
      let snapshot;
      try {
        snapshot = await readEvidenceSnapshot(root, id);
      } catch (error) {
        if (!String(error?.message ?? "").includes("ENOENT")) throw error;
        snapshot = await ingestEvidenceBytes(root, {
          bytes,
          sourceUri,
          mediaType: "application/octet-stream",
          capturedAt: evidence.generatedAt,
          expectedSha256: evidence.sha256,
        });
      }
      operations.push({ type: "INSERT", node: evidenceSnapshotToGraphNode(snapshot, {
        label: evidence.id,
        confidence: evidence.result === "pass" ? 1 : 0.7,
        properties: { artifactRef: evidence.artifactRef, evolutionRecordId: evidence.id, sourceCommit: evidence.sourceCommit, result: evidence.result },
      }) });
    }
  }
  const records = [...ledger.events, ...ledger.assumptions, ...ledger.invariants, ...ledger.adoptions];
  for (const record of records) {
    const id = `evolution:${record.id}`;
    if (existing.has(id)) continue;
    const refs = record.evidenceIds ?? record.supportingEvidenceIds ?? (record.schemaVersion === "nodekit.invariant-claim/v1" ? ledger.evidence.filter((evidence) => evidence.verifiesInvariantIds.includes(record.id)).map((evidence) => evidence.id) : []);
    const grounded = refs.map((ref) => evidenceNodeIds.get(ref)).filter(Boolean);
    if (grounded.length === 0) continue;
    operations.push({ type: "INSERT", node: { id, kind: record.schemaVersion.split("/")[0].replace("nodekit.", ""), label: record.statement ?? record.challenge ?? record.id, layer: record.schemaVersion === "nodekit.evolution-adoption/v1" ? "canonical" : "derived", confidence: record.status === "verified" ? 1 : 0.8, evidenceRefs: grounded, metadata: record } });
  }
  for (const event of ledger.events) {
    const participants = [event.id, ...event.assumptionIds, ...event.invariantIds].map((id, index) => ({ nodeId: `evolution:${id}`, role: index === 0 ? "event" : id.startsWith("asm") ? "challenged-assumption" : "introduced-invariant" })).filter((participant) => operations.some((operation) => operation.node?.id === participant.nodeId) || existing.has(participant.nodeId));
    const edgeId = `evolution:causal:${event.id}`;
    if (participants.length >= 2 && !existing.has(edgeId)) operations.push({ type: "INSERT", hyperedge: { id: edgeId, predicate: "evolution-causal-chain", layer: "derived", participants, confidence: 1, evidenceRefs: event.evidenceIds.map((id) => evidenceNodeIds.get(id)).filter(Boolean), createdAt: timestamp } });
  }
  if (operations.length === 0) throw new Error("evolution ledger has no new evidence-grounded records to propose");
  const patch = await proposeGraphPatch(root, {
    graphId: graph.graphId,
    baseVersion: graph.version,
    operations,
    evidenceRefs: [...evidenceNodeIds.values()],
    contradictionRefs: [],
    proposedBy: { agentId: "nodekit-evolution-ledger", modelRoute: "deterministic", resolvedModel: "none", harnessVersion: "evolution-v1" },
    confidence: 1,
  }, { graphPath });
  return { patch, verdict };
}
