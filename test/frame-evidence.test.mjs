// "Do not optimise a demo clip by watching the final MP4." A human or a vision model looking at
// finished output is the weakest instrument available and the first one everybody reaches for.
// These are the checks that run before any of that, and the load-bearing one is mislabelling: a
// generated mockup shown as the running product is the easy mistake, because it looks better.

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFrameEvidence, formatFrameEvidence, parseFrameSet } from "../src/lib/frame-evidence.mjs";

const hash = (c) => c.repeat(64);
const live = (over = {}) => ({
  frameId: "f-live-1",
  kind: "LIVE_PRODUCT",
  presentedAs: "LIVE_PRODUCT",
  sha256: hash("a"),
  bindings: {
    deploymentRevision: "abc1234",
    browserTraceId: "trace-9",
    journeyState: "populated",
    screenshotSha256: hash("a"),
  },
  ...over,
});
// What each kind must carry to be complete, so a test about mislabelling is not accidentally also
// a test about missing evidence.
const evidenceFor = (kind) => ({
  MOTION_GRAPHIC: { composition: { sourceRef: "remotion:HeroTitle" } },
  SOURCE_MEDIA: { origin: { originRef: "camera:clip-04", rights: "owned by creator" } },
  STOCK_MEDIA: { origin: { originRef: "pond5:123", licenseId: "PD5-EXT-9912" } },
  TEXT_OR_DIAGRAM: {},
  GENERATED_ILLUSTRATION: {},
}[kind] ?? {});

const generated = (over = {}) => ({
  frameId: "f-gen-1",
  kind: "GENERATED_ILLUSTRATION",
  presentedAs: "GENERATED_ILLUSTRATION",
  sha256: hash("b"),
  provenance: { provider: "local", model: "sdxl", prompt: "a calm dashboard", inputAssets: [] },
  ...over,
});

test("a bound live frame and a labelled generated frame pass together", () => {
  const verdict = evaluateFrameEvidence([live(), generated()]);
  assert.equal(verdict.passed, true, formatFrameEvidence(verdict));
  assert.equal(verdict.liveProduct, 1);
  assert.equal(verdict.generated, 1);
});

test("no made frame of any kind may be presented as the running product", () => {
  // The spec has six source kinds. A two-value enum forced motion graphics and stock into
  // "generated", which then demanded a model and prompt they never had — and escaping that demand
  // by labelling them LIVE_PRODUCT was the loophole. Every non-live kind is checked.
  for (const kind of ["GENERATED_ILLUSTRATION", "MOTION_GRAPHIC", "SOURCE_MEDIA", "STOCK_MEDIA", "TEXT_OR_DIAGRAM"]) {
    const verdict = evaluateFrameEvidence([generated({ kind, presentedAs: "LIVE_PRODUCT", ...evidenceFor(kind) })]);
    assert.equal(verdict.passed, false, kind);
    assert.match(verdict.blockers.join(" "), /presented as the running application/, kind);
  }
});

test("each kind owes different evidence, and is not asked for evidence it never had", () => {
  // A motion graphic has no provider or prompt. Demanding one is a false positive, and a noisy gate
  // is a disabled gate.
  for (const kind of ["MOTION_GRAPHIC", "SOURCE_MEDIA", "STOCK_MEDIA", "TEXT_OR_DIAGRAM"]) {
    const verdict = evaluateFrameEvidence([generated({ kind, presentedAs: kind, provenance: undefined, ...evidenceFor(kind) })]);
    assert.equal(verdict.passed, true, `${kind} was asked for evidence it does not owe: ${verdict.blockers.join("; ")}`);
  }

  // But each still owes its own. A stock clip without a licence is the whole basis for using it.
  const noLicence = evaluateFrameEvidence([generated({ kind: "STOCK_MEDIA", presentedAs: "STOCK_MEDIA", provenance: undefined, origin: { originRef: "pond5:123" } })]);
  assert.equal(noLicence.passed, false);
  assert.match(noLicence.blockers.join(" "), /licenseId/);

  const noSource = evaluateFrameEvidence([generated({ kind: "MOTION_GRAPHIC", presentedAs: "MOTION_GRAPHIC", provenance: undefined })]);
  assert.equal(noSource.passed, false);
  assert.match(noSource.blockers.join(" "), /sourceRef/);
});

test("a live frame missing any binding is unbound, and each missing one is named", () => {
  for (const missing of ["deploymentRevision", "browserTraceId", "journeyState", "screenshotSha256"]) {
    const bindings = { ...live().bindings };
    delete bindings[missing];
    const verdict = evaluateFrameEvidence([live({ bindings })]);
    assert.equal(verdict.passed, false, missing);
    assert.match(verdict.blockers.join(" "), new RegExp(missing), missing);
  }
});

test("a screenshot hash that does not match the frame's own hash is not a binding", () => {
  // The subtle one: every field present, and the binding points at a different image.
  const verdict = evaluateFrameEvidence([live({ bindings: { ...live().bindings, screenshotSha256: hash("c") } })]);
  assert.equal(verdict.passed, false);
  assert.match(verdict.blockers.join(" "), /does not match the frame's own hash/);
});

test("a generated frame without provenance cannot be audited later", () => {
  for (const missing of ["provider", "model", "prompt", "inputAssets"]) {
    const provenance = { ...generated().provenance };
    delete provenance[missing];
    const verdict = evaluateFrameEvidence([generated({ provenance })]);
    assert.equal(verdict.passed, false, missing);
    assert.match(verdict.blockers.join(" "), new RegExp(missing), missing);
  }
});

test("no frames is insufficient, not a pass", () => {
  const verdict = evaluateFrameEvidence([]);
  assert.equal(verdict.passed, false, "a check over zero frames measured nothing");
  assert.equal(verdict.insufficient, true);
  assert.match(formatFrameEvidence(verdict), /nothing was checked/);
});

test("a frame nobody hashed, or that does not say what it is presented as, is refused", () => {
  assert.throws(() => parseFrameSet([live({ sha256: "not-a-hash" })]), /needs its own sha256/);
  assert.throws(() => parseFrameSet([live({ presentedAs: undefined })]), /needs presentedAs/);
  assert.throws(() => parseFrameSet([live({ kind: "MOCKUP" })]), /kind must be one of/);
});
