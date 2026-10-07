// From the NodeKit thread's local frame-measured demo loop, kept to the half that is portable.
//
// The rule it opens with is the whole point: do not optimise a clip by watching the final MP4. A
// human or a vision model looking at finished output is the weakest instrument available, and it is
// the one everybody reaches for first. Deterministic, bindable checks run before any model
// judgement, and a model's opinion never overturns a hard zero.
//
// The rule underneath: real product footage proves the product, everything else explains the idea.
// So exactly one kind may be presented as the running application, and it must bind to the exact
// deployment it was captured from. Anything else presented that way is a false claim about what the
// viewer is looking at — the demo equivalent of a fixture-origin number rendered as a measurement,
// and far easier to do by accident, because the made version usually looks better.
//
// Deliberately NOT here: OCR, CLIP ranking, VLM review, variant tournaments. Those need a runtime,
// a model, and a video pipeline; they belong to the app that owns the frames. This is the contract
// they would report against.

// Six kinds, because collapsing them breaks in both directions. A two-value enum forces a motion
// graphic to be "generated", which then demands a provider, model and prompt it never had — a false
// positive, and a noisy gate is a disabled gate. Escaping that by labelling it LIVE_PRODUCT is the
// loophole. Each kind owes different evidence, so each kind is its own value.
export const FRAME_KINDS = Object.freeze([
  "LIVE_PRODUCT",            // a capture of the real application
  "GENERATED_ILLUSTRATION",  // a model made it
  "MOTION_GRAPHIC",          // deterministic composition — Remotion, SVG, CSS
  "SOURCE_MEDIA",            // footage or documents the creator already had
  "STOCK_MEDIA",             // licensed third-party material
  "TEXT_OR_DIAGRAM",         // authored directly
]);

/** What each kind owes. The point is that they owe DIFFERENT things. */
const REQUIREMENTS = Object.freeze({
  LIVE_PRODUCT: { field: "bindings", keys: ["deploymentRevision", "browserTraceId", "journeyState", "screenshotSha256"], why: "a claim about the running application must name the exact deployment it was captured from" },
  GENERATED_ILLUSTRATION: { field: "provenance", keys: ["provider", "model", "prompt", "inputAssets"], why: "a model made this, and which model with what prompt is the only thing that makes it auditable later" },
  MOTION_GRAPHIC: { field: "composition", keys: ["sourceRef"], why: "deterministic composition is reproducible, so it owes the source that produced it — not a model it never used" },
  SOURCE_MEDIA: { field: "origin", keys: ["originRef", "rights"], why: "material the creator already had still needs to say where it came from and on what terms" },
  STOCK_MEDIA: { field: "origin", keys: ["originRef", "licenseId"], why: "licensed material owes its licence, which is the whole basis for using it" },
  TEXT_OR_DIAGRAM: { field: null, keys: [], why: "authored directly; being labelled is all it owes" },
});

export const LIVE_PRODUCT_BINDINGS = REQUIREMENTS.LIVE_PRODUCT.keys;
export const GENERATED_PROVENANCE = REQUIREMENTS.GENERATED_ILLUSTRATION.keys;

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
    const requirement = REQUIREMENTS[frame.kind];
    const missing = requirement.field
      ? requirement.keys.filter((key) => {
        const value = frame[requirement.field]?.[key];
        return key === "inputAssets" ? !Array.isArray(value) : !isNonEmptyString(value);
      })
      : [];

    if (missing.length > 0) {
      const detail = `${frame.frameId} (${frame.kind}) is missing ${requirement.field}.${missing.join(", ")} — ${requirement.why}`;
      if (frame.kind === "LIVE_PRODUCT") unbound.push(detail);
      else unprovenanced.push(detail);
    }

    if (frame.kind === "LIVE_PRODUCT") {
      const shot = frame.bindings?.screenshotSha256;
      if (shot && shot !== frame.sha256) {
        unbound.push(`${frame.frameId} (screenshotSha256 does not match the frame's own hash)`);
      }
    }

    // Generalised from "generated" to every non-live kind. A motion graphic or a stock clip
    // presented as the running application is the same false claim about what the viewer is seeing.
    if (frame.kind !== "LIVE_PRODUCT" && frame.presentedAs === "LIVE_PRODUCT") {
      mislabelled.push(`${frame.frameId} is ${frame.kind} but presented as the running application`);
    }
  }

  const blockers = [
    ...unbound.map((f) => `unbound live-product frame: ${f}`),
    ...mislabelled.map((f) => `mislabelled frame: ${f}`),
    ...unprovenanced.map((f) => `frame without its required evidence: ${f}`),
  ];

  return {
    // A frame set with nothing in it measured nothing, and must not read as a pass.
    passed: blockers.length === 0 && frames.length > 0,
    insufficient: frames.length === 0,
    blockers,
    checked: frames.length,
    liveProduct: frames.filter((f) => f.kind === "LIVE_PRODUCT").length,
    generated: frames.filter((f) => f.kind !== "LIVE_PRODUCT").length,
  };
}

export function formatFrameEvidence(verdict) {
  if (verdict.insufficient) return "FRAME EVIDENCE: no frames supplied — nothing was checked.";
  const head = `FRAME EVIDENCE ${verdict.passed ? "PASS" : "BLOCKED"}: `
    + `${verdict.checked} frame(s) — ${verdict.liveProduct} live-product, ${verdict.generated} generated.`;
  return verdict.passed ? head : [head, ...verdict.blockers.map((b) => `  ${b}`)].join("\n");
}
