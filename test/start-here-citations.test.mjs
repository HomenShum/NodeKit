// The onboarding pages cite source by file, symbol, and line. A guard that only checks the cited
// LINE NUMBER is in range proves anchor stability, never anchor correctness: it passes unchanged
// while the citation points at the wrong symbol, and it earns trust it has not established. That
// exact check shipped in five repositories in one wave, and a cold reader — not the guard — found
// every mis-anchored citation.
//
// So every citation carries the symbol it promises, and this asserts the CITED LINE CONTAINS IT.
// A line number with no symbol beside it is itself a failure: there would be nothing to check.
//
// Citation form, both documents:
//
//     `decideProposal` (line 289)                      file comes from the block's **File:** line
//     `createProject` (scaffold.mjs line 315)          basename picks one of several files
//     `decideProposal` (src/lib/caseflow.mjs line 289) full path, self-contained

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCUMENTS = ["START_HERE.md", "docs/START_HERE.md"];

const PATH_TOKEN = /^[\w.-]+(?:\/[\w.-]+)+\.(?:mjs|cjs|js|json|ts)$/u;
const CITATION = /`([^`\n]+)`\s*\(([^)]*?)\bline (\d+)\)/gu;
const LINE_MENTION = /\bline \d+\)/gu;

function blocksOf(markdown) {
  const blocks = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ") || blocks.length === 0) blocks.push([]);
    blocks[blocks.length - 1].push(line);
  }
  return blocks.map((lines) => lines.join("\n"));
}

// Backticked tokens that look like a repository path AND exist. Existence filtering is what makes
// `templates/base/agent/workflow.mjs` (real) beat `agent/workflow.mjs` (the name it takes inside a
// generated application) without the document having to say which is which.
function pathsIn(text) {
  return [...text.matchAll(/`([^`\n]+)`/gu)]
    .map((match) => match[1])
    .filter((token) => PATH_TOKEN.test(token) && existsSync(path.join(repoRoot, token)));
}

function resolveFile(qualifier, candidates, where) {
  const named = qualifier.trim().replace(/[,;]$/u, "");
  if (named) {
    if (existsSync(path.join(repoRoot, named)) && PATH_TOKEN.test(named)) return named;
    const byBasename = candidates.filter((file) => path.basename(file) === named);
    assert.equal(byBasename.length, 1, `${where}: "${named}" does not name one of ${candidates.join(", ") || "(no file cited in this section)"}`);
    return byBasename[0];
  }
  assert.equal(
    candidates.length,
    1,
    `${where}: which file? this section cites ${candidates.length} (${candidates.join(", ") || "none"}); name it as \`symbol\` (basename line N)`,
  );
  return candidates[0];
}

let checked = 0;

for (const document of DOCUMENTS) {
  test(`${document} cites symbols that are still on the lines it names`, () => {
    const markdown = readFileSync(path.join(repoRoot, document), "utf8");
    for (const block of blocksOf(markdown)) {
      const heading = block.split("\n", 1)[0].replace(/^#+\s*/u, "").trim() || "(preamble)";
      const fileLine = block.split("\n").find((line) => line.startsWith("**File:**"));
      const candidates = pathsIn(fileLine ?? "").length > 0 ? pathsIn(fileLine) : pathsIn(block);

      const citations = [...block.matchAll(CITATION)];
      const mentions = block.match(LINE_MENTION) ?? [];
      assert.equal(
        citations.length,
        mentions.length,
        `${document} — ${heading}: ${mentions.length - citations.length} line number(s) here name no symbol. A citation the guard cannot check is the defect this guard exists to catch.`,
      );

      for (const [, symbol, qualifier, lineText] of citations) {
        const where = `${document} — ${heading} — \`${symbol}\``;
        const file = resolveFile(qualifier, candidates, where);
        const lines = readFileSync(path.join(repoRoot, file), "utf8").split(/\r?\n/);
        const line = Number(lineText);
        assert.ok(line <= lines.length, `${where}: ${file} has ${lines.length} lines, so line ${line} does not exist`);
        assert.ok(
          lines[line - 1].includes(symbol),
          `${where}: ${file}:${line} says "${lines[line - 1].trim()}" — it does not contain "${symbol}". Either the code moved or the citation was always wrong; find the symbol and correct the line.`,
        );
        checked += 1;
      }
    }
  });
}

// A guard that parses nothing passes everything. Measured on this commit: 1 in START_HERE.md and
// 17 in docs/START_HERE.md.
test("the guard actually checked the citations, rather than parsing none of them", () => {
  assert.ok(checked >= 18, `only ${checked} citations were checked; the citation format changed and this guard stopped seeing them`);
});
