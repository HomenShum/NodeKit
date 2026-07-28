# Motion token drift — measured, 2026-07-28

The council ranked `motion-token-harmonizer` first because it is the only proposed stage that is
already a *measured* defect rather than a capability gap. Here is the measurement. It is worse than
"three dialects."

## Inventory

| token | nodeslide | parity-studio | noderoom |
|---|---|---|---|
| `--duration-fastest` | 80ms | 80ms | — |
| `--duration-faster` | 120ms | 120ms | — |
| `--duration-fast` | **180ms** | **180ms** | **120ms** |
| `--duration-base` | 240ms | 240ms | — |
| `--duration-normal` | — | — | 220ms |
| `--duration-slow` | — | — | 380ms |
| `--motion-fast` | — | — | .12s |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.25, 1)` | same | — |
| `--ease-out-expo` | — | — | `cubic-bezier(.16,1,.3,1)` *and* `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-spring` | — | — | `cubic-bezier(0.32, 0.72, 0, 1)` |

`prefers-reduced-motion` is honored in all three (4 / 6 / 12 files), so the accessibility floor is
intact. The drift is in vocabulary, not in compliance.

## The three defects, in severity order

**1. `--duration-fast` is a false friend — same name, different meaning.**

    nodeslide / parity   --duration-fast: 180ms
    noderoom             --duration-fast: 120ms

And the collision closes the loop: noderoom's `--duration-fast` (120ms) is *exactly* nodeslide's
`--duration-faster` (120ms). So the same name means two things, and the same value has two names.

This is the worst available shape, because it fails silently in the one operation the design stack
is built to encourage: **copying a reviewed recipe between repos.** A recipe that reads correctly,
compiles, and passes review runs 33% faster or 50% slower than authored, and nothing reports it.
It is the token-level instance of the class this week keeps producing — *a name's presence is not
its meaning*.

**2. Two scales that do not map onto each other.** nodeslide/parity run a four-rung
fastest/faster/fast/base scale; noderoom runs a three-rung fast/normal/slow scale. There is no
value in common except the 120ms collision above. A canonical mapping must therefore be authored,
not derived — no mechanical rename can reconcile 4 rungs with 3.

**3. Two curves both called "ease out", and one curve spelled two ways.**
`--ease-out: cubic-bezier(0.2, 0.8, 0.25, 1)` and `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`
are materially different curves. Separately, `--ease-out-expo` is declared twice within noderoom
with different formatting of the same values — harmless today, but it means a textual diff of
token files reports a change where there is none, which is how a real change later gets waved
through.

## Proposed canonical scale

Semantics first, names second — the council's floor is "map each token to canonical *semantics*",
not "pick a winner."

| canonical | ms | meaning | absorbs |
|---|---|---|---|
| `--motion-instant` | 80 | state flip, no perceived travel | `--duration-fastest` |
| `--motion-quick` | 120 | micro-feedback, hover, focus | `--duration-faster`, noderoom `--duration-fast`, `--motion-fast` |
| `--motion-base` | 180 | standard enter/exit | nodeslide/parity `--duration-fast` |
| `--motion-considered` | 240 | modal, panel, route | `--duration-base` |
| `--motion-deliberate` | 380 | large surface, deliberate reveal | `--duration-slow` |

noderoom's 220ms `--duration-normal` maps to `--motion-considered` (240) — a 20ms change, the only
value that moves. Every other mapping is behavior-preserving.

Curves keep both, because both are real and used:
`--motion-ease-standard: cubic-bezier(0.2, 0.8, 0.25, 1)` ·
`--motion-ease-expressive: cubic-bezier(0.16, 1, 0.3, 1)` ·
`--motion-ease-spring: cubic-bezier(0.32, 0.72, 0, 1)`

## Migration rule (behavior-preserving)

Per the council floor — *"preserve existing behavior until migration"* — each repo gets aliases,
not replacements:

```css
/* noderoom */
--duration-fast: var(--motion-quick);      /* 120ms — unchanged */
--motion-fast:   var(--motion-quick);      /* was .12s — unchanged */
--duration-slow: var(--motion-deliberate); /* 380ms — unchanged */
--duration-normal: var(--motion-considered); /* 220ms -> 240ms, THE ONLY BEHAVIOR CHANGE */
```

The one changing value is called out rather than buried, so the diff carries its own disclosure.

## Gate this needs

A cross-repo check that fails when a motion token name resolves to different values in different
repositories. Without it this report describes a state, and the state re-drifts. Same argument as
every other gate this week: **`git branch -r --contains HEAD` beat a documented habit, and so will
this.**
