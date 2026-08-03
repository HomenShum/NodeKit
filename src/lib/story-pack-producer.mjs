import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "./journey-chain-gate.mjs";
import { validateSchema } from "./schema-validation.mjs";

// The EXPLAIN-stage producer of the Builder Journey. Given a nodekit.build-evidence-pack/v1 and a
// set of claims somebody wants to make about it, it writes a nodekit.story-pack/v1.
//
// This is the stage where a product acquires abilities it does not have. Nobody decides to lie. A
// sentence gets written because it reads well, it survives three revisions because nobody owns
// checking it, and by launch it is on a slide. So the producer's whole job is the demotion: a claim
// it cannot bind does not get deleted and does not get a warning, it moves to withheldClaims where
// the omission is a recorded fact with a reason. A story that quietly dropped its weakest claim and
// a story that never had one look identical, and only one of them is honest.
//
// Two mechanical checks, both of which a human reviewer reliably misses:
//
//   1. DOES THE EVIDENCE EXIST. Every claim names bepClaimIds and evidenceRefs. Those either resolve
//      to entries in the pack or they do not; it is a lookup, not a judgement. An unresolvable ref
//      is an invented capability by definition.
//
//   2. DOES THE SENTENCE IMPLY MORE THAN THE DATA IS. This is the one worth having. "Your Square
//      export shows revenue up 12%" makes four promises about the DATA — that these bytes are the
//      reader's, that a live account is attached, that it reflects now, that the numbers happened.
//      A statement implying user-owned data over a synthetic fixture is the defect, and it is
//      invisible to review because the sentence is beautiful and the binding is three files away.
//
//      Two halves, and only together are they worth anything. The phrase scan finds the promise, and
//      it has limited recall by construction: a paraphrase using no listed phrase scans clean, which
//      completeness.notRun states outright rather than leaving a reader to assume coverage. The
//      origin finds the truth, and it is DERIVED from the declared sources — never read back from
//      the claim's own contentBinding.origin. That second half is what makes the first a check
//      instead of a formality: if a caller could write "authority-issued" over a fixture, the one
//      field everything turns on would be the one field nobody verifies, and a claim could pass by
//      asserting its own innocence. A claim is only as real as the weakest source it cites.
//
// What this producer CANNOT do, stated so completeness.notRun can say it: it cannot tell whether a
// statement is true, whether the narrative is any good, or whether the audience is the right one. It
// reads bindings. promotionAuthorized is never written true — that is a human's signature, and a
// producer that could grant it would be the last check anyone bothered to run.
//
// See docs/JOURNEY_INTERSTAGE_CONTRACT.md and schemas/nodekit.story-pack.v1.schema.json.

export const STORY_PACK_SCHEMA = "nodekit.story-pack.v1.schema.json";
export const STORY_PACK_SCHEMA_VERSION = "nodekit.story-pack/v1";
export const BUILD_EVIDENCE_PACK_SCHEMA_VERSION = "nodekit.build-evidence-pack/v1";
export const OPPORTUNITY_CONTRACT_SCHEMA_VERSION = "nodekit.opportunity-contract/v1";

const PRODUCER_TOOL = "src/lib/story-pack-producer.mjs";
const SCANNER_VERSION = "1.0.0";

/** Origins where the bytes are not the reader's real, current data. */
const UNREAL_ORIGINS = new Set(["fixture", "synthetic", "model_generated", "unknown"]);

/**
 * How real each origin is. A claim drawing on several sources is only as real as its weakest one:
 * mixing an authority-issued export with a synthetic row does not produce authority-issued data, and
 * a chart that blends them is not partly trustworthy.
 */
const ORIGIN_STRENGTH = Object.freeze({
  "authority-issued": 4,
  fixture: 3,
  synthetic: 2,
  model_generated: 1,
  unknown: 0,
});

/**
 * The origin a claim's data ACTUALLY has, derived from the sources it cites rather than taken from
 * the caller's own contentBinding.origin.
 *
 * This is the difference between a check and a formality. `origin` is a string the caller writes; if
 * the producer reads it back and believes it, then writing "authority-issued" over a fixture
 * disables every downstream honesty rule at zero cost, and the one field the whole check turns on is
 * the one field nobody verifies. The schema names weakest-origin comparison a verifier obligation.
 * This performs it.
 */
function deriveOrigin(sourceRefs, sourceOrigins, at, refusals) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    // No sources cited is not "authority-issued by default". It is the absence of provenance, and
    // it must land on the weakest rung rather than the strongest.
    return "unknown";
  }
  const unresolved = sourceRefs.filter((ref) => !sourceOrigins.has(ref));
  if (unresolved.length > 0) {
    refusals.push(
      `${at} cites ${unresolved.join(", ")}, which is not a declared source — `
        + "a provenance reference that resolves to nothing is the same defect as an evidence reference that does",
    );
    return "unknown";
  }
  let weakest = "authority-issued";
  for (const ref of sourceRefs) {
    const origin = sourceOrigins.get(ref) ?? "unknown";
    if ((ORIGIN_STRENGTH[origin] ?? 0) < (ORIGIN_STRENGTH[weakest] ?? 0)) weakest = origin;
  }
  return weakest;
}

/**
 * The phrase lexicon. Each entry maps a surface phrase to what it promises about the DATA — the
 * four implications the story-pack schema enumerates. Ordering is longest-first at match time so
 * "your data" does not shadow "based on your data".
 *
 * Deliberately small and literal. A cleverer scanner with stemming and negation handling would find
 * more and would also be arguable, and an arguable scanner gets overridden the first time it blocks
 * a launch. Every phrase here is one a reasonable person agrees implies what it is mapped to.
 */
export const PHRASE_LEXICON = Object.freeze({
  "your square export": ["user-owned", "connected", "factual"],
  "your export": ["user-owned", "factual"],
  "your account": ["user-owned", "connected"],
  "your data": ["user-owned", "factual"],
  "your numbers": ["user-owned", "factual"],
  "your revenue": ["user-owned", "factual"],
  "your customers": ["user-owned", "factual"],
  "based on your": ["user-owned", "factual"],
  "from your": ["user-owned", "factual"],
  "connected to": ["connected"],
  "synced": ["connected", "current"],
  "syncs": ["connected", "current"],
  "live": ["connected", "current"],
  "real time": ["connected", "current"],
  "real-time": ["connected", "current"],
  "up to date": ["current"],
  "up-to-date": ["current"],
  "as of today": ["current"],
  "currently": ["current"],
  "right now": ["current"],
  "actual revenue": ["factual"],
  "actual": ["factual"],
  "real revenue": ["factual"],
  "measured": ["factual"],
  "we found": ["factual"],
  "shows that": ["factual"],
});

export const LEXICON_DIGEST = createHash("sha256")
  .update(JSON.stringify(PHRASE_LEXICON))
  .digest("hex");

/** Fail-closed error. Every reason at once, so fixing one does not reveal the next on a rerun. */
export class StoryPackRefusal extends Error {
  constructor(refusals) {
    const list = Array.isArray(refusals) ? refusals : [String(refusals)];
    super(`story-pack producer refused:\n${list.map((entry) => `  - ${entry}`).join("\n")}`);
    this.name = "StoryPackRefusal";
    this.refusals = list;
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Digest every artifactRef the caller named, rather than trusting a supplied hash.
 *
 * A caller-supplied sha256 is an unchecked claim wearing the costume of evidence — it is a string
 * in a field, and nothing forces it to correspond to any file. So the producer reads the bytes and
 * fills in path/sha256/byteLength itself, and a named file that does not exist is a refusal. The
 * schema's own comment says it: `exists: true` is not evidence that anything exists.
 */
async function digestArtifact(ref, repoRoot, at, refusals) {
  if (!ref || typeof ref !== "object" || !isNonEmptyString(ref.path)) {
    refusals.push(`${at} needs an artifact with a path`);
    return null;
  }
  const abs = path.resolve(repoRoot, ref.path);
  try {
    const bytes = await readFile(abs);
    return {
      path: ref.path.split(path.sep).join("/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      ...(isNonEmptyString(ref.mediaType) ? { mediaType: ref.mediaType } : {}),
    };
  } catch (error) {
    refusals.push(`${at} names ${ref.path}, which cannot be read (${error?.code ?? error}); a fabricated artifact path is the dishonesty this schema exists to make unrepresentable`);
    return null;
  }
}

/** POSIX-relative path from where the pack will be written to what it binds. */
function relativeTo(outTarget, absolute) {
  return path.relative(path.dirname(path.resolve(outTarget)), absolute).split(path.sep).join("/");
}

function utcNow(now) {
  const stamp = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(stamp.getTime())) throw new StoryPackRefusal(["now is not a valid date"]);
  return stamp.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/**
 * Scan one statement. Returns the phraseScan record the schema wants: every matched phrase with
 * what it implies and where it sat, so a reader can see the scanner's working rather than trust it.
 */
export function scanStatement(statement, scannedAt) {
  const haystack = String(statement ?? "").toLowerCase();
  const matches = [];
  const claimed = new Set();
  // Longest phrase first: "based on your data" must win over "your data", or the report points at
  // a fragment the writer did not write and the finding gets dismissed as noise.
  const phrases = Object.keys(PHRASE_LEXICON).sort((a, b) => b.length - a.length);
  const taken = [];

  for (const phrase of phrases) {
    // Word-bounded, not substring: "live" inside "delivered" and "actual" inside "actuality" would
    // withhold a claim over a coincidence, and a scanner that cries wolf gets switched off.
    const bounded = new RegExp(`(?<![a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
    const found = bounded.exec(haystack);
    if (!found) continue;
    const offset = found.index;
    const end = offset + phrase.length;
    // Skip a phrase already covered by a longer match at the same position.
    if (taken.some(([start, stop]) => offset >= start && end <= stop)) continue;
    taken.push([offset, end]);
    const implies = PHRASE_LEXICON[phrase];
    for (const implication of implies) claimed.add(implication);
    if (matches.length < 32) matches.push({ phrase, implies: [...implies], offset });
  }

  return {
    scan: {
      scanner: PRODUCER_TOOL,
      scannerVersion: SCANNER_VERSION,
      lexiconDigest: LEXICON_DIGEST,
      scannedAt,
      matches,
    },
    implications: [...claimed].sort(),
  };
}

/** Every evidenceId and claimId the build evidence pack actually contains. */
function packIndex(pack) {
  const evidence = new Set();
  const claims = new Set();
  for (const entry of pack?.content?.evidence ?? []) {
    if (isNonEmptyString(entry?.evidenceId)) evidence.add(entry.evidenceId);
  }
  for (const entry of pack?.content?.claims ?? []) {
    if (isNonEmptyString(entry?.claimId)) claims.add(entry.claimId);
  }
  return { evidence, claims };
}

function packRefusals(pack) {
  const refusals = [];
  if (!pack || typeof pack !== "object") return ["the build evidence pack is not an object"];
  if (pack.schemaVersion !== BUILD_EVIDENCE_PACK_SCHEMA_VERSION) {
    refusals.push(`input must be a ${BUILD_EVIDENCE_PACK_SCHEMA_VERSION}, got ${pack.schemaVersion ?? "nothing"}`);
  }
  if (!isNonEmptyString(pack.caseId)) refusals.push("the build evidence pack has no caseId");
  if (!Array.isArray(pack?.content?.evidence)) {
    refusals.push("the build evidence pack has no content.evidence; there is nothing for a story to bind to");
  }
  // A pack whose own producer refused things is a pack whose story must not read as complete. This
  // is not fatal — it is carried into completeness so the story inherits it.
  return refusals;
}

/**
 * Decide one proposed claim's fate. Returns either {claim} or {withheld}. Nothing is dropped: a
 * claim that cannot be bound becomes a recorded omission with a reason a reader can argue with.
 */
function adjudicate(proposed, index, { evidence, claims }, surfaces, sourceOrigins, disclosures, demoMode, scannedAt) {
  const at = `claims[${index}]`;
  const claimId = isNonEmptyString(proposed?.claimId) ? proposed.claimId : `sc-${index + 1}`;
  const statement = proposed?.statement;

  // Shape problems are the caller's bug, not a story decision — refuse rather than silently withhold.
  if (!isNonEmptyString(statement)) throw new StoryPackRefusal([`${at} needs a statement`]);
  if (!Array.isArray(proposed.surfaceRefs) || proposed.surfaceRefs.length === 0) {
    throw new StoryPackRefusal([`${at} ("${statement}") names no surfaceRefs; a claim rendered nowhere is not a claim`]);
  }
  const unknownSurfaces = proposed.surfaceRefs.filter((ref) => !surfaces.has(ref));
  if (unknownSurfaces.length > 0) {
    throw new StoryPackRefusal([`${at} renders on ${unknownSurfaces.join(", ")}, which is not in surfaces`]);
  }

  const { scan, implications } = scanStatement(statement, scannedAt);
  const binding = proposed.buildBinding ?? {};
  const bepClaimIds = Array.isArray(binding.bepClaimIds) ? binding.bepClaimIds : [];
  const evidenceRefs = Array.isArray(binding.evidenceRefs) ? binding.evidenceRefs : [];

  // Check 1: the evidence either exists in the pack or it does not.
  const missingEvidence = evidenceRefs.filter((ref) => !evidence.has(ref));
  const missingClaims = bepClaimIds.filter((ref) => !claims.has(ref));

  if (evidenceRefs.length === 0 && bepClaimIds.length === 0) {
    return {
      withheld: {
        claimId,
        statement,
        withheldBecause: "no-build-evidence",
        detail: "the claim cites nothing in the build evidence pack; an empty binding is the shape an aspiration takes on its way to a slide",
        wouldHaveImplied: implications.length > 0 ? implications : ["factual"],
      },
    };
  }
  if (missingEvidence.length > 0 || missingClaims.length > 0) {
    const missing = [...missingEvidence, ...missingClaims].join(", ");
    return {
      withheld: {
        claimId,
        statement,
        withheldBecause: "no-build-evidence",
        detail: `cites ${missing}, which the build evidence pack does not contain — a reference that resolves to nothing is an invented capability, not a typo`,
        wouldHaveImplied: implications.length > 0 ? implications : ["factual"],
      },
    };
  }

  // Check 2: does the sentence promise more than the data is?
  const proposedBinding = proposed.contentBinding ?? { origin: "unknown", sourceRefs: [] };
  const sourceRefs = Array.isArray(proposedBinding.sourceRefs) ? proposedBinding.sourceRefs : [];
  const originRefusals = [];
  const origin = deriveOrigin(sourceRefs, sourceOrigins, `${at} ("${statement}")`, originRefusals);
  if (originRefusals.length > 0) throw new StoryPackRefusal(originRefusals);
  // The caller's own claim about origin is overwritten by the derived one, and the disagreement is
  // recorded on the claim rather than silently resolved — somebody wrote that word for a reason.
  const contentBinding = { ...proposedBinding, sourceRefs, origin };
  const statedOrigin = proposedBinding.origin;
  const originDisagreement = isNonEmptyString(statedOrigin) && statedOrigin !== origin
    ? `the claim stated origin ${statedOrigin}; its sources are ${origin}, and the weaker of the two is what the reader gets`
    : null;
  const dataIsUnreal = UNREAL_ORIGINS.has(origin);
  const promisesReality = implications.some((entry) => entry === "user-owned" || entry === "connected" || entry === "factual");
  const onDemoSurface = demoMode.engaged === true
    && proposed.surfaceRefs.some((ref) => (demoMode.surfaceRefs ?? []).includes(ref));

  let status = "bound";
  const disclosureRefs = Array.isArray(proposed.disclosureRefs) ? [...proposed.disclosureRefs] : [];

  if (dataIsUnreal && promisesReality) {
    // A disclosure covering one of this claim's own surfaces is the only thing that makes it
    // sayable. A demo-data disclosure on a different page is not a disclosure to this reader.
    const covering = disclosures.filter(
      (entry) => entry.kind === "demo-data" && (entry.surfaceRefs ?? []).some((ref) => proposed.surfaceRefs.includes(ref)),
    );
    if (covering.length === 0) {
      return {
        withheld: {
          claimId,
          statement,
          withheldBecause: "cannot-be-disclosed-honestly",
          detail:
            `the statement implies ${implications.join(", ")} but its data origin is ${origin}, and no demo-data disclosure covers `
            + `${proposed.surfaceRefs.join(", ")}. Either the sentence stops promising real data or the surface says it is a demo.`,
          wouldHaveImplied: implications,
        },
      };
    }
    status = "disclosed-demo";
    for (const entry of covering) {
      if (!disclosureRefs.includes(entry.disclosureId)) disclosureRefs.push(entry.disclosureId);
    }
  } else if (onDemoSurface) {
    // Rendered inside a demo, so it is a demo claim even where the phrasing is careful.
    status = "disclosed-demo";
  }

  const claim = {
    claimId,
    statement,
    surfaceRefs: [...proposed.surfaceRefs],
    consequential: proposed.consequential === true,
    rendersData: proposed.rendersData === true,
    dataImplications: implications,
    phraseScan: scan,
    status,
    buildBinding: {
      bepClaimIds,
      evidenceRefs,
      ...(binding.restatement ? { restatement: binding.restatement } : {}),
      ...(binding.strengthDelta ? { strengthDelta: binding.strengthDelta } : {}),
    },
    contentBinding,
    boundary: [
      isNonEmptyString(proposed.boundary)
        ? proposed.boundary
        : "What this claim does not establish was not assessed by the producer; it reads bindings, not meaning.",
      originDisagreement,
    ].filter(Boolean).join(" "),
  };
  if (disclosureRefs.length > 0) claim.disclosureRefs = disclosureRefs;
  return { claim };
}

/**
 * Produce a StoryPack from a BuildEvidencePack.
 *
 * @nodekit-behavior journey.explain.produce-story owner
 */
export async function produceStoryPack({
  packPath,
  contractPath,
  outPath,
  repoRoot,
  caseId,
  audience,
  surfaces = [],
  sources = [],
  disclosures = [],
  claims = [],
  narrative = [],
  demoMode = { engaged: false, surfaceRefs: [] },
  now,
} = {}) {
  const refusals = [];
  if (!packPath) refusals.push("packPath is required");
  // EXPLAIN is answerable to the contract, not only to the build: the narrative has to serve the
  // successCondition somebody agreed to, and stay inside the authorityLimits. Carrying only the
  // pack forward would let a story drift off its own contract with nothing to compare against.
  if (!contractPath) refusals.push("contractPath is required; the story is answerable to the contract's successCondition, not only to what the build produced");
  if (!audience) refusals.push("audience is required; a story with no named reader is a story nobody checked against anyone");
  // Zero claims is not a modest story, it is an empty one, and an empty pack in a chain reads as a
  // completed stage. The vacuous-pass rule applies to producers too.
  if (!Array.isArray(claims) || claims.length === 0) {
    refusals.push("no claims proposed; a story pack that claims nothing explains nothing, and must not sit in the chain looking like a finished stage");
  }
  if (refusals.length > 0) throw new StoryPackRefusal(refusals);

  const packAbs = path.resolve(packPath);
  let raw;
  try {
    raw = await readFile(packAbs);
  } catch (error) {
    throw new StoryPackRefusal([`cannot read build evidence pack at ${packAbs}: ${error?.code ?? error}`]);
  }
  let pack;
  try {
    pack = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new StoryPackRefusal([`build evidence pack at ${packAbs} is not parseable JSON: ${error?.message ?? error}`]);
  }
  const packProblems = packRefusals(pack);
  if (packProblems.length > 0) throw new StoryPackRefusal(packProblems);

  const contractAbs = path.resolve(contractPath);
  let contract;
  try {
    contract = JSON.parse((await readFile(contractAbs)).toString("utf8"));
  } catch (error) {
    throw new StoryPackRefusal([`cannot read the opportunity contract at ${contractAbs}: ${error?.message ?? error?.code ?? error}`]);
  }
  if (contract?.schemaVersion !== OPPORTUNITY_CONTRACT_SCHEMA_VERSION) {
    throw new StoryPackRefusal([`the contract must be a ${OPPORTUNITY_CONTRACT_SCHEMA_VERSION}, got ${contract?.schemaVersion ?? "nothing"}`]);
  }
  // The pack already bound a contract. A story binding a DIFFERENT one is how a narrative ends up
  // answering a question nobody asked of this build — silent, and invisible in review.
  const packContractDigest = (pack.inputs ?? []).find(
    (entry) => entry?.schemaVersion === OPPORTUNITY_CONTRACT_SCHEMA_VERSION,
  )?.sha256;
  const contractDigest = canonicalSha256(contract);
  if (packContractDigest && packContractDigest !== contractDigest) {
    throw new StoryPackRefusal([
      `the build evidence pack was produced against contract ${packContractDigest.slice(0, 12)} but this story binds ${contractDigest.slice(0, 12)} — `
        + "a story answering a different contract than the build is a chain break, not a detail",
    ]);
  }

  for (const field of ["reader", "decision", "stakes"]) {
    if (!isNonEmptyString(audience?.[field])) refusals.push(`audience needs ${field}`);
  }
  if (refusals.length > 0) throw new StoryPackRefusal(refusals);

  const root = path.resolve(repoRoot ?? ".");
  const producedAt = utcNow(now);
  const index = packIndex(pack);
  const surfaceIds = new Set(surfaces.map((entry) => entry?.surfaceId).filter(isNonEmptyString));
  const resolvedCaseId = isNonEmptyString(caseId) ? caseId.trim() : pack.caseId;

  // Sources and surfaces name files. Digest them here so the pack's artifact refs are measurements
  // rather than assertions; a path that does not resolve stops the stage.
  const artifactRefusals = [];
  const digestedSources = [];
  for (const [i, source] of sources.entries()) {
    const artifact = await digestArtifact(source?.artifact, root, `sources[${i}] (${source?.sourceId ?? "unnamed"})`, artifactRefusals);
    const authority = source?.authority
      ? {
        ...source.authority,
        receipt: await digestArtifact(source.authority.receipt, root, `sources[${i}].authority.receipt`, artifactRefusals),
      }
      : undefined;
    digestedSources.push({ ...source, ...(artifact ? { artifact } : {}), ...(authority ? { authority } : {}) });
  }
  const digestedSurfaces = [];
  for (const [i, surface] of surfaces.entries()) {
    if (!surface?.artifact) {
      digestedSurfaces.push(surface);
      continue;
    }
    const artifact = await digestArtifact(surface.artifact, root, `surfaces[${i}] (${surface?.surfaceId ?? "unnamed"})`, artifactRefusals);
    digestedSurfaces.push({ ...surface, ...(artifact ? { artifact } : {}) });
  }
  if (artifactRefusals.length > 0) throw new StoryPackRefusal(artifactRefusals);

  // Provenance as declared by the sources themselves, which is the authority a claim's own
  // contentBinding.origin does not have.
  const sourceOrigins = new Map(
    digestedSources.map((entry) => [entry?.sourceId, entry?.origin ?? "unknown"]).filter(([id]) => isNonEmptyString(id)),
  );

  const kept = [];
  const withheld = [];
  for (const [i, proposed] of claims.entries()) {
    const verdict = adjudicate(proposed, i, index, surfaceIds, sourceOrigins, disclosures, demoMode, producedAt);
    if (verdict.claim) kept.push(verdict.claim);
    else withheld.push(verdict.withheld);
  }

  // Everything withheld means there is no story, and the schema agrees: content.claims has
  // minItems 1. Refusing here says that in words rather than failing validation three frames later
  // with a cardinality error nobody can trace back to a sentence about revenue.
  if (kept.length === 0) {
    throw new StoryPackRefusal([
      "every proposed claim was withheld, so there is no story to tell yet",
      ...withheld.map((entry) => `${entry.claimId} (${entry.withheldBecause}): ${entry.detail}`),
    ]);
  }

  // A narrative beat pointing at a claim that got withheld is the failure mode where the demotion
  // happens and the slide keeps the sentence anyway. Drop the ref, keep the beat, say so.
  const keptIds = new Set(kept.map((entry) => entry.claimId));
  const orphanedBeats = [];
  const beats = narrative.map((beat, i) => {
    const refs = (beat?.claimRefs ?? []).filter((ref) => keptIds.has(ref));
    const lost = (beat?.claimRefs ?? []).filter((ref) => !keptIds.has(ref));
    if (lost.length > 0) orphanedBeats.push(`beat ${beat?.order ?? i} ("${beat?.heading ?? ""}") lost ${lost.join(", ")} to withholding`);
    return { ...beat, claimRefs: refs };
  });
  // A beat left citing nothing is a heading with no substance behind it; refuse rather than ship it.
  const emptyBeats = beats.filter((beat) => beat.claimRefs.length === 0);
  if (emptyBeats.length > 0) {
    throw new StoryPackRefusal(
      emptyBeats.map(
        (beat) =>
          `narrative beat ${beat.order} ("${beat.heading}") has no surviving claims — `
          + "every claim it rested on was withheld, so the beat is a heading with nothing under it",
      ),
    );
  }

  const storyPack = {
    schemaVersion: STORY_PACK_SCHEMA_VERSION,
    caseId: resolvedCaseId,
    stage: "explain",
    producedAt,
    inputs: [
      {
        schemaVersion: pack.schemaVersion,
        caseId: pack.caseId,
        sha256: canonicalSha256(pack),
        path: relativeTo(outPath ?? packAbs, packAbs),
      },
      {
        schemaVersion: contract.schemaVersion,
        caseId: resolvedCaseId,
        sha256: contractDigest,
        path: relativeTo(outPath ?? packAbs, contractAbs),
      },
    ],
    content: {
      audience,
      surfaces: digestedSurfaces,
      sources: digestedSources,
      disclosures,
      claims: kept,
      withheldClaims: withheld,
      narrative: beats,
      demoMode,
      // Never true. A producer that could authorize its own promotion is the last check anyone runs.
      promotionAuthorized: false,
    },
    completeness: {
      claimed: kept.map((entry) => entry.claimId),
      notRun: [
        "Whether any statement is TRUE was not assessed. This producer checks that a claim's references resolve and that its phrasing does not promise more than its data origin supports; both are lookups, and neither is truth.",
        "The phrase scan has LIMITED RECALL and this is its stated boundary, not a caveat. It matches a fixed phrase list, so a paraphrase that implies user-owned, connected, current or factual data without using a listed phrase is not detected by it — \"Revenue pulled moments ago from the owner's linked account\" scans clean. Claims that slip the scanner are still governed by the derived origin, which comes from the declared sources rather than from the claim's own wording; a scan with no matches is not evidence that a statement is modest.",
        "Whether the narrative is persuasive, well-ordered, or appropriate for the named reader was not assessed.",
        "Whether the audience record names the right reader was not assessed — it was supplied, not derived.",
        ...(pack?.completeness?.notRun ?? []).map((entry) => `inherited from the build stage: ${entry}`),
      ],
      refused: [
        ...withheld.map((entry) => ({
          item: `claim ${entry.claimId}: ${entry.statement}`,
          reason: `${entry.withheldBecause} — ${entry.detail}`,
        })),
        ...orphanedBeats.map((entry) => ({
          item: entry,
          // The beat kept its heading. Somebody has to decide whether it still earns one.
          reason: "the beat's claim was withheld, so the heading now rests on fewer claims than it was written for",
        })),
        ...(pack?.completeness?.refused ?? []).map((entry) => ({
          item: typeof entry === "string" ? entry : (entry?.item ?? JSON.stringify(entry)),
          reason: typeof entry === "string"
            ? "inherited from the build stage"
            : `inherited from the build stage: ${entry?.reason ?? "no reason recorded upstream"}`,
        })),
      ],
    },
  };

  const errors = await validateSchema(STORY_PACK_SCHEMA, storyPack, resolvedCaseId);
  if (errors.length > 0) throw new StoryPackRefusal(errors);

  if (outPath) {
    const abs = path.resolve(outPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, `${JSON.stringify(storyPack, null, 2)}\n`, "utf8");
  }
  return storyPack;
}

export function formatStoryPack(storyPack) {
  const { claims, withheldClaims } = storyPack.content;
  const demoted = claims.filter((entry) => entry.status === "disclosed-demo").length;
  const lines = [
    `STORY PACK written: case ${storyPack.caseId}`,
    `  ${claims.length} claim(s) bound to build evidence; ${demoted} demoted to disclosed-demo`,
    `  ${withheldClaims.length} withheld — recorded, not deleted`,
  ];
  for (const entry of withheldClaims) {
    lines.push(`    ${entry.claimId} (${entry.withheldBecause}): ${entry.statement}`);
  }
  lines.push("  promotionAuthorized: false (a producer may never write true)");
  return lines.join("\n");
}
