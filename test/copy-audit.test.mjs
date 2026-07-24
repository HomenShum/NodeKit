import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VOCABULARY, auditCopy } from "../src/lib/copy-audit.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function corpus(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-copy-"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, name), body, "utf8");
  return root;
}

// Persona: a maintainer adding a page for newcomers. The audit's job is to stop them shipping
// words a newcomer cannot decode — the exact failure the cold-start baseline measured (F2:
// 11 undefined terms in the first five lines of README.md).
test("the real repository's newcomer surfaces define their own jargon", async () => {
  const result = await auditCopy(REPO);
  assert.equal(result.schemaVersion, "nodekit.copy-audit/v1");
  assert.deepEqual(result.undefinedTerms, [], "every vocabulary term must be defined in GLOSSARY.md");
  assert.deepEqual(result.findings, [], `copy audit findings: ${JSON.stringify(result.findings, null, 2)}`);
  assert.equal(result.passed, true);
});

// A green audit is worthless unless it can go red. Each case below MUST fail.
// @nodekit-verifies language.copy-audit#undefined-term-blocks
test("the audit fails when user-facing copy uses a NodeKit term the glossary never defines", async () => {
  const root = await corpus({
    "GLOSSARY.md": "# Glossary\n\nNothing is defined here yet.\n",
    "START_HERE.md": "# Start\n\nNodeKit is domain-blank and proof-carrying. See GLOSSARY.md.\n",
  });
  const result = await auditCopy(root, { files: ["START_HERE.md", "GLOSSARY.md"] });
  assert.equal(result.passed, false, "undefined jargon must block");
  const terms = result.findings.filter((f) => f.kind === "undefined-term").map((f) => f.term);
  assert.ok(terms.includes("domain-blank"), "must flag domain-blank");
  assert.ok(terms.includes("proof-carrying"), "must flag proof-carrying");
  await rm(root, { recursive: true, force: true });
});

// @nodekit-verifies language.copy-audit#unreachable-glossary-blocks
test("the audit fails when copy defines its terms but never tells the reader where the definitions are", async () => {
  const glossary = `# Glossary\n\n${Object.keys(VOCABULARY).map((t) => `**${t}**\ndefined.\n`).join("\n")}`;
  const root = await corpus({
    "GLOSSARY.md": glossary,
    "START_HERE.md": "# Start\n\nNodeKit is domain-blank. Good luck finding out what that means.\n",
  });
  const result = await auditCopy(root, { files: ["START_HERE.md", "GLOSSARY.md"] });
  assert.equal(result.passed, false, "a reader with no pointer to the glossary is still stranded");
  assert.ok(result.findings.some((f) => f.kind === "no-glossary-pointer"));
  await rm(root, { recursive: true, force: true });
});

// False-positive guard: a term inside a command, path, or schema id is an identifier, not prose.
// An audit that cries wolf on real identifiers gets switched off, and then it protects nothing.
// @nodekit-verifies language.copy-audit#identifiers-not-flagged
test("the audit does not flag NodeKit terms that appear inside code, paths, or link targets", async () => {
  const glossary = `# Glossary\n\n${Object.keys(VOCABULARY).map((t) => `**${t}**\ndefined.\n`).join("\n")}`;
  const root = await corpus({
    "GLOSSARY.md": glossary,
    "START_HERE.md": [
      "# Start",
      "",
      "Run the command below. Definitions live in GLOSSARY.md.",
      "",
      "```bash",
      "node src/cli.mjs create app --brief 'domain-blank proof-carrying receipt'",
      "```",
      "",
      "See [the ledger](docs/EVOLUTION_LEDGER.md) and `src/lib/caseflow.mjs`.",
    ].join("\n"),
  });
  const result = await auditCopy(root, { files: ["START_HERE.md", "GLOSSARY.md"] });
  assert.equal(result.passed, true, `identifiers must not be flagged as prose: ${JSON.stringify(result.findings)}`);
  await rm(root, { recursive: true, force: true });
});
