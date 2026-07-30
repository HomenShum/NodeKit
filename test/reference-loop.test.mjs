import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildDesignRule,
  buildExternalReferenceRun,
  buildReferenceCandidateReceipt,
  buildReferenceObservation,
  getExternalReferenceStatus,
  referenceContentDigest,
  referenceExternalRunSubjectDigest,
  referenceHumanAttestationSigningBytes,
  referenceHumanOverrideSubjectDigest,
  referenceRenderReceiptDigest,
  referenceServiceAttestationSigningBytes,
  recordDesignRule,
  recordReferenceObservation,
  scoreReferenceCandidate,
  verifyReferenceScoreReceipt,
} from "../src/lib/reference-loop.mjs";

const execFileAsync = promisify(execFile);
const CHECKED_AT = new Date(Date.now() - 60_000).toISOString();
const EXPIRES_AT = new Date(Date.now() + 60 * 60_000).toISOString();
const MOBBIN_FLOW_URL = "https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937";
const MOBBIN_FLOW_ID = "033bd9d8-9418-4c27-b9f5-9a2a072a0937";
const MOBBIN_PRODUCER_VERSION = "2026.07.29";
const RENDER_ARTIFACT_PATH = "reference/render-proof.json";
const TRUST_POLICY_PATH = "reference/trust-policy.json";
const candidateBindings = new Map();

async function refreshCandidateBinding(root) {
  const artifactBytes = await readFile(path.join(root, RENDER_ARTIFACT_PATH));
  const candidateCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  })).stdout.trim();
  candidateBindings.set(root, {
    candidateCommit,
    renderArtifacts: [{
      path: RENDER_ARTIFACT_PATH,
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      bytes: artifactBytes.length,
    }],
  });
}

async function commitReferenceConfiguration(root, paths, message) {
  await execFileAsync("git", ["add", "--", ...paths], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", message], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-28T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-28T00:00:00Z",
    },
  });
  await refreshCandidateBinding(root);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-reference-loop-"));
  const artifactBytes = Buffer.from('{"rendered":true,"surface":"nodeslide"}\n', "utf8");
  await mkdir(path.join(root, "reference"), { recursive: true });
  await writeFile(path.join(root, RENDER_ARTIFACT_PATH), artifactBytes);
  await writeFile(
    path.join(root, TRUST_POLICY_PATH),
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-trust-policy/v1",
      credentials: {},
    }, null, 2)}\n`,
    "utf8",
  );
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "NodeKit Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "nodekit@example.test"], { cwd: root });
  await execFileAsync("git", ["add", "--", RENDER_ARTIFACT_PATH, TRUST_POLICY_PATH], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "render fixture"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-28T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-28T00:00:00Z",
    },
  });
  await refreshCandidateBinding(root);
  t.after(async () => {
    candidateBindings.delete(root);
    await rm(root, { force: true, recursive: true });
  });
  return root;
}

async function installScoringProfiles(root, profiles) {
  const profileRoot = path.join(root, "reference", "profiles");
  await mkdir(profileRoot, { recursive: true });
  const profilePaths = [];
  for (const [profile, rules] of Object.entries(profiles)) {
    const relativePath = `reference/profiles/${profile}.json`;
    await writeFile(
      path.join(root, relativePath),
      `${JSON.stringify({
        schemaVersion: "nodekit.reference-profile-manifest/v1",
        profile,
        rules: rules.map((rule) => ({
          ruleId: rule.ruleId,
          ruleDigest: rule.contentDigest,
        })),
      }, null, 2)}\n`,
      "utf8",
    );
    profilePaths.push(relativePath);
  }
  await commitReferenceConfiguration(
    root,
    [...profilePaths, "reference/corpus"],
    "install reference scoring profiles and corpus",
  );
}

function ownedObservationDraft(index = 1) {
  return {
    schemaVersion: "nodekit.reference-loop-observation/v1",
    source: {
      origin: "nodekit-owned",
      sourceUrl: `https://nodekit.local/reference/${index}`,
      sourcePolicyId: "nodekit-owned/v1",
      firstSeenAt: "2026-07-28T00:00:00.000Z",
      lastVerifiedAt: "2026-07-28T00:00:00.000Z",
      accessMode: "owned",
    },
    problemTags: ["uncitable-reference"],
    intentTags: ["bind-evidence"],
    layoutTags: ["ordered-surface"],
    interactionTags: ["review-before-release"],
    facts: [{
      factId: `fact_owned_${index}`,
      kind: "count",
      subject: "owned fixture",
      relation: "contains",
      object: index,
      unit: "facts",
      locatorDescription: "The NodeKit-owned contract fixture.",
    }],
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
    },
  };
}

function mobbinObservationDraft() {
  return {
    schemaVersion: "nodekit.reference-loop-observation/v1",
    source: {
      origin: "mobbin",
      sourceUrl: MOBBIN_FLOW_URL,
      sourcePolicyId: "atlas:mobbin/v1",
      firstSeenAt: CHECKED_AT,
      lastVerifiedAt: CHECKED_AT,
      accessMode: "remote-mcp",
    },
    problemTags: ["presentation-start-state"],
    intentTags: ["start-presentation"],
    layoutTags: ["three-screen-flow"],
    interactionTags: ["ordered-creation-flow"],
    facts: [
      {
        factId: "fact_mobbin_screen_count",
        kind: "count",
        subject: "Starting a presentation (Figma Slides) flow",
        relation: "contains",
        object: 3,
        unit: "screens",
        locatorDescription: "Flow-level screen_count returned by authenticated mobbin/search_flows.",
      },
      {
        factId: "fact_mobbin_step_1_2",
        kind: "choreography",
        subject: "screen bcdacfdb-c856-4dc9-979d-8eb351267f21",
        relation: "precedes",
        object: "screen ab34bc66-2b87-45f0-8a7d-ed8cb3120df7",
        unit: "flow position",
        locatorDescription: "Returned screen positions 1 and 2.",
      },
      {
        factId: "fact_mobbin_step_2_3",
        kind: "choreography",
        subject: "screen ab34bc66-2b87-45f0-8a7d-ed8cb3120df7",
        relation: "precedes",
        object: "screen 471a4980-ccae-4212-9a65-b5ed4c01e480",
        unit: "flow position",
        locatorDescription: "Returned screen positions 2 and 3.",
      },
      {
        factId: "fact_mobbin_category",
        kind: "relationship",
        subject: "Starting a presentation (Figma Slides) flow",
        relation: "is categorized as",
        object: "Starting & Completing",
        unit: "Mobbin action category",
        locatorDescription: "Flow-level actions metadata returned by authenticated mobbin/search_flows.",
      },
    ],
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
    },
  };
}

function mobbinRun(status = "pass") {
  return {
    schemaVersion: "nodekit.external-reference-run/v1",
    provider: "mobbin",
    operation: "authenticated-live-inspection",
    policyId: "nodekit.mobbin-remote-mcp/v1",
    status,
    ...(status === "pass" ? {
      checkedAt: CHECKED_AT,
      expiresAt: EXPIRES_AT,
      sourceUrl: MOBBIN_FLOW_URL,
      remoteObjectId: MOBBIN_FLOW_ID,
      runNonce: "canary_nonce_20260729",
      producer: {
        tool: "mobbin/search_flows",
        version: MOBBIN_PRODUCER_VERSION,
      },
    } : {
      reasonCode: "AUTHENTICATED_LIVE_INSPECTION_ABSENT",
    }),
  };
}

async function installMobbinServiceTrust(root) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const human = generateKeyPairSync("ed25519");
  const keyId = "mobbin-adapter-test";
  const humanKeyId = "human-override-test";
  await mkdir(path.join(root, "reference"), { recursive: true });
  await writeFile(
    path.join(root, TRUST_POLICY_PATH),
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-trust-policy/v1",
      credentials: {
        [keyId]: {
          publicKey: publicKey.export({ type: "spki", format: "pem" }),
          algorithm: "Ed25519",
          assurance: "S2",
          purposes: ["mobbin-external-reference-run"],
          producers: [`mobbin/search_flows@${MOBBIN_PRODUCER_VERSION}`],
        },
        [humanKeyId]: {
          publicKey: human.publicKey.export({ type: "spki", format: "pem" }),
          algorithm: "Ed25519",
          assurance: "H2",
          purposes: ["reference-score-override"],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await commitReferenceConfiguration(
    root,
    [TRUST_POLICY_PATH],
    "install reference trust credentials",
  );
  return {
    keyId,
    privateKey,
    human: { keyId: humanKeyId, privateKey: human.privateKey },
  };
}

function signedMobbinRun(
  observationDraft,
  signer,
  {
    signedAt = CHECKED_AT,
    runNonce = "canary_nonce_20260729",
  } = {},
) {
  const observation = buildReferenceObservation(observationDraft);
  const draft = {
    ...mobbinRun(),
    runNonce,
    observationId: observation.observationId,
    observationDigest: observation.contentDigest,
    factsDigest: referenceContentDigest(observation.facts),
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
      ragIndexed: false,
      trainingUsed: false,
    },
  };
  const subjectDigest = referenceExternalRunSubjectDigest(draft);
  const attestation = {
    schemaVersion: "nodekit.reference-service-attestation/v1",
    purpose: "mobbin-external-reference-run",
    keyId: signer.keyId,
    subjectDigest,
    signedAt,
    algorithm: "Ed25519",
    signatureEncoding: "base64url",
  };
  return buildExternalReferenceRun({
    ...draft,
    attestation: {
      ...attestation,
      signature: sign(
        null,
        referenceServiceAttestationSigningBytes(attestation),
        signer.privateKey,
      ).toString("base64url"),
    },
  });
}

function signedHumanOverride(baseScore, signer, decision, suppliedReason) {
  const reason = suppliedReason ?? (decision === "accept"
    ? "Explicitly approve this exact novel-by-intent candidate."
    : "Explicitly reject this exact candidate.");
  const reasonDigest = referenceContentDigest(reason);
  const subjectDigest = referenceHumanOverrideSubjectDigest({
    profile: baseScore.profile,
    candidateReceiptDigest: baseScore.candidate.candidateReceiptDigest,
    rules: baseScore.rules,
    coverage: baseScore.coverage,
    baseVerdict: baseScore.verdict,
    decision,
    reason,
  });
  const attestation = {
    schemaVersion: "nodekit.reference-human-attestation/v1",
    purpose: "reference-score-override",
    keyId: signer.keyId,
    subjectDigest,
    decision,
    reasonDigest,
    signedAt: new Date().toISOString(),
    algorithm: "Ed25519",
    signatureEncoding: "base64url",
  };
  return {
    decision,
    reason,
    reasonDigest,
    subjectDigest,
    attestation: {
      ...attestation,
      signature: sign(
        null,
        referenceHumanAttestationSigningBytes(attestation),
        signer.privateKey,
      ).toString("base64url"),
    },
  };
}

function ruleDraft(observation, index = 1) {
  return {
    schemaVersion: "nodekit.reference-loop-design-rule/v1",
    sourceObservationRefs: [{
      observationId: observation.observationId,
      observationDigest: observation.contentDigest,
      factIds: observation.facts.map((fact) => fact.factId),
    }],
    statement: "A reference-derived release must cite exact atomic facts.",
    problemTags: ["uncitable-reference"],
    intentTags: ["bind-evidence"],
    layoutTags: ["ordered-surface"],
    interactionTags: ["review-before-release"],
    mechanismHypothesis: "Exact atomic citations make the release decision independently traceable.",
    appliesWhen: ["A candidate declares reference-derived guidance."],
    doesNotApplyWhen: ["The candidate is explicitly novel by intent with separate human attestation."],
    confidence: { observation: "high", audienceFit: "medium", causal: "low" },
    requiredEvidence: [`evidence://reference-check/${index}`],
  };
}

function candidate(root, rule, overrides = {}) {
  const binding = candidateBindings.get(root);
  assert.ok(binding, "candidate fixture binding is available");
  return buildReferenceCandidateReceipt({
    schemaVersion: "nodekit.reference-candidate-receipt/v1",
    candidateId: "candidate_nodeslide_owned",
    candidateCommit: binding.candidateCommit,
    renderArtifacts: binding.renderArtifacts,
    evaluations: [{
      ruleId: rule.ruleId,
      result: "satisfied",
      factIds: rule.sourceObservationRefs.flatMap((entry) => entry.factIds),
      evidenceRefs: ["evidence://reference-check/1"],
    }],
    ...overrides,
  });
}

function evaluationFor(rule, overrides = {}) {
  return {
    ruleId: rule.ruleId,
    result: "satisfied",
    factIds: rule.sourceObservationRefs.flatMap((entry) => entry.factIds),
    evidenceRefs: ["evidence://reference-check/1"],
    ...overrides,
  };
}

function rederiveRecord(value, idField, prefix) {
  const body = structuredClone(value);
  delete body[idField];
  delete body.contentDigest;
  const contentDigest = referenceContentDigest(body);
  return {
    ...body,
    [idField]: `${prefix}_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

test("Mobbin policy rejects prohibited payload shapes and image URLs with exit 5 and writes nothing", async (t) => {
  const root = await fixture(t);
  const prohibited = [
    ["pixelPath", "capture.png"],
    ["screenshotPath", "capture.png"],
    ["imageBase64", "data:image/png;base64,AAAA"],
    ["cachedScreenshotUrl", "https://cache.local/capture.png"],
    ["ocrText", "copied source text"],
    ["domSnapshot", "<main>source</main>"],
    ["embedding", [0.1, 0.2]],
    ["vectorId", "vec_123"],
    ["cachedResponseBody", "{}"],
    ["trainingUsed", true],
    ["ragIndexed", true],
    ["storedPixels", true],
    ["cachedSourcePayload", true],
    ["embeddingStored", true],
    ["sourceHtml", "<main />"],
    ["sourceContent", "remote source"],
    ["rawPayload", "{}"],
    ["screenshot", "capture.png"],
    ["image", "capture.png"],
    ["cacheKey", "mobbin-flow"],
    ["previewUrl", "https://cdn.mobbin.com/screenshots/capture.png"],
  ];
  for (const [key, value] of prohibited) {
    const observation = { ...mobbinObservationDraft(), [key]: value };
    await assert.rejects(
      () => recordReferenceObservation(root, { observation, externalRun: mobbinRun() }),
      (error) => error.code === "SOURCE_POLICY_VIOLATION" && error.exitCode === 5,
      key,
    );
  }
  const observationsDir = path.join(root, "reference", "corpus", "observations");
  await assert.rejects(() => readdir(observationsDir), /ENOENT/);
});

test("the content-addressed chain verifies and detects observation and candidate mutation", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const scored = await scoreReferenceCandidate(root, {
    candidateReceipt: candidate(root, ruled.rule),
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  assert.equal(scored.score.verdict, "pass");
  assert.deepEqual((await verifyReferenceScoreReceipt(root, scored.score, {
    candidateReceipt: candidate(root, ruled.rule),
  })).verdict, "pass");
  assert.equal((await verifyReferenceScoreReceipt(root, scored.score)).verdict, "fail");

  const changedCandidate = candidate(root, ruled.rule, { candidateCommit: "b".repeat(40) });
  assert.equal((await verifyReferenceScoreReceipt(root, scored.score, {
    candidateReceipt: changedCandidate,
  })).verdict, "fail");

  const observationPath = path.join(
    root,
    "reference",
    "corpus",
    "observations",
    `${recorded.observation.contentDigest}.json`,
  );
  const changedObservation = JSON.parse(await readFile(observationPath, "utf8"));
  changedObservation.facts[0].object = 99;
  await writeFile(observationPath, `${JSON.stringify(changedObservation, null, 2)}\n`, "utf8");
  assert.equal((await verifyReferenceScoreReceipt(root, scored.score, {
    candidateReceipt: candidate(root, ruled.rule),
  })).verdict, "fail");
  assert.equal((await verifyReferenceScoreReceipt(root, "../outside-score.json", {
    candidateReceipt: candidate(root, ruled.rule),
  })).verdict, "fail");
});

test("verification schema-validates every stored design rule before replay", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const exactCandidate = candidate(root, ruled.rule);
  const scored = await scoreReferenceCandidate(root, {
    candidateReceipt: exactCandidate,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });

  const invalidRuleBody = structuredClone(ruled.rule);
  delete invalidRuleBody.requiredEvidence;
  const invalidRule = rederiveRecord(invalidRuleBody, "ruleId", "rule");
  const invalidRulePath = `reference/corpus/rules/${invalidRule.contentDigest}.json`;
  const profilePath = "reference/profiles/nodeslide.json";
  await writeFile(
    path.join(root, invalidRulePath),
    `${JSON.stringify(invalidRule)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, profilePath),
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-profile-manifest/v1",
      profile: "nodeslide",
      rules: [{
        ruleId: invalidRule.ruleId,
        ruleDigest: invalidRule.contentDigest,
      }],
    }, null, 2)}\n`,
    "utf8",
  );
  await commitReferenceConfiguration(
    root,
    [invalidRulePath, profilePath],
    "install schema-invalid tracked rule fixture",
  );
  const forgedCandidate = candidate(root, invalidRule, {
    evaluations: [evaluationFor(invalidRule)],
  });
  const profileBytes = await readFile(path.join(root, profilePath));
  const forgedScoreBody = structuredClone(scored.score);
  forgedScoreBody.profileManifest.digest = createHash("sha256")
    .update(profileBytes)
    .digest("hex");
  forgedScoreBody.candidate = {
    candidateId: forgedCandidate.candidateId,
    renderReceiptId: forgedCandidate.renderReceiptId,
    renderReceiptDigest: referenceRenderReceiptDigest(forgedCandidate),
    candidateReceiptDigest: referenceContentDigest(forgedCandidate),
    candidateCommit: forgedCandidate.candidateCommit,
  };
  forgedScoreBody.rules[0].ruleId = invalidRule.ruleId;
  forgedScoreBody.rules[0].ruleDigest = invalidRule.contentDigest;
  const forgedScore = rederiveRecord(forgedScoreBody, "receiptId", "score");
  const verified = await verifyReferenceScoreReceipt(root, forgedScore, {
    candidateReceipt: forgedCandidate,
  });
  assert.equal(verified.verdict, "fail");
  assert.match(verified.findings.join("\n"), /requiredEvidence/);
});

test("candidate identity rejects lossy JSON values instead of aliasing NaN to null", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  assert.throws(
    () => candidate(root, ruled.rule, { unstableMetric: Number.NaN }),
    (error) => error.code === "REFERENCE_INVALID" && /finite JSON numbers/.test(error.message),
  );
});

test("canonical identity rejects sparse arrays with named properties", () => {
  const sparse = [];
  sparse.length = 1;
  sparse.named = "aliases-an-empty-array";
  assert.throws(
    () => referenceContentDigest({ sparse }),
    (error) => error.code === "REFERENCE_INVALID"
      && /sparse or carry named properties/.test(error.message),
  );
});

test("candidate scoring is bound to the current Git HEAD and tracked render bytes", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const exactCandidate = candidate(root, ruled.rule);
  await scoreReferenceCandidate(root, {
    candidateReceipt: exactCandidate,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });

  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, ruled.rule, { candidateCommit: "b".repeat(40) }),
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /current Git HEAD/.test(error.message),
  );

  await writeFile(
    path.join(root, RENDER_ARTIFACT_PATH),
    '{"rendered":false,"surface":"nodeslide"}\n',
    "utf8",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /artifact bytes changed/.test(error.message),
  );
});

test("a release engineer cannot omit, duplicate, or reorder an authoritative profile rule", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const first = await recordDesignRule(root, ruleDraft(recorded.observation));
  const second = await recordDesignRule(root, {
    ...ruleDraft(recorded.observation),
    statement: "Keep the ordered activity ledger visible beside the decision surface.",
  });
  await installScoringProfiles(root, { nodeslide: [first.rule, second.rule] });
  const exactCandidate = candidate(root, first.rule, {
    evaluations: [evaluationFor(first.rule), evaluationFor(second.rule)],
  });

  const happy = await scoreReferenceCandidate(root, {
    candidateReceipt: exactCandidate,
    profile: "nodeslide",
    ruleIds: [first.rule.ruleId, second.rule.ruleId],
  });
  assert.equal(happy.score.verdict, "pass");
  assert.deepEqual(
    happy.score.rules.map((entry) => entry.ruleId),
    [first.rule.ruleId, second.rule.ruleId],
  );

  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, first.rule),
      profile: "nodeslide",
      ruleIds: [first.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /exactly match the profile manifest/.test(error.message),
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [first.rule.ruleId, first.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_INVALID"
      && /must be unique/.test(error.message),
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [second.rule.ruleId, first.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /exactly match the profile manifest in order/.test(error.message),
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, first.rule, {
        evaluations: [evaluationFor(first.rule)],
      }),
      profile: "nodeslide",
      ruleIds: [first.rule.ruleId, second.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /candidate evaluations must exactly match/.test(error.message),
  );
});

test("a release cannot inject rule or observation bytes after the candidate commit", async (t) => {
  async function writeProfileOnly(root, rule) {
    const relativePath = "reference/profiles/nodeslide.json";
    await mkdir(path.join(root, "reference", "profiles"), { recursive: true });
    await writeFile(
      path.join(root, relativePath),
      `${JSON.stringify({
        schemaVersion: "nodekit.reference-profile-manifest/v1",
        profile: "nodeslide",
        rules: [{
          ruleId: rule.ruleId,
          ruleDigest: rule.contentDigest,
        }],
      }, null, 2)}\n`,
      "utf8",
    );
    return relativePath;
  }

  const postCommitRuleRoot = await fixture(t);
  const firstObservation = await recordReferenceObservation(
    postCommitRuleRoot,
    ownedObservationDraft(),
  );
  const firstRule = await recordDesignRule(
    postCommitRuleRoot,
    ruleDraft(firstObservation.observation),
  );
  const firstProfile = await writeProfileOnly(postCommitRuleRoot, firstRule.rule);
  await commitReferenceConfiguration(
    postCommitRuleRoot,
    [firstProfile],
    "commit manifest before corpus records",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(postCommitRuleRoot, {
      candidateReceipt: candidate(postCommitRuleRoot, firstRule.rule),
      profile: "nodeslide",
      ruleIds: [firstRule.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /reference\/corpus\/rules\/.+ is not tracked at Git HEAD/.test(error.message),
  );

  const postCommitObservationRoot = await fixture(t);
  const secondObservation = await recordReferenceObservation(
    postCommitObservationRoot,
    ownedObservationDraft(2),
  );
  const secondRule = await recordDesignRule(
    postCommitObservationRoot,
    ruleDraft(secondObservation.observation, 2),
  );
  const secondProfile = await writeProfileOnly(postCommitObservationRoot, secondRule.rule);
  await commitReferenceConfiguration(
    postCommitObservationRoot,
    [secondProfile, secondRule.output],
    "commit manifest and rule before observation",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(postCommitObservationRoot, {
      candidateReceipt: candidate(postCommitObservationRoot, secondRule.rule, {
        evaluations: [evaluationFor(secondRule.rule, {
          evidenceRefs: ["evidence://reference-check/2"],
        })],
      }),
      profile: "nodeslide",
      ruleIds: [secondRule.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /reference\/corpus\/observations\/.+ is not tracked at Git HEAD/.test(error.message),
  );
});

test("a profile owner cannot configure duplicate rule ids under different digests", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  const relativePath = "reference/profiles/nodeslide.json";
  await mkdir(path.join(root, "reference", "profiles"), { recursive: true });
  await writeFile(
    path.join(root, relativePath),
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-profile-manifest/v1",
      profile: "nodeslide",
      rules: [
        { ruleId: ruled.rule.ruleId, ruleDigest: ruled.rule.contentDigest },
        { ruleId: ruled.rule.ruleId, ruleDigest: "f".repeat(64) },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await commitReferenceConfiguration(root, [relativePath], "install invalid duplicate profile");

  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, ruled.rule),
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /manifest rule ids must be unique/.test(error.message),
  );
});

test("candidate evaluation bounds reject 501 entries before reading or hashing them", () => {
  const evaluations = new Array(501);
  Object.defineProperty(evaluations, 0, {
    configurable: true,
    get() {
      throw new Error("evaluation entry was read before the bound was enforced");
    },
  });
  assert.throws(
    () => buildReferenceCandidateReceipt({
      schemaVersion: "nodekit.reference-candidate-receipt/v1",
      candidateId: "candidate_bounded",
      candidateCommit: "a".repeat(40),
      renderArtifacts: [{
        path: RENDER_ARTIFACT_PATH,
        sha256: "b".repeat(64),
        bytes: 1,
      }],
      evaluations,
    }),
    (error) => error.code === "REFERENCE_INVALID"
      && /identity or evaluations are invalid/.test(error.message),
  );
});

test("trust policy provenance rejects dirty, untracked, and receipt-mutated state", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const exactCandidate = candidate(root, ruled.rule);
  const scored = await scoreReferenceCandidate(root, {
    candidateReceipt: exactCandidate,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  assert.equal((await verifyReferenceScoreReceipt(root, scored.score, {
    candidateReceipt: exactCandidate,
  })).verdict, "pass");

  const policyPath = path.join(root, TRUST_POLICY_PATH);
  const originalPolicy = await readFile(policyPath, "utf8");
  await writeFile(
    policyPath,
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-trust-policy/v1",
      credentials: {},
      changed: true,
    })}\n`,
    "utf8",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /differs from Git HEAD/.test(error.message),
  );
  await writeFile(policyPath, originalPolicy, "utf8");

  const forgedBody = structuredClone(scored.score);
  forgedBody.trustPolicy.digest = "f".repeat(64);
  const forged = rederiveRecord(forgedBody, "receiptId", "score");
  const verified = await verifyReferenceScoreReceipt(root, forged, {
    candidateReceipt: exactCandidate,
  });
  assert.equal(verified.verdict, "fail");
  assert.match(verified.findings.join("\n"), /trust policy binding changed/);

  await execFileAsync("git", ["rm", "--cached", "--quiet", "--", TRUST_POLICY_PATH], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "untrack trust policy"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-28T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-28T00:00:00Z",
    },
  });
  await refreshCandidateBinding(root);
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, ruled.rule),
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /not tracked at Git HEAD/.test(error.message),
  );
});

test("JSON-equivalent insertion order deduplicates to the same canonical bytes", async (t) => {
  const root = await fixture(t);
  const draft = ownedObservationDraft();
  const reordered = {
    facts: draft.facts,
    interactionTags: draft.interactionTags,
    layoutTags: draft.layoutTags,
    intentTags: draft.intentTags,
    problemTags: draft.problemTags,
    prohibitedMaterial: draft.prohibitedMaterial,
    source: draft.source,
    schemaVersion: draft.schemaVersion,
  };
  const first = await recordReferenceObservation(root, draft);
  const second = await recordReferenceObservation(root, reordered);
  assert.equal(first.observation.contentDigest, second.observation.contentDigest);
  assert.equal(second.duplicate, true);
});

test("not-applicable and fake evidence cannot satisfy a rule's exact evidence contract", async (t) => {
  const root = await fixture(t);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const noFacts = candidate(root, ruled.rule);
  noFacts.evaluations[0] = {
    ruleId: ruled.rule.ruleId,
    result: "not-applicable",
    factIds: [],
    evidenceRefs: ["evidence://reference-check/1"],
  };
  const notApplicable = await scoreReferenceCandidate(root, {
    candidateReceipt: noFacts,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  assert.equal(notApplicable.score.verdict, "incomplete");

  const fakeEvidence = candidate(root, ruled.rule);
  fakeEvidence.evaluations[0].evidenceRefs = ["evidence://fake"];
  const fake = await scoreReferenceCandidate(root, {
    candidateReceipt: fakeEvidence,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  assert.equal(fake.score.verdict, "incomplete");
});

test("novel-by-intent needs an exact H2/H3 signature, while a signed reject always rejects", async (t) => {
  const root = await fixture(t);
  const trust = await installMobbinServiceTrust(root);
  const recorded = await recordReferenceObservation(root, ownedObservationDraft());
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  await installScoringProfiles(root, {
    nodeslide: [ruled.rule],
    "unrelated-profile": [ruled.rule],
  });

  const ordinary = candidate(root, ruled.rule);
  const ordinaryBase = await scoreReferenceCandidate(root, {
    candidateReceipt: ordinary,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  const rejectOverride = signedHumanOverride(
    ordinaryBase.score,
    trust.human,
    "reject",
  );
  const rejected = await scoreReferenceCandidate(root, {
    candidateReceipt: ordinary,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
    humanOverride: rejectOverride,
  });
  assert.equal(rejected.score.verdict, "fail");
  assert.equal((await verifyReferenceScoreReceipt(root, rejected.score, {
    candidateReceipt: ordinary,
    attestation: { verified: true, level: "H2" },
  })).verdict, "fail");
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: ordinary,
      profile: "unrelated-profile",
      ruleIds: [ruled.rule.ruleId],
      humanOverride: rejectOverride,
    }),
    (error) => error.code === "REFERENCE_OVERRIDE_INVALID",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: ordinary,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
      humanOverride: {
        ...rejectOverride,
        reason: "A different reason that was never signed.",
        reasonDigest: referenceContentDigest("A different reason that was never signed."),
      },
    }),
    (error) => error.code === "REFERENCE_OVERRIDE_INVALID",
  );

  const novel = candidate(root, ruled.rule, { novelByIntent: true });
  novel.evaluations[0] = {
    ruleId: ruled.rule.ruleId,
    result: "not-applicable",
    factIds: [],
    evidenceRefs: ["evidence://reference-check/1"],
  };
  const novelBase = await scoreReferenceCandidate(root, {
    candidateReceipt: novel,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  const accepted = await scoreReferenceCandidate(root, {
    candidateReceipt: novel,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
    humanOverride: signedHumanOverride(novelBase.score, trust.human, "accept"),
  });
  assert.equal(accepted.score.verdict, "pass");
  assert.equal((await verifyReferenceScoreReceipt(root, accepted.score, {
    candidateReceipt: novel,
  })).verdict, "pass");
});

test("canonical observation and rule digests are deterministic 100 out of 100 times", () => {
  const observations = Array.from({ length: 100 }, () => buildReferenceObservation(ownedObservationDraft()));
  assert.equal(new Set(observations.map((entry) => entry.contentDigest)).size, 1);
  assert.equal(new Set(observations.map((entry) => entry.observationId)).size, 1);
  const rules = Array.from({ length: 100 }, () => buildDesignRule(ruleDraft(observations[0])));
  assert.equal(new Set(rules.map((entry) => entry.contentDigest)).size, 1);
  assert.equal(new Set(rules.map((entry) => entry.ruleId)).size, 1);
});

test("Mobbin status fails closed at NOT_RUN and passes only the authenticated non-pixel run", async (t) => {
  const blockedRoot = await fixture(t);
  await assert.rejects(
    () => recordReferenceObservation(blockedRoot, {
      observation: mobbinObservationDraft(),
      externalRun: mobbinRun("not-run"),
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY" && error.exitCode === 5,
  );

  const root = await fixture(t);
  const signer = await installMobbinServiceTrust(root);
  const recorded = await recordReferenceObservation(root, {
    observation: mobbinObservationDraft(),
    externalRun: signedMobbinRun(mobbinObservationDraft(), signer),
  });
  const status = await getExternalReferenceStatus(root, "mobbin");
  assert.equal(status.status, "pass");
  assert.equal(status.observationId, recorded.observation.observationId);
  assert.equal(status.observationDigest, recorded.observation.contentDigest);
  assert.equal(status.sourceUrl, MOBBIN_FLOW_URL);
  assert.equal(recorded.observation.facts.length, 4);
  assert.deepEqual(recorded.observation.prohibitedMaterial, {
    storedPixels: false,
    cachedSourcePayload: false,
    embeddingStored: false,
  });
});

test("Mobbin scoring requires the exact signed external run at the candidate commit", async (t) => {
  const root = await fixture(t);
  const signer = await installMobbinServiceTrust(root);
  const recorded = await recordReferenceObservation(root, {
    observation: mobbinObservationDraft(),
    externalRun: signedMobbinRun(mobbinObservationDraft(), signer),
  });
  const ruled = await recordDesignRule(root, ruleDraft(recorded.observation));
  const profilePath = "reference/profiles/nodeslide.json";
  await mkdir(path.join(root, "reference", "profiles"), { recursive: true });
  await writeFile(
    path.join(root, profilePath),
    `${JSON.stringify({
      schemaVersion: "nodekit.reference-profile-manifest/v1",
      profile: "nodeslide",
      rules: [{
        ruleId: ruled.rule.ruleId,
        ruleDigest: ruled.rule.contentDigest,
      }],
    }, null, 2)}\n`,
    "utf8",
  );
  await commitReferenceConfiguration(
    root,
    [profilePath, recorded.output, ruled.output],
    "commit Mobbin analysis without its service attestation",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: candidate(root, ruled.rule),
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY"
      && /requires exactly one tracked valid external run/.test(error.message),
  );

  const externalRunPath =
    `reference/corpus/external-runs/${recorded.externalRun.contentDigest}.json`;
  await commitReferenceConfiguration(
    root,
    [externalRunPath],
    "commit exact Mobbin service attestation",
  );
  const exactCandidate = candidate(root, ruled.rule);
  const scored = await scoreReferenceCandidate(root, {
    candidateReceipt: exactCandidate,
    profile: "nodeslide",
    ruleIds: [ruled.rule.ruleId],
  });
  assert.equal(scored.score.verdict, "pass");
  assert.equal((await verifyReferenceScoreReceipt(root, scored.score, {
    candidateReceipt: exactCandidate,
  })).verdict, "pass");

  await writeFile(
    path.join(root, externalRunPath),
    `${JSON.stringify(recorded.externalRun, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "REFERENCE_BINDING_INVALID"
      && /differs from Git HEAD/.test(error.message),
  );
});

test("Mobbin scoring enumerates every candidate-committed run despite worktree deletion", async (t) => {
  const root = await fixture(t);
  const signer = await installMobbinServiceTrust(root);
  const first = await recordReferenceObservation(root, {
    observation: mobbinObservationDraft(),
    externalRun: signedMobbinRun(mobbinObservationDraft(), signer),
  });
  const second = await recordReferenceObservation(root, {
    observation: mobbinObservationDraft(),
    externalRun: signedMobbinRun(mobbinObservationDraft(), signer, {
      runNonce: "canary_nonce_20260729_second",
    }),
  });
  const ruled = await recordDesignRule(root, ruleDraft(first.observation));
  await installScoringProfiles(root, { nodeslide: [ruled.rule] });
  const exactCandidate = candidate(root, ruled.rule);

  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY"
      && /requires exactly one tracked valid external run/.test(error.message),
  );

  const hiddenRunPath =
    `reference/corpus/external-runs/${second.externalRun.contentDigest}.json`;
  await rm(path.join(root, hiddenRunPath), { force: true });
  await assert.rejects(
    () => scoreReferenceCandidate(root, {
      candidateReceipt: exactCandidate,
      profile: "nodeslide",
      ruleIds: [ruled.rule.ruleId],
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY"
      && new RegExp(`${second.externalRun.contentDigest}\\.json is absent`).test(error.message),
  );
});

test("Mobbin PASS rejects an absent attestation and a service signature too far in the future", async (t) => {
  const root = await fixture(t);
  const signer = await installMobbinServiceTrust(root);
  const observation = buildReferenceObservation(mobbinObservationDraft());
  const unsigned = {
    ...mobbinRun(),
    observationId: observation.observationId,
    observationDigest: observation.contentDigest,
    factsDigest: referenceContentDigest(observation.facts),
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
      ragIndexed: false,
      trainingUsed: false,
    },
  };
  assert.throws(
    () => buildExternalReferenceRun(unsigned),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY"
      && /requires a detached service attestation/.test(error.message),
  );
  await assert.rejects(
    () => recordReferenceObservation(root, {
      observation: mobbinObservationDraft(),
      externalRun: signedMobbinRun(mobbinObservationDraft(), signer, {
        signedAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY"
      && /stale or time-invalid/.test(error.message),
  );
});

test("a caller-forged Mobbin PASS cannot create an observation or status receipt", async (t) => {
  const root = await fixture(t);
  const observation = buildReferenceObservation(mobbinObservationDraft());
  const forged = {
    ...mobbinRun(),
    observationId: observation.observationId,
    observationDigest: observation.contentDigest,
    factsDigest: referenceContentDigest(observation.facts),
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
      ragIndexed: false,
      trainingUsed: false,
    },
  };
  await assert.rejects(
    () => recordReferenceObservation(root, {
      observation: mobbinObservationDraft(),
      externalRun: forged,
    }),
    (error) => error.code === "EXTERNAL_REFERENCE_NOT_READY" && error.exitCode === 5,
  );
  await assert.rejects(
    () => readdir(path.join(root, "reference", "corpus", "observations")),
    /ENOENT/,
  );
  assert.equal((await getExternalReferenceStatus(root, "mobbin")).status, "not-run");
});

test("the committed standalone validators match the six source schemas", async () => {
  await execFileAsync(process.execPath, [
    path.resolve("scripts", "generate-reference-schema-validators.mjs"),
    "--check",
  ]);
});

test("the CLI completes observe, rule, score, verify in four commands", async (t) => {
  const root = await fixture(t);
  const observation = buildReferenceObservation(ownedObservationDraft());
  const rule = buildDesignRule(ruleDraft(observation));
  await recordReferenceObservation(root, ownedObservationDraft());
  await recordDesignRule(root, ruleDraft(observation));
  await installScoringProfiles(root, { nodeslide: [rule] });
  const observationFile = path.join(root, "observation.json");
  const ruleFile = path.join(root, "rule.json");
  const candidateFile = path.join(root, "candidate.json");
  await writeFile(observationFile, `${JSON.stringify(ownedObservationDraft(), null, 2)}\n`, "utf8");
  await writeFile(ruleFile, `${JSON.stringify(ruleDraft(observation), null, 2)}\n`, "utf8");
  await writeFile(candidateFile, `${JSON.stringify(candidate(root, rule), null, 2)}\n`, "utf8");
  const cli = path.resolve("src", "cli.mjs");
  const started = performance.now();
  const run = (...args) => execFileAsync(process.execPath, [
    cli,
    ...args,
    `--repo-root=${root}`,
    "--json",
  ]);

  const observed = JSON.parse((await run("reference", "observe", "--file", observationFile)).stdout);
  assert.equal(observed.observation.observationId, observation.observationId);
  const ruled = JSON.parse((await run("reference", "rule", "--file", ruleFile)).stdout);
  assert.equal(ruled.rule.ruleId, rule.ruleId);
  const scored = JSON.parse((await run(
    "reference",
    "score",
    "--candidate-receipt",
    candidateFile,
    "--rules",
    rule.ruleId,
    "--profile",
    "nodeslide",
  )).stdout);
  const verified = JSON.parse((await run(
    "reference",
    "verify",
    "--score",
    scored.output,
    "--candidate-receipt",
    candidateFile,
  )).stdout);
  assert.equal(verified.verdict, "pass");
  const elapsedMs = performance.now() - started;
  const budgetMs = process.platform === "win32" ? 5_000 : 2_000;
  assert.ok(
    elapsedMs < budgetMs,
    `four-command loop exceeded the ${budgetMs}ms ${process.platform} budget (${elapsedMs.toFixed(0)}ms)`,
  );
});
