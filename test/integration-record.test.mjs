// The catch this exists to repeat: a primitive that training memory was confident about had been
// deprecated. Docs caught it. Introspection then caught something docs could not — what the
// installed version actually exposes.

import assert from "node:assert/strict";
import test from "node:test";
import { DOCS_TTL_MS, evaluateIntegrationRecord, parseIntegrationRecord } from "../src/lib/integration-record.mjs";

const NOW = Date.parse("2026-08-02T15:00:00.000Z");

const record = (overrides = "") => `library: assistant-ui
resolvedVersion: "0.15.1"
docsSource: "context7 /assistant-ui/assistant-ui"
docsCheckedAt: "2026-08-02"
deprecationsFound:
  - "makeAssistantToolUI -> makeAssistantDataUI"
introspection: "dir(RunController) -> add_data, add_source, append_reasoning"
frameworkVsProtocol:
  advertisedPath: "LangGraph template"
  adopted: "protocol-only"
  rationale: "SSE underneath; a graph is not needed for one planning call"
${overrides}`;

test("a complete record parses, and pins the version it was taken against", () => {
  const doc = parseIntegrationRecord(record());
  assert.equal(doc.resolvedVersion, "0.15.1");
  assert.equal(evaluateIntegrationRecord(doc, { installedVersion: "0.15.1", now: NOW }).passed, true);
});

test("a record describing a version nobody runs is a record of the last integration", () => {
  const verdict = evaluateIntegrationRecord(parseIntegrationRecord(record()), { installedVersion: "0.16.0", now: NOW });
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /nobody is running/);
});

test("stale docs are flagged, because deprecations land between releases", () => {
  const old = record().replace('docsCheckedAt: "2026-08-02"', 'docsCheckedAt: "2026-01-02"');
  const verdict = evaluateIntegrationRecord(parseIntegrationRecord(old), { installedVersion: "0.15.1", now: NOW });
  assert.equal(verdict.passed, false);
  assert.match(verdict.faults.join(" "), /days ago/);
  assert.ok(DOCS_TTL_MS > 0);
});

test("the record refuses to omit the questions that did the work", () => {
  const cases = [
    { doc: record().replace(/deprecationsFound:\n  - .*\n/, ""), pattern: /deprecationsFound/ },
    { doc: record().replace(/frameworkVsProtocol:[\s\S]*$/, ""), pattern: /frameworkVsProtocol answer/ },
    { doc: record().replace('  rationale: "SSE underneath; a graph is not needed for one planning call"\n', ""), pattern: /needs rationale/ },
    { doc: record().replace(/introspection: .*\n/, ""), pattern: /needs a non-empty introspection/ },
    { doc: record().replace('docsCheckedAt: "2026-08-02"', 'docsCheckedAt: "whenever"'), pattern: /must be a date/ },
  ];
  for (const { doc, pattern } of cases) {
    assert.throws(() => parseIntegrationRecord(doc), pattern, doc.slice(0, 80));
  }

  // An empty deprecations list is a real answer — it claims somebody looked and found none.
  const none = record().replace(/deprecationsFound:\n  - .*\n/, "deprecationsFound: []\n");
  assert.deepEqual(parseIntegrationRecord(none).deprecationsFound, []);
});
