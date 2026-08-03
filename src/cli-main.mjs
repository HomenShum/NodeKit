#!/usr/bin/env node
// Full command implementation. The public wrapper keeps reference-loop startup bounded.
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "./lib/dashboard.mjs";
import { compileAgentDefinition, inspectAgentDefinition } from "./lib/agent-definition.mjs";
import { pathExists } from "./lib/files.mjs";
import { checkRepository, commandFor } from "./lib/repo-check.mjs";
import { buildRepoMap } from "./lib/repo-map.mjs";
import { auditCopy } from "./lib/copy-audit.mjs";
import { buildBehaviorIndex } from "./lib/behavior-index.mjs";
import { compareMotionPortability } from "./lib/motion-portability.mjs";
import { verifyJourneyContract } from "./lib/journey-contract-verify.mjs";
import { BuildEvidenceRefusal, produceBuildEvidencePack } from "./lib/build-evidence-producer.mjs";
import { StoryPackRefusal, formatStoryPack, produceStoryPack } from "./lib/story-pack-producer.mjs";
import { CapabilityContractRefusal, evaluateCapability, formatCapabilityVerdict, parseCapabilityContract } from "./lib/capability-contract.mjs";
import { validateSchema as validateNodekitSchema } from "./lib/schema-validation.mjs";
import { SessionContractRefusal, evaluateSessionContract, formatSessionContract } from "./lib/session-contract.mjs";
import { loadRegistry, validateRegistry } from "./lib/registry.mjs";
import { adoptProject, createProject, recordSetupEvent } from "./lib/scaffold.mjs";
import {
  compileModelIntelligence,
  diagnoseModelFailures,
  initializeHarness,
  writeModelBaseline,
} from "./lib/model-intelligence.mjs";
import {
  benchmarkSkillCandidate,
  compileRoutingPolicy,
  evaluateTournament,
  harnessStatus,
  promoteSkillCandidate,
  proposeSkillCandidates,
  rejectSkillCandidate,
  reviewSkillCandidate,
  rollbackHarness,
  verifyCanary,
} from "./lib/harness-gym.mjs";
import {
  builderGymStatus,
  createBuilderGymLock,
  evaluateBuilderGym,
  initializeBuilderGym,
  inspectBuilderGymVerdict,
  inspectNodeTraceTrajectory,
  recordNodeTraceTrajectory,
} from "./lib/builder-gym.mjs";
import {
  importUnderstandAnythingCodeGraph,
  queryUnderstandAnythingCodeGraph,
  readUnderstandAnythingCodeGraph,
} from "./lib/understand-anything.mjs";
import {
  applyGraphPatch,
  benchmarkKnowledgeRetrieval,
  decideGraphPatch,
  diffKnowledgeGraph,
  initializeKnowledgeGraph,
  inspectKnowledgeGaps,
  proposeGraphPatch,
  queryKnowledgeGraph,
  readKnowledgeGraph,
  recordKnowledgeAction,
  replayKnowledgeGraph,
  validateGraphPatch,
} from "./lib/knowledge-evolution.mjs";
import {
  evidenceSnapshotToGraphNode,
  ingestEvidenceFile,
  verifyEvidenceSnapshot,
} from "./lib/evidence-snapshots.mjs";
import {
  collectExternalResearch,
  createLocalFixtureResearchProvider,
  readLocalResearchFixture,
} from "./lib/research-collector.mjs";
import { proposeHarnessKnowledgePatch } from "./lib/harness-knowledge.mjs";
import {
  compileFrontendPlan,
  createFrontendDirections,
  createFrontendRepairPlan,
  evaluateFrontendTournament,
  initializeFrontendHarness,
  verifyFrontendCanary,
} from "./lib/frontend-specialist.mjs";
import {
  addAtlasAsset,
  addAtlasFlow,
  initializeAtlasStore,
  inspectAtlasRecord,
  listAtlasRecords,
} from "./lib/atlas.mjs";
import {
  atlasDelta,
  atlasPreview,
  atlasRecipe,
  atlasSearch,
} from "./lib/atlas-retrieval.mjs";
import { serveAtlasMcp } from "./lib/atlas-mcp.mjs";
import {
  buildEvolutionDocs,
  checkEvolutionMateriality,
  createDeferredEvolutionReview,
  diffEvolutionLedger,
  draftEvolutionEvent,
  initializeEvolutionLedger,
  proposeEvolutionKnowledgePatch,
  queryEvolutionLedger,
  recordEvolutionRecord,
  verifyEvolutionLedger,
} from "./lib/evolution-ledger.mjs";
import { initializeTrust, readTrustPolicy } from "./lib/evolution-trust.mjs";
import { approvalSubject, evidenceManifestHash, sealEvolutionApproval } from "./lib/evolution-approval.mjs";
import {
  planLegacySessionMigration,
  verifyLegacySessionMigration,
} from "./lib/native-agent-migration.mjs";
import {
  createPr32GovernanceScenario,
  renderGovernanceGraphHtml,
} from "./lib/governance.mjs";
import { runAgent } from "./lib/agent-run.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  const tokens = separator >= 0 ? argv.slice(0, separator) : [...argv];
  const options = {};
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    let value;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      value = tokens[index + 1];
      index += 1;
    } else {
      value = true;
    }
    // A repeated flag COLLECTS rather than overwriting. Last-wins silently discarded every earlier
    // value, so `--test a --test b --test c` ran only c and reported honestly on a quarter of what
    // was asked — a partial result wearing the shape of a complete one. Verbs that expect a single
    // string now see an array and refuse on their own type check, which fails closed instead of
    // quietly acting on one of several values the caller supplied.
    if (Object.hasOwn(options, rawName)) {
      options[rawName] = Array.isArray(options[rawName]) ? [...options[rawName], value] : [options[rawName], value];
    } else {
      options[rawName] = value;
    }
  }

  return { commandArgs, options, positional };
}

function printHelp() {
  console.log(`NodeKit

Usage:
  nodekit explain --for <any|node|convex|python|postgres|supabase|frontend> [--json]
      Which surfaces apply to your project, and which you can stop reading. Start here.
  nodekit audience check [--record <audience-research.json>] [--json]
      Was the reviewer researched BEFORE the design was decided, and was the primary document
      (job description, rubric, RFP) asked for rather than inferred from the web?
  nodekit preflight [--repo-root <path>] [--session-started-at <iso>] [--json]
      Run BEFORE the work: refuses a session whose harness.yaml declares a blocking dependency
      that cannot take effect yet, or an external service with no recent liveness probe.
  nodekit create <directory> --name <slug> --brief <text>
      [--provider openrouter] [--model openai/gpt-4o-mini] [--backend filesystem]
      [--nodekit-specifier <npm-or-file-spec>] [--sponsors <comma-list>]
      [--package-manager npm|pnpm]
      [--launch-started-at <iso>] [--research-ms <number>] [--local-proof]
      [--no-install] [--no-git]
  nodekit adopt [directory] --name <slug> --brief <text>
  nodekit compile [--repo-root <path>] [--check] [--json]
  nodekit inspect [--repo-root <path>] [--json]
  nodekit doctor [--repo-root <path>] [--json]
  nodekit agent run --agent <label> --goal <text> [--out <dir>] [--timeout-ms <n>] [--json] -- <program> [args...]
  nodekit dev|demo|check|proof [--repo-root <path>] [-- <args>]
  nodekit repo check [--repo-root <path>] [--json]
  nodekit motion compare <repoA> <repoB> [repoC ...] [--output <receipt.json>] [--json]
  nodekit journey verify [--repo-root <path>] [--json]
  nodekit journey build-evidence --contract <opportunity-contract.json>
      [--repo <path>] [--out <pack.json>] [--case-id <id>] [--test-command <cmd>] [--json]
  nodekit regression prove --baseline <commit> --test <file> [--test <file>...] [--name <pattern>] [--repo-root <path>] [--json]
  nodekit skills sync [--repo-root <path>] [--json]
  nodekit sessions check --contract <session-contract.json> [--repo-root <path>] [--json]
  nodekit capability declare --out <capability-contract.json> --capability <slug> [--json]
  nodekit capability settle --contract <capability-contract.json> --measurement <measurement.json> [--json]
  nodekit journey story-pack --pack <build-evidence-pack.json> --contract <opportunity-contract.json>
      --story <story-input.json> [--out <story-pack.json>] [--case-id <id>] [--now <iso8601>] [--json]
  nodekit registry check [--registry-root <path>] [--json]
  nodekit ecosystem check [--workspace <path>] [--json]
  nodekit dashboard [--workspace <path>] [--write] [--out <path>]
  nodekit governance visualize [--scenario pr32] [--out <governance.html>] [--json]
  nodekit graph import [--repo-root <path>] [--graph-dir <path>] [--repo-id <id>] [--commit <sha>] [--json]
  nodekit graph init [--repo-root <path>] [--graph-id <id>] [--owner-id <id>] [--json]
  nodekit graph ingest --input <file> [--repo-root <path>] [--json]
  nodekit graph evidence-ingest --file <path> --source-uri <uri> --media-type <type>
      [--label <text>] [--captured-at <iso>] [--expected-sha256 <hash>] [--locators <json-file>]
      [--expires-at <iso>] [--max-bytes <number>] [--max-locators <number>] [--repo-root <path>] [--json]
  nodekit graph evidence-verify --snapshot <id> [--at <iso>] [--repo-root <path>] [--json]
  nodekit graph inspect [--repo-root <path>] [--json]
  nodekit graph query <terms> [--repo-root <path>] [--limit <number>] [--code] [--json]
  nodekit graph gaps [--repo-root <path>] [--json]
  nodekit graph research <terms> --provider-fixture <json-file>
      [--max-searches <number>] [--max-results <number>] [--max-fetches <number>]
      [--max-bytes-per-fetch <number>] [--max-total-bytes <number>] [--max-duration-ms <number>]
      [--repo-root <path>] [--run-id <id>] [--json]
  nodekit graph propose --patch <file> [--repo-root <path>] [--json]
  nodekit graph validate --patch <id> [--repo-root <path>] [--json]
  nodekit graph apply --patch <id> --approved-by <principal> [--reason <text>] [--repo-root <path>] [--json]
  nodekit graph diff --from <version> [--to <version>] [--repo-root <path>] [--json]
  nodekit graph replay --version <number> [--out <file>] [--repo-root <path>] [--json]
  nodekit graph benchmark --cases <file> [--repo-root <path>] [--json]
  nodekit graph harness-sync [--repo-root <path>] [--json]
  nodekit frontend init [--repo-root <path>] [--json]
  nodekit frontend plan --contract <file> [--route <file>] [--repo-root <path>] [--json]
  nodekit frontend directions --plan <file> [--repo-root <path>] [--json]
  nodekit frontend benchmark --manifest <file> [--repo-root <path>] [--json]
  nodekit frontend repair --benchmark <file> [--repo-root <path>] [--json]
  nodekit frontend canary --receipt <file> [--repo-root <path>] [--json]
  nodekit atlas init [--repo-root <path>] [--json]
  nodekit atlas add --asset <yaml-file> --observation <path>
      [--vendor <path>] [--notice <path>] [--derived-from <sha256>] [--repo-root <path>] [--json]
  nodekit atlas add --flow <yaml-file> [--repo-root <path>] [--json]
  nodekit atlas list [--repo-root <path>] [--json]
  nodekit atlas inspect --id <assetId-or-flowId> [--repo-root <path>] [--json]
  nodekit atlas search <terms...> [--target asset|flow|both] [--kind <list>] [--framework <id>]
      [--language <list>] [--mobile <mode>] [--accessibility A|AA|AAA] [--maturity <floor>]
      [--license-allowlist <spdx-list>] [--no-new-deps] [--limit <1-50>] [--repo-root <path>] [--json]
  nodekit atlas preview --ids <comma-list-max-4> [--repo-root <path>] [--json]
  nodekit atlas recipe --id <assetId> [--flow <flowId>] [--allow-unvetted] [--repo-root <path>] [--json]
  nodekit atlas repair --recipe <file> [--repo-root <path>] [--json]
  nodekit atlas serve --mcp [--repo-root <path>]
  nodekit reference observe --file <observation.json> [--repo-root <path>] [--json]
  nodekit reference rule --file <rule.json> [--repo-root <path>] [--json]
  nodekit reference score --candidate-receipt <render-receipt.json> --rules <comma-list> --profile <id> [--repo-root <path>] [--json]
  nodekit reference verify --score <score-receipt.json> --candidate-receipt <render-receipt.json> [--repo-root <path>] [--json]
  nodekit reference status --provider mobbin [--repo-root <path>] [--json]
  nodekit evolution init [--repo-root <path>] [--json]
  nodekit evolution draft --id <id> --track <track> --category <category> --challenge <text> --resolution <text> --evidence <comma-list> [--predecessors <comma-list>] [--supersedes <comma-list>]
  nodekit evolution record --file <file> [--repo-root <path>] [--json]
  nodekit evolution verify [--repo-root <path>] [--json]
  nodekit evolution query [--track <track>] [--since <iso>] [--invariant <id>] [--repo-root <path>] [--json]
  nodekit evolution diff --from <commit> --to <commit> [--repo-root <path>] [--json]
  nodekit evolution materiality --from <commit> --to <commit> [--repo-root <path>] [--json]
  nodekit evolution defer-review --drafts <comma-list> --from <commit> --to <commit> --rollback <commit> --before-live <file> --after-live <file> --journey-card <file> --rollback-verification <comma-list> (--ui-media <comma-list> | --ui-not-applicable <reason>) [--authority-directive <file>] [--repo-root <path>] [--json]
  nodekit evolution build-docs [--repo-root <path>] [--json]
  nodekit evolution sync-graph [--graph-path <path>] [--repo-root <path>] [--json]
  nodekit session migrate-legacy --input <legacy.json>
      [--mode dry-run|apply|verify|retire] [--output <bundle.json>]
      [--rollback <rollback-source.json>] [--confirm-bundle-digest <sha256>] [--json]
  nodekit harness init [--repo-root <path>] [--json]
  nodekit harness builder init [--repo-root <path>] [--json]
  nodekit harness builder lock --baseline <trajectory> [--repo-root <path>] [--json]
  nodekit harness builder evaluate --lock <lock> --expected-lock-hash <sha256> --baseline <trajectory> --candidate <trajectory> [--repo-root <path>] [--json]
  nodekit harness builder inspect --ref <hash-or-path> [--repo-root <path>] [--json]
  nodekit harness builder status [--repo-root <path>] [--json]
  nodekit harness trajectory record --file <trajectory> [--repo-root <path>] [--json]
  nodekit harness trajectory inspect --ref <hash-or-path> [--repo-root <path>] [--json]
  nodekit models baseline [--repo-root <path>] [--json]
  nodekit models profile [--repo-root <path>] [--json]
  nodekit models inspect [--repo-root <path>] [--json]
  nodekit models diagnose [--repo-root <path>] [--json]
  nodekit skills propose [--repo-root <path>] [--json]
  nodekit skills review --candidate <id> [--repo-root <path>] [--json]
  nodekit skills benchmark --candidate <id> --comparison <file> [--repo-root <path>] [--json]
  nodekit skills promote --candidate <id> --canary <file> --proof-receipt <file> --approval <signed-file>
  nodekit skills reject --candidate <id> --reason <text>
  nodekit routing compile [--repo-root <path>] [--json]
  nodekit routing canary --receipt <file> [--repo-root <path>] [--json]
  nodekit harness tournament --manifest <file> [--repo-root <path>] [--json]
  nodekit harness baseline|inspect|diagnose|propose|benchmark|canary|review|promote
  nodekit harness status [--repo-root <path>] [--json]
  nodekit harness gate [--repo-root <path>] [--json]
  nodekit harness rollback [--repo-root <path>] [--json]
  nodekit certify [--repo-root <path>] [--json]`);
}

function summarize(result) {
  const name = result.manifest?.repository ?? path.basename(result.repoRoot);
  return {
    checks: result.checks,
    contractFindings: result.contractFindings,
    errors: result.errors,
    passed: result.passed,
    repository: name,
    sourceFindings: result.sourceFindings,
  };
}

function printResult(result, json) {
  const summary = summarize(result);
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`${summary.passed ? "PASS" : "FAIL"} ${summary.repository}`);
  for (const check of summary.checks) {
    console.log(`  ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
  }
  for (const error of summary.errors) console.error(`  ERROR ${error}`);
}

async function registryFrom(options) {
  const root = path.resolve(String(options["registry-root"] ?? packageRoot));
  return loadRegistry(root);
}

async function checkOne(options) {
  const registry = await registryFrom(options);
  const repoRoot = path.resolve(String(options["repo-root"] ?? process.cwd()));
  return checkRepository(repoRoot, registry);
}

async function runShell(command, cwd, args) {
  const suffix = args.length > 0 ? ` -- ${args.map(quoteArgument).join(" ")}` : "";
  await new Promise((resolve, reject) => {
    const child = spawn(`${command}${suffix}`, {
      cwd,
      env: process.env,
      shell: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

// Lifecycle commands are declared per application in nodekit.yaml, so the platform repository
// itself declares only a subset. Stating that a command is undeclared is true but teaches nothing:
// it was the highest-severity dead end in the cold-start baseline (harness/journey, F5). Name what
// this repository does declare and the next step that gets the caller a repository that declares
// the rest.
function undeclaredLifecycleMessage(name, manifest) {
  const declared = Object.keys(manifest?.commands ?? {}).sort();
  const lines = [
    `${name} is not declared in nodekit.yaml.`,
    "",
    `Lifecycle commands (dev, demo, check, proof) are declared per application. This repository declares: ${declared.length ? declared.join(", ") : "none"}.`,
  ];
  if (!declared.includes(name)) {
    lines.push(
      "",
      "If you are exploring NodeKit itself, this repository is the platform, not a generated application.",
      "  nodekit tour                      show what this repository is and verify your setup",
      "  nodekit create <dir> --name <slug> --brief <text>   generate an application that declares dev, demo, check, and proof",
    );
  }
  return lines.join("\n");
}

// The journey contract forbade hand-editing a check to true, and then eleven of twelve were
// hand-edited to true because nothing read the file. This command is what reads it.
async function runJourneyVerify(parsed) {
  const root = path.resolve(parsed.options["repo-root"] ?? ".");
  const verdict = await verifyJourneyContract(root);
  printStructured(verdict, parsed, (value) => {
    const lines = [`JOURNEY CONTRACT: ${value.counts.derivedTrue}/${value.counts.total} derive true; ${value.counts.overclaimed} overclaimed.`];
    for (const check of value.checks) {
      const mark = !check.agrees ? "OVERCLAIM" : check.derived ? "ok" : "--";
      lines.push(`  [${mark}] ${check.id}`);
      if (check.evidence) lines.push(`        ${check.evidence}`);
      else if (check.unattainable) lines.push(`        (never derivable by design)`);
    }
    return lines.join("\n");
  });
  if (!verdict.passed) process.exitCode = 1;
}

// The BUILD-stage producer, wired to the same journey the chain gate walks. The four stage schemas
// enforce shape; this is the first thing that writes a conforming artifact from a real repository
// instead of a hand-authored fixture. It fails closed: an unreconcilable contract or a fabricated
// evidence path refuses the whole pack rather than shipping a partial truth.
/**
 * The EXPLAIN stage. Audience, surfaces, claims and narrative are structured enough that flags would
 * mangle them, so they arrive as one --story file; the producer decides which claims survive.
 */
/**
 * The measurement gate. `declare` writes the bet before the build; `settle` scores it afterwards and
 * refuses if the bet postdates its own evidence.
 */
/** Reject a multi-session plan before launch, while rejecting it is still free. */
async function runSessionsCheck(parsed) {
  const contractPath = parsed.options.contract;
  if (typeof contractPath !== "string") {
    console.error("usage: nodekit sessions check --contract <session-contract.json> [--repo-root <path>]");
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(parsed.options["repo-root"] ?? ".");
  try {
    const contract = JSON.parse(await readFile(path.resolve(contractPath), "utf8"));
    // Tracked files only. An untracked lockfile is not yet a shared-write problem, and demanding a
    // classification for a build artifact is the noise that gets a gate turned off.
    const listed = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const repoFiles = listed.status === 0 ? listed.stdout.split("\n").filter(Boolean) : [];
    if (listed.status !== 0) {
      console.error("sessions check: not a git repository, so no file list could be read; the manifest coverage check did NOT run");
      process.exitCode = 1;
      return;
    }
    // realpath supplied so symlinked aliases collide instead of reading as two separate paths.
    // Resolution is relative to the repository, and a path that cannot be resolved falls back to
    // its lexical form inside the library rather than failing the run.
    const verdict = evaluateSessionContract(contract, repoFiles, {
      resolvePath: (relative) => path.relative(root, realpathSync.native(path.resolve(root, relative))).split(path.sep).join("/"),
    });
    printStructured(verdict, parsed, formatSessionContract);
    if (!verdict.passed) process.exitCode = 1;
  } catch (error) {
    if (error instanceof SessionContractRefusal) {
      console.error(`SESSION CONTRACT REFUSED\n${error.refusals.map((entry) => `  - ${entry}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runCapability(parsed, mode) {

  if (mode === "declare") {
    const capability = parsed.options.capability;
    const out = parsed.options.out;
    if (typeof capability !== "string" || typeof out !== "string") {
      console.error("usage: nodekit capability declare --capability <slug> --out <capability-contract.json>");
      process.exitCode = 2;
      return;
    }
    // A template with every field present and obviously unanswered. Blanks an author must replace
    // beat a form they can submit unread, which is how a kill condition becomes a formality.
    const template = {
      schemaVersion: "nodekit.capability-contract/v1",
      capability,
      declaredAt: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      questionItServes: "REPLACE: a question a USER asks, in their words — not this capability with a question mark on it",
      whyExistingToolsCannot: "REPLACE: why the tools already here cannot answer it. If this is hard to write, that is the finding.",
      measuredImprovement: {
        metric: "REPLACE: what you will count",
        baseline: 0,
        predicted: 0,
        howMeasured: "REPLACE: the command that reads this number, used for BOTH baseline and result",
      },
      killCondition: [
        { metric: "REPLACE: same metric", comparator: "below", value: 0, rationale: "REPLACE: what result would make you delete this" },
      ],
      consumers: [],
    };
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(path.resolve(out), `${JSON.stringify(template, null, 2)}
`, "utf8");
    console.log(`CAPABILITY CONTRACT declared: ${out}`);
    console.log(`  declaredAt ${template.declaredAt} — settle refuses any measurement observed at or before this.`);
    console.log("  Fill every REPLACE before building. Declaring after the build is the failure this prevents.");
    return;
  }

  const { contract: contractPath, measurement: measurementPath } = parsed.options;
  if (typeof contractPath !== "string" || typeof measurementPath !== "string") {
    console.error("usage: nodekit capability settle --contract <capability-contract.json> --measurement <measurement.json>");
    process.exitCode = 2;
    return;
  }
  try {
    const contract = JSON.parse(await readFile(path.resolve(contractPath), "utf8"));
    const measurement = JSON.parse(await readFile(path.resolve(measurementPath), "utf8"));
    const errors = await validateNodekitSchema("nodekit.capability-contract.v1.schema.json", contract, contract.capability ?? "capability");
    if (errors.length > 0) throw new CapabilityContractRefusal(errors);
    parseCapabilityContract(contract);
    const verdict = evaluateCapability(contract, measurement);
    printStructured(verdict, parsed, formatCapabilityVerdict);
    // Only load-bearing exits clean. decorative, killed and insufficient are all "do not ship this
    // as-is", and a gate that exits 0 on three of its four verdicts is a report.
    if (verdict.verdict !== "load-bearing") process.exitCode = 1;
  } catch (error) {
    if (error instanceof CapabilityContractRefusal) {
      console.error(`CAPABILITY CONTRACT REFUSED\n${error.refusals.map((entry) => `  - ${entry}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runJourneyStoryPack(parsed) {

  const { contract, pack, story } = parsed.options;
  if (typeof pack !== "string" || typeof contract !== "string" || typeof story !== "string") {
    console.error(
      "usage: nodekit journey story-pack --pack <build-evidence-pack.json> --contract <opportunity-contract.json> "
        + "--story <story-input.json> [--out <story-pack.json>] [--case-id <id>] [--now <iso8601>] [--json]",
    );
    process.exitCode = 2;
    return;
  }
  let input;
  try {
    input = JSON.parse(await readFile(path.resolve(story), "utf8"));
  } catch (error) {
    console.error(`cannot read the story input at ${story}: ${error?.message ?? error}`);
    process.exitCode = 2;
    return;
  }
  const outPath = typeof parsed.options.out === "string" ? parsed.options.out : undefined;
  try {
    const storyPack = await produceStoryPack({
      packPath: pack,
      contractPath: contract,
      outPath,
      caseId: typeof parsed.options["case-id"] === "string" ? parsed.options["case-id"] : undefined,
      audience: input.audience,
      surfaces: input.surfaces ?? [],
      sources: input.sources ?? [],
      disclosures: input.disclosures ?? [],
      claims: input.claims ?? [],
      narrative: input.narrative ?? [],
      demoMode: input.demoMode ?? { engaged: false, surfaceRefs: [] },
      // Explicit so a regenerated pack is byte-comparable with the committed one. Without it the
      // only difference is producedAt, and "it differs" then carries no information.
      now: typeof parsed.options.now === "string" ? parsed.options.now : undefined,
    });
    printStructured({ storyPack, outPath }, parsed, (value) =>
      [formatStoryPack(value.storyPack), outPath ? `  written to ${outPath}` : "  not written (no --out)"].join("\n"),
    );
  } catch (error) {
    if (error instanceof StoryPackRefusal) {
      console.error(`STORY PACK REFUSED\n${error.refusals.map((entry) => `  - ${entry}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runJourneyBuildEvidence(parsed) {
  const repoRoot = path.resolve(parsed.options.repo ?? parsed.options["repo-root"] ?? ".");
  const contractPath = parsed.options.contract;
  if (typeof contractPath !== "string") {
    console.error(
      "usage: nodekit journey build-evidence --contract <opportunity-contract.json> [--repo <path>] [--out <pack.json>] [--case-id <id>] [--test-command <cmd>] [--json]",
    );
    process.exitCode = 2;
    return;
  }
  try {
    const { pack, packPath } = await produceBuildEvidencePack({
      repoRoot,
      contractPath,
      outPath: typeof parsed.options.out === "string" ? parsed.options.out : undefined,
      caseId: typeof parsed.options["case-id"] === "string" ? parsed.options["case-id"] : undefined,
      testCommand: typeof parsed.options["test-command"] === "string" ? parsed.options["test-command"] : undefined,
    });
    const entries = [
      ...Object.values(pack.content.decisions.contract).flatMap((entry) =>
        entry.elements ? entry.elements : entry.disposition ? [entry] : Object.values(entry).flatMap((bucket) => bucket.elements),
      ),
    ];
    const byDisposition = entries.reduce((acc, entry) => {
      acc[entry.disposition] = (acc[entry.disposition] ?? 0) + 1;
      return acc;
    }, {});
    printStructured({ pack, packPath }, parsed, () =>
      [
        `BUILD EVIDENCE PACK written: ${packPath}`,
        `  case ${pack.caseId}; contract bound by canonical sha256 ${pack.inputs[0].sha256.slice(0, 12)}…`,
        `  reconciled ${entries.length} decision pointer(s): ${byDisposition.honoured ?? 0} honoured, ${byDisposition["defaulted-with-disclosure"] ?? 0} defaulted-with-disclosure, ${byDisposition.contradicted ?? 0} contradicted`,
        `  evidence ${pack.content.evidence.length} entr(ies), each a real file with digest + generation record`,
        `  emergent 0 surfaced; sweep receipt at ${pack.content.evidence.find((e) => e.kind === "command-output")?.artifact.path}`,
        `  notRun ${pack.completeness.notRun.length}, refused ${pack.completeness.refused.length}; promotionAuthorized: false (a producer may never write true)`,
      ].join("\n"),
    );
  } catch (error) {
    if (error instanceof BuildEvidenceRefusal) {
      console.error(`BUILD EVIDENCE REFUSED\n${error.refusals.map((entry) => `  - ${entry}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runBehaviorIndex(parsed) {
  const root = path.resolve(parsed.options["repo-root"] ?? ".");
  const index = await buildBehaviorIndex(root);
  if (parsed.options.write) {
    await writeFile(path.join(root, "behavior-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }
  printStructured(index, parsed, (value) => {
    const c = value.counts;
    const lines = [
      `BEHAVIOR INDEX: ${c.declared} declared — ${c.mapped} mapped, ${c.unmapped} unmapped; ${c.verified} verified, ${c.partial} partial, ${c.unverified} unverified.`,
    ];
    for (const b of value.behaviors) {
      lines.push(`  [${b.implementationState}/${b.verificationState}] ${b.behaviorId}`);
      for (const owner of b.owners) lines.push(`      owner: ${owner.file}#${owner.symbol ?? "?"}`);
      for (const gap of [...b.implementationGaps, ...b.verificationGaps]) lines.push(`      GAP: ${gap}`);
    }
    if (c.orphanAnnotations) lines.push(`  ${c.orphanAnnotations} annotation(s) name a behavior nothing declares.`);

    // Repository-wide ownership, read from the ledger's own human-reviewed invariants.
    const coverage = value.invariantCoverage;
    if (coverage?.available) {
      const k = coverage.counts;
      lines.push(
        "",
        `LEDGER INVARIANT OWNERSHIP: ${k.total} invariants — ${k.annotatedSymbol} owned by a named symbol, ${k.namedFileOnly} name a file only, ${k.unowned} unowned.`,
      );
      for (const invariant of coverage.invariants) {
        if (invariant.ownership === "annotated-symbol") continue;
        const detail = invariant.ownership === "named-file-only"
          ? `names ${invariant.namedSourceFiles.join(", ")} but no symbol claims it`
          : "NO source file or symbol claims it";
        lines.push(`  [${invariant.ownership}] ${invariant.invariantId} — ${detail}`);
      }
      if (k.withMissingRefs) {
        lines.push(`  ${k.withMissingRefs} invariant(s) point at a verifier file that no longer exists.`);
      }
    }
    return lines.join("\n");
  });
}

async function runMotionCompare(parsed) {
  if (parsed.options.help) {
    console.log(`Usage:
  nodekit motion compare <repoA> <repoB> [repoC ...] [--output <receipt.json>] [--json]

Compares concrete CSS motion-token declarations across repositories.
Returns PASS (0), FAIL (1), or NOT_RUN (3). It never applies a migration.`);
    return;
  }
  const repositories = parsed.positional.slice(2);
  if (repositories.length < 2) {
    throw Object.assign(
      new Error(
        "motion compare needs at least two repository paths; an absent comparison is NOT_RUN, never PASS",
      ),
      { exitCode: 3 },
    );
  }
  const receipt = await compareMotionPortability(repositories);
  if (parsed.options.output) {
    const output = path.resolve(String(parsed.options.output));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }
  printStructured(receipt, parsed, (value) => {
    const c = value.coverage;
    const lines = [
      `MOTION PORTABILITY ${value.verdict}: ${c.readableRepositories}/${c.repositoriesRequested} repositories, ${c.repositories.reduce((sum, repository) => sum + repository.cssFilesRead, 0)} CSS files, ${c.declarationsObserved} declarations, ${c.distinctTokenNames} token names.`,
    ];
    for (const conflict of value.conflicts) {
      lines.push(`  [${conflict.scope}] ${conflict.token}`);
      for (const observed of conflict.values) {
        lines.push(`      ${observed.value}: ${observed.sites.join(", ")}`);
      }
    }
    const migration = value.migration.summary;
    lines.push(
      "",
      `MIGRATION: ${migration.behaviorPreservingAliases} behavior-preserving aliases ready; ${migration.reviewRequiredValueChanges} value changes require review; ${migration.ownerDecisions} owner decisions blocked; ${migration.unmappedTokens} unmapped.`,
      "PROOF BOUNDARY: static declarations observed; runtime, DOM/trace, video, and audience evidence not run.",
    );
    if (parsed.options.output) lines.push(`RECEIPT: ${path.resolve(String(parsed.options.output))}`);
    return lines.join("\n");
  });
  if (!receipt.passed) process.exitCode = receipt.exitCode;
}

async function runRepoMap(parsed) {
  const root = path.resolve(parsed.options["repo-root"] ?? ".");
  const map = await buildRepoMap(root);
  if (parsed.options.write) {
    await writeFile(path.join(root, "repo-map.json"), `${JSON.stringify(map, null, 2)}\n`, "utf8");
  }
  printStructured(map, parsed, (value) =>
    `REPO MAP: ${value.architecture.length} architecture parts, ${value.counts.schemas} schemas, ${value.counts.modules} modules, ${value.counts.tests} test suites${parsed.options.write ? " (wrote repo-map.json)" : ""}`,
  );
}

// The tour VERIFIES each step instead of narrating it. A step that cannot be observed is reported
// as an explanation, never as a pass, so a green tour cannot mean "we printed some prose".
// @nodekit-behavior orientation.tour owner
// @nodekit-behavior inv:tour-verifies-what-it-claims owner
async function runTour(parsed) {
  const root = path.resolve(parsed.options["repo-root"] ?? ".");
  const map = await buildRepoMap(root);
  const steps = [];

  const major = Number(process.versions.node.split(".")[0]);
  steps.push({
    id: "environment.node",
    title: "Your Node.js is new enough",
    checked: true,
    passed: major >= 20,
    detail: `Node ${process.versions.node} (needs 20 or newer).`,
    fix: major >= 20 ? null : "Install Node 20 or newer, then run this again.",
  });

  let depsOk = true;
  try { await import("yaml"); } catch { depsOk = false; }
  steps.push({
    id: "environment.dependencies",
    title: "Dependencies are installed",
    checked: true,
    passed: depsOk,
    detail: depsOk ? "Dependencies resolve." : "A required dependency did not resolve.",
    fix: depsOk ? null : "Run `npm install` in this directory, then run this again.",
  });

  steps.push({
    id: "orientation.what-this-is",
    title: "What this repository is",
    checked: false,
    passed: null,
    detail:
      "This repository is the NodeKit PLATFORM, not an application. It generates applications and then proves what they did. That is why `nodekit demo` does not run here: lifecycle commands belong to a generated application.",
    fix: null,
  });

  const partChecks = await Promise.all(
    map.architecture.map(async (part) => ({ part, exists: await pathExists(path.join(root, part.rootGlob)) })),
  );
  const missingParts = partChecks.filter((p) => !p.exists).map((p) => p.part.id);
  steps.push({
    id: "architecture.five-parts",
    title: "The five parts you must be able to name",
    checked: true,
    passed: missingParts.length === 0,
    detail: partChecks.map(({ part }) => `${part.title} — ${part.owns}`).join("\n    "),
    fix: missingParts.length === 0 ? null : `These parts are named in the map but missing on disk: ${missingParts.join(", ")}. The map is stale; run \`npm run repo:map\`.`,
  });

  const traceFiles = ["src/lib/caseflow.mjs", "src/lib/builder-journey.mjs", "schemas/nodekit.builder-case.v1.schema.json"];
  const traceMissing = (await Promise.all(traceFiles.map(async (f) => ({ f, ok: await pathExists(path.join(root, f)) })))).filter((x) => !x.ok).map((x) => x.f);
  steps.push({
    id: "trace.one-action",
    title: "Trace one action from start to receipt",
    checked: true,
    passed: traceMissing.length === 0,
    detail:
      "A builder case advances a stage only when that stage's handoff artifact exists AND a receipt binds it by content hash:\n    " +
      traceFiles.join("\n    ") +
      "\n    Read advanceStage in src/lib/builder-journey.mjs — it is the whole rule in one function.",
    fix: traceMissing.length ? `Missing: ${traceMissing.join(", ")}` : null,
  });

  steps.push({
    id: "change.make-and-prove",
    title: "Make one small change and prove it",
    checked: false,
    passed: null,
    detail:
      "Change something, then run `npm test` and `npm run evolution:verify`. A change to src, schemas, templates/base, or harness is MATERIAL and needs a reviewed Evolution Ledger entry before it can land.",
    fix: null,
  });

  const verified = steps.filter((s) => s.checked);
  const failed = verified.filter((s) => !s.passed);
  const output = {
    schemaVersion: "nodekit.tour-result/v1",
    steps,
    verifiedCount: verified.length,
    failedCount: failed.length,
    passed: failed.length === 0,
  };
  if (parsed.options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("NodeKit tour\n");
    for (const s of steps) {
      const mark = !s.checked ? "[note]" : s.passed ? "[ ok ]" : "[FAIL]";
      console.log(`${mark} ${s.title}`);
      console.log(`    ${s.detail}`);
      if (s.fix) console.log(`    -> ${s.fix}`);
      console.log("");
    }
    console.log(
      output.passed
        ? `TOUR PASS: ${verified.length} steps verified. Steps marked [note] are explanations, not verified claims.`
        : `TOUR FAIL: ${failed.length} of ${verified.length} verified steps failed.`,
    );
  }
  if (!output.passed) process.exitCode = 1;
}

async function runLifecycle(name, parsed) {
  const result = await checkOne(parsed.options);
  if (!result.passed) {
    printResult(result, parsed.options.json);
    process.exitCode = 1;
    return;
  }
  const command = commandFor(result.manifest, name);
  if (!command) throw new Error(undeclaredLifecycleMessage(name, result.manifest));
  await runShell(command, result.repoRoot, parsed.commandArgs);
}

async function runRegistryCheck(parsed) {
  const registry = await registryFrom(parsed.options);
  const errors = validateRegistry(registry);
  const output = { errors, passed: errors.length === 0, schemaVersion: "nodeplatform.registry-check/v1" };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${output.passed ? "PASS" : "FAIL"} Node Platform registry`);
    for (const error of errors) console.error(`  ERROR ${error}`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function collectEcosystem(parsed) {
  const registry = await registryFrom(parsed.options);
  const workspace = path.resolve(String(parsed.options.workspace ?? path.dirname(registry.root)));
  const results = [];

  for (const repository of registry.repositoryCatalog.repositories) {
    if (repository.commandProfile === "untracked") continue;
    const repoRoot = repository.name === "node-platform"
      ? registry.root
      : path.join(workspace, repository.name);
    if (!(await pathExists(repoRoot))) {
      results.push({
        checks: [],
        contractFindings: [],
        errors: [`repository checkout is missing at ${repoRoot}`],
        manifest: null,
        name: repository.name,
        passed: false,
        repoRoot,
        sourceFindings: [],
      });
      continue;
    }
    results.push(await checkRepository(repoRoot, registry));
  }
  return { registry, results };
}

async function runEcosystemCheck(parsed) {
  const { results } = await collectEcosystem(parsed);
  const output = {
    passed: results.every((result) => result.passed),
    repositories: results.map(summarize),
    schemaVersion: "nodeplatform.ecosystem-check/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    for (const result of results) printResult(result, false);
    console.log(`${output.passed ? "PASS" : "FAIL"} ecosystem conformance`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function runDashboard(parsed) {
  const { registry, results } = await collectEcosystem(parsed);
  const markdown = renderDashboard(results, registry);
  if (!parsed.options.write) {
    console.log(markdown);
    return;
  }
  const output = path.resolve(
    String(parsed.options.out ?? path.join(registry.root, "docs", "ECOSYSTEM_STATUS.md")),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, markdown, "utf8");
  console.log(`WROTE ${output}`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

async function runGovernanceVisualize(parsed) {
  const scenario = String(parsed.options.scenario ?? "pr32");
  if (scenario !== "pr32") {
    throw new Error(`governance visualize: unsupported scenario ${scenario}`);
  }
  const output = path.resolve(String(parsed.options.out ?? path.join(".tmp", "governance-graph.html")));
  const bundle = createPr32GovernanceScenario();
  const html = renderGovernanceGraphHtml({
    ...bundle,
    referenceProvenance: [
      {
        label: "n8n run evaluation",
        url: "https://mobbin.com/screens/8e2ed125-52a7-457f-9831-caadfc788629",
        factIds: ["obs-mobbin-n8n-run-evaluation/f1", "obs-mobbin-n8n-run-evaluation/f3"],
      },
      {
        label: "StackAI run detail",
        url: "https://mobbin.com/screens/bb0174f4-60aa-4e30-ac5f-73679b160f38",
        factIds: ["obs-mobbin-stackai-run-detail/f2", "obs-mobbin-stackai-run-detail/f4"],
      },
      {
        label: "GitHub failed workflow",
        url: "https://mobbin.com/screens/0690bb8b-3bbb-45be-9dfa-8cef91e2956f",
        factIds: ["obs-mobbin-github-failed-workflow/f1", "obs-mobbin-github-failed-workflow/f4"],
      },
    ],
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  const receiptPath = output.replace(/\.html$/i, ".json");
  await writeFile(receiptPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  if (parsed.options.json) {
    console.log(JSON.stringify({
      mode: bundle.riskAssessment.mode,
      ready: bundle.promotionReadiness.ready,
      html: output,
      receipt: receiptPath,
      graphDigest: bundle.graph.graphDigest,
    }, null, 2));
    return;
  }
  console.log(`GOVERNANCE ${bundle.riskAssessment.mode} ready=${bundle.promotionReadiness.ready}`);
  console.log(`WROTE ${output}`);
  console.log(`WROTE ${receiptPath}`);
}

async function runDoctor(parsed) {
  const result = await checkOne(parsed.options);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  result.checks.unshift({
    detail: process.versions.node,
    id: "node-version",
    passed: nodeMajor >= 20,
  });
  if (nodeMajor < 20) result.errors.unshift("Node.js 20 or newer is required");
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  if (await pathExists(path.join(repoRoot, "nodeagent.yaml"))) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    const compiled = await compileAgentDefinition(repoRoot, { write: false });
    if (compiled.definition.provider.package === "@earendil-works/pi-ai" && (major < 22 || (major === 22 && minor < 19))) {
      result.errors.unshift("@earendil-works/pi-ai requires Node.js 22.19 or newer");
    }
  }
  result.passed = result.errors.length === 0;
  printResult(result, parsed.options.json);
  if (!result.passed) process.exitCode = 1;
}

function optionEnabled(options, name, defaultValue = true) {
  if (options[`no-${name}`]) return false;
  if (options[name] === false || options[name] === "false") return false;
  return defaultValue;
}

async function runCreate(parsed) {
  const target = parsed.positional[1];
  if (!target) throw new Error("create requires a target directory");
  const localProof = parsed.options["local-proof"] === true || parsed.options["local-proof"] === "true";
  if (localProof && !optionEnabled(parsed.options, "git")) {
    throw new Error("--local-proof requires the default local Git candidate; omit --no-git so NodeKit can bind receipts to an immutable commit");
  }
  const nodekitSpecifier = parsed.options["nodekit-specifier"] ?? parsed.options["nodekit-source"];
  const result = await createProject({
    backend: parsed.options.backend,
    brief: parsed.options.brief,
    git: optionEnabled(parsed.options, "git"),
    install: optionEnabled(parsed.options, "install"),
    launchStartedAt: parsed.options["launch-started-at"],
    model: parsed.options.model,
    name: parsed.options.name ?? path.basename(path.resolve(target)),
    nodekitSpecifier,
    packageManager: parsed.options["package-manager"],
    provider: parsed.options.provider,
    researchMs: parsed.options["research-ms"] === undefined ? undefined : Number(parsed.options["research-ms"]),
    secretRef: parsed.options["secret-ref"],
    sponsors: String(parsed.options.sponsors ?? "").split(",").filter(Boolean),
    target,
  });
  const compileStarted = Date.now();
  const compiled = await compileAgentDefinition(result.target);
  await recordSetupEvent(result.target, "compile_completed", { configHash: compiled.definition.configHash }, Date.now() - compileStarted);
  if (localProof) {
    const scripts = ["demo.mjs", "eval.mjs", "proof.mjs"];
    for (const script of scripts) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(result.target, "scripts", script)], {
          cwd: result.target,
          env: process.env,
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${script} exited ${code}`));
        });
      });
    }
  }
  console.log(`CREATED ${result.name} at ${result.target}${result.candidateCommit ? ` (${result.candidateCommit.slice(0, 12)})` : ""}`);
  console.log(`NEXT cd ${quoteArgument(result.target)} && ${result.packageManager} run compile && ${result.packageManager} run demo`);
}

async function runAdopt(parsed) {
  const target = path.resolve(String(parsed.positional[1] ?? parsed.options["repo-root"] ?? process.cwd()));
  const result = await adoptProject({
    backend: parsed.options.backend,
    brief: parsed.options.brief,
    model: parsed.options.model,
    name: parsed.options.name ?? path.basename(target),
    nodekitSpecifier: parsed.options["nodekit-specifier"] ?? parsed.options["nodekit-source"],
    provider: parsed.options.provider,
    secretRef: parsed.options["secret-ref"],
    target,
  });
  console.log(`ADOPTED ${result.name} at ${result.target}`);
  console.log("NodeKit only added missing harness files; existing auth, routes, CSS, and schemas were preserved.");
  console.log(`COLLISIONS ${result.collisions.length}; inspect proof/adoption-receipt.json before installation.`);
  // An adopted project keeps its OWN `check`, deliberately — hijacking somebody's entry point is
  // hostile, and adopt is non-destructive by design. But that leaves the gates installed and
  // uncalled: measured on a real adoption, everything landed correctly and nothing in the project
  // ran any of it, with no output saying so. Installed-but-unwired is the exact failure this
  // repository spent a day closing elsewhere; printing the wiring is the cheapest possible fix.
  console.log([
    "",
    "NOT WIRED: your `check` script is still yours, on purpose. These gates are installed and nothing calls them yet:",
    "  nodekit preflight        harness liveness, plus skill and code-graph freshness",
    "  nodekit deferrals check  refuses a submission while a deliberate deferral is still open",
    "  nodekit audience check   refuses a design decided before its audience was researched",
    "Add them to your own check script when you want them enforced:",
    '  "check": "<your existing check> && nodekit preflight && nodekit deferrals check"',
  ].join("\n"));
}

async function runCompile(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const result = await compileAgentDefinition(repoRoot, {
    check: Boolean(parsed.options.check),
    write: !parsed.options.check,
  });
  const output = {
    application: result.definition.application.id,
    applicationHash: result.definition.applicationHash,
    configHash: result.definition.configHash,
    contracts: result.definition.contracts,
    fileCount: result.definition.fileCount,
    passed: true,
    schemaVersion: "nodekit.compile/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`${parsed.options.check ? "CURRENT" : "COMPILED"} ${output.application} ${output.configHash.slice(0, 12)} (${output.fileCount} authored files)`);
}

async function runInspect(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const output = inspectAgentDefinition(await compileAgentDefinition(repoRoot, { write: false }));
  if (parsed.options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`${output.application.name} (${output.application.id})`);
  console.log(`  runtime ${output.runtime.engine}/${output.runtime.profile}`);
  console.log(`  provider ${output.provider.adapter}:${output.provider.model.provider}/${output.provider.model.id}`);
  console.log(`  backend ${output.backend.adapter}`);
  console.log(`  contracts event=${output.contracts.event} trace=${output.contracts.trace}`);
  console.log(`  config ${output.configHash}`);
  console.log(`  application ${output.applicationHash}`);
  console.log(`  files ${output.fileCount}`);
  for (const [name, count] of Object.entries(output.discovered)) console.log(`  ${name} ${count}`);
  for (const secret of output.secrets) console.log(`  secret ${secret.name}: ${secret.configured ? "configured" : "missing"}`);
}

async function runCertify(parsed) {
  const result = await checkOne(parsed.options);
  const criteria = {
    architectureConformance: result.sourceFindings.every((finding) => finding.excepted),
    canonicalOwnership: (result.manifest?.canonicalFor ?? []).every((concept) =>
      Boolean(concept),
    ),
    commonCommands: result.checks
      .filter((check) => check.id.startsWith("command:"))
      .every((check) => check.passed),
    duplicateContractFreeze: result.contractFindings.every((finding) => finding.declared),
    environmentContract: result.manifest?.environment?.contractVersion === "nodeplatform.env/v1",
    lifecycle: Boolean(result.manifest?.lifecycle),
    noKey: ["certified", "not-applicable"].includes(result.manifest?.noKey?.status),
    proofReceipt: Boolean(result.manifest?.proof?.receiptSchema),
  };
  const met = Object.values(criteria).filter(Boolean).length;
  const output = {
    criteria,
    errors: result.errors,
    level: "p0-contract",
    passed: result.passed && met === Object.keys(criteria).length,
    repository: result.manifest?.repository ?? path.basename(result.repoRoot),
    score: `${met}/${Object.keys(criteria).length}`,
    schemaVersion: "nodeplatform.certification/v1",
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`P0 ${output.passed ? "PASS" : "BLOCKED"} ${output.repository} ${output.score}`);
    for (const [criterion, passed] of Object.entries(criteria)) {
      console.log(`  ${passed ? "PASS" : "BLOCKED"} ${criterion}`);
    }
    for (const error of output.errors) console.error(`  ERROR ${error}`);
  }
  if (!output.passed) process.exitCode = 1;
}

async function runGraphImport(parsed) {
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  const snapshot = await importUnderstandAnythingCodeGraph(repoRoot, {
    commitSha: parsed.options.commit,
    graphDir: parsed.options["graph-dir"],
    repoId: parsed.options["repo-id"],
  });
  const output = {
    commitSha: snapshot.commitSha,
    contentHash: snapshot.contentHash,
    layers: snapshot.layers.length,
    nodes: snapshot.nodes.length,
    passed: true,
    repoId: snapshot.repoId,
    schemaVersion: "nodekit.graph-import/v1",
    source: snapshot.source,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`IMPORTED ${output.repoId}@${output.commitSha} ${output.nodes} nodes ${output.layers} layers`);
}

async function runGraphQuery(parsed) {
  const query = parsed.positional.slice(2).join(" ");
  if (!query) throw new Error("graph query requires search terms");
  const repoRoot = path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
  if (!parsed.options.code) {
    try {
      const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
      const output = queryKnowledgeGraph(graph, query, { limit: parsed.options.limit });
      if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`KNOWLEDGE GRAPH ${output.graphId}@v${output.graphVersion}`);
        for (const { entity, score } of output.results) console.log(`  ${score} ${entity.label ?? entity.predicate} (${entity.kind ?? "hyperedge"}:${entity.layer})`);
      }
      await recordKnowledgeAction(repoRoot, {
        type: "GRAPH_RETRIEVE",
        runId: parsed.options["run-id"] ?? "run:nodekit-cli-query",
        caseId: parsed.options["case-id"] ?? "case:nodekit-cli-query",
        actorId: parsed.options["actor-id"] ?? "nodekit-cli",
        input: { query, limit: parsed.options.limit ?? 12 },
        outputRefs: output.results.map((entry) => entry.entity.id),
      }, { graphPath: parsed.options["graph-path"] });
      return;
    } catch (error) {
      if (!String(error.message).includes("knowledge graph is missing")) throw error;
    }
  }
  const snapshot = await readUnderstandAnythingCodeGraph(repoRoot, {
    snapshotPath: parsed.options["snapshot-path"],
  });
  const output = queryUnderstandAnythingCodeGraph(snapshot, query, {
    limit: parsed.options.limit,
  });
  if (parsed.options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`CODE GRAPH ${output.source.repoId}@${output.source.commitSha}`);
  for (const { node, score } of output.matched) console.log(`  ${score} ${node.name} (${node.type})`);
}

async function readJsonInput(repoRoot, candidate, label) {
  if (!candidate) throw new Error(`${label} file is required`);
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, String(candidate));
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} file must stay inside the repository`);
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} file is invalid JSON: ${relative}: ${error.message}`);
  }
}

async function runGraphInit(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const graph = await initializeKnowledgeGraph(repoRoot, {
    graphId: parsed.options["graph-id"],
    graphPath: parsed.options["graph-path"],
    ownerId: parsed.options["owner-id"],
  });
  const output = { passed: true, graphId: graph.graphId, graphVersion: graph.version, ownerId: graph.authority.ownerId, contentHash: graph.contentHash };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`INITIALIZED ${graph.graphId}@v${graph.version} ${graph.contentHash}`);
}

async function runGraphInspect(parsed) {
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = {
    schemaVersion: "nodekit.knowledge-inspection/v1",
    graphId: graph.graphId,
    graphVersion: graph.version,
    contentHash: graph.contentHash,
    nodes: graph.nodes.length,
    hyperedges: graph.hyperedges.length,
    layers: Object.fromEntries(graph.layers.map((layer) => [layer.id, graph.nodes.filter((node) => node.layer === layer.id).length + graph.hyperedges.filter((edge) => edge.layer === layer.id).length])),
    patches: Object.fromEntries(["pending", "accepted", "rejected", "conflicted", "applied"].map((status) => [status, graph.proposals.filter((patch) => patch.status === status).length])),
    actionReceipts: graph.actionReceipts.length,
    evolutionReceipts: graph.evolutionReceipts.length,
    authority: graph.authority,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`KNOWLEDGE ${output.graphId}@v${output.graphVersion} ${output.nodes} nodes ${output.hyperedges} hyperedges ${output.patches.pending} pending patches`);
}

function proposalActor(parsed) {
  return {
    agentId: String(parsed.options["agent-id"] ?? "nodekit-cli"),
    modelRoute: String(parsed.options["model-route"] ?? "deterministic"),
    resolvedModel: String(parsed.options["resolved-model"] ?? "none"),
    harnessVersion: String(parsed.options["harness-version"] ?? "h0"),
  };
}

async function runGraphIngest(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const input = await readJsonInput(repoRoot, parsed.options.input, "graph ingest input");
  const patch = await proposeGraphPatch(repoRoot, {
    operations: [
      ...(input.nodes ?? []).map((node) => ({ type: "INSERT", node })),
      ...(input.hyperedges ?? []).map((hyperedge) => ({ type: "INSERT", hyperedge })),
    ],
    evidenceRefs: input.evidenceRefs ?? [],
    contradictionRefs: input.contradictionRefs ?? [],
    proposedBy: input.proposedBy ?? proposalActor(parsed),
    confidence: input.confidence ?? 1,
  }, { graphPath: parsed.options["graph-path"] });
  const output = {
    passed: true,
    proposalOnly: true,
    byteAuthenticated: false,
    warning: "Preconstructed graph input is not a byte-authenticated evidence capture; use graph evidence-ingest for source evidence.",
    patch,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`PROPOSED PRECONSTRUCTED GRAPH INPUT ${patch.patchId} (${patch.operations.length} operations); canonical graph unchanged; source bytes not authenticated`);
}

async function runGraphEvidenceIngest(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const sourceFile = parsed.options.file;
  const sourceUri = parsed.options["source-uri"];
  const mediaType = parsed.options["media-type"];
  if (!sourceFile || !sourceUri || !mediaType) {
    throw new Error("graph evidence-ingest requires --file, --source-uri, and --media-type");
  }
  let locators = [];
  if (parsed.options.locators) {
    const locatorInput = await readJsonInput(repoRoot, parsed.options.locators, "evidence locators");
    locators = Array.isArray(locatorInput) ? locatorInput : locatorInput.locators;
    if (!Array.isArray(locators)) throw new Error("evidence locators file must be an array or contain a locators array");
  }
  const { snapshot, sourcePath } = await ingestEvidenceFile(repoRoot, {
    file: sourceFile,
    sourceUri,
    mediaType,
    capturedAt: parsed.options["captured-at"],
    expectedSha256: parsed.options["expected-sha256"],
    expiresAt: parsed.options["expires-at"],
    locators,
  }, {
    limits: {
      maximumBytes: parsed.options["max-bytes"],
      maximumLocators: parsed.options["max-locators"],
    },
  });
  const verification = await verifyEvidenceSnapshot(repoRoot, snapshot.snapshotId);
  if (!verification.passed) throw new Error(`evidence snapshot failed immediate verification: ${snapshot.snapshotId}`);
  const node = evidenceSnapshotToGraphNode(snapshot, {
    label: parsed.options.label ?? path.basename(String(sourceFile)),
    confidence: parsed.options.confidence ?? 1,
    properties: { ingestSourcePath: sourcePath, ingestActor: proposalActor(parsed).agentId },
  });
  const patch = await proposeGraphPatch(repoRoot, {
    operations: [{ type: "INSERT", node }],
    evidenceRefs: [],
    contradictionRefs: [],
    proposedBy: proposalActor(parsed),
    confidence: Number(parsed.options.confidence ?? 1),
  }, { graphPath: parsed.options["graph-path"] });
  const output = { passed: true, proposalOnly: true, sourcePath, snapshot, verification, patch };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`SNAPSHOTTED ${snapshot.snapshotId} ${snapshot.raw.sha256}; proposed ${patch.patchId}; canonical graph unchanged`);
}

async function runGraphEvidenceVerify(parsed) {
  const snapshotId = parsed.options.snapshot;
  if (!snapshotId) throw new Error("graph evidence-verify requires --snapshot <id>");
  const output = await verifyEvidenceSnapshot(repoRootFrom(parsed), String(snapshotId), { at: parsed.options.at });
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`EVIDENCE ${output.passed ? "VERIFIED" : "BLOCKED"} ${output.snapshotId} hash=${output.hashMatches} fresh=${output.fresh}`);
  if (!output.passed) process.exitCode = 1;
}

async function runGraphPropose(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const input = await readJsonInput(repoRoot, parsed.options.patch, "graph patch");
  const patch = await proposeGraphPatch(repoRoot, {
    ...input,
    proposedBy: input.proposedBy ?? proposalActor(parsed),
  }, { graphPath: parsed.options["graph-path"] });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, patch }, null, 2));
  else console.log(`PROPOSED ${patch.patchId}@v${patch.baseVersion}; validate then apply with explicit approval`);
}

async function runGraphValidate(parsed) {
  const patchId = parsed.options.patch;
  if (!patchId) throw new Error("graph validate requires --patch <id>");
  const patch = await validateGraphPatch(repoRootFrom(parsed), String(patchId), { graphPath: parsed.options["graph-path"] });
  const passed = patch.validation.errors.length === 0 && Object.entries(patch.validation).filter(([key]) => key !== "errors").every(([, value]) => value);
  if (parsed.options.json) console.log(JSON.stringify({ passed, patch }, null, 2));
  else {
    console.log(`GRAPH PATCH ${passed ? "VALID" : "BLOCKED"} ${patch.patchId}`);
    for (const error of patch.validation.errors) console.log(`  ${error}`);
  }
  if (!passed) process.exitCode = 1;
}

async function runGraphApply(parsed) {
  const patchId = parsed.options.patch;
  const principalId = parsed.options["approved-by"];
  if (!patchId || !principalId) throw new Error("graph apply requires --patch <id> and --approved-by <principal>");
  const repoRoot = repoRootFrom(parsed);
  let graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  let patch = graph.proposals.find((entry) => entry.patchId === patchId);
  if (!patch) throw new Error(`graph patch not found: ${patchId}`);
  if (patch.status === "pending" || patch.status === "conflicted") {
    patch = await validateGraphPatch(repoRoot, String(patchId), { graphPath: parsed.options["graph-path"] });
    if (patch.status !== "pending") throw new Error(`graph patch is ${patch.status}; create a rebased proposal`);
    patch = await decideGraphPatch(repoRoot, String(patchId), {
      decision: "accept",
      principalId: String(principalId),
      reason: parsed.options.reason,
      graphPath: parsed.options["graph-path"],
    });
  }
  const output = await applyGraphPatch(repoRoot, String(patchId), { graphPath: parsed.options["graph-path"] });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, ...output }, null, 2));
  else console.log(`APPLIED ${patchId} v${output.receipt.fromVersion}->v${output.receipt.toVersion} ${output.receipt.receiptId}`);
}

async function runGraphGaps(parsed) {
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = inspectKnowledgeGaps(graph);
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GAPS unresolved=${output.unresolved.length} unsupported=${output.unsupported.length} stale=${output.staleEvidence.length} pending=${output.pendingPatches.length}`);
}

async function runGraphResearch(parsed) {
  const query = parsed.positional.slice(2).join(" ");
  if (!query) throw new Error("graph research requires a typed knowledge-gap query");
  const fixturePath = parsed.options["provider-fixture"];
  if (!fixturePath) throw new Error("graph research requires --provider-fixture <json-file>; live providers must be supplied through the provider-neutral library port");
  const repoRoot = repoRootFrom(parsed);
  const fixture = await readLocalResearchFixture(repoRoot, fixturePath);
  const provider = createLocalFixtureResearchProvider(repoRoot, fixture);
  const output = await collectExternalResearch(repoRoot, {
    provider,
    query,
    graphPath: parsed.options["graph-path"],
    runId: parsed.options["run-id"] ?? `research:${Date.now()}`,
    caseId: parsed.options["case-id"] ?? "case:knowledge-research",
    actorId: parsed.options["actor-id"] ?? "nodekit-cli",
    gapIds: String(parsed.options["gap-ids"] ?? "").split(",").filter(Boolean),
    proposedBy: proposalActor(parsed),
    limits: {
      maximumSearches: parsed.options["max-searches"],
      maximumResultsPerSearch: parsed.options["max-results"],
      maximumFetches: parsed.options["max-fetches"],
      maximumBytesPerFetch: parsed.options["max-bytes-per-fetch"],
      maximumTotalBytes: parsed.options["max-total-bytes"],
      maximumLocatorsPerDocument: parsed.options["max-locators"],
      maximumDurationMs: parsed.options["max-duration-ms"],
    },
  });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, ...output }, null, 2));
  else console.log(`COLLECTED ${output.collection.collectionId}; snapshotted ${output.collection.fetches.length} documents; proposed ${output.patch.patchId}; canonical graph unchanged`);
}

async function runGraphDiff(parsed) {
  if (parsed.options.from === undefined) throw new Error("graph diff requires --from <version>");
  const graph = await readKnowledgeGraph(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  const output = diffKnowledgeGraph(graph, parsed.options.from, parsed.options.to ?? graph.version);
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GRAPH DIFF v${output.fromVersion}->v${output.toVersion}: ${output.patchIds.length} patches ${output.operations.length} operations`);
}

async function runGraphReplay(parsed) {
  if (parsed.options.version === undefined) throw new Error("graph replay requires --version <number>");
  const repoRoot = repoRootFrom(parsed);
  const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  const output = replayKnowledgeGraph(graph, parsed.options.version);
  if (parsed.options.out) {
    const root = path.resolve(repoRoot);
    const destination = path.resolve(root, String(parsed.options.out));
    const relation = path.relative(root, destination);
    if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error("graph replay output must stay inside the repository");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`REPLAYED ${output.graphId}@v${output.version} ${output.nodes.length} nodes ${output.hyperedges.length} hyperedges`);
}

async function runGraphBenchmark(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const cases = await readJsonInput(repoRoot, parsed.options.cases, "graph benchmark cases");
  const graph = await readKnowledgeGraph(repoRoot, { graphPath: parsed.options["graph-path"] });
  const output = benchmarkKnowledgeRetrieval(graph, Array.isArray(cases) ? cases : cases.cases, { limit: parsed.options.limit });
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`GRAPH BENCHMARK flat=${output.results.flat.averageRecall.toFixed(3)} static=${output.results.staticGraph.averageRecall.toFixed(3)} evolving=${output.results.evolvingGraph.averageRecall.toFixed(3)}`);
}

async function runGraphHarnessSync(parsed) {
  const output = await proposeHarnessKnowledgePatch(repoRootFrom(parsed), {
    graphPath: parsed.options["graph-path"],
    agentId: parsed.options["agent-id"],
  });
  if (parsed.options.json) console.log(JSON.stringify({ passed: true, proposalOnly: true, ...output }, null, 2));
  else if (output.unchanged) console.log(`HARNESS KNOWLEDGE UNCHANGED (${output.observationCount} observations)`);
  else console.log(`PROPOSED HARNESS KNOWLEDGE ${output.patch.patchId} (${output.patch.operations.length} operations); canonical graph unchanged`);
}

async function runFrontendInit(parsed) {
  const output = await initializeFrontendHarness(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED Frontend Gym at ${value.frontendRoot}; preferred route remains unprofiled`);
}

async function runFrontendPlan(parsed) {
  const output = await compileFrontendPlan(repoRootFrom(parsed), requireOption(parsed, "contract"), parsed.options.route);
  printStructured(output, parsed, (value) => `PLANNED ${value.plan.planId}; 3 directions required; route ${value.plan.routeStatus}; deployment unauthorized`);
}

async function runFrontendDirections(parsed) {
  const output = await createFrontendDirections(repoRootFrom(parsed), requireOption(parsed, "plan"));
  printStructured(output, parsed, (value) => `CREATED ${value.directionSet.directionSetId}: collaborative workspace, artifact studio, and domain-native hypotheses`);
}

async function runFrontendBenchmark(parsed) {
  const output = await evaluateFrontendTournament(repoRootFrom(parsed), requireOption(parsed, "manifest"));
  printStructured(output, parsed, (value) => `FRONTEND TOURNAMENT ${value.decisive ? "DECISIVE" : "BLOCKED"}: provisional ${value.decision.selectedCandidateId}; promotion unauthorized`);
  if (!output.decisive) process.exitCode = 1;
}

async function runFrontendRepair(parsed) {
  const output = await createFrontendRepairPlan(repoRootFrom(parsed), requireOption(parsed, "benchmark"));
  printStructured(output, parsed, (value) => `REPAIR ${value.repair.repairId}: maximum ${value.repair.maximumRounds} bounded rounds; prior implementation preserved`);
}

async function runFrontendCanary(parsed) {
  const output = await verifyFrontendCanary(repoRootFrom(parsed), requireOption(parsed, "receipt"));
  printStructured(output, parsed, (value) => `FRONTEND CANARY ${value.passed ? "PASS" : "BLOCKED"}`);
  if (!output.passed) process.exitCode = 1;
}

function optionList(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function printAtlasUsage() {
  console.log(`nodekit atlas <sub>

  nodekit atlas init [--repo-root <path>] [--json]
  nodekit atlas add --asset <yaml-file> --observation <path>
      [--vendor <path>] [--notice <path>] [--derived-from <sha256>] [--repo-root <path>] [--json]
  nodekit atlas add --flow <yaml-file> [--repo-root <path>] [--json]
  nodekit atlas list [--repo-root <path>] [--json]
  nodekit atlas inspect --id <assetId-or-flowId> [--repo-root <path>] [--json]
  nodekit atlas search <terms...> [--target asset|flow|both] [--framework <id>] [--mobile <mode>]
      [--accessibility A|AA|AAA] [--maturity <floor>] [--license-allowlist <spdx-list>] [--limit <1-50>] [--json]
  nodekit atlas preview --ids <comma-list-max-4> [--repo-root <path>] [--json]
  nodekit atlas recipe --id <assetId> [--flow <flowId>] [--allow-unvetted] [--repo-root <path>] [--json]
  nodekit atlas repair --recipe <file> [--repo-root <path>] [--json]
  nodekit atlas serve --mcp [--repo-root <path>]

Flags come last: nodekit atlas list --repo-root . --json`);
}

async function runAtlasInit(parsed) {
  const output = await initializeAtlasStore(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED atlas store at ${value.atlasRoot}; no assets registered`);
}

async function runAtlasAdd(parsed) {
  if (parsed.options.flow !== undefined && parsed.options.asset !== undefined) {
    throw new Error("atlas add takes either --asset or --flow, not both");
  }
  if (parsed.options.flow !== undefined) {
    const output = await addAtlasFlow(repoRootFrom(parsed), { flowFile: requireOption(parsed, "flow") });
    printStructured(output, parsed, (value) => `${value.duplicate ? "UNCHANGED" : "REGISTERED"} ${value.flow.flowId}; ${value.flow.card.stateCoverage} states covered; maturity ${value.flow.quality.maturity}; nothing promoted`);
    return;
  }
  const output = await addAtlasAsset(repoRootFrom(parsed), {
    assetFile: requireOption(parsed, "asset"),
    observationFile: requireOption(parsed, "observation"),
    vendorFile: parsed.options.vendor === true ? undefined : parsed.options.vendor,
    noticeFile: parsed.options.notice === true ? undefined : parsed.options.notice,
    derivedFromSha256: parsed.options["derived-from"] === true ? undefined : parsed.options["derived-from"],
  });
  printStructured(output, parsed, (value) => `${value.duplicate ? "UNCHANGED" : "REGISTERED"} ${value.asset.assetId} (reuseMode ${value.asset.source.reuseMode}, ${value.asset.source.license.identifier}); maturity ${value.asset.quality.maturity}; nothing promoted`);
}

async function runAtlasList(parsed) {
  const output = await listAtlasRecords(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `LISTED ${value.counts.assets} assets, ${value.counts.flows} flows; byte identity not re-verified`);
}

async function runAtlasInspect(parsed) {
  const output = await inspectAtlasRecord(repoRootFrom(parsed), requireOption(parsed, "id"));
  printStructured(output, parsed, (value) => `ATLAS ${value.passed ? "PASS" : "BLOCKED"} ${value.id}: ${value.issues.length} issues, ${value.snapshotChecks.length} snapshots re-verified; nothing promoted`);
  if (!output.passed) process.exitCode = 1;
}

async function runAtlasSearch(parsed) {
  const terms = parsed.positional.slice(2).join(" ").trim();
  if (!terms) throw new Error("atlas search requires search terms");
  const target = parsed.options.target === true ? undefined : parsed.options.target;
  const output = await atlasSearch(repoRootFrom(parsed), {
    terms,
    target,
    kind: optionList(parsed, "kind"),
    framework: parsed.options.framework === true ? undefined : parsed.options.framework,
    language: optionList(parsed, "language"),
    mobile: parsed.options.mobile === true ? undefined : parsed.options.mobile,
    accessibility: parsed.options.accessibility === true ? undefined : parsed.options.accessibility,
    maturityFloor: parsed.options.maturity === true ? undefined : parsed.options.maturity,
    licenseAllowlist: optionList(parsed, "license-allowlist"),
    noNewDeps: parsed.options["no-new-deps"] === true,
    limit: parsed.options.limit === true ? undefined : parsed.options.limit,
  });
  printStructured(output, parsed, (value) => {
    const excludedTotal = Object.values(value.excluded).reduce((sum, count) => sum + count, 0);
    return `FOUND ${value.assets.length} assets, ${value.flows.length} flows (${excludedTotal} excluded by constraints); decision ${value.decision.status}; no compatibility determination made; nothing selected, vendored, or promoted`;
  });
  if (output.decision.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasPreview(parsed) {
  const ids = optionList(parsed, "ids");
  const output = await atlasPreview(repoRootFrom(parsed), { ids });
  printStructured(output, parsed, (value) => `PREVIEWED ${value.candidates.filter((entry) => entry.preview).length} candidates; ${value.differences.length} differing fields; decision ${value.decision.status}; nothing installed`);
  if (output.decision.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasRecipe(parsed) {
  const output = await atlasRecipe(repoRootFrom(parsed), {
    id: requireOption(parsed, "id"),
    flowId: parsed.options.flow === true ? undefined : parsed.options.flow,
    allowUnvetted: parsed.options["allow-unvetted"] === true,
  });
  printStructured(output, parsed, (value) => {
    if (value.status) return `ATLAS ${value.status} ${value.reason}; nothing installed`;
    return `RECIPE ${value.recipeId} for ${value.assetId}; ${value.files.length} files, ${value.responseBytes} bytes; deployment not authorized`;
  });
  if (output.status === "REFUSED" || output.status === "ABSTAIN") process.exitCode = 1;
}

async function runAtlasRepair(parsed) {
  const repoRoot = repoRootFrom(parsed);
  const recipe = await readJsonInput(repoRoot, requireOption(parsed, "recipe"), "atlas recipe");
  const output = await atlasDelta(repoRoot, { recipe });
  printStructured(output, parsed, (value) => {
    if (value.status === "UNCHANGED") return `UNCHANGED ${value.recipeHash ?? "recipe"}; no repair needed`;
    if (value.status === "CHANGED") return `CHANGED ${value.changedPaths.length} paths, ${value.changedFiles.length} files; ${value.repairSteps.length} repair steps; nothing installed`;
    return `ATLAS ${value.status} ${value.reason ?? ""}; a fresh selection is required`.trim();
  });
  if (["SUPERSEDED", "GONE", "REFETCH_REQUIRED"].includes(output.status)) process.exitCode = 1;
}

async function runAtlasServe(parsed) {
  if (parsed.options.mcp !== true) throw new Error("atlas serve currently supports only --mcp");
  await serveAtlasMcp(repoRootFrom(parsed));
}

async function runEvolutionInit(parsed) {
  const output = await initializeEvolutionLedger(repoRootFrom(parsed));
  printStructured({ ...output, passed: true }, parsed, (value) => `INITIALIZED Evolution Ledger at ${value.evolutionRoot}`);
}

async function runEvolutionDraft(parsed) {
  const output = await draftEvolutionEvent(repoRootFrom(parsed), {
    id: requireOption(parsed, "id"),
    repository: parsed.options.repository,
    projectId: parsed.options["project-id"],
    commitSha: parsed.options.commit,
    pullRequest: parsed.options.pr,
    track: requireOption(parsed, "track"),
    category: requireOption(parsed, "category"),
    challenge: requireOption(parsed, "challenge"),
    observedFailure: parsed.options.failure,
    resolution: requireOption(parsed, "resolution"),
    // A draft cannot name its own reviewer; that identity is derived from the verified approval
    // credential at record time. These two are passed through ONLY so draftEvolutionEvent can
    // refuse them explicitly — dropping them here would silently ignore an attempt to assert
    // authority, and let the caller believe it worked.
    reviewedBy: parsed.options["reviewed-by"],
    status: parsed.options.status,
    author: parsed.options.author,
    assumptionIds: optionList(parsed, "assumptions"),
    invariantIds: optionList(parsed, "invariants"),
    evidenceIds: optionList(parsed, "evidence"),
    predecessorIds: optionList(parsed, "predecessors"),
    supersedesIds: optionList(parsed, "supersedes"),
    knownLimitations: optionList(parsed, "limitations"),
  });
  printStructured(output, parsed, (value) => `DRAFTED ${value.event.id}; record remains separate from canonical history`);
}

async function runEvolutionRecord(parsed) {
  const output = await recordEvolutionRecord(repoRootFrom(parsed), requireOption(parsed, "file"), parsed.options.approval);
  printStructured(output, parsed, (value) => {
    const promoted = value.promotion
      // State the assurance actually reached. A reader must never have to assume which level applied.
      ? ` promoted by ${value.promotion.interpretation.reviewedBy} at ${value.promotion.trustLevel} (${value.promotion.assurance})`
      : "";
    return `${value.duplicate ? "UNCHANGED" : "RECORDED"} ${value.record.id}${promoted}`;
  });
}

/**
 * Sign an approval for a draft. Without this the verification side is unsatisfiable and the ledger
 * is bricked: a gate nobody can pass is not a gate, it is an outage.
 *
 * This command does NOT grant an assurance level. It produces a signature; the trust policy decides
 * what that signature is worth. Signing with a software key the agent can read yields H1 no matter
 * what this command is told, because the level is a property of where the key lives.
 */
async function runEvolutionApprove(parsed) {
  const root = repoRootFrom(parsed);
  const draft = JSON.parse(await readFile(path.resolve(root, requireOption(parsed, "draft")), "utf8"));
  const policy = await readTrustPolicy(root);
  if (!policy) throw new Error("no evolution/trust-policy.json. Run 'nodekit trust init' first.");

  const credentialId = parsed.options["credential-id"] ?? Object.keys(policy.credentials)[0];
  const credential = policy.credentials[credentialId];
  if (!credential) throw new Error(`credential ${credentialId} is not in the trust policy`);

  const keyPath = requireOption(parsed, "key");
  const approval = sealEvolutionApproval({
    repositoryId: parsed.options["repository-id"] ?? draft.repository ?? "unknown/repo",
    projectId: draft.projectId,
    eventId: draft.id,
    subjectHash: approvalSubject(draft),
    evidenceManifestHash: evidenceManifestHash(draft.evidenceIds),
    commitSha: draft.source?.commitSha,
    trustPolicyVersion: policy.version,
    nonce: randomUUID(),
    issuedAt: new Date().toISOString(),
    // Short by default. An approval that lives for a week is a standing grant, not a decision.
    expiresAt: new Date(Date.now() + Number(parsed.options["ttl-minutes"] ?? 30) * 60_000).toISOString(),
  }, {
    privateKey: await readFile(path.resolve(keyPath), "utf8"),
    credentialId,
    algorithm: credential.algorithm ?? "Ed25519",
  });

  const out = path.resolve(root, parsed.options.out ?? path.join("evolution", `approval-${draft.id}.json`));
  await writeFile(out, `${JSON.stringify(approval, null, 2)}\n`);
  printStructured({ approval, output: out, trustLevel: credential.trustLevel }, parsed, (value) =>
    `APPROVED ${draft.id} -> ${path.relative(root, value.output)}\n` +
    `  credential ${credentialId} at ${value.trustLevel}; single use; expires ${approval.expiresAt}\n` +
    `  This command signed. It did not decide the assurance level — the trust policy did.`);
}

async function runTrustInit(parsed) {
  const output = await initializeTrust(repoRootFrom(parsed), {
    reviewer: requireOption(parsed, "reviewer"),
    dev: Boolean(parsed.flags?.dev ?? parsed.options.dev),
    credentialId: parsed.options["credential-id"],
    publicKey: parsed.options["public-key"],
    trustLevel: parsed.options["trust-level"],
    algorithm: parsed.options.algorithm,
    requiredTrustLevel: parsed.options["required-trust-level"],
  });
  printStructured(output, parsed, (value) =>
    `TRUST INITIALISED ${value.policy.version}; requires ${value.policy.requiredTrustLevel}` +
    (value.devPrivateKeyPath ? `\n  development private key written OUTSIDE the repository: ${value.devPrivateKeyPath}\n  This is an H1 credential. It does NOT attest that a human acted.` : ""));
}

async function runEvolutionVerify(parsed) {
  const output = await verifyEvolutionLedger(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `EVOLUTION ${value.passed ? "PASS" : "BLOCKED"}: ${value.counts.events} events, ${value.counts.invariants} invariants, ${value.counts.adoptions} adoptions`);
  if (!output.passed) process.exitCode = 1;
}

async function runEvolutionQuery(parsed) {
  const output = await queryEvolutionLedger(repoRootFrom(parsed), { track: parsed.options.track, since: parsed.options.since, invariantId: parsed.options.invariant });
  printStructured(output, parsed, (value) => `EVOLUTION QUERY: ${value.events.length} events, ${value.invariants.length} invariants, ${value.evidence.length} evidence records`);
}

async function runEvolutionDiff(parsed) {
  const output = await diffEvolutionLedger(repoRootFrom(parsed), requireOption(parsed, "from"), requireOption(parsed, "to"));
  printStructured(output, parsed, (value) => `EVOLUTION DIFF ${value.from}..${value.to}: ${value.events.length} material events`);
}

async function runEvolutionMateriality(parsed) {
  const output = await checkEvolutionMateriality(repoRootFrom(parsed), requireOption(parsed, "from"), requireOption(parsed, "to"));
  printStructured(output, parsed, (value) =>
    `EVOLUTION MATERIALITY ${value.passed ? "PASS" : "BLOCKED"}: ${value.materialFiles.length} material files, ${value.events.length} recorded events, ${value.deferredReviews.length} proof-backed deferred reviews`);
  if (!output.passed) process.exitCode = 1;
}

async function runEvolutionDeferReview(parsed) {
  const uiMedia = optionList(parsed, "ui-media");
  if (uiMedia.length > 0 && parsed.options["ui-not-applicable"]) {
    throw new Error("choose either --ui-media or --ui-not-applicable, not both");
  }
  const before = [
    { ref: requireOption(parsed, "before-live"), kind: "live-io" },
    ...optionList(parsed, "before-ci").map((ref) => ({ ref, kind: "ci-log" })),
    ...optionList(parsed, "authority-directive").map((ref) => ({ ref, kind: "operator-directive" })),
  ];
  const after = [
    { ref: requireOption(parsed, "after-live"), kind: "live-io" },
    { ref: requireOption(parsed, "journey-card"), kind: "journey-card" },
    ...optionList(parsed, "after-test").map((ref) => ({ ref, kind: "test-log" })),
    ...uiMedia.map((ref) => ({
      ref,
      kind: /\.(?:gif|mp4|webm|mov)$/iu.test(ref) ? "ui-clip" : "ui-screenshot",
    })),
  ];
  const output = await createDeferredEvolutionReview(repoRootFrom(parsed), {
    draftRefs: optionList(parsed, "drafts"),
    from: requireOption(parsed, "from"),
    to: requireOption(parsed, "to"),
    rollbackTarget: requireOption(parsed, "rollback"),
    before,
    after,
    uiChanged: uiMedia.length > 0,
    uiReason: parsed.options["ui-not-applicable"],
    rollbackVerificationRefs: optionList(parsed, "rollback-verification"),
    authorityDirectiveRef: parsed.options["authority-directive"],
    feedbackChannel: parsed.options["feedback-channel"],
  });
  printStructured(output, parsed, (value) =>
    `DEFERRED REVIEW ${value.receipt.id}: ${value.receipt.coverage.materialFiles.length} material files, ${value.receipt.events.length} agent-proposed events, exact before/after evidence bound`);
}

async function runEvolutionBuildDocs(parsed) {
  const output = await buildEvolutionDocs(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `BUILT ${value.output} with ${value.adoptionMap.length} adoption records`);
}

async function runEvolutionSyncGraph(parsed) {
  const output = await proposeEvolutionKnowledgePatch(repoRootFrom(parsed), { graphPath: parsed.options["graph-path"] });
  printStructured({ ...output, proposalOnly: true }, parsed, (value) => `PROPOSED EVOLUTION KNOWLEDGE ${value.patch.patchId}; approval is still required`);
}

function repoRootFrom(parsed) {
  return path.resolve(String(parsed.options["repo-root"] ?? process.cwd()));
}

async function runHarnessInit(parsed) {
  const root = repoRootFrom(parsed);
  const output = await initializeHarness(root);
  if (parsed.options.json) console.log(JSON.stringify({ ...output, passed: true }, null, 2));
  else {
    console.log(`INITIALIZED Harness Gym for ${output.applicationId}`);
    console.log(`  ${output.created.length} files created; existing files preserved`);
    console.log("  Frontend Gym initialized with an unprofiled evidence-ranked route and three-direction contract");
    console.log("  automatic promotion disabled; no model capability claims were created");
  }
}

async function runBuilderGymInit(parsed) {
  const output = await initializeBuilderGym(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `INITIALIZED Builder Gym for ${value.applicationId}; evaluator ${value.evaluatorHash.slice(0, 12)}; promotion disabled`);
}

async function runBuilderGymEvaluate(parsed) {
  const output = await evaluateBuilderGym(repoRootFrom(parsed), {
    baseline: requireOption(parsed, "baseline"),
    candidate: requireOption(parsed, "candidate"),
    lock: requireOption(parsed, "lock"),
    expectedLockHash: requireOption(parsed, "expected-lock-hash"),
  });
  printStructured(output, parsed, (value) => `BUILDER GYM ${value.passed ? "PASS" : "REGRESSION"}: ${value.outcome}; real-world claim and promotion not authorized`);
  if (!output.passed) process.exitCode = 1;
}

async function runBuilderGymLock(parsed) {
  const output = await createBuilderGymLock(repoRootFrom(parsed), requireOption(parsed, "baseline"));
  printStructured(output, parsed, (value) => `LOCKED Builder Gym baseline ${value.baselineTrajectoryHash.slice(0, 12)}; evaluator ${value.evaluatorHash.slice(0, 12)}`);
}

async function runBuilderGymStatus(parsed) {
  const output = await builderGymStatus(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `BUILDER GYM: ${value.trajectoryCount} trajectories, ${value.lockCount} locks, ${value.verdictCount} verdicts, ${value.protectedTaskCount} protected tasks; real-world evidence absent`);
}

async function runBuilderGymInspect(parsed) {
  const output = await inspectBuilderGymVerdict(repoRootFrom(parsed), requireOption(parsed, "ref"));
  printStructured(output, parsed, (value) => `BUILDER GYM VERDICT VERIFIED ${value.verdict.comparisonId}; promotion not authorized`);
}

async function runTrajectoryRecord(parsed) {
  const output = await recordNodeTraceTrajectory(repoRootFrom(parsed), requireOption(parsed, "file"));
  printStructured(output, parsed, (value) => `RECORDED ${value.trajectory.trajectoryId}; protected evaluator ${value.evaluatorHash.slice(0, 12)}`);
}

async function runTrajectoryInspect(parsed) {
  const output = await inspectNodeTraceTrajectory(repoRootFrom(parsed), requireOption(parsed, "ref"));
  printStructured(output, parsed, (value) => `NODETRACE VERIFIED ${value.trajectory.trajectoryId}; seven verdict dimensions present`);
}

async function runModelsBaseline(parsed) {
  const { receipt, output } = await writeModelBaseline(repoRootFrom(parsed));
  if (parsed.options.json) console.log(JSON.stringify({ ...receipt, output, passed: true }, null, 2));
  else {
    console.log(`BASELINED ${receipt.applicationId}: ${receipt.observationCount} observations, ${receipt.capabilityCardCount} cards`);
    console.log(`  status ${receipt.status}; provider calls 0; routing not certified`);
    console.log(`  receipt ${output}`);
  }
}

async function runModelsProfile(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed));
  const output = { ...compiled.registry, passed: true };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(`PROFILED ${output.applicationId}: ${output.observations} observations, ${output.cards.length} evidence-backed cards (${output.status})`);
}

async function runModelsInspect(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed), { write: false });
  const output = {
    applicationId: compiled.harness.applicationId,
    harnessVersion: compiled.harness.version,
    harnessHash: compiled.resolved.harnessHash,
    benchmarkHash: compiled.resolved.benchmarkHash,
    status: compiled.registry.status,
    observationCount: compiled.observations.length,
    cards: compiled.cards.map((card) => ({
      confidence: card.confidence,
      model: card.model,
      scope: card.scope,
      status: card.status,
    })),
    routingCertified: false,
    automaticPromotion: false,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${output.applicationId} Harness ${output.harnessVersion}: ${output.status}`);
    console.log(`  observations ${output.observationCount}; cards ${output.cards.length}`);
    console.log("  routing uncertified; automatic promotion disabled");
    for (const card of output.cards) console.log(`  ${card.scope.level} ${card.model.resolvedProvider}/${card.model.resolvedModel}: ${card.status}, ${card.confidence.level} confidence`);
  }
}

async function runModelsDiagnose(parsed) {
  const compiled = await compileModelIntelligence(repoRootFrom(parsed), { write: false });
  const clusters = diagnoseModelFailures(compiled.observations);
  const output = {
    schemaVersion: "nodekit.model-diagnosis/v1",
    applicationId: compiled.harness.applicationId,
    observationCount: compiled.observations.length,
    clusters,
    skillCandidates: clusters.filter((cluster) => cluster.skillCandidateEligible).length,
    passed: true,
  };
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`DIAGNOSED ${output.applicationId}: ${clusters.length} failure clusters, ${output.skillCandidates} eligible for skill-candidate review`);
    for (const cluster of clusters) console.log(`  ${cluster.count}x ${cluster.failureClass} (${cluster.probableCause}) ${cluster.model}${cluster.skillCandidateEligible ? " [candidate threshold met]" : ""}`);
  }
}

function requireOption(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") throw new Error(`--${name} is required`);
  return String(value);
}

function printStructured(output, parsed, textSummary) {
  if (parsed.options.json) console.log(JSON.stringify(output, null, 2));
  else console.log(textSummary(output));
}

const MAX_NATIVE_MIGRATION_FILE_BYTES = 1_048_576;

async function readBoundedJson(file, label) {
  const absolute = path.resolve(file);
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new Error(`${label} must be a file`);
  if (metadata.size > MAX_NATIVE_MIGRATION_FILE_BYTES) {
    throw new Error(
      `${label} exceeds ${MAX_NATIVE_MIGRATION_FILE_BYTES} bytes`,
    );
  }
  let value;
  try {
    value = JSON.parse(await readFile(absolute, "utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
  return { absolute, value };
}

async function runNativeSessionMigration(parsed) {
  const mode = String(parsed.options.mode ?? "dry-run");
  if (!["dry-run", "apply", "verify", "retire"].includes(mode)) {
    throw new Error("--mode must be dry-run, apply, verify, or retire");
  }
  const input = mode === "verify"
    ? null
    : await readBoundedJson(requireOption(parsed, "input"), "--input");
  const outputPath = parsed.options.output === undefined
    ? null
    : path.resolve(String(parsed.options.output));

  if (mode === "verify") {
    if (!outputPath) throw new Error("--output is required for verify");
    const bundle = await readBoundedJson(outputPath, "--output");
    const verification = verifyLegacySessionMigration(bundle.value);
    printStructured(
      verification,
      parsed,
      (value) =>
        `NATIVE MIGRATION VERIFY ${value.passed ? "PASS" : "FAIL"} ${value.bundleDigest}`,
    );
    if (!verification.passed) process.exitCode = 1;
    return;
  }

  const bundle = planLegacySessionMigration(input.value);
  if (mode === "dry-run") {
    printStructured(
      bundle,
      parsed,
      (value) =>
        `NATIVE MIGRATION DRY RUN ${value.bundleDigest}: ${value.outcomes.length} records, ${value.artifacts.length} canonical artifacts; legacy source unchanged`,
    );
    return;
  }
  if (!outputPath) throw new Error(`--output is required for ${mode}`);

  if (mode === "apply") {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(bundle, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const persisted = await readBoundedJson(outputPath, "--output");
    const verification = verifyLegacySessionMigration(persisted.value);
    if (!verification.passed) {
      throw new Error(
        `persisted migration bundle failed verification: ${verification.findings.join("; ")}`,
      );
    }
    printStructured(
      { ...verification, mode, output: outputPath },
      parsed,
      (value) =>
        `NATIVE MIGRATION APPLIED ${value.bundleDigest}; verified bundle ${value.output}; legacy source unchanged`,
    );
    return;
  }

  const persisted = await readBoundedJson(outputPath, "--output");
  const verification = verifyLegacySessionMigration(persisted.value);
  if (!verification.passed) {
    throw new Error(
      `migration bundle is not verified: ${verification.findings.join("; ")}`,
    );
  }
  if (persisted.value.bundleDigest !== bundle.bundleDigest) {
    throw new Error("migration bundle does not match the current legacy source");
  }
  const confirmation = requireOption(parsed, "confirm-bundle-digest");
  if (confirmation !== bundle.bundleDigest) {
    throw new Error("--confirm-bundle-digest does not match the verified bundle");
  }
  const rollbackPath = path.resolve(requireOption(parsed, "rollback"));
  if (
    rollbackPath === input.absolute
    || rollbackPath === outputPath
    || input.absolute === outputPath
  ) {
    throw new Error("--input, --output, and --rollback must be distinct paths");
  }
  if (await pathExists(rollbackPath)) {
    throw new Error("--rollback already exists; refusing to overwrite recovery data");
  }
  await mkdir(path.dirname(rollbackPath), { recursive: true });
  await rename(input.absolute, rollbackPath);
  printStructured(
    {
      ...verification,
      mode,
      retiredInput: input.absolute,
      rollback: rollbackPath,
    },
    parsed,
    (value) =>
      `NATIVE MIGRATION RETIRED ${value.bundleDigest}; legacy source moved to recoverable rollback ${value.rollback}`,
  );
}

async function runSkillsPropose(parsed) {
  const output = await proposeSkillCandidates(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `PROPOSED ${value.candidates.length} evidence-backed skill candidates; none promoted`);
}

async function runSkillsReview(parsed) {
  const output = await reviewSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"));
  printStructured(output, parsed, (value) => `REVIEWED ${value.candidate.candidateId}: ${value.candidate.status} (${value.skill.id}@${value.skill.version})`);
}

async function runSkillsBenchmark(parsed) {
  const output = await benchmarkSkillCandidate(
    repoRootFrom(parsed),
    requireOption(parsed, "candidate"),
    requireOption(parsed, "comparison"),
  );
  printStructured(output, parsed, (value) => `BENCHMARK ${value.passed ? "PASS" : "FAIL"} ${value.candidateId}; meaningful improvement ${value.meaningfulImprovement}`);
  if (!output.passed) process.exitCode = 1;
}

async function runSkillsPromote(parsed) {
  const output = await promoteSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"), {
    approvalPath: requireOption(parsed, "approval"),
    canaryPath: requireOption(parsed, "canary"),
    proofPath: requireOption(parsed, "proof-receipt"),
  });
  printStructured(output, parsed, (value) => `PROMOTED ${value.promotion.candidateId} to ${value.nextVersion}; rollback ${value.promotion.rollbackVersion}`);
}

async function runSkillsReject(parsed) {
  const output = await rejectSkillCandidate(repoRootFrom(parsed), requireOption(parsed, "candidate"), requireOption(parsed, "reason"));
  printStructured(output, parsed, (value) => `REJECTED ${value.candidateId}: ${value.reason}`);
}

async function runRoutingCompile(parsed) {
  const output = await compileRoutingPolicy(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `COMPILED provisional routing policy with ${value.routes.length} task-family routes; promotion not authorized`);
}

async function runRoutingCanary(parsed) {
  const output = await verifyCanary(repoRootFrom(parsed), requireOption(parsed, "receipt"));
  printStructured(output, parsed, (value) => `CANARY PASS ${value.receiptId} for ${value.candidateId}; trusted evaluator ${value.trustedKeyId}`);
}

async function runHarnessTournament(parsed) {
  const output = await evaluateTournament(repoRootFrom(parsed), requireOption(parsed, "manifest"));
  printStructured(output, parsed, (value) => `TOURNAMENT ${value.tournamentId}: ${value.decisive ? `provisional winner ${value.winner}` : "no decisive winner"}; promotion not authorized`);
}

async function runHarnessStatus(parsed) {
  const output = await harnessStatus(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `HARNESS ${value.version}: ${value.observations} observations, ${value.capabilityCards} cards, ${value.skillCandidates.length} candidates; Builder Gym ${value.builderGym.trajectories} trajectories; routing uncertified`);
}

async function runHarnessRollback(parsed) {
  const output = await rollbackHarness(repoRootFrom(parsed));
  printStructured(output, parsed, (value) => `ROLLED BACK ${value.from} -> ${value.to}; version history preserved`);
}

async function runHarnessGate(parsed) {
  const output = await harnessStatus(repoRootFrom(parsed));
  const checks = {
    activeVersionPromoted: /^h[1-9]\d*$/.test(output.version),
    automaticPromotionDisabled: output.automaticPromotion === false,
    benchmarkBound: typeof output.benchmarkHash === "string" && output.benchmarkHash.length === 64,
    builderGymMechanicsReady: output.builderGym.mechanicsReady === true,
    builderGymPromotionDisabled: output.builderGym.automaticPromotion === false && output.builderGym.promotionAuthorized === false,
    noOpenCandidates: output.skillCandidates.every((entry) => !["proposed", "reviewed", "benchmark-passed"].includes(entry.status)),
    routingCertified: output.routingCertified === true,
  };
  const result = { ...output, checks, passed: Object.values(checks).every(Boolean), schemaVersion: "nodekit.harness-gate/v1" };
  printStructured(result, parsed, (value) => `HARNESS GATE ${value.passed ? "PASS" : "BLOCKED"} ${value.version}`);
  if (!result.passed) process.exitCode = 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [first, second, third] = parsed.positional;
  if (!first || first === "help" || first === "--help") {
    printHelp();
    return;
  }
  if (["dev", "demo", "check", "proof"].includes(first)) {
    await runLifecycle(first, parsed);
    return;
  }
  if (first === "create") {
    await runCreate(parsed);
    return;
  }
  if (first === "adopt") {
    await runAdopt(parsed);
    return;
  }
  if (first === "audience" && second === "check") {
    const { evaluateAudienceRecord, readAudienceRecord } = await import("./lib/audience-contract.mjs");
    const file = path.resolve(parsed.options.record ?? parsed.positional[2] ?? "audience-research.json");
    const { record, present } = await readAudienceRecord(file);
    const verdict = evaluateAudienceRecord(record);
    if (parsed.options.json) console.log(JSON.stringify({ ...verdict, present, file }, null, 2));
    else if (verdict.passed) console.log(`AUDIENCE PASS: ${record.audience.organisation} — researched before the design was decided.`);
    else console.log(["AUDIENCE BLOCKED:", ...verdict.faults.map((f) => `  ${f}`)].join("\n"));
    if (!verdict.passed) process.exitCode = 1;
    return;
  }
  if (first === "production" && (second === "check" || second === undefined)) {
    const { evaluateProductionReadiness, formatProductionReadiness } = await import("./lib/production-gate.mjs");
    const file = path.resolve(parsed.options.record ?? "production-readiness.json");
    let record = null;
    try {
      record = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // No record is not a pass. Seven questions nobody asked is seven NOT_RUNs.
    const verdict = record
      ? evaluateProductionReadiness(record)
      : { releasable: false, blockers: [`no ${path.basename(file)}; every production check is unasked, and an unasked question is NOT_RUN`], checked: 7, passed: 0, waived: 0 };
    console.log(parsed.options.json ? JSON.stringify(verdict, null, 2) : formatProductionReadiness(verdict));
    if (!verdict.releasable) process.exitCode = 1;
    return;
  }
  if (first === "deferrals" && (second === "check" || second === undefined)) {
    const { evaluateDeferrals, formatDeferrals, readDeferrals } = await import("./lib/deferrals.mjs");
    const repoRoot = path.resolve(parsed.options["repo-root"] ?? ".");
    const ledger = await readDeferrals(repoRoot);
    const verdict = evaluateDeferrals(ledger);
    console.log(parsed.options.json ? JSON.stringify({ ...verdict, present: ledger.present }, null, 2) : formatDeferrals(ledger, verdict));
    if (!verdict.passed) process.exitCode = 1;
    return;
  }
  if (first === "reproduce") {
    const { produceReplayPacket, reproduce, writeReplayPacket } = await import("./lib/replay-packet-producer.mjs");
    const { formatReplayVerdict } = await import("./lib/replay-packet.mjs");
    const repoRoot = path.resolve(parsed.options["repo-root"] ?? ".");
    const packet = await produceReplayPacket({
      repoRoot,
      runId: parsed.options.run ?? `run-${Date.now().toString(36)}`,
      originalPrompt: parsed.options.prompt ?? "",
      resolvedPrompt: parsed.options["resolved-prompt"],
      agent: parsed.options.agent ?? "unknown-agent",
      model: parsed.options.model ?? "unknown-model",
    });
    // --fresh-worktree is not a flag that asserts a fresh worktree; it is the flag that CREATES one
    // and runs the command there. Without a command there is nothing to replay and the packet
    // honestly stays at PROMPT_REPLAYABLE.
    const replayed = parsed.options.command
      ? await reproduce({ repoRoot, packet, command: parsed.options.command })
      : { packet, verdict: { passed: true, claimed: packet.reproduction.levelClaimed, earned: packet.reproduction.levelClaimed, faults: [] } };
    if (parsed.options.out) await writeReplayPacket(repoRoot, replayed.packet, path.dirname(parsed.options.out));

    // The two documents a person actually opens. Generated, never authored: a hand-written
    // RECREATE.md drifts from the packet and then reads with more authority than the receipt it
    // contradicts.
    if (parsed.options.book) {
      const { renderPromptBook, renderRecreate } = await import("./lib/replay-book.mjs");
      const dir = path.resolve(parsed.options.book);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "PROMPT_BOOK.md"), renderPromptBook(replayed.packet), "utf8");
      await writeFile(path.join(dir, "RECREATE.md"), renderRecreate(replayed.packet), "utf8");
      console.error(`wrote PROMPT_BOOK.md and RECREATE.md to ${dir}`);
    }
    console.log(parsed.options.json ? JSON.stringify(replayed.packet, null, 2) : formatReplayVerdict(replayed.verdict));
    if (!replayed.verdict.passed) process.exitCode = 1;
    return;
  }
  if (first === "preflight") {
    const { evaluatePreflight, formatPreflight, readHarnessManifest } = await import("./lib/preflight.mjs");
    const repoRoot = path.resolve(parsed.options["repo-root"] ?? ".");
    const manifest = await readHarnessManifest(repoRoot);
    // Session start is explicit rather than guessed: the whole restart rule turns on whether the
    // install predates the session, and inferring that from process uptime would quietly answer a
    // question the caller is the only one who actually knows.
    const verdict = evaluatePreflight(manifest, {
      sessionStartedAt: parsed.options["session-started-at"] ?? new Date().toISOString(),
    });
    // Skill freshness rides along with preflight rather than getting its own verb, because
    // preflight already runs in every generated project's `check` and a gate nobody invokes is the
    // problem this whole session has been about. The projected skills ARE the agent's instructions;
    // a project reading a superseded copy is a preflight fact by any reasonable reading.
    const { evaluateSkillFreshness, formatSkillFreshness } = await import("./lib/skill-freshness.mjs");
    let installedVersion = null;
    for (const candidate of ["vendor/nodekit/package.json", "node_modules/@homenshum/nodekit/package.json", "package.json"]) {
      try {
        const pkg = JSON.parse(await readFile(path.join(repoRoot, candidate), "utf8"));
        if (pkg.name === "@homenshum/nodekit" && typeof pkg.version === "string") { installedVersion = pkg.version; break; }
      } catch { /* absent is not an error; it leaves the skew question unanswered rather than answered no */ }
    }
    const skills = await evaluateSkillFreshness(repoRoot, installedVersion);

    // Same reasoning as the skills above, and the third surface today with this shape. The code
    // graph is what an agent consults during implementation — "what calls this, what imports it" —
    // and it is commit-pinned by design. The pin worked; nothing ever mentioned it, so the graph
    // aged 201 commits while still answering confidently.
    const { evaluateCodeGraphFreshness, formatCodeGraphFreshness } = await import("./lib/code-graph-freshness.mjs");
    const codeGraph = await evaluateCodeGraphFreshness(repoRoot);

    console.log(parsed.options.json
      ? JSON.stringify({ ...verdict, present: manifest.present, skills, codeGraph }, null, 2)
      : `${formatPreflight(verdict)}\n${formatSkillFreshness(skills)}\n${formatCodeGraphFreshness(codeGraph)}`);
    // Skew and unrecorded provenance are reported, never fatal. A project legitimately pins an old
    // skill or predates the record, and failing preflight over it would train people to skip
    // preflight — which costs more than the drift it was catching.
    if (!verdict.passed) process.exitCode = 1;
    return;
  }
  if (first === "explain") {
    const { explainFor, formatExplanation, STACKS } = await import("./lib/nodekit-surfaces.mjs");
    const stack = parsed.options.for ?? parsed.positional[1] ?? "any";
    let explanation;
    try {
      explanation = explainFor(String(stack));
    } catch (error) {
      if (error.code !== "UNKNOWN_STACK") throw error;
      console.error(`${error.message}\nUsage: nodekit explain --for <${STACKS.join("|")}> [--json]`);
      process.exitCode = 2;
      return;
    }
    console.log(parsed.options.json ? JSON.stringify(explanation, null, 2) : formatExplanation(explanation));
    return;
  }
  if (first === "compile") {
    await runCompile(parsed);
    return;
  }
  if (first === "inspect") {
    await runInspect(parsed);
    return;
  }
  if (first === "doctor") {
    await runDoctor(parsed);
    return;
  }
  if (first === "agent" && second === "run") {
    const allowedOptions = new Set([
      "agent",
      "goal",
      "json",
      "out",
      "timeout-ms",
    ]);
    const unknownOptions = Object.keys(parsed.options)
      .filter((name) => !allowedOptions.has(name))
      .sort();
    if (unknownOptions.length > 0) {
      throw new Error(`unknown agent run option: --${unknownOptions[0]}`);
    }
    if (parsed.positional.length !== 2) {
      throw new Error("agent run accepts no positional values before --");
    }
    const [program, ...args] = parsed.commandArgs;
    if (!program) throw new Error("a program is required after the -- separator");
    if (parsed.options.out === true) throw new Error("--out requires a directory");
    if (parsed.options["timeout-ms"] === true) {
      throw new Error("--timeout-ms requires an integer");
    }
    const output = await runAgent({
      agent: parsed.options.agent,
      args,
      cwd: process.cwd(),
      goal: parsed.options.goal,
      out: parsed.options.out,
      program,
      timeoutMs: parsed.options["timeout-ms"],
    });
    if (parsed.options.json) {
      console.log(
        JSON.stringify({
          ...output.receipt,
          artifactPaths: {
            receipt: output.receiptPath,
            report: output.reportPath,
          },
        }, null, 2),
      );
    } else {
      const receipt = output.receipt;
      const label = receipt.status === "completed"
        ? "SUCCESS"
        : receipt.status.toUpperCase();
      const pathLine = receipt.status === "completed"
        ? "accepted -> ran -> completed -> evidence saved"
        : receipt.status === "timeout"
          ? "accepted -> ran -> timed out -> partial evidence saved"
          : "accepted -> ran -> failed -> evidence saved";
      console.log(`${label} | ${receipt.agent.label}`);
      console.log(
        `Exit ${receipt.process.exitCode ?? "none"} | ${receipt.durationMs} ms | stdout ${receipt.io.stdout.observedBytes} B | stderr ${receipt.io.stderr.observedBytes} B | kept ${receipt.io.stdout.retainedBytes + receipt.io.stderr.retainedBytes} B`,
      );
      console.log("");
      console.log(pathLine);
      console.log(receipt.outcome.summary);
      console.log("");
      console.log(`Report:  ${output.reportPath}`);
      console.log(`Receipt: ${output.receiptPath}`);
    }
    if (output.receipt.status === "timeout") process.exitCode = 124;
    else if (output.receipt.status === "failed") {
      process.exitCode = output.receipt.process.exitCode || 1;
    }
    return;
  }
  if (first === "certify") {
    await runCertify(parsed);
    return;
  }
  if (first === "repo" && second === "map") {
    await runRepoMap(parsed);
    return;
  }
  if (first === "behavior" && second === "index") {
    await runBehaviorIndex(parsed);
    return;
  }
  if (first === "motion" && second === "compare") {
    await runMotionCompare(parsed);
    return;
  }
  if (first === "journey" && second === "verify") {
    await runJourneyVerify(parsed);
    return;
  }
  if (first === "session" && second === "migrate-legacy") {
    await runNativeSessionMigration(parsed);
    return;
  }
  if (first === "journey" && second === "build-evidence") {
    await runJourneyBuildEvidence(parsed);
    return;
  }
  if (first === "regression" && second === "prove") {
    const { RegressionProofRefusal, formatRegressionProof, proveRegression } = await import("./lib/regression-proof.mjs");
    const root = path.resolve(parsed.options["repo-root"] ?? ".");
    const baseline = parsed.options.baseline;
    const raw = parsed.options.test;
    const testFiles = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    if (typeof baseline !== "string" || testFiles.length === 0) {
      console.error("usage: nodekit regression prove --baseline <commit> --test <file> [--test <file>...] [--repo-root <path>]");
      process.exitCode = 2;
      return;
    }
    try {
      const verdict = proveRegression(root, {
        baseline,
        testFiles,
        namePattern: typeof parsed.options.name === "string" ? parsed.options.name : undefined,
        worktreeDir: path.join(root, "..", `.nodekit-regression-${process.pid}`),
        // Real test files import real dependencies; the throwaway checkout has none of its own.
        copyNodeModules: true,
      });
      printStructured(verdict, parsed, formatRegressionProof);
      // Only a full proof exits clean. An unproven test and a run that never happened are both
      // "this has not been demonstrated", and exiting 0 on either is how the check becomes a ritual.
      if (verdict.status !== "proven") process.exitCode = 1;
    } catch (error) {
      if (error instanceof RegressionProofRefusal) {
        console.error(`REGRESSION PROOF REFUSED\n${error.refusals.map((entry) => `  - ${entry}`).join("\n")}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    return;
  }
  if (first === "sessions" && second === "check") {
    await runSessionsCheck(parsed);
    return;
  }
  if (first === "capability" && (second === "settle" || second === "declare")) {
    await runCapability(parsed, second);
    return;
  }
  if (first === "journey" && second === "story-pack") {
    await runJourneyStoryPack(parsed);
    return;
  }
  if (first === "tour") {
    await runTour(parsed);
    return;
  }
  if (first === "copy" && second === "audit") {
    const root = path.resolve(parsed.options["repo-root"] ?? ".");
    const result = await auditCopy(root);
    printStructured(result, parsed, (value) =>
      value.passed
        ? `COPY AUDIT PASS: ${value.vocabularySize} terms defined and reachable across ${value.auditedFiles.length} surfaces.`
        : `COPY AUDIT BLOCKED: ${value.findings.length} findings.\n${value.findings.map((f) => `  ${f.file}: ${f.detail}`).join("\n")}`,
    );
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (first === "repo" && second === "check") {
    const result = await checkOne(parsed.options);
    printResult(result, parsed.options.json);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (first === "registry" && second === "check") {
    await runRegistryCheck(parsed);
    return;
  }
  if (first === "ecosystem" && second === "check") {
    await runEcosystemCheck(parsed);
    return;
  }
  if (first === "dashboard") {
    await runDashboard(parsed);
    return;
  }
  if (first === "governance" && second === "visualize") {
    await runGovernanceVisualize(parsed);
    return;
  }
  if (first === "graph" && second === "import") {
    await runGraphImport(parsed);
    return;
  }
  if (first === "graph" && second === "init") {
    await runGraphInit(parsed);
    return;
  }
  if (first === "graph" && second === "ingest") {
    await runGraphIngest(parsed);
    return;
  }
  if (first === "graph" && second === "evidence-ingest") {
    await runGraphEvidenceIngest(parsed);
    return;
  }
  if (first === "graph" && second === "evidence-verify") {
    await runGraphEvidenceVerify(parsed);
    return;
  }
  if (first === "graph" && second === "inspect") {
    await runGraphInspect(parsed);
    return;
  }
  if (first === "graph" && second === "query") {
    await runGraphQuery(parsed);
    return;
  }
  if (first === "graph" && second === "gaps") {
    await runGraphGaps(parsed);
    return;
  }
  if (first === "graph" && second === "research") {
    await runGraphResearch(parsed);
    return;
  }
  if (first === "graph" && second === "propose") {
    await runGraphPropose(parsed);
    return;
  }
  if (first === "graph" && second === "validate") {
    await runGraphValidate(parsed);
    return;
  }
  if (first === "graph" && second === "apply") {
    await runGraphApply(parsed);
    return;
  }
  if (first === "graph" && second === "diff") {
    await runGraphDiff(parsed);
    return;
  }
  if (first === "graph" && second === "replay") {
    await runGraphReplay(parsed);
    return;
  }
  if (first === "graph" && second === "benchmark") {
    await runGraphBenchmark(parsed);
    return;
  }
  if (first === "graph" && second === "harness-sync") {
    await runGraphHarnessSync(parsed);
    return;
  }
  if (first === "frontend" && second === "init") {
    await runFrontendInit(parsed);
    return;
  }
  if (first === "frontend" && second === "plan") {
    await runFrontendPlan(parsed);
    return;
  }
  if (first === "frontend" && second === "directions") {
    await runFrontendDirections(parsed);
    return;
  }
  if (first === "frontend" && second === "benchmark") {
    await runFrontendBenchmark(parsed);
    return;
  }
  if (first === "frontend" && second === "repair") {
    await runFrontendRepair(parsed);
    return;
  }
  if (first === "frontend" && second === "canary") {
    await runFrontendCanary(parsed);
    return;
  }
  if (first === "atlas" && second === "init") {
    await runAtlasInit(parsed);
    return;
  }
  if (first === "atlas" && second === "add") {
    await runAtlasAdd(parsed);
    return;
  }
  if (first === "atlas" && second === "list") {
    await runAtlasList(parsed);
    return;
  }
  if (first === "atlas" && second === "inspect") {
    await runAtlasInspect(parsed);
    return;
  }
  if (first === "atlas" && second === "search") {
    await runAtlasSearch(parsed);
    return;
  }
  if (first === "atlas" && second === "preview") {
    await runAtlasPreview(parsed);
    return;
  }
  if (first === "atlas" && second === "recipe") {
    await runAtlasRecipe(parsed);
    return;
  }
  if (first === "atlas" && second === "repair") {
    await runAtlasRepair(parsed);
    return;
  }
  if (first === "atlas" && second === "serve") {
    await runAtlasServe(parsed);
    return;
  }
  if (first === "atlas") {
    printAtlasUsage();
    if (second) process.exitCode = 1;
    return;
  }
  if (first === "evolution" && second === "init") {
    await runEvolutionInit(parsed);
    return;
  }
  if (first === "evolution" && second === "draft") {
    await runEvolutionDraft(parsed);
    return;
  }
  if (first === "evolution" && second === "approve") {
    await runEvolutionApprove(parsed);
    return;
  }
  if (first === "trust" && second === "init") {
    await runTrustInit(parsed);
    return;
  }
  if (first === "evolution" && second === "record") {
    await runEvolutionRecord(parsed);
    return;
  }
  if (first === "evolution" && second === "verify") {
    await runEvolutionVerify(parsed);
    return;
  }
  if (first === "evolution" && second === "query") {
    await runEvolutionQuery(parsed);
    return;
  }
  if (first === "evolution" && second === "diff") {
    await runEvolutionDiff(parsed);
    return;
  }
  if (first === "evolution" && second === "materiality") {
    await runEvolutionMateriality(parsed);
    return;
  }
  if (first === "evolution" && second === "defer-review") {
    await runEvolutionDeferReview(parsed);
    return;
  }
  if (first === "evolution" && second === "build-docs") {
    await runEvolutionBuildDocs(parsed);
    return;
  }
  if (first === "evolution" && second === "sync-graph") {
    await runEvolutionSyncGraph(parsed);
    return;
  }
  if (first === "harness" && second === "init") {
    await runHarnessInit(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "init") {
    await runBuilderGymInit(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "evaluate") {
    await runBuilderGymEvaluate(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "lock") {
    await runBuilderGymLock(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "status") {
    await runBuilderGymStatus(parsed);
    return;
  }
  if (first === "harness" && second === "builder" && third === "inspect") {
    await runBuilderGymInspect(parsed);
    return;
  }
  if (first === "harness" && second === "trajectory" && third === "record") {
    await runTrajectoryRecord(parsed);
    return;
  }
  if (first === "harness" && second === "trajectory" && third === "inspect") {
    await runTrajectoryInspect(parsed);
    return;
  }
  if (first === "models" && second === "baseline") {
    await runModelsBaseline(parsed);
    return;
  }
  if (first === "models" && second === "profile") {
    await runModelsProfile(parsed);
    return;
  }
  if (first === "models" && second === "inspect") {
    await runModelsInspect(parsed);
    return;
  }
  if (first === "models" && second === "diagnose") {
    await runModelsDiagnose(parsed);
    return;
  }
  if (first === "harness" && second === "baseline") {
    await runModelsBaseline(parsed);
    return;
  }
  if (first === "harness" && second === "inspect") {
    await runModelsInspect(parsed);
    return;
  }
  if (first === "harness" && second === "diagnose") {
    await runModelsDiagnose(parsed);
    return;
  }
  if (first === "harness" && second === "propose") {
    await runSkillsPropose(parsed);
    return;
  }
  if (first === "harness" && second === "benchmark") {
    await runSkillsBenchmark(parsed);
    return;
  }
  if (first === "harness" && second === "canary") {
    await runRoutingCanary(parsed);
    return;
  }
  if (first === "harness" && second === "review") {
    await runSkillsReview(parsed);
    return;
  }
  if (first === "harness" && second === "promote") {
    await runSkillsPromote(parsed);
    return;
  }
  if (first === "skills" && second === "sync") {
    const { syncCodingAgentSkills } = await import("./lib/scaffold.mjs");
    const root = path.resolve(parsed.options["repo-root"] ?? parsed.positional[2] ?? ".");
    const result = await syncCodingAgentSkills(root);
    printStructured(result, parsed, (value) => {
      const lines = [`SKILLS SYNCED to NodeKit ${value.version}`];
      if (value.added.length > 0) lines.push(`  added:   ${value.added.join(", ")}`);
      if (value.changed.length > 0) lines.push(`  replaced: ${value.changed.join(", ")}`);
      if (value.added.length === 0 && value.changed.length === 0) lines.push("  nothing changed; the copies already matched.");
      else lines.push("  A local edit to a projected skill is legitimate — this says what was overwritten so it is not discovered later.");
      return lines.join(String.fromCharCode(10));
    });
    return;
  }
  if (first === "skills" && second === "propose") {
    await runSkillsPropose(parsed);
    return;
  }
  if (first === "skills" && second === "review") {
    await runSkillsReview(parsed);
    return;
  }
  if (first === "skills" && second === "benchmark") {
    await runSkillsBenchmark(parsed);
    return;
  }
  if (first === "skills" && second === "promote") {
    await runSkillsPromote(parsed);
    return;
  }
  if (first === "skills" && second === "reject") {
    await runSkillsReject(parsed);
    return;
  }
  if (first === "routing" && second === "compile") {
    await runRoutingCompile(parsed);
    return;
  }
  if (first === "routing" && second === "canary") {
    await runRoutingCanary(parsed);
    return;
  }
  if (first === "harness" && second === "tournament") {
    await runHarnessTournament(parsed);
    return;
  }
  if (first === "harness" && second === "status") {
    await runHarnessStatus(parsed);
    return;
  }
  if (first === "harness" && second === "gate") {
    await runHarnessGate(parsed);
    return;
  }
  if (first === "harness" && second === "rollback") {
    await runHarnessRollback(parsed);
    return;
  }
  throw new Error(`unknown command: ${parsed.positional.join(" ")}`);
}

main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = error?.exitCode ?? 1;
});
