import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CASEFLOW_SCHEMA_VERSIONS,
  createMemoryCaseflow,
  normalizePortableValue,
  PORTABLE_VALUE_LIMITS,
  runCaseflowConformance,
  runtimeProfiles,
} from "@homenshum/nodekit/caseflow";
import {
  normalizePortableValue as normalizePortableValueFromRoot,
  PORTABLE_VALUE_LIMITS as PORTABLE_VALUE_LIMITS_FROM_ROOT,
} from "@homenshum/nodekit";
import { createPostgresCaseflow } from "@homenshum/nodekit/adapters/postgres";
import {
  SUBMISSION_ATTESTATION_SCHEMA_VERSION,
  canonicalizeAttestationPayload,
} from "@homenshum/nodekit/submission-attestation";
import {
  CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION,
  prepareExactConsumerPackage,
} from "@homenshum/nodekit/consumer-package-preparation";
import {
  MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION,
  startManagedEvidenceCampaign,
} from "@homenshum/nodekit/managed-evidence-capture";
import {
  NODETRACE_VERDICT_DIMENSIONS,
  builderGymStatus,
} from "@homenshum/nodekit/builder-gym";
import {
  computeSkillEvidenceClosure,
  sealSkillPromotionApproval,
  verifySkillBenchmarkVerdict,
  verifySkillPromotionApproval,
} from "@homenshum/nodekit/skill-evaluation";
import {
  session_checkpoint,
  session_resume,
  session_start,
  session_status,
  workspace_bind,
} from "@homenshum/nodekit/native-agent-identity";
import * as nativeAgentIdentity from "@homenshum/nodekit/native-agent-identity";
import {
  workspace_bind as workspaceBindFromRoot,
} from "@homenshum/nodekit";
import {
  AGENT_RUN_LIMITS,
  runAgent,
} from "@homenshum/nodekit/agent-run";

// @nodekit-verifies inv:stable-caseflow-package-entrypoint#entrypoint-surface-stable
test("published Caseflow entry point exposes the supported portable contract", async () => {
  assert.equal(CASEFLOW_SCHEMA_VERSIONS.case, "nodekit.case/v1");
  assert.equal(PORTABLE_VALUE_LIMITS.maxArrayItems, 8192);
  assert.deepEqual(normalizePortableValue({ value: -0 }), { value: 0 });
  assert.equal(PORTABLE_VALUE_LIMITS_FROM_ROOT, PORTABLE_VALUE_LIMITS);
  assert.deepEqual(normalizePortableValueFromRoot({ value: -0 }), { value: 0 });
  assert.equal(runtimeProfiles.memory.optimisticConcurrency, true);
  const verdict = await runCaseflowConformance(() => createMemoryCaseflow());
  assert.equal(verdict.passed, true);
  assert.equal(verdict.assertions.staleProposalFailedClosed, true);
  assert.equal(verdict.assertions.contentAddressedReceipt, true);
  assert.equal(typeof createPostgresCaseflow, "function");
  assert.equal(SUBMISSION_ATTESTATION_SCHEMA_VERSION, "nodekit.detached-attestation/v1");
  assert.equal(canonicalizeAttestationPayload({ gate: "public-api" }), '{"gate":"public-api"}');
  assert.equal(CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION, "nodekit.consumer-package-provenance/v1");
  assert.equal(typeof prepareExactConsumerPackage, "function");
  assert.equal(MANAGED_EVIDENCE_CAMPAIGN_SCHEMA_VERSION, "nodekit.managed-evidence-campaign/v1");
  assert.equal(typeof startManagedEvidenceCampaign, "function");
  assert.equal(NODETRACE_VERDICT_DIMENSIONS.length, 7);
  assert.equal(typeof builderGymStatus, "function");
  assert.equal(typeof computeSkillEvidenceClosure, "function");
  assert.equal(typeof sealSkillPromotionApproval, "function");
  assert.equal(typeof verifySkillPromotionApproval, "function");
  assert.equal(typeof verifySkillBenchmarkVerdict, "function");
  assert.equal(typeof workspace_bind, "function");
  assert.equal(typeof session_start, "function");
  assert.equal(typeof session_checkpoint, "function");
  assert.equal(typeof session_resume, "function");
  assert.equal(typeof session_status, "function");
  assert.equal(workspaceBindFromRoot, workspace_bind);
  assert.equal(typeof runAgent, "function");
  assert.equal(AGENT_RUN_LIMITS.retention, 50);
  assert.deepEqual(Object.keys(nativeAgentIdentity).sort(), [
    "NativeAgentSessionError",
    "session_checkpoint",
    "session_resume",
    "session_start",
    "session_status",
    "workspace_bind",
  ]);
});

test("published metadata cannot silently drop attestation and evidence-finalization surfaces", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/HomenShum/node-platform.git",
  });
  assert.equal(packageJson.homepage, "https://github.com/HomenShum/node-platform#readme");
  assert.deepEqual(packageJson.bugs, { url: "https://github.com/HomenShum/node-platform/issues" });
  assert.equal(packageJson.author, "Homen Shum");
  assert.equal(packageJson.keywords.includes("agent-applications"), true);
  assert.deepEqual(packageJson.exports["./submission-attestation"], {
    types: "./src/submission-attestation.d.mts",
    import: "./src/submission-attestation.mjs",
    default: "./src/submission-attestation.mjs",
  });
  assert.equal(packageJson.bin["nodekit-attestation-sign"], "scripts/sign-submission-attestation.mjs");
  assert.equal(packageJson.bin["nodekit-attestation-verify"], "scripts/verify-submission-attestation.mjs");
  assert.deepEqual(packageJson.exports["./submission-evidence-finalizer"], {
    types: "./src/submission-evidence-finalizer.d.mts",
    import: "./src/submission-evidence-finalizer.mjs",
    default: "./src/submission-evidence-finalizer.mjs",
  });
  assert.equal(packageJson.bin["nodekit-evidence-finalize"], "scripts/finalize-submission-evidence.mjs");
  assert.deepEqual(packageJson.exports["./consumer-package-preparation"], {
    types: "./src/consumer-package-preparation.d.mts",
    import: "./src/consumer-package-preparation.mjs",
    default: "./src/consumer-package-preparation.mjs",
  });
  assert.deepEqual(packageJson.exports["./managed-evidence-capture"], {
    types: "./src/managed-evidence-capture.d.mts",
    import: "./src/managed-evidence-capture.mjs",
    default: "./src/managed-evidence-capture.mjs",
  });
  assert.deepEqual(packageJson.exports["./builder-gym"], {
    types: "./src/builder-gym.d.mts",
    import: "./src/builder-gym.mjs",
    default: "./src/builder-gym.mjs",
  });
  assert.deepEqual(packageJson.exports["./skill-evaluation"], {
    types: "./src/skill-evaluation.d.mts",
    import: "./src/skill-evaluation.mjs",
    default: "./src/skill-evaluation.mjs",
  });
  assert.deepEqual(packageJson.exports["./native-agent-identity"], {
    types: "./src/native-agent-identity.d.mts",
    import: "./src/native-agent-identity.mjs",
    default: "./src/native-agent-identity.mjs",
  });
  assert.deepEqual(packageJson.exports["./agent-run"], {
    types: "./src/agent-run.d.mts",
    import: "./src/agent-run.mjs",
    default: "./src/agent-run.mjs",
  });
  assert.equal(packageJson.bin["nodekit-consumer-prepare"], "scripts/prepare-consumer-package.mjs");
  assert.equal(packageJson.bin["nodekit-evidence-capture"], "scripts/capture-managed-evidence.mjs");
  assert.equal(packageJson.bin["nodekit-human-study"], "scripts/capture-human-study.mjs");
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-sign"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-attestation-verify"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-evidence-finalize"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-consumer-prepare"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-evidence-capture"]), true);
  assert.equal(packageJson.files.includes(packageJson.bin["nodekit-human-study"]), true);
});

test("every relative README link resolves to a packed package path", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const packedRoots = ["package.json", ...(packageJson.files ?? [])]
    .map((entry) => String(entry).replace(/^\.\//, "").replace(/\/$/, ""));
  const broken = [];
  for (const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const href = match[1].trim();
    if (/^(?:[a-z]+:|#)/iu.test(href)) continue;
    const target = href.split(/[?#]/u, 1)[0].replace(/^\.\//u, "");
    const packed = packedRoots.some((root) => target === root || target.startsWith(`${root}/`));
    if (!packed) broken.push(target);
  }
  assert.deepEqual(broken, []);
});

test("a first-time builder can reach the principles from both packaged onboarding entry points", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packedRoots = ["package.json", ...(packageJson.files ?? [])]
    .map((entry) => String(entry).replace(/^\.\//, "").replace(/\/$/, ""));
  const principlesPath = "docs/IDEA_TO_REALITY_PRINCIPLES.md";
  assert.ok(packedRoots.includes(principlesPath), "the installed package must contain the principles manual");

  for (const onboardingPath of ["README.md", "START_HERE.md"]) {
    const onboarding = await readFile(new URL(`../${onboardingPath}`, import.meta.url), "utf8");
    const relativeLinks = [...onboarding.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => match[1].trim().split(/[?#]/u, 1)[0].replace(/^\.\//u, ""));
    assert.ok(relativeLinks.includes(principlesPath), `${onboardingPath} must link to the principles manual`);
  }
});

test("the bundled launch skill routes coding agents through the compact principles without adding ceremony", async () => {
  const launchSkill = await readFile(new URL("../plugins/nodekit/skills/nodekit-launch/SKILL.md", import.meta.url), "utf8");
  assert.match(launchSkill, /idea-to-reality principles/u);
  assert.match(launchSkill, /90-second field card/u);
  assert.match(launchSkill, /do not turn the manual into ceremony/u);
  assert.match(launchSkill, /\.\.\/\.\.\/\.\.\/\.\.\/docs\/IDEA_TO_REALITY_PRINCIPLES\.md/u);
});

test("the field card preserves the NodeVideo execution and anti-complexity boundaries", async () => {
  const principles = await readFile(new URL("../docs/IDEA_TO_REALITY_PRINCIPLES.md", import.meta.url), "utf8");
  assert.match(principles, /proof and debugging workflow/u);
  assert.match(principles, /deterministic or specialist tool owns\s+execution/u);
  assert.match(principles, /Acquire patterns, not pixels/u);
  assert.match(principles, /rebuild only when evidence identifies/u);
});

test("a fresh human or coding agent reaches the compact loop before the detailed manual", async () => {
  const principles = await readFile(new URL("../docs/IDEA_TO_REALITY_PRINCIPLES.md", import.meta.url), "utf8");
  const quickStart = principles.indexOf("## The whole method in 90 seconds");
  const detailedManual = principles.indexOf("## 1. Start with a person and a job");
  const complexityGate = principles.indexOf("## The anti-complexity gate");
  const reusableRecords = principles.indexOf("## Reusable records");

  assert.ok(quickStart > 0, "the compact operating loop must be discoverable");
  assert.ok(detailedManual > quickStart, "progressive disclosure must put the compact loop first");
  assert.ok(complexityGate > detailedManual, "the detailed manual must lead to a removal gate");
  assert.ok(reusableRecords > complexityGate, "copyable records must remain available after the gate");
  assert.match(principles.slice(0, quickStart), /do not turn all 15 principles into a ceremony/u);
  assert.match(principles, /build only the smallest behavior that can earn the next piece of/u);

  const numberedHeadings = [...principles.matchAll(/^## (\d+)\. /gmu)].map((match) => Number(match[1]));
  assert.deepEqual(numberedHeadings, Array.from({ length: 15 }, (_, index) => index + 1));
  for (const number of numberedHeadings) {
    const start = principles.indexOf(`## ${number}. `);
    const end = number < 15
      ? principles.indexOf(`## ${number + 1}. `, start)
      : complexityGate;
    const decisionContract = principles.slice(start, end);
    for (const marker of ["**Trigger:**", "**Decision rule:**", "**Action:**", "**Proof:**", "**Exception:**"]) {
      assert.match(decisionContract, new RegExp(marker.replaceAll("*", "\\*"), "u"), `principle ${number} must expose ${marker}`);
    }
  }
});

test("public package bins expose usable help without credentials or writes", () => {
  for (const [script, marker] of [
    ["../scripts/finalize-submission-evidence.mjs", "nodekit-evidence-finalize"],
    ["../scripts/prepare-consumer-package.mjs", "nodekit-consumer-prepare"],
    ["../scripts/capture-managed-evidence.mjs", "nodekit-evidence-capture"],
    ["../scripts/capture-human-study.mjs", "nodekit-human-study"],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), "--help"], {
      encoding: "utf8",
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, new RegExp(marker));
  }
});

test("EaseProof documents the qualifying campaign entrypoint rather than incomplete manual trials", async () => {
  const easeProof = await readFile(new URL("../docs/EASE_PROOF.md", import.meta.url), "utf8");
  assert.match(easeProof, /npm run ease:run-agent-matrix --/);
  assert.match(easeProof, /--lower-cost-evidence=<official-pricing-evidence\.json>/);
  assert.doesNotMatch(easeProof, /npm run acceptance:agent --/);
});
