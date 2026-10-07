// A guided tour that points at the wrong line is worse than no tour: the reader trusts it, lands
// somewhere unrelated, and concludes the codebase is the thing that is confusing. So every step in
// .tours/ carries both a line number and the `pattern` it was anchored to, and this test asserts
// they still agree with the source.
//
// It fails the moment someone moves a function without regenerating the tours, which is the only
// point at which the mismatch is cheap to fix.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const toursDir = path.join(repoRoot, ".tours");
const tourFiles = readdirSync(toursDir).filter((name) => name.endsWith(".tour")).sort();

test("the repository ships the three tours the HUMAN-READY packet names", () => {
  assert.deepEqual(tourFiles, [
    "01-primary-user-flow.tour",
    "02-agent-execution.tour",
    "03-debug-and-recovery.tour",
  ]);
});

for (const name of tourFiles) {
  test(`${name} points at real files, real lines, and the code it claims`, () => {
    const tour = JSON.parse(readFileSync(path.join(toursDir, name), "utf8"));
    assert.ok(tour.title, "a tour needs a title");
    assert.ok(tour.steps.length > 0, "a tour with no steps is not a tour");

    for (const [index, step] of tour.steps.entries()) {
      const where = `${name} step ${index + 1} (${step.file}:${step.line})`;
      assert.ok(typeof step.file === "string" && step.file.length > 0, `${where}: missing file`);
      assert.ok(Number.isInteger(step.line) && step.line > 0, `${where}: missing line`);
      assert.ok(typeof step.pattern === "string" && step.pattern.length > 0, `${where}: missing pattern`);
      assert.ok(step.title && step.description, `${where}: a step without prose is a bookmark, not a tour step`);

      let source;
      try {
        source = readFileSync(path.join(repoRoot, step.file), "utf8");
      } catch {
        assert.fail(`${where}: file does not exist`);
      }
      const lines = source.split(/\r?\n/);
      assert.ok(step.line <= lines.length, `${where}: line is past the end of the file (${lines.length} lines)`);

      // The pattern is the durable anchor; the line number is a convenience. They must agree, and
      // the pattern must be unambiguous, or "regenerate the tours" has no single right answer.
      const matches = lines.reduce((all, text, i) => (new RegExp(step.pattern).test(text) ? [...all, i + 1] : all), []);
      assert.equal(
        matches.length,
        1,
        `${where}: pattern /${step.pattern}/ matched ${matches.length} lines (${matches.join(", ")}); it must match exactly one`,
      );
      assert.equal(matches[0], step.line, `${where}: the code moved to line ${matches[0]}; regenerate the tours`);
    }
  });
}
