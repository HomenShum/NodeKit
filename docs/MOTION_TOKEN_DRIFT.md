# Motion token portability — measured, 2026-07-28

Status: **productized as `nodekit motion compare`**. The command emits
`nodekit.motion-portability-receipt/v1`, binds the exact CSS source set, fails closed on incomplete
coverage, and never claims runtime evidence from a static scan.

## The public defect

| token | NodeSlide | parity-studio | NodeRoom |
|---|---:|---:|---:|
| `--duration-fastest` | 80ms | 80ms | — |
| `--duration-faster` | 120ms | 120ms | — |
| `--duration-fast` | **180ms** | **180ms** | **120ms** |
| `--duration-base` | 240ms | 240ms | — |
| `--duration-normal` | — | — | 200ms **and** 220ms |
| `--duration-slow` | — | — | 380ms **and** 400ms |
| `--motion-fast` | — | — | 120ms |
| `--motion-base` | — | — | 180ms |
| `--motion-slow` | — | — | 340ms |

`--duration-fast` is a false friend:

```text
NodeSlide / parity-studio   --duration-fast: 180ms
NodeRoom                    --duration-fast: 120ms
```

The collision closes the loop: NodeRoom's `--duration-fast` is exactly NodeSlide's
`--duration-faster`. The same name means two things, and the same value has two names.

A reviewed recipe copied by spelling still compiles, but it runs 33% faster in one direction or
50% slower in the other. Presence is not meaning.

This is currently a **portability hazard**, not evidence of an active NodeSlide component
regression. On the measured checkouts, NodeSlide defines the duration scale but has no CSS
`var(--duration-*)` consumers; NodeRoom has live consumers. The showcase deliberately demonstrates
the copy boundary rather than pretending an existing NodeSlide control is broken.

## What the shipped receipt observed

The 2026-07-28 three-repository run reported:

```text
MOTION PORTABILITY FAIL
3/3 repositories
56 CSS files
40 concrete motion declarations
13 distinct motion-token names
3 conflicts
```

The conflicts are:

1. Cross-repository `--duration-fast`: 180ms versus 120ms.
2. Inside NodeRoom, `--duration-normal`: the design exports say 200ms while shipped mobile CSS says
   220ms.
3. Inside NodeRoom, `--duration-slow`: the design exports say 400ms while shipped mobile CSS says
   380ms.

Normalization removes spelling noise before comparison: `.12s` equals `120ms`, and
`cubic-bezier(.16,1,.3,1)` equals `cubic-bezier(0.16, 1, 0.3, 1)`. A `var(...)` alias is counted in
the denominator but is not treated as an independent value claim.

## Canonical semantics

Names follow behavior, not relative adjectives:

| canonical token | value | meaning |
|---|---:|---|
| `--motion-instant` | 80ms | state flip with no perceived travel |
| `--motion-quick` | 120ms | micro-feedback such as hover or focus |
| `--motion-base` | 180ms | standard enter or exit |
| `--motion-considered` | 240ms | modal, panel, or route transition |
| `--motion-deliberate` | 380ms | large surface or deliberate reveal |

The two real curves remain distinct:

```css
--motion-ease-standard: cubic-bezier(0.2, 0.8, 0.25, 1);
--motion-ease-expressive: cubic-bezier(0.16, 1, 0.3, 1);
--motion-ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
```

Generated NodeKit applications already inherit this vocabulary from
`templates/base/apps/web/public/styles.css`.

## Migration truth

The first hand analysis said “exactly one value moves.” The complete CSS scan disproved that claim,
so the command does not repeat it.

The current receipt emits:

- 14 behavior-preserving aliases ready for review;
- one explicit value-change proposal, NodeRoom `--motion-slow` 340ms →
  `--motion-deliberate` 380ms;
- two blocked owner decisions for NodeRoom's 200/220ms and 380/400ms specification/runtime
  disagreements;
- one unmapped curve, `--ease-smooth`, which remains distinct instead of being silently collapsed.

The important contextual mapping is behavior-preserving:

```css
/* NodeSlide: "fast" meant standard enter/exit. */
--duration-fast: var(--motion-base);  /* 180ms stays 180ms */

/* NodeRoom: "fast" meant micro-feedback. */
--duration-fast: var(--motion-quick); /* 120ms stays 120ms */
```

A value-changing proposal is never emitted inside the ready alias block. It stays review-only until
an owner chooses the authoritative behavior.

## Proof boundary

This first receipt is authoritative only for **static CSS name/value conflicts** and whether a
generated alias preserves that observed value. It explicitly records:

```text
runtimeObserved: false
domOrTraceObserved: false
videoReviewed: false
audienceValidated: false
```

It therefore cannot say that an animation executed, that its computed duration matched the token,
that reduced motion reached the same final state, or that an audience found it useful.

There is also a known source-kind gap: NodeSlide's tracked
`src/domains/nodeslide/theme/app-tokens.json` declares a 120/180/340ms scale that disagrees with its
runtime CSS and appears unconsumed. The receipt says `comparison: css-motion-tokens`; it does not
smuggle that JSON record into a denominator it did not scan. DTCG/design-record ingestion is the
next contract-coverage increment.

The evidence order remains separate:

```text
static contract comparison  → token portability only
runtime instrumentation     → timing, order, state, performance
DOM + trace                  → structure and user flow
video review                 → advisory perception
audience study               → usefulness
```

No later layer may override a trust-surface violation, missing reduced motion, performance failure,
or failed knockout, and the receipts are never blended into one score.

## Reproduce

```bash
node src/cli.mjs motion compare \
  /path/to/nodeslide \
  /path/to/noderoom \
  /path/to/parity-studio \
  --output proof/motion-portability.json
```

The legacy entrypoint remains a wrapper over the same implementation:

```bash
node scripts/motion-token-drift-gate.mjs \
  /path/to/nodeslide \
  /path/to/noderoom \
  /path/to/parity-studio
```
