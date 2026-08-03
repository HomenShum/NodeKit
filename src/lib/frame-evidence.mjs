// From the NodeKit thread's local frame-measured demo loop, kept to the half that is portable.
//
// The rule it opens with is the whole point: do not optimise a clip by watching the final MP4. A
// human or a vision model looking at finished output is the weakest instrument available, and it is
// the one everybody reaches for first. Deterministic, bindable checks run before any model
// judgement, and a model's opinion never overturns a hard zero.
//
// Two frame kinds, and conflating them is the fraud this exists to stop:
//
//   LIVE_PRODUCT   a frame of the real application. Must bind to the deployment revision, the
//                  browser trace, the journey state, and its own screenshot hash. Unbound: 0.
//   GENERATED      an illustration. Must carry provider, model, prompt and input assets, and must
//                  never be presented as the running product. Mislabelled: 0.
//
// A generated mockup shown as the shipped application is the demo equivalent of a fixture-origin
// number rendered as a measurement — and it is far easier to do by accident, because it looks
// better than the real thing.
//
// Deliberately NOT here: OCR, CLIP ranking, VLM review, variant tournaments. Those need a runtime,
// a model, and a video pipeline; they belong to the app that owns the frames. This is the contract
// they would report against.

export const FRAME_KINDS = Object.freeze(["LIVE_PRODUCT", "GENERATED"]);

/** Bindings a frame of the real product must carry. Absence of any one makes it unbound. */
export const LIVE_PRODUCT_BINDINGS = Object.freeze([
  "deploymentRevision",
  "browserTraceId",
  "journeyState",
  "screenshotSha256",
]);

/** Provenance a generated frame must carry, so it can never be mistaken for a capture. */
export const GENERATED_PROVENANCE = Object.freeze(["provider", "model", "prompt", "inputAssets"]);

const SHA256 = /^[0-9a-f]{64}$/;

function fail(message, code = "FRAME_EVIDENCE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

export function parseFrameSet(frames) {
  if (!Array.isArray(frames)) fail("frames must be a list");
  for (const [i, frame] of frames.entries()) {
    const at = `frames[${i}]`;
    if (!frame || typeof frame !== "object") fail(`${at} must be an object`);
    if (!FRAME_KINDS.includes(frame.kind)) fail(`${at} kind must be one of ${FRAME_KINDS.join(", ")}`);
    if (!isNonEmptyString(frame.frameId)) fail(`${at} needs a frameId`);
    if (!SHA256.test(frame.sha256 ?? "")) fail(`${at} needs its own sha256; a frame nobody hashed is not evidence`);
    // presentedAs is what the VIEWER is told this frame is. It is the field that makes the
    // mislabelling checkable at all — without it, a generated frame and a capture are just pixels.
    if (!FRAME_KINDS.includes(frame.presentedAs)) {
      fail(`${at} needs presentedAs (${FRAME_KINDS.join(" or ")}) — what the audience is told this frame is`);
    }
  }
  return frames;
}

/**
 * Hard zeros, computed rather than asserted. Returns counts alongside the verdict so a pass over an
 * empty frame set cannot read like a pass over a real one.
 */
export function evaluateFrameEvidence(frames) {
  parseFrameSet(frames);

  const unbound = [];
  const mislabelled = [];
  const unprovenanced = [];

  for (const frame of frames) {
    if (frame.kind === "LIVE_PRODUCT") {
      const missing = LIVE_PRODUCT_BINDINGS.filter((b) => !isNonEmptyString(frame.bindings?.[b]));
      if (missing.length > 0) unbound.push(`${frame.frameId} (missing ${missing.join(", ")})`);
      if (frame.bindings?.screenshotSha256 && frame.bindings.screenshotSha256 !== frame.sha256) {
        unbound.push(`${frame.frameId} (screenshotSha256 does not match the frame's own hash)`);
      }
    }
    if (frame.kind === "GENERATED") {
      const missing = GENERATED_PROVENANCE.filter((p) => {
        const value = frame.provenance?.[p];
        return p === "inputAssets" ? !Array.isArray(value) : !isNonEmptyString(value);
      });
      if (missing.length > 0) unprovenanced.push(`${frame.frameId} (missing ${missing.join(", ")})`);
      // The load-bearing one. A generated frame presented as the running product is a false claim
      // about what the viewer is looking at, and it is the easy mistake because it looks better.
      if (frame.presentedAs === "LIVE_PRODUCT") {
        mislabelled.push(`${frame.frameId} is generated but presented as the running application`);
      }
    }
  }

  const blockers = [
    ...unbound.map((f) => `unbound live-product frame: ${f}`),
    ...mislabelled.map((f) => `mislabelled frame: ${f}`),
    ...unprovenanced.map((f) => `generated frame without provenance: ${f}`),
  ];

  return {
    // A frame set with nothing in it measured nothing, and must not read as a pass.
    passed: blockers.length === 0 && frames.length > 0,
    insufficient: frames.length === 0,
    blockers,
    checked: frames.length,
    liveProduct: frames.filter((f) => f.kind === "LIVE_PRODUCT").length,
    generated: frames.filter((f) => f.kind === "GENERATED").length,
  };
}

export function formatFrameEvidence(verdict) {
  if (verdict.insufficient) return "FRAME EVIDENCE: no frames supplied — nothing was checked.";
  const head = `FRAME EVIDENCE ${verdict.passed ? "PASS" : "BLOCKED"}: `
    + `${verdict.checked} frame(s) — ${verdict.liveProduct} live-product, ${verdict.generated} generated.`;
  return verdict.passed ? head : [head, ...verdict.blockers.map((b) => `  ${b}`)].join("\n");
}
