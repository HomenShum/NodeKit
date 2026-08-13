# NodeBenchAI `api` resolves to `never` — the hypothesis a bisect cannot reach

Status: **open**. Recorded 2026-08-13 so the reasoning survives the run that is
brute-forcing toward it.

## Measured, not assumed

- `npx tsc -p tsconfig.app.json --noEmit` exits 2 with **5,383 error lines** at HEAD;
  4,641 are `TS2339 Property 'domains' does not exist on type 'never'`. Re-measured
  during Wave 1 as `5383`, matching the earlier count.
- The 2-line probe `type X = ApiFromModules<typeof fullApi>` yields `never` over the
  full 1,537-module map. `imports resolved: 1537 / 1537` — nothing is missing.
- Regenerating codegen with convex 1.43.0 was **refuted as a fix** by measurement:
  5,383 → 5,378, `api` still `never`.
- The same machinery is **healthy on a single module** under the same tsconfig and
  TypeScript 5.5.4.

## The hypothesis the bisect will not name

A delta-debugging bisect assumes there is a poisoned module to find. If the real
cause is that `ApiFromModules` over 1,537 modules exceeds a TypeScript
instantiation-depth or union-size limit, then **every half passes on its own and
only the whole fails** — and a bisect over halves can never converge, because there
is no single culprit to isolate. It will either run forever or report a false
minimum.

That is consistent with everything measured so far: healthy at 1 module, `never` at
1,537, unaffected by codegen version, with all imports resolving.

## The one probe that decides it

Cheaper than continuing the bisect, and it distinguishes the two causes in a single
comparison:

1. Build a probe with the **first half** of the module map (~768 modules). Record
   `IsNever`.
2. Build a probe with the **second half**. Record `IsNever`.

- If exactly one half is `never` → there IS a poisoned module; bisect that half and
  the search is sound.
- If **neither half is `never` but the union is** → it is scale, not a module. The
  fix is then structural (split the api surface, raise the limit, or stop deriving
  the full map in the app's tsconfig), and no amount of bisecting will find a file
  to blame.

Record the result here either way. The measurement that kills a hypothesis is worth
more than the hypothesis.

## Why this blocks a gate condition

Promotion condition 11 (tests and build green) cannot PASS for NodeBenchAI while
`tsc -p tsconfig.app.json` exits 2. It is tracked as a known blocker in the Wave 1
results, not as a Wave 1 defect, because Wave 1 does not fix.

Note that Wave 1 found a defect that outranks this one for user impact:
**every product route renders "Convex backend not configured" from a clean clone**
(`apps/web/src/main.tsx` builds the Convex client conditionally on `convexUrl`). A
stranger meets an error card, not the product. Fix that first.
