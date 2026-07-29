import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getExternalReferenceStatus,
  recordDesignRule,
  recordReferenceObservation,
  scoreReferenceCandidate,
  verifyReferenceScoreReceipt,
} from "./lib/reference-loop.mjs";

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }
  return { positional, options };
}

function requireOption(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new Error(`--${name} is required`);
  }
  return String(value);
}

function optionList(parsed, name) {
  const value = parsed.options[name];
  if (value === undefined || value === true || String(value).trim() === "") return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function repoRootFrom(parsed) {
  return path.resolve(parsed.options["repo-root"] === true
    ? "."
    : parsed.options["repo-root"] ?? ".");
}

async function readJsonInput(repoRoot, candidate, label) {
  const absolute = path.resolve(repoRoot, candidate);
  const relative = path.relative(repoRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} file must stay inside the repository`);
  }
  try {
    const bytes = await readFile(absolute);
    if (bytes.length > 1024 * 1024) throw new Error("exceeds 1048576 bytes");
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} file is invalid JSON: ${relative}: ${error.message}`);
  }
}

function printStructured(output, parsed, summary) {
  console.log(parsed.options.json
    ? JSON.stringify(output, null, 2)
    : summary(output));
}

function printUsage() {
  console.log(`nodekit reference <sub>

  nodekit reference observe --file <observation.json> [--repo-root <path>] [--json]
  nodekit reference rule --file <rule.json> [--repo-root <path>] [--json]
  nodekit reference score --candidate-receipt <render-receipt.json> --rules <comma-list> --profile <id> [--repo-root <path>] [--json]
  nodekit reference verify --score <score-receipt.json> --candidate-receipt <render-receipt.json> [--repo-root <path>] [--json]
  nodekit reference status --provider mobbin [--repo-root <path>] [--json]`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [, subcommand] = parsed.positional;
  const repoRoot = repoRootFrom(parsed);

  if (subcommand === "observe") {
    const input = await readJsonInput(repoRoot, requireOption(parsed, "file"), "reference observation");
    const output = await recordReferenceObservation(repoRoot, input);
    printStructured(output, parsed, (value) => `RECORDED ${value.observation.observationId}`);
    return;
  }
  if (subcommand === "rule") {
    const input = await readJsonInput(repoRoot, requireOption(parsed, "file"), "design rule");
    const output = await recordDesignRule(repoRoot, input);
    printStructured(output, parsed, (value) => `RECORDED ${value.rule.ruleId}`);
    return;
  }
  if (subcommand === "score") {
    const candidateReceipt = await readJsonInput(
      repoRoot,
      requireOption(parsed, "candidate-receipt"),
      "candidate receipt",
    );
    const output = await scoreReferenceCandidate(repoRoot, {
      candidateReceipt,
      profile: requireOption(parsed, "profile"),
      ruleIds: optionList(parsed, "rules"),
    });
    printStructured(output, parsed, (value) =>
      `REFERENCE ${value.score.verdict.toUpperCase()} ${value.score.receiptId}`);
    if (output.score.verdict !== "pass") process.exitCode = 1;
    return;
  }
  if (subcommand === "verify") {
    const candidateReceipt = await readJsonInput(
      repoRoot,
      requireOption(parsed, "candidate-receipt"),
      "candidate receipt",
    );
    const output = await verifyReferenceScoreReceipt(
      repoRoot,
      requireOption(parsed, "score"),
      { candidateReceipt },
    );
    printStructured(output, parsed, (value) => `REFERENCE ${value.verdict.toUpperCase()}`);
    if (output.verdict !== "pass") process.exitCode = 1;
    return;
  }
  if (subcommand === "status") {
    const output = await getExternalReferenceStatus(
      repoRoot,
      requireOption(parsed, "provider"),
    );
    printStructured(output, parsed, (value) =>
      `${value.provider.toUpperCase()} ${value.status.toUpperCase()}`);
    if (output.status !== "pass") process.exitCode = 1;
    return;
  }
  printUsage();
  if (subcommand) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = error?.exitCode ?? 1;
});
