import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "./journey-chain-gate.mjs";
import { validateSchema } from "./schema-validation.mjs";

// The BUILD-stage producer of the Builder Journey. Given a repository and an approved
// OpportunityContract, it writes a nodekit.build-evidence-pack/v1 whose every evidence entry names
// a real file (path + sha256 + byteLength) and the real process that produced it (command + exit
// code). It never asserts a boolean, never writes promotionAuthorized:true, and never marks a
// contract decision "honoured" unless the caller supplied evidence for that specific pointer.
//
// The honesty model, stated once:
//
//   - This producer is MECHANICAL. It can digest files, run commands, and record what happened.
//     It cannot judge whether the build semantically honoured "the owner of a one-location salon".
//     So its default disposition for every contract decision is defaulted-with-disclosure, backed
//     by a generated disclosure artifact a human could actually read — and the pack's
//     completeness.notRun says outright that no semantic assessment happened.
//   - A caller that DID make a build honour a decision passes `honoured` entries naming the
//     pointer, prose for how, and the source files that show it. The producer digests those real
//     bytes; a named file that does not exist is a refusal, not a warning, because a fabricated
//     evidence path is the exact dishonesty the schema exists to make unrepresentable.
//   - `canonicalSha256` is imported from the gate module and nothing else is. A producer that
//     reused the gate's traversal to pre-clear its own output would be grading itself.
//
// See docs/JOURNEY_INTERSTAGE_CONTRACT.md (frozen envelope), docs/VACUOUS_PASS.md (why notRun and
// the sweep receipt are load-bearing), and schemas/nodekit.build-evidence-pack.v1.schema.json.

export const BUILD_EVIDENCE_PACK_SCHEMA = "nodekit.build-evidence-pack.v1.schema.json";
export const OPPORTUNITY_CONTRACT_SCHEMA_VERSION = "nodekit.opportunity-contract/v1";
export const BUILD_EVIDENCE_PACK_SCHEMA_VERSION = "nodekit.build-evidence-pack/v1";

const PRODUCER_TOOL = "src/lib/build-evidence-producer.mjs";
const MAX_COLLECTION_ELEMENTS = 24; // collectionDecisionEntry ceiling in the schema
const MAX_SWEEP_BUFFER = 64 * 1024 * 1024;

/** Scalar decision-bearing contract fields, each one decisionEntry at its pointer. */
const SCALAR_FIELDS = Object.freeze(["user", "problem", "wedge", "primaryJob", "primaryArtifact", "successCondition"]);
/** Array decision-bearing contract fields, each one collectionDecisionEntry. */
const COLLECTION_FIELDS = Object.freeze(["inputs", "rejectedAlternatives", "openUnknowns"]);
const AUTHORITY_BUCKETS = Object.freeze(["read", "propose", "approve", "prohibited"]);

/**
 * Fail-closed error. `refusals` lists every reason, so a caller fixing one does not discover the
 * next only after a rerun.
 */
export class BuildEvidenceRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`build-evidence producer refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "BuildEvidenceRefusal";
    this.refusals = list;
  }
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}

function utcNow(now) {
  const value = typeof now === "function" ? now() : now instanceof Date ? now : new Date();
  // The envelope's utcDateTime allows at most millisecond precision; toISOString emits exactly that.
  return value.toISOString();
}

function evidenceSlug(value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "unnamed";
}

/**
 * A path recorded in the pack must satisfy the schema's repoPath: repository-relative, POSIX,
 * no traversal. Preference order: relative to repoRoot (matches the committed fixtures), else
 * relative to the pack's own directory (a pack written outside the repo carries its evidence
 * beside itself). A path that resolves under neither is unrecordable, which is a refusal.
 */
function recordablePath(absolute, repoRoot, packDir) {
  for (const base of [repoRoot, packDir]) {
    const rel = toPosix(path.relative(base, absolute));
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  return null;
}

function prose(text) {
  const value = String(text).trim();
  if (value.length < 12) throw new BuildEvidenceRefusal([`internal: generated prose too short to satisfy the schema: "${value}"`]);
  return value.slice(0, 2000);
}

/**
 * Enumerate every decision pointer the contract carries, in schema order. Collections contribute
 * one pointer per element so each element gets its own disposition rather than one word covering
 * four inputs — the falsifiability the schema's declaredElementCount exists to enforce.
 */
function enumerateDecisionPointers(contract) {
  const scalars = SCALAR_FIELDS.map((field) => `/${field}`);
  const collections = [];
  for (const field of COLLECTION_FIELDS) {
    collections.push({ pointer: `/${field}`, elements: contract[field].map((_, index) => `/${field}/${index}`) });
  }
  for (const bucket of AUTHORITY_BUCKETS) {
    collections.push({
      pointer: `/authorityLimits/${bucket}`,
      elements: contract.authorityLimits[bucket].map((_, index) => `/authorityLimits/${bucket}/${index}`),
    });
  }
  return { scalars, collections };
}

/** Everything about the contract this producer refuses to guess. */
function contractRefusals(contract) {
  const refusals = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return ["the contract file does not contain a JSON object"];
  }
  if (contract.schemaVersion !== OPPORTUNITY_CONTRACT_SCHEMA_VERSION) {
    refusals.push(
      `contract declares schemaVersion "${contract.schemaVersion}", not ${OPPORTUNITY_CONTRACT_SCHEMA_VERSION}; reconciling against an artifact of unknown shape would be a guess wearing a digest`,
    );
    return refusals;
  }
  for (const field of SCALAR_FIELDS) {
    if (typeof contract[field] !== "string" || contract[field].trim() === "") {
      refusals.push(`contract field /${field} is absent or empty; a decision that does not exist cannot be reconciled, and inventing a disposition for it would be the silent-decision failure this pack exists to prevent`);
    }
  }
  for (const field of COLLECTION_FIELDS) {
    if (!Array.isArray(contract[field])) {
      refusals.push(`contract field /${field} is absent or not an array; it cannot be reconciled element by element`);
    } else if (contract[field].length > MAX_COLLECTION_ELEMENTS) {
      refusals.push(`contract field /${field} holds ${contract[field].length} elements; the pack schema can represent at most ${MAX_COLLECTION_ELEMENTS}, so a conforming reconciliation would silently drop elements`);
    }
  }
  if (!contract.authorityLimits || typeof contract.authorityLimits !== "object" || Array.isArray(contract.authorityLimits)) {
    refusals.push("contract field /authorityLimits is absent or not an object; authority cannot be reconciled");
  } else {
    for (const bucket of AUTHORITY_BUCKETS) {
      if (!Array.isArray(contract.authorityLimits[bucket])) {
        refusals.push(`contract field /authorityLimits/${bucket} is absent or not an array`);
      } else if (contract.authorityLimits[bucket].length > MAX_COLLECTION_ELEMENTS) {
        refusals.push(`contract field /authorityLimits/${bucket} exceeds the ${MAX_COLLECTION_ELEMENTS}-element ceiling the pack schema can represent`);
      }
    }
  }
  return refusals;
}

/**
 * Produce a nodekit.build-evidence-pack/v1 for one repository against one OpportunityContract.
 *
 * @param {object} options
 * @param {string} options.repoRoot       repository the build happened in
 * @param {string} options.contractPath   the OpportunityContract JSON file
 * @param {string} [options.outPath]      where the pack is written; evidence lands beside it under
 *                                        evidence/. Default: <repoRoot>/proof/journey/<caseId>.build-evidence-pack.json
 * @param {string} [options.caseId]       journey case id; default derived from the contract digest
 * @param {string} [options.testCommand]  a real shell command to run and record as test-run evidence.
 *                                        Its exit code is recorded as it happened, pass or fail.
 * @param {string[]} [options.sweepPaths] repository paths the emergent-decision sweep inventories
 * @param {object} [options.honoured]     { "<pointer>": { how, sourceFiles: [repo-relative...] } } —
 *                                        the ONLY way a decision becomes "honoured". Every named
 *                                        file must exist; a missing file refuses the whole pack.
 * @param {Function|Date} [options.now]
 * @returns {Promise<{ pack: object, packPath: string, evidenceFiles: string[] }>}
 */
// @nodekit-behavior journey.build.produce-evidence owner
export async function produceBuildEvidencePack({
  repoRoot,
  contractPath,
  outPath,
  caseId,
  testCommand,
  sweepPaths = ["src", "schemas", "scripts", "test"],
  honoured = {},
  now,
} = {}) {
  const refusals = [];
  if (!repoRoot) refusals.push("repoRoot is required");
  if (!contractPath) refusals.push("contractPath is required");
  if (refusals.length > 0) throw new BuildEvidenceRefusal(refusals);

  const root = path.resolve(repoRoot);
  const contractAbs = path.resolve(contractPath);

  let contractRaw;
  try {
    contractRaw = await readFile(contractAbs);
  } catch (error) {
    throw new BuildEvidenceRefusal([`cannot read contract at ${contractAbs}: ${error?.code ?? error}`]);
  }
  let contract;
  try {
    contract = JSON.parse(contractRaw.toString("utf8"));
  } catch (error) {
    throw new BuildEvidenceRefusal([`contract at ${contractAbs} is not parseable JSON: ${error?.message ?? error}`]);
  }
  refusals.push(...contractRefusals(contract));
  if (refusals.length > 0) throw new BuildEvidenceRefusal(refusals);

  const contractDigest = canonicalSha256(contract);
  const resolvedCaseId = typeof caseId === "string" && caseId.trim() !== "" ? caseId.trim() : `journey-${contractDigest.slice(0, 12)}`;
  const packAbs = path.resolve(outPath ?? path.join(root, "proof", "journey", `${resolvedCaseId}.build-evidence-pack.json`));
  const packDir = path.dirname(packAbs);
  const evidenceDirAbs = path.join(packDir, "evidence");

  const { scalars, collections } = enumerateDecisionPointers(contract);
  const knownPointers = new Set([...scalars, ...collections.flatMap((entry) => entry.elements)]);

  // --- honoured entries are validated BEFORE any file is written: fail closed, write nothing ----
  const honouredByPointer = new Map();
  for (const [pointer, spec] of Object.entries(honoured ?? {})) {
    if (!knownPointers.has(pointer)) {
      refusals.push(`honoured entry names pointer "${pointer}", which is not a decision-bearing pointer of this contract; evidence for a decision the contract never made reconciles nothing`);
      continue;
    }
    if (!spec || typeof spec !== "object" || typeof spec.how !== "string" || spec.how.trim().length < 12) {
      refusals.push(`honoured entry for "${pointer}" carries no usable "how" prose; an honoured disposition without how is an assertion, and the producer does not assert`);
      continue;
    }
    if (!Array.isArray(spec.sourceFiles) || spec.sourceFiles.length === 0) {
      refusals.push(`honoured entry for "${pointer}" names no source files; honouring without generated evidence is the silent-honour path, and it is closed`);
      continue;
    }
    honouredByPointer.set(pointer, spec);
  }
  const honouredFiles = new Map(); // absolute path -> { relPath, buffer }
  for (const [pointer, spec] of honouredByPointer) {
    for (const file of spec.sourceFiles) {
      const abs = path.resolve(root, file);
      if (honouredFiles.has(abs)) continue;
      const rel = recordablePath(abs, root, packDir);
      if (!rel) {
        refusals.push(`honoured evidence file "${file}" for "${pointer}" resolves outside the repository, so its path cannot be recorded reproducibly`);
        continue;
      }
      try {
        honouredFiles.set(abs, { relPath: rel, buffer: await readFile(abs) });
      } catch (error) {
        refusals.push(`honoured evidence file "${file}" for "${pointer}" does not exist or is unreadable (${error?.code ?? error}); a fabricated evidence path refuses the whole pack`);
      }
    }
  }
  if (refusals.length > 0) throw new BuildEvidenceRefusal(refusals);

  // --- run the emergent-decision sweep: a real command, a real exit code, a receipt on disk ------
  const sweepStarted = Date.now();
  const sweep = spawnSync("git", ["-c", "core.quotepath=false", "ls-files", "--", ...sweepPaths], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_SWEEP_BUFFER,
  });
  const sweepDuration = Date.now() - sweepStarted;
  if (sweep.error || typeof sweep.status !== "number" || sweep.status !== 0) {
    throw new BuildEvidenceRefusal([
      `emergent-decision sweep command failed (${sweep.error?.code ?? `exit ${sweep.status}`}); an empty emergent list without a search receipt is a claim the schema rightly refuses, so the pack is not produced`,
    ]);
  }
  const sweepFiles = sweep.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const sweepCommand = `git -c core.quotepath=false ls-files -- ${sweepPaths.join(" ")}`;

  await mkdir(evidenceDirAbs, { recursive: true });
  const producedAt = utcNow(now);
  const evidence = [];
  const evidenceFiles = [];
  const usedEvidenceIds = new Set();

  function uniqueEvidenceId(base) {
    let id = `ev-${evidenceSlug(base)}`;
    let n = 2;
    while (usedEvidenceIds.has(id)) id = `ev-${evidenceSlug(base)}-${n++}`;
    usedEvidenceIds.add(id);
    return id;
  }

  async function addFileEvidence({ idBase, kind, absolutePath, relPath, buffer, generatedBy, observation, boundary, mediaType }) {
    const evidenceId = uniqueEvidenceId(idBase);
    evidence.push({
      evidenceId,
      kind,
      artifact: {
        path: relPath,
        sha256: sha256Hex(buffer),
        byteLength: buffer.byteLength,
        ...(mediaType ? { mediaType } : {}),
      },
      generatedBy,
      observation: prose(observation),
      boundary: prose(boundary),
    });
    if (absolutePath) evidenceFiles.push(absolutePath);
    return evidenceId;
  }

  // Evidence 1: the contract that was actually read, as bytes, so a reader can re-derive both this
  // file digest and the canonical digest in inputs[0] from the same object.
  const contractRel = recordablePath(contractAbs, root, packDir);
  if (!contractRel) {
    throw new BuildEvidenceRefusal([`contract path ${contractAbs} resolves under neither the repository nor the pack directory, so it cannot be recorded reproducibly`]);
  }
  const evContract = await addFileEvidence({
    idBase: "opportunity-contract-source",
    kind: "source-file",
    absolutePath: null,
    relPath: contractRel,
    buffer: contractRaw,
    generatedBy: { method: "file-read", tool: PRODUCER_TOOL, actor: "platform-tool", producedAt },
    observation: `The OpportunityContract this pack reconciles against, read as ${contractRaw.byteLength} bytes; its canonical-JSON digest is recorded in inputs[0].`,
    mediaType: "application/json",
    boundary: "Shows what the contract says, not that any of it was built. Reconciliation dispositions carry that burden separately.",
  });

  // Evidence 2: the emergent-decision sweep receipt — what was searched, how, and what came back.
  const sweepReceiptRel = recordablePath(path.join(evidenceDirAbs, "emergent-sweep.txt"), root, packDir);
  const sweepReceiptBody = [
    "emergent-decision sweep receipt",
    `command: ${sweepCommand}`,
    `exit code: ${sweep.status}`,
    `cwd: ${toPosix(path.relative(process.cwd(), root)) || "."}`,
    `files inventoried: ${sweepFiles.length}`,
    "",
    "method: mechanical inventory of tracked files under the scanned paths. Each file listed below",
    "was enumerated; none was semantically read. A decision expressed inside code, copy, or a",
    "configuration value is invisible to this sweep and is declared as a blind spot in the pack.",
    "",
    ...sweepFiles,
    "",
  ].join("\n");
  await writeFile(path.join(evidenceDirAbs, "emergent-sweep.txt"), sweepReceiptBody, "utf8");
  const evSweep = await addFileEvidence({
    idBase: "emergent-sweep",
    kind: "command-output",
    absolutePath: path.join(evidenceDirAbs, "emergent-sweep.txt"),
    relPath: sweepReceiptRel,
    buffer: Buffer.from(sweepReceiptBody, "utf8"),
    generatedBy: {
      method: "command",
      tool: "git",
      actor: "platform-tool",
      producedAt,
      command: sweepCommand,
      exitCode: sweep.status,
      durationMs: sweepDuration,
    },
    observation: `The sweep inventoried ${sweepFiles.length} tracked files under ${sweepPaths.join(", ")} and the producer surfaced zero emergent decisions from that inventory.`,
    mediaType: "text/plain",
    boundary: "A file inventory, not a reading. It cannot detect a decision expressed in code semantics, copy, or a default value; those blind spots are declared in decisions.emergentSweep.",
  });

  // Evidence 3: honoured-entry source files, digested from real bytes.
  const evidenceIdByFile = new Map();
  for (const [abs, { relPath, buffer }] of honouredFiles) {
    const id = await addFileEvidence({
      idBase: `src-${path.basename(relPath)}`,
      kind: "source-file",
      absolutePath: null,
      relPath,
      buffer,
      generatedBy: { method: "file-read", tool: PRODUCER_TOOL, actor: "platform-tool", producedAt },
      observation: `Source file named by the caller as evidence that a contract decision was honoured; digested from the ${buffer.byteLength} bytes on disk at production time.`,
      boundary: "Existence and content of one file. Whether it actually honours the decision it is cited for is the caller's claim, recorded under that pointer's how.",
    });
    evidenceIdByFile.set(abs, id);
  }

  // Evidence 4 (optional): a real test run, recorded exactly as it exited.
  let evTestRun = null;
  let testExit = null;
  if (typeof testCommand === "string" && testCommand.trim() !== "") {
    const testStarted = Date.now();
    const run = spawnSync(testCommand, { cwd: root, shell: true, encoding: "utf8", maxBuffer: MAX_SWEEP_BUFFER });
    const testDuration = Date.now() - testStarted;
    if (run.error || typeof run.status !== "number") {
      throw new BuildEvidenceRefusal([`test command could not be spawned (${run.error?.code ?? run.error}); a test that never ran leaves no evidence to record`]);
    }
    testExit = run.status;
    const logBody = [
      `command: ${testCommand}`,
      `exit code: ${run.status}`,
      `duration ms: ${testDuration}`,
      "--- stdout ---",
      run.stdout ?? "",
      "--- stderr ---",
      run.stderr ?? "",
    ].join("\n");
    await writeFile(path.join(evidenceDirAbs, "test-run.log"), logBody, "utf8");
    evTestRun = await addFileEvidence({
      idBase: "test-run",
      kind: "test-run",
      absolutePath: path.join(evidenceDirAbs, "test-run.log"),
      relPath: recordablePath(path.join(evidenceDirAbs, "test-run.log"), root, packDir),
      buffer: Buffer.from(logBody, "utf8"),
      generatedBy: {
        method: "command",
        tool: "shell",
        actor: "platform-tool",
        producedAt,
        command: testCommand.slice(0, 1024),
        exitCode: run.status,
        durationMs: testDuration,
      },
      observation: `The configured test command exited ${run.status}; its full stdout and stderr are the artifact bytes, recorded whether it passed or failed.`,
      mediaType: "text/plain",
      boundary: "One invocation on one machine at one time. It does not establish coverage of the contract's success condition, only what this command reported.",
    });
  }

  // Evidence 5: the disclosure document — the artifact a defaulted disposition points at. A
  // disclosure that exists only inside this pack was disclosed to nobody; this file is the thing a
  // human can actually be shown.
  const defaultedPointers = [...scalars, ...collections.flatMap((entry) => entry.elements)].filter(
    (pointer) => !honouredByPointer.has(pointer),
  );
  const disclosureFor = (pointer) =>
    `No build action attested to ${pointer}. The producer recorded the repository as found and made no claim that this decision was honoured; treat every downstream statement about ${pointer} as unverified until evidence is attached.`;
  const disclosureBody = [
    "# Defaulted contract decisions — disclosure",
    "",
    `Contract: ${contractRel} (canonical sha256 ${contractDigest})`,
    `Case: ${resolvedCaseId}`,
    "",
    "The BUILD stage attached no evidence for the decisions below. Each is recorded as",
    "defaulted-with-disclosure, never silently honoured. \"Defaulted\" here means: the build left",
    "the repository's existing state to speak for this decision and attests nothing about it.",
    "",
    ...defaultedPointers.map((pointer) => `- ${pointer}: ${disclosureFor(pointer)}`),
    "",
  ].join("\n");
  await writeFile(path.join(evidenceDirAbs, "default-disclosures.md"), disclosureBody, "utf8");
  const evDisclosures = await addFileEvidence({
    idBase: "default-disclosures",
    kind: "disclosure-copy",
    absolutePath: path.join(evidenceDirAbs, "default-disclosures.md"),
    relPath: recordablePath(path.join(evidenceDirAbs, "default-disclosures.md"), root, packDir),
    buffer: Buffer.from(disclosureBody, "utf8"),
    generatedBy: { method: "instrumented-run", tool: PRODUCER_TOOL, actor: "platform-tool", producedAt },
    observation: `The human-readable disclosure listing all ${defaultedPointers.length} contract decisions this pack defaults rather than honours, one line per pointer.`,
    mediaType: "text/markdown",
    boundary: "A disclosure written, not a disclosure read. No human has seen it; completeness.notRun says so.",
  });

  // --- reconciliation: every decision-bearing pointer, no silent honour ------------------------
  const whyNotEscalated =
    "The producer ran unattended with no human in the loop to ask; recording the default with a written disclosure was the only honest option that neither blocked the pipeline nor asserted an honour it could not show.";

  function entryFor(pointer) {
    const spec = honouredByPointer.get(pointer);
    if (spec) {
      const refs = [...new Set(spec.sourceFiles.map((file) => evidenceIdByFile.get(path.resolve(root, file))))];
      return { pointer, disposition: "honoured", evidenceRefs: refs, how: prose(spec.how) };
    }
    return {
      pointer,
      disposition: "defaulted-with-disclosure",
      evidenceRefs: [evDisclosures, evContract],
      defaultApplied: prose(
        `The build attached no evidence for ${pointer}; the repository's existing state was left as found and nothing about this decision is attested.`,
      ),
      disclosure: prose(disclosureFor(pointer)),
      disclosedIn: evDisclosures,
      whyNotEscalated: prose(whyNotEscalated),
    };
  }

  const contractReconciliation = {};
  for (const field of SCALAR_FIELDS) contractReconciliation[field] = entryFor(`/${field}`);
  for (const field of COLLECTION_FIELDS) {
    contractReconciliation[field] = {
      pointer: `/${field}`,
      declaredElementCount: contract[field].length,
      elements: contract[field].map((_, index) => entryFor(`/${field}/${index}`)),
    };
  }
  contractReconciliation.authorityLimits = {};
  for (const bucket of AUTHORITY_BUCKETS) {
    contractReconciliation.authorityLimits[bucket] = {
      pointer: `/authorityLimits/${bucket}`,
      declaredElementCount: contract.authorityLimits[bucket].length,
      elements: contract.authorityLimits[bucket].map((_, index) => entryFor(`/authorityLimits/${bucket}/${index}`)),
    };
  }

  const honouredCount = honouredByPointer.size;
  const defaultedCount = defaultedPointers.length;

  // --- completeness: the denominator. notRun is the honest core of this producer. --------------
  const completeness = {
    claimed: [
      `All ${honouredCount + defaultedCount} decision-bearing contract pointers carry an explicit disposition; none is silently honoured and none is omitted.`,
      "The inputs[0] binding digest was recomputed from the canonical JSON of the contract actually read, via the same canonicalSha256 the chain gate uses.",
      `The emergent-decision sweep ran as a real command (exit ${sweep.status}) and its receipt lists all ${sweepFiles.length} files inventoried.`,
      ...(evTestRun ? [`The configured test command was executed and its exit code (${testExit}) recorded exactly as it happened.`] : []),
    ],
    notRun: [
      "No semantic assessment of the built system against any contract decision was performed by this producer; every pointer without caller-supplied evidence is recorded as defaulted-with-disclosure, not honoured.",
      "No human has read the disclosure artifact; it exists on disk with a digest, and nothing more is claimed for it.",
      "The emergent sweep inventoried tracked file paths only; decisions expressed inside code semantics, copy, or configuration values were not searched for.",
      ...(evTestRun ? [] : ["No test command was configured, so this pack contains no test-run evidence at all."]),
      // A green suite says nobody has falsified this yet, not that anyone tried. This producer runs
      // the author's own test command and nothing else, so it must say so rather than let a passing
      // run read as verification.
      "No adversarial review was run. This pack carries the author's own test command and no independent attempt to break the build, which is unfalsified rather than verified.",
    ],
    refused: [
      {
        item: "Marking any contract decision honoured without caller-supplied evidence files",
        reason: prose(
          "An honoured disposition asserts the build did something specific, and this producer cannot see intent — only bytes and exit codes. Where no evidence was supplied it defaulted with disclosure instead.",
        ),
      },
      {
        item: "Writing promotionAuthorized: true",
        reason: prose(
          "Authorization is derived by verification from an attestation. A producer granting it to itself is the self-approval the authority model forbids, so the field is pinned false.",
        ),
      },
    ],
  };

  const pack = {
    schemaVersion: BUILD_EVIDENCE_PACK_SCHEMA_VERSION,
    caseId: resolvedCaseId,
    stage: "build",
    producedAt,
    inputs: [
      {
        schemaVersion: OPPORTUNITY_CONTRACT_SCHEMA_VERSION,
        caseId: resolvedCaseId,
        sha256: contractDigest,
        path: contractRel,
      },
    ],
    content: {
      summary: prose(
        `Mechanical BUILD-stage evidence for case ${resolvedCaseId}: ${honouredCount} contract decision(s) honoured with digested source evidence, ${defaultedCount} defaulted with a written disclosure, 0 contradicted, and 0 emergent decisions surfaced by a receipted sweep of ${sweepFiles.length} tracked files. Every evidence entry is a real file with a digest and a generation record; nothing in this pack is asserted.`,
      ),
      built: {
        // No surfaces: this producer records evidence about a build, it does not perform one.
        // completeness.refused explains why claiming a surface here would be fabrication.
        surfaces: [],
      },
      decisions: {
        contract: contractReconciliation,
        emergent: [],
        emergentSweep: {
          method: prose(
            "Mechanical inventory: every tracked file under the scanned paths was enumerated by a receipted git ls-files run. The producer surfaced no emergent decisions because it does not read semantics; the receipt shows exactly what was and was not searched.",
          ),
          scannedPaths: [...sweepPaths],
          evidenceRefs: [evSweep],
          knownBlindSpots: [
            "The sweep enumerates file paths only; a decision expressed inside code, copy, or a configuration value does not appear.",
            "Untracked files are invisible to git ls-files and were not inventoried.",
          ],
        },
      },
      claims: [],
      evidence,
      promotionAuthorized: false,
    },
    completeness,
  };

  // Fail closed before writing: an invalid pack on disk is worse than no pack. This validates
  // against the JSON Schema via the shared validator — it is not the chain gate, and the chain
  // gate is never consulted here.
  const schemaErrors = await validateSchema(BUILD_EVIDENCE_PACK_SCHEMA, pack, "build-evidence-pack");
  if (schemaErrors.length > 0) {
    throw new BuildEvidenceRefusal([
      "the produced pack does not validate against its schema, so it was not written:",
      ...schemaErrors,
    ]);
  }

  await writeFile(packAbs, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  return { pack, packPath: packAbs, evidenceFiles };
}
