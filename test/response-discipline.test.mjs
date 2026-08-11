import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The response-discipline lineage (Cheiron take-home, 2026-08-10..11): a
// correct number under a wrong label misled a reader while every test was
// green. These tests pin that the practice is present AND wired — an
// orphaned practice doc is the same failure as an orphaned module.

const read = (p) => readFile(path.resolve(p), "utf8");

test("the launch skill carries the response discipline, human-situation first", async () => {
  const skill = await read("plugins/nodekit/skills/nodekit-launch/SKILL.md");
  assert.match(skill, /## Response discipline/);
  assert.match(skill, /human situation before the technical rule/i);
  assert.match(skill, /normal human language, then a concrete example, then the technical term/i);
  assert.match(skill, /Trace the completed work back to the request/i);
  assert.match(skill, /Never state a number you did not just produce/i);
});

test("both gate docs exist and keep their load-bearing sentences", async () => {
  const title = await read("docs/TITLE_SCOPE_IDENTITY.md");
  assert.match(title, /correct number under a wrong label is a wrong answer/i);
  assert.match(title, /composed from what the system ACTUALLY did/);
  assert.match(title, /Semantic identity is a hard condition/i);
  assert.match(title, /defect 78/i);

  const assertion = await read("docs/ASSERTION_DISCIPLINE.md");
  assert.match(assertion, /named version, a link that re-returns it, and a loud failure/i);
  assert.match(assertion, /Release drift refuses/i);
  assert.match(assertion, /chain is not a statement about its endpoints/i);
  assert.match(assertion, /Measurement/);
  assert.match(assertion, /Curated assertion/);
  assert.match(assertion, /Interaction telemetry/);
});

test("the gate docs are wired from the skill, not orphaned", async () => {
  const skill = await read("plugins/nodekit/skills/nodekit-launch/SKILL.md");
  assert.match(skill, /docs\/TITLE_SCOPE_IDENTITY\.md/);
  assert.match(skill, /docs\/ASSERTION_DISCIPLINE\.md/);
});

test("a scaffolded consumer project inherits the discipline", async () => {
  const consumerDoc = await read("templates/base/docs/RESPONSE_DISCIPLINE.md");
  assert.match(consumerDoc, /Normal human language first/i);
  assert.match(consumerDoc, /correct number under a wrong label is a wrong answer/i);
  assert.match(consumerDoc, /title must describe the exact search the\s+system actually ran/i);
  assert.match(consumerDoc, /never combine into a third statement nobody\s+made/i);

  const entry = await read("templates/base/AGENTS.md");
  assert.match(entry, /docs\/RESPONSE_DISCIPLINE\.md/);
});
