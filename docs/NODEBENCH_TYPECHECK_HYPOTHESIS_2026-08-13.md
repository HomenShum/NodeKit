# NodeBenchAI `api` resolves to `never` — it is scale, not a poisoned module

Status: **RESOLVED as a diagnosis** 2026-08-13. The hypothesis below was recorded
before the measurement and is kept intact; the measurement that confirmed it is in
"The answer" at the end. There is no culprit module to find.

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

## The answer, measured 2026-08-13

The `fullApi` map at `backend/convex/_generated/api.d.ts:1555-3093` holds exactly
1,537 entries: 1,515 with quoted path keys (`"actions/foo": typeof actions_foo`)
and 22 with bare identifier keys (`agentOS: typeof agentOS`). Three probes, each a
freshly generated `ApiFromModules<{...}>` over a chosen subset, checked with
`type IsNever<X> = [X] extends [never] ? true : false`:

| probe | modules | `IsNever` |
|---|---:|---|
| the 1,515 quoted-key modules | 1,515 | **false** |
| the 22 bare-key modules | 22 | **false** |
| all of them together | 1,537 | **true** |

**Neither subset is `never`; their union is.** That is the signature of a type-level
complexity ceiling, not a bad module — there is nothing to blame, because every part
is individually fine. The 22 bare-key modules include `http`, `crons`, `router` and
`auth`, which were the obvious suspects; they are innocent, alone and as a group.

This also explains the silence of the bisect that had been running since the day
before. Its fallback, on finding *both* halves clean, is
`for (const cand of right) isNever([left[0], cand])` — one full `tsc` over the
module set per candidate, 758 candidates, roughly ten minutes each, logging only at
round boundaries it would never reach. About five days of compute, producing no
output, searching for a module that does not exist. It was stopped on the evidence
above rather than on suspicion.

## What to do about it

The fix is structural, and none of the obvious ones is "find the bad file":

1. Stop deriving the whole 1,537-module map inside the frontend's
   `tsconfig.app.json`. The web app calls a small fraction of these functions; it
   does not need every backend module instantiated to type them.
2. Split the Convex deployment's function surface so no single `ApiFromModules`
   instantiation carries 1,537 modules.
3. Emit a pre-expanded `api` type instead of deriving it at check time.

Option 1 is the smallest and should be measured first. **Do not claim any of these
works until `npx tsc -p tsconfig.app.json --noEmit` is re-run and its error count is
quoted against the 5,383 baseline.**

## Why this blocks a gate condition

Promotion condition 11 (tests and build green) cannot PASS for NodeBenchAI while
`tsc -p tsconfig.app.json` exits 2. It is tracked as a known blocker in the Wave 1
results, not as a Wave 1 defect, because Wave 1 does not fix.

Note that Wave 1 found a defect that outranks this one for user impact:
**every product route renders "Convex backend not configured" from a clean clone**
(`apps/web/src/main.tsx` builds the Convex client conditionally on `convexUrl`). A
stranger meets an error card, not the product. Fix that first.
