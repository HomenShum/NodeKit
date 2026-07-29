# Behavior portability showcase

## One-line product

**Design systems preserve pixels. NodeKit preserves behavior.**

The concrete demo is smaller:

> Copy the interaction. Keep the behavior.

No new public layer is needed. NodeKit owns the contract, comparison, receipt, and adapter recipe.
Generated applications own whichever runtime executes the contract.

## The 90-second story

### 0–15 seconds — copy a real recipe

Take NodeRoom's segmented-control transition, authored as 120ms micro-feedback:

```css
transition: transform var(--duration-fast);
```

Copy it into NodeSlide. The code is valid and the token exists.

### 15–30 seconds — show the silent failure

```text
NodeRoom   --duration-fast = 120ms
NodeSlide  --duration-fast = 180ms
```

The copied interaction runs 50% slower. A screenshot of the final state looks identical, so an
end-state or video-only gate can miss the defect.

### 30–50 seconds — run NodeKit

```bash
nodekit motion compare ./nodeslide ./noderoom ./parity-studio
```

The real receipt returns `FAIL` and prints its denominator:

```text
3 repositories · 56 CSS files · 40 declarations · 13 token names · 3 conflicts
```

It also finds two conflicts the hand-picked token-file review missed: NodeRoom's design exports and
runtime CSS disagree about normal and slow durations.

### 50–70 seconds — copy semantics, not spelling

The reference record says the source behavior is **micro-feedback / 120ms**. The generated adapter
therefore emits:

```css
transition: transform var(--motion-quick);
```

Both products resolve `--motion-quick` to 120ms. Existing legacy uses keep their current behavior
through repository-specific aliases:

```css
/* NodeRoom */
--duration-fast: var(--motion-quick);

/* NodeSlide */
--duration-fast: var(--motion-base);
```

This is the product moment: the aliases differ because the old names meant different things. The
canonical semantics do not.

### 70–90 seconds — show the trust boundary

Open the receipt:

```text
static declarations observed
runtime not observed
DOM/trace not observed
video not reviewed
audience not validated
```

Then run the runtime fixture:

1. Trigger the real interaction.
2. Read `Element.getAnimations()` and `effect.getTiming().duration`.
3. Require intended, resolved, and runtime duration to agree.
4. Knock out the transition mechanism entirely.
5. Show that the final screenshot still matches while the runtime animation count falls to zero.

That is why deterministic instrumentation outranks video.

## Product architecture behind the demo

```text
ReferenceObservation
  resolved behavior: motion-quick / 120ms
        ↓
NodeKit semantic contract
        ↓
generated adapter recipe
        ↓
runtime implementation
        ↓
separate receipts
  static portability · runtime · DOM/trace · video · audience
```

Internally, Design DNA is the record format for the reference observation and rules. It is not a
second product. GSAP, Framer Motion, and Three.js remain optional generated-application adapters;
none is a NodeKit core dependency.

## What this showcase may claim

- NodeKit detects the measured CSS false friend and two within-repository disagreements.
- The receipt is bound to the exact CSS source set.
- Equivalent spellings normalize before comparison.
- Ready aliases preserve observed values.
- Value changes and unresolved authority conflicts stay review-only.
- Generated NodeKit applications already receive the five-rung vocabulary.

## What it may not claim yet

- The CSS receipt proves an animation ran.
- “Exactly one value moves.” The full scan disproved that simplification.
- The current comparator covers DTCG/design-token JSON.
- The runtime probe, mechanism-removal knockout, or audience study has shipped.
- Video can override runtime, reduced-motion, trust-surface, or performance failures.

The next increment is one runtime receipt and one adversarial fixture—not another named layer.
