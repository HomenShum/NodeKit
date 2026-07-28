import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The traversal gate for the builder journey.
//
// This is a SIBLING of journey-contract-verify.mjs, not an extension of it, because the two answer
// different questions about different subjects:
//
//   journey-contract-verify.mjs  subject: harness/journey/journey-contract.json, a 12-check repo
//                               maturity scorecard. Question: "does the committed contract agree
//                               with what evidence on disk derives?" Verdict: passed:boolean.
//   this module                 subject: a directory of five journey artifacts. Question: "does
//                               the chain DECIDE -> BUILD -> {EXPLAIN, LAUNCH} -> LEARN actually
//                               hold, digest by digest?" Verdict: PASS | FAIL | NOT_RUN + exit code.
//
// Merging them would give one module two subjects and force the existing boolean verdict to grow a
// second, differently-shaped one. They share no input, no failure mode, and no exit convention.
//
// Read docs/JOURNEY_INTERSTAGE_CONTRACT.md for the frozen envelope and docs/VACUOUS_PASS.md for the
// failure class this gate is specifically built not to join. Every rule below that looks paranoid
// traces to a named instance in that second file.

export const JOURNEY_CHAIN_VERDICT_SCHEMA = "nodekit.journey-chain-verdict/v1";

/**
 * The chain, frozen by docs/JOURNEY_INTERSTAGE_CONTRACT.md.
 *
 * `envelope: "exempt-legacy-root"` on DECIDE is not a courtesy. The shipped
 * nodekit.opportunity-contract/v1 schema predates the inter-stage envelope and CONTRADICTS it: it
 * has no caseId, no stage, no producedAt, no completeness, and its own `inputs` field is an array
 * of data-source names (strings), not input bindings. Demanding the envelope of it would make this
 * gate one that nothing can satisfy -- the inverse vacuous pass named in VACUOUS_PASS.md. So DECIDE
 * is checked for exactly what is checkable about it: that it exists, that it declares the right
 * schemaVersion, and that its canonical digest matches what downstream stages claim to have read.
 */
export const CHAIN_SPEC = Object.freeze([
  Object.freeze({
    stage: "decide",
    schemaVersion: "nodekit.opportunity-contract/v1",
    consumes: Object.freeze([]),
    envelope: "exempt-legacy-root",
  }),
  Object.freeze({
    stage: "build",
    schemaVersion: "nodekit.build-evidence-pack/v1",
    consumes: Object.freeze(["nodekit.opportunity-contract/v1"]),
    envelope: "required",
  }),
  Object.freeze({
    stage: "explain",
    schemaVersion: "nodekit.story-pack/v1",
    consumes: Object.freeze(["nodekit.build-evidence-pack/v1", "nodekit.opportunity-contract/v1"]),
    envelope: "required",
  }),
  Object.freeze({
    stage: "launch",
    schemaVersion: "nodekit.launch-manifest/v1",
    consumes: Object.freeze(["nodekit.build-evidence-pack/v1"]),
    envelope: "required",
  }),
  Object.freeze({
    stage: "learn",
    schemaVersion: "nodekit.observation-pack/v1",
    consumes: Object.freeze(["nodekit.launch-manifest/v1", "nodekit.story-pack/v1"]),
    envelope: "required",
  }),
]);

export const STAGES_EXPECTED = CHAIN_SPEC.length;
export const EDGES_EXPECTED = CHAIN_SPEC.reduce((total, spec) => total + spec.consumes.length, 0);

const CHAIN_SCHEMA_VERSIONS = new Set(CHAIN_SPEC.map((spec) => spec.schemaVersion));
const SPEC_BY_SCHEMA = new Map(CHAIN_SPEC.map((spec) => [spec.schemaVersion, spec]));

const ENVELOPE_FIELDS = Object.freeze([
  "schemaVersion",
  "caseId",
  "stage",
  "producedAt",
  "inputs",
  "content",
  "completeness",
]);

/**
 * Field names a producer may never write, from the frozen authority rule: approval is DERIVED by
 * verification from an attestation, never accepted as input.
 *
 * Matched as EXACT key names at any depth, never as substrings. `approvalsRequestedFrom` and
 * `reviewedByPolicy` are legitimate content; a substring match would flag them and the gate would
 * be over-matching prose the way the trust-surface enumerator did (VACUOUS_PASS.md).
 */
const FORBIDDEN_SELF_APPROVAL_KEYS = new Set(["approved", "reviewedBy", "signedOffBy", "humanReviewed"]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_WALK_DEPTH = 64;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * Canonical JSON: keys sorted at every level, no insignificant whitespace.
 *
 * Deliberately NOT presentation-pipeline.mjs's exported `canonicalJson`, which emits
 * `JSON.stringify(v, null, 2) + "\n"`. That form sorts keys but keeps indentation, so it produces a
 * different digest for the same document -- verified against the shipped build-evidence-pack
 * fixture, whose recorded digest matches the compact form and neither pretty form.
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoInstant(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

/** Exact-key deep scan. Depth-bounded so a cyclic or pathological document cannot hang the gate. */
function findSelfApprovalKeys(value, trail = "", depth = 0) {
  if (depth > MAX_WALK_DEPTH) return [];
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => hits.push(...findSelfApprovalKeys(entry, `${trail}[${index}]`, depth + 1)));
    return hits;
  }
  if (!isPlainObject(value)) return hits;
  for (const [key, entry] of Object.entries(value)) {
    const at = trail ? `${trail}.${key}` : key;
    if (FORBIDDEN_SELF_APPROVAL_KEYS.has(key)) {
      hits.push({ path: at, key, reason: "a producer may not assert its own approval" });
    }
    if (key === "promotionAuthorized" && entry === true) {
      hits.push({ path: at, key, reason: "a producer may write promotionAuthorized:false, never true" });
    }
    if (key === "verdict" && entry === "human-reviewed") {
      hits.push({ path: at, key, reason: "human review is derived from an attestation, never authored" });
    }
    hits.push(...findSelfApprovalKeys(entry, at, depth + 1));
  }
  return hits;
}

/**
 * The clauses behind "a stage asserts completeness it cannot show".
 *
 * The load-bearing one is `total-claim`: a stage that lists what it achieved, declares nothing
 * unattempted and nothing refused, is claiming its whole scope was covered. That is the vacuous
 * pass at artifact scale -- a conclusion with no denominator behind it.
 */
function completenessFaults(stage, completeness) {
  const faults = [];
  if (!isPlainObject(completeness)) {
    return [{ stage, clause: "missing", detail: "completeness must be an object with claimed, notRun and refused" }];
  }
  const claimed = completeness.claimed;
  const notRun = completeness.notRun;
  const refused = completeness.refused;
  if (!Array.isArray(claimed) || !Array.isArray(notRun) || !Array.isArray(refused)) {
    return [{ stage, clause: "malformed", detail: "claimed, notRun and refused must each be arrays" }];
  }
  if (claimed.length > 0 && notRun.length === 0 && refused.length === 0) {
    faults.push({
      stage,
      clause: "total-claim",
      detail: `claims ${claimed.length} item(s) while declaring nothing not-run and nothing refused, which asserts its entire scope was covered`,
    });
  }
  const notRunSet = new Set(notRun.filter((entry) => typeof entry === "string"));
  for (const entry of claimed) {
    if (typeof entry === "string" && notRunSet.has(entry)) {
      faults.push({ stage, clause: "contradiction", detail: `"${entry}" is listed as both claimed and notRun` });
    }
  }
  refused.forEach((entry, index) => {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.item) || !isNonEmptyString(entry.reason)) {
      faults.push({
        stage,
        clause: "refusal-without-reason",
        detail: `refused[${index}] must carry a non-empty item and reason; a silent omission is the failure this exists to catch`,
      });
    }
  });
  return faults;
}

/**
 * Load the chain artifacts from one directory.
 *
 * Non-recursive, on purpose. A chain directory legitimately contains sub-trees of supporting
 * evidence (the shipped build-evidence fixture ships source files and a receipt-match-coverage.json
 * under `build-evidence/`). Recursing would let an evidence file that happens to declare a chain
 * schemaVersion masquerade as a stage. Bounding the subject to the top level is the over-matching
 * guard.
 *
 * Artifacts are indexed by their DECLARED root `schemaVersion`, never by filename. Filenames are a
 * convention; the declaration is definitional. This is the same correction the trust-surface gate
 * needed when it matched prose instead of declared state.
 */
async function loadChain(chainDir) {
  let entries;
  try {
    entries = await readdir(chainDir, { withFileTypes: true });
  } catch (error) {
    return { unreadableDir: { dir: chainDir, error: String(error?.code ?? error) } };
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const bySchema = new Map();
  const duplicates = [];
  const unreadableFiles = [];
  const ignoredNonChainJson = [];

  for (const name of files) {
    const file = path.join(chainDir, name);
    let doc;
    try {
      doc = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      unreadableFiles.push({ file: name, error: String(error?.message ?? error) });
      continue;
    }
    const schemaVersion = isPlainObject(doc) ? doc.schemaVersion : undefined;
    if (!isNonEmptyString(schemaVersion) || !CHAIN_SCHEMA_VERSIONS.has(schemaVersion)) {
      ignoredNonChainJson.push(name);
      continue;
    }
    if (bySchema.has(schemaVersion)) {
      duplicates.push({ schemaVersion, files: [bySchema.get(schemaVersion).file, name].sort() });
      continue;
    }
    bySchema.set(schemaVersion, { file: name, doc });
  }

  return { bySchema, duplicates, unreadableFiles, ignoredNonChainJson, jsonFilesScanned: files.length };
}

/**
 * Walk the full chain and report what was measured alongside what was concluded.
 *
 * @param {object} options
 * @param {string} options.chainDir   directory holding the five stage artifacts, top level only
 * @param {string} [options.caseId]   restrict to one journey; inferred from the artifacts when absent
 * @returns {Promise<object>} a verdict carrying verdict, exitCode and a full denominator
 */
export async function verifyJourneyChain({ chainDir, caseId } = {}) {
  const dir = path.resolve(String(chainDir ?? ""));
  const loaded = await loadChain(dir);

  const failures = [];
  const notes = [];

  if (loaded.unreadableDir) {
    return renderVerdict({
      dir,
      caseId: caseId ?? null,
      resolvedCaseId: null,
      stages: CHAIN_SPEC.map((spec) => ({ stage: spec.stage, schemaVersion: spec.schemaVersion, present: false, file: null })),
      edges: [],
      failures: [],
      notes: [
        {
          code: "chain-directory-unreadable",
          detail: `cannot read ${dir} (${loaded.unreadableDir.error}); nothing was measured`,
        },
      ],
      coverage: {
        jsonFilesScanned: 0,
        ignoredNonChainJson: [],
        unreadableFiles: [],
        duplicateStages: [],
        caseIdsConfirmed: 0,
        caseIdsAssertedUnconfirmable: 0,
      },
    });
  }

  const { bySchema, duplicates, unreadableFiles, ignoredNonChainJson, jsonFilesScanned } = loaded;

  // caseId scoping. The exempt root declares none, so it is never filtered out by this.
  const declaredCaseIds = [...bySchema.values()]
    .map(({ doc }) => doc.caseId)
    .filter((value) => isNonEmptyString(value));
  const distinctCaseIds = [...new Set(declaredCaseIds)].sort();
  let resolvedCaseId = null;
  if (isNonEmptyString(caseId)) {
    resolvedCaseId = caseId;
    for (const [schemaVersion, record] of [...bySchema]) {
      if (isNonEmptyString(record.doc.caseId) && record.doc.caseId !== caseId) {
        bySchema.delete(schemaVersion);
        notes.push({
          code: "artifact-outside-requested-case",
          detail: `${record.file} declares caseId "${record.doc.caseId}", not the requested "${caseId}"; excluded from this traversal`,
        });
      }
    }
  } else if (distinctCaseIds.length === 1) {
    resolvedCaseId = distinctCaseIds[0];
  } else if (distinctCaseIds.length > 1) {
    failures.push({
      code: "case-id-conflict",
      detail: `one chain directory holds more than one journey: ${distinctCaseIds.join(", ")}. Pass caseId to disambiguate.`,
    });
  }

  for (const duplicate of duplicates) {
    failures.push({
      code: "duplicate-stage",
      detail: `${duplicate.schemaVersion} is declared by more than one file (${duplicate.files.join(", ")}); the chain is ambiguous`,
    });
  }

  // --- stage presence -------------------------------------------------------------------------
  const stages = CHAIN_SPEC.map((spec) => {
    const record = bySchema.get(spec.schemaVersion);
    return {
      stage: spec.stage,
      schemaVersion: spec.schemaVersion,
      present: Boolean(record),
      file: record?.file ?? null,
      envelope: spec.envelope,
    };
  });
  const stagesFound = stages.filter((entry) => entry.present).length;
  for (const entry of stages.filter((s) => !s.present)) {
    failures.push({
      code: "stage-absent",
      stage: entry.stage,
      detail: `no artifact in ${dir} declares ${entry.schemaVersion}`,
    });
  }

  // --- envelope -------------------------------------------------------------------------------
  for (const spec of CHAIN_SPEC) {
    const record = bySchema.get(spec.schemaVersion);
    if (!record) continue;
    if (spec.envelope === "exempt-legacy-root") {
      notes.push({
        code: "envelope-exempt",
        stage: spec.stage,
        detail: `${spec.schemaVersion} predates the inter-stage envelope and declares no caseId/stage/producedAt/completeness; only its existence, schemaVersion and digest are checkable`,
      });
      continue;
    }
    const doc = record.doc;
    const missing = ENVELOPE_FIELDS.filter((field) => doc[field] === undefined);
    if (missing.length > 0) {
      failures.push({
        code: "envelope-incomplete",
        stage: spec.stage,
        detail: `${record.file} is missing required envelope field(s): ${missing.join(", ")}`,
      });
    }
    if (doc.stage !== undefined && doc.stage !== spec.stage) {
      failures.push({
        code: "stage-mislabelled",
        stage: spec.stage,
        detail: `${record.file} declares stage "${doc.stage}" but ${spec.schemaVersion} is the ${spec.stage} stage`,
      });
    }
    if (doc.producedAt !== undefined && !isIsoInstant(doc.producedAt)) {
      failures.push({
        code: "produced-at-unparseable",
        stage: spec.stage,
        detail: `${record.file} producedAt "${doc.producedAt}" is not an ISO-8601 instant`,
      });
    }
    if (!Array.isArray(doc.inputs)) {
      failures.push({
        code: "inputs-not-an-array",
        stage: spec.stage,
        detail: `${record.file} inputs must be an array of bindings`,
      });
    }
    failures.push(
      ...completenessFaults(spec.stage, doc.completeness).map((fault) => ({
        code: `completeness-${fault.clause}`,
        stage: fault.stage,
        detail: `${record.file}: ${fault.detail}`,
      })),
    );
    for (const hit of findSelfApprovalKeys(doc)) {
      failures.push({
        code: "self-approval-asserted",
        stage: spec.stage,
        detail: `${record.file} writes "${hit.path}": ${hit.reason}`,
      });
    }
  }

  // --- edges and digests ----------------------------------------------------------------------
  const edges = [];
  let caseIdsConfirmed = 0;
  let caseIdsAssertedUnconfirmable = 0;

  for (const spec of CHAIN_SPEC) {
    const record = bySchema.get(spec.schemaVersion);
    for (const upstreamSchema of spec.consumes) {
      const edge = {
        from: spec.stage,
        to: SPEC_BY_SCHEMA.get(upstreamSchema)?.stage ?? null,
        upstreamSchemaVersion: upstreamSchema,
        bound: false,
        digestChecked: false,
        digestMatched: false,
        reason: null,
      };
      if (!record) {
        edge.reason = "downstream stage absent";
        edges.push(edge);
        continue;
      }
      const bindings = Array.isArray(record.doc.inputs) ? record.doc.inputs : [];
      const binding = bindings.find(
        (entry) => isPlainObject(entry) && entry.schemaVersion === upstreamSchema,
      );
      if (!binding) {
        edge.reason = "no inputs[] binding names this upstream artifact";
        failures.push({
          code: "edge-unbound",
          stage: spec.stage,
          detail: `${record.file} consumes ${upstreamSchema} per the frozen chain but declares no inputs[] binding for it`,
        });
        edges.push(edge);
        continue;
      }
      edge.bound = true;

      if (!isNonEmptyString(binding.sha256) || !SHA256_HEX.test(binding.sha256)) {
        edge.reason = "binding carries no lowercase-hex sha256";
        failures.push({
          code: "digest-malformed",
          stage: spec.stage,
          detail: `${record.file} binding for ${upstreamSchema} has sha256 "${binding.sha256}", which is not 64 lowercase hex characters`,
        });
        edges.push(edge);
        continue;
      }

      const upstream = bySchema.get(upstreamSchema);
      if (!upstream) {
        // Unresolvable is NOT a pass and NOT a match. It is unknown, and it is counted apart from
        // both so a reader can see that the digest was never actually compared to anything.
        edge.reason = "upstream artifact absent from the chain directory, so its digest cannot be recomputed";
        failures.push({
          code: "digest-unresolvable",
          stage: spec.stage,
          detail: `${record.file} binds ${upstreamSchema} by digest, but no artifact in ${dir} declares that schemaVersion`,
        });
        edges.push(edge);
        continue;
      }

      // A binding may carry a `path` hint. If it does, it must point at the file the declared
      // schemaVersion resolved to. A binding naming one artifact while pointing at another is a
      // broken chain wearing a correct-looking label.
      if (isNonEmptyString(binding.path)) {
        const pointedAt = path.basename(binding.path);
        if (pointedAt !== upstream.file) {
          failures.push({
            code: "binding-path-mismatch",
            stage: spec.stage,
            detail: `${record.file} binds ${upstreamSchema} with path "${binding.path}" but that schemaVersion resolves to ${upstream.file}`,
          });
        }
      }

      if (binding.caseId !== undefined) {
        if (isNonEmptyString(upstream.doc.caseId)) {
          if (binding.caseId === upstream.doc.caseId) {
            caseIdsConfirmed += 1;
          } else {
            failures.push({
              code: "binding-case-id-mismatch",
              stage: spec.stage,
              detail: `${record.file} binds ${upstreamSchema} as caseId "${binding.caseId}" but that artifact declares "${upstream.doc.caseId}"`,
            });
          }
        } else {
          // The exempt root declares no caseId, so the binding's claim about it can be neither
          // confirmed nor denied. Counting this as "confirmed" would be a receipt computed from the
          // traversal that produced it. It is reported apart instead.
          caseIdsAssertedUnconfirmable += 1;
          notes.push({
            code: "binding-case-id-unconfirmable",
            stage: spec.stage,
            detail: `${record.file} asserts caseId "${binding.caseId}" for ${upstreamSchema}, which declares no caseId of its own; asserted, not confirmed`,
          });
        }
      }

      edge.digestChecked = true;
      const recomputed = canonicalSha256(upstream.doc);
      edge.digestMatched = recomputed === binding.sha256;
      if (!edge.digestMatched) {
        edge.reason = "recomputed canonical digest differs from the declared one";
        failures.push({
          code: "digest-mismatch",
          stage: spec.stage,
          detail: `${record.file} declares sha256 ${binding.sha256} for ${upstreamSchema}, but the canonical JSON of ${upstream.file} hashes to ${recomputed}`,
        });
      }
      edges.push(edge);
    }
  }

  for (const entry of unreadableFiles) {
    notes.push({
      code: "file-unreadable",
      detail: `${entry.file} is not parseable JSON (${entry.error}); coverage of this directory is incomplete`,
    });
  }

  return renderVerdict({
    dir,
    caseId: caseId ?? null,
    resolvedCaseId,
    stages,
    edges,
    failures,
    notes,
    coverage: {
      jsonFilesScanned,
      ignoredNonChainJson,
      unreadableFiles,
      duplicateStages: duplicates,
      caseIdsConfirmed,
      caseIdsAssertedUnconfirmable,
    },
  });
}

function renderVerdict({ dir, caseId, resolvedCaseId, stages, edges, failures, notes, coverage }) {
  const stagesFound = stages.filter((entry) => entry.present).length;
  const stagesMissing = stages.filter((entry) => !entry.present).map((entry) => entry.stage);
  const edgesBound = edges.filter((entry) => entry.bound).length;
  const digestsChecked = edges.filter((entry) => entry.digestChecked).length;
  const digestsMatched = edges.filter((entry) => entry.digestMatched).length;
  const digestsUnresolvable = edges.filter((entry) => entry.bound && !entry.digestChecked).length;

  // Nothing located means nothing measured. That is NOT_RUN -- unknown, not clean -- and it is a
  // different thing from a chain that was walked and found broken. A caller has to be able to tell
  // "the gate could not run" from "the chain is broken", so they get different exit codes.
  const measurable = stagesFound > 0;

  // Coverage must be complete for a PASS. An unparseable file in the chain directory means part of
  // the subject was never read, and a green over an unread subject is the whole failure class.
  const coverageComplete =
    measurable &&
    stagesFound === STAGES_EXPECTED &&
    coverage.unreadableFiles.length === 0 &&
    coverage.duplicateStages.length === 0 &&
    // The structural anti-vacuity clause: every edge in the frozen chain must have been bound AND
    // its digest actually recomputed and compared. A chain of five artifacts that declare no inputs
    // would otherwise satisfy every other clause by having nothing to contradict.
    edgesBound === EDGES_EXPECTED &&
    digestsChecked === EDGES_EXPECTED &&
    digestsMatched === EDGES_EXPECTED;

  const verdict = !measurable ? "NOT_RUN" : failures.length > 0 ? "FAIL" : coverageComplete ? "PASS" : "NOT_RUN";
  const exitCode = verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 3;

  if (measurable && failures.length === 0 && !coverageComplete) {
    notes.push({
      code: "coverage-incomplete",
      detail:
        "no failure fired, but the traversal did not cover the whole chain; reported NOT_RUN rather than PASS because an unmeasured chain is unknown, not clean",
    });
  }

  return {
    schemaVersion: JOURNEY_CHAIN_VERDICT_SCHEMA,
    chainDir: dir,
    requestedCaseId: caseId,
    caseId: resolvedCaseId,
    verdict,
    exitCode,
    passed: verdict === "PASS",
    // The denominator. Printed on every run, PASS or not. A gate reporting only its conclusion
    // cannot be audited for having measured nothing (docs/VACUOUS_PASS.md).
    denominator: {
      stagesExpected: STAGES_EXPECTED,
      stagesFound,
      stagesMissing,
      edgesExpected: EDGES_EXPECTED,
      edgesBound,
      digestsExpected: EDGES_EXPECTED,
      digestsChecked,
      digestsMatched,
      digestsUnresolvable,
      jsonFilesScanned: coverage.jsonFilesScanned,
      ignoredNonChainJson: coverage.ignoredNonChainJson,
      unreadableFiles: coverage.unreadableFiles,
      duplicateStages: coverage.duplicateStages,
      caseIdsConfirmed: coverage.caseIdsConfirmed,
      caseIdsAssertedUnconfirmable: coverage.caseIdsAssertedUnconfirmable,
      coverageComplete,
    },
    stages,
    edges,
    failures,
    notes,
    boundary:
      "Reads JSON artifacts from one directory, top level only, and recomputes every declared inputs[] digest from the canonical JSON of the artifact it names. It does not validate stage content against its JSON Schema, does not run any stage, and cannot tell whether a stage's content is true -- only whether the chain binding it claims actually holds.",
  };
}

/**
 * Human-readable report. Leads with the denominator, not the verdict, so a reader who expected five
 * stages sees "2 of 5" before they see a colour.
 */
export function formatJourneyChainReport(verdict) {
  const d = verdict.denominator;
  const lines = [
    `journey chain: ${verdict.chainDir}`,
    `case: ${verdict.caseId ?? "(none declared)"}`,
    `stages ${d.stagesFound}/${d.stagesExpected} found` + (d.stagesMissing.length ? `  missing: ${d.stagesMissing.join(", ")}` : ""),
    `edges  ${d.edgesBound}/${d.edgesExpected} bound`,
    `digests ${d.digestsMatched}/${d.digestsExpected} matched  (checked ${d.digestsChecked}, unresolvable ${d.digestsUnresolvable})`,
    `caseIds ${d.caseIdsConfirmed} confirmed, ${d.caseIdsAssertedUnconfirmable} asserted-unconfirmable`,
    `files   ${d.jsonFilesScanned} json scanned, ${d.ignoredNonChainJson.length} not chain artifacts, ${d.unreadableFiles.length} unreadable`,
  ];
  for (const note of verdict.notes) lines.push(`  note    [${note.code}] ${note.detail}`);
  for (const failure of verdict.failures) lines.push(`  FAILURE [${failure.code}] ${failure.detail}`);
  lines.push(`verdict: ${verdict.verdict} (exit ${verdict.exitCode})`);
  return lines.join("\n");
}

// Runnable directly so both probe directions can be demonstrated with a real exit code without
// touching src/cli.mjs, which four agents are editing concurrently. CLI wiring is a follow-up.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , chainDir, caseId] = process.argv;
  if (!chainDir) {
    console.error("usage: node src/lib/journey-chain-gate.mjs <chain-dir> [caseId]");
    process.exit(2);
  }
  const verdict = await verifyJourneyChain({ chainDir, caseId });
  console.log(formatJourneyChainReport(verdict));
  process.exit(verdict.exitCode);
}
