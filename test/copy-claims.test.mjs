import assert from "node:assert/strict";
import test from "node:test";
import { auditCopyClaims } from "../src/lib/copy-claims.mjs";

const SOURCE = "Estimated operating profit is $4,182 for the week. 2 of 214 transactions are unresolved. See https://example.com/brief for the source.";

// Persona: a salon owner reading a generated brief. Every hard failure below is a sentence that
// would make them believe something untrue about their own money or their own data.
// @nodekit-verifies inv:copy-claims-gate-lies-not-taste#fabrication-caught-against-source
test("fabricated entities are caught against the approved source", () => {
  const result = auditCopyClaims({
    text: "Estimated operating profit is $9,999 for the week. Details at https://not-real.example/report.",
    source: SOURCE,
    hasReceipt: true,
  });
  assert.equal(result.passed, false);
  const kinds = result.hardFailures.map((f) => f.kind);
  assert.ok(kinds.includes("fabrication"));
  // Both the invented figure and the invented URL must surface — one is a wrong number, the other
  // sends the reader somewhere that does not exist.
  assert.equal(result.hardFailures.filter((f) => f.kind === "fabrication").length, 2);
});

test("copy that reuses only source entities is not flagged as fabrication", () => {
  const result = auditCopyClaims({
    text: "Your estimated operating profit is $4,182. 2 of 214 transactions still need review.",
    source: SOURCE,
    hasReceipt: true,
  });
  assert.deepEqual(result.hardFailures, [], "restating source figures must not be a fabrication");
  assert.equal(result.passed, true);
});

// The four claim classes. Each is a different way for text to be false while the UI renders fine.
test("an unsupported capability claim is a hard failure", () => {
  const r = auditCopyClaims({ text: "Your data is protected with bank-level security.", source: "", hasReceipt: true });
  assert.equal(r.passed, false);
  assert.ok(r.hardFailures.some((f) => f.kind === "unsupported-claim"));
});

test("a completion claim with no receipt behind it is a hard failure", () => {
  const withoutReceipt = auditCopyClaims({ text: "Your weekly brief is complete.", source: "", hasReceipt: false });
  assert.ok(withoutReceipt.hardFailures.some((f) => f.kind === "false-status"));

  const withReceipt = auditCopyClaims({ text: "Your weekly brief is complete.", source: "", hasReceipt: true });
  assert.deepEqual(withReceipt.hardFailures, [], "a receipt makes the same sentence legitimate");
});

test("claiming a mutation the agent may not perform is a hard failure", () => {
  const proposalOnly = auditCopyClaims({ text: "We updated your accounting ledger.", source: "", hasReceipt: true, agentMayMutate: false });
  assert.ok(proposalOnly.hardFailures.some((f) => f.kind === "authority-error"));

  // The identical sentence is fine when the agent genuinely holds that authority.
  const allowed = auditCopyClaims({ text: "We updated your accounting ledger.", source: "", hasReceipt: true, agentMayMutate: true });
  assert.deepEqual(allowed.hardFailures, []);
});

test("a failure message with no next action is a hard failure", () => {
  const deadEnd = auditCopyClaims({ text: "Upload failed.", source: "", hasReceipt: true });
  assert.ok(deadEnd.hardFailures.some((f) => f.kind === "missing-recovery"));

  const recoverable = auditCopyClaims({ text: "Upload failed. Check the file format and try again.", source: "", hasReceipt: true });
  assert.deepEqual(recoverable.hardFailures, []);
});

// Regression: the first version listed bare nouns as recovery markers, so "Upload failed." matched
// "upload" — its own subject — as its own remedy, and stayed silent on the exact dead end it exists
// to catch. A word's presence is not its role, and recovery must FOLLOW the failure.
test("a noun inside the failure itself is not mistaken for its own remedy", () => {
  for (const deadEnd of ["Upload failed.", "Sync error.", "We could not open the file."]) {
    const r = auditCopyClaims({ text: deadEnd, source: "", hasReceipt: true });
    assert.ok(
      r.hardFailures.some((f) => f.kind === "missing-recovery"),
      `"${deadEnd}" names no next action and must fail`,
    );
  }
  // Recovery in its own sentence counts, wherever it sits — the reader still knows what to do.
  const separate = auditCopyClaims({ text: "Try again in a moment. The upload failed.", source: "", hasReceipt: true });
  assert.deepEqual(separate.hardFailures, [], "an action in its own sentence is genuine recovery");
});

// THE design property. Style must never be able to block, because a voice sample can require it.
// A checker that fails people for an em dash is one they route around, and then it stops catching
// the lies too.
// @nodekit-verifies inv:copy-claims-gate-lies-not-taste#style-never-blocks
test("style findings are reported but can never fail the gate", () => {
  const styled = auditCopyClaims({
    text: "Great question! Your brief — the whole thing — is ready 🚀 with “smart quotes”.",
    source: "",
    hasReceipt: true,
  });
  assert.equal(styled.passed, true, "style alone must not block");
  assert.deepEqual(styled.hardFailures, []);
  const kinds = styled.advisory.map((a) => a.kind);
  for (const expected of ["style:em-dash", "style:emoji", "style:curly-quote", "style:sycophancy"]) {
    assert.ok(kinds.includes(expected), `${expected} should be reported as advisory`);
  }
});

// Honesty about the limit of the check itself, rather than a silent pass.
test("without a source, fabrication is declared unchecked rather than silently passed", () => {
  const r = auditCopyClaims({ text: "Profit was $12,345.", hasReceipt: true });
  assert.equal(r.passed, true, "it cannot fail what it cannot check");
  assert.ok(r.advisory.some((a) => a.kind === "fabrication-unchecked"), "but it must SAY it did not check");
  assert.match(r.boundary, /cannot judge whether copy is GOOD/);
});

test("hard failures and advisory findings never share a bucket", () => {
  const r = auditCopyClaims({ text: "Upload failed — try again 🚀", source: "", hasReceipt: true });
  assert.deepEqual(r.hardFailures, [], "recovery is present, so nothing is hard");
  assert.ok(r.advisory.length >= 2);
  assert.ok(r.advisory.every((a) => a.kind.startsWith("style:") || a.kind === "fabrication-unchecked"));
});
