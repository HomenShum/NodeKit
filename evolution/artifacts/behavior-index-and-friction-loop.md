# Behavior index and the wired friction loop

Two capabilities that answer questions NodeKit could not answer, built by routing into machinery
that already existed rather than beside it.

## The behaviour-ownership gap

Receipts answer "did this artifact pass". The Evolution Ledger answers "why did the architecture
change". The generated repository map answers "which packages exist". Interaction flows answer
"which user steps exist". None of them answered: **which code owns this behaviour, which scenarios
define it, which tests prove it, and which part has no proof.**

`nodekit.behavior-index/v1` answers that, and it is GENERATED. A hand-maintained behaviour map rots
exactly like the documentation it replaces, and a rotted map is worse than none because it teaches a
false shape of the system. Three small sources: behaviour declarations in `nodekit.yaml` (an
existing contract, extended properly rather than carrying an undeclared key), `@nodekit-behavior
<id> owner|support` beside the owning symbol, and `@nodekit-verifies <id>#<scenario>` beside the
test that proves a scenario. Implementation state and verification state are derived, so nobody
keeps two status fields honest from memory.

Ownership resolves to a symbol rather than to a file, because a file-level pointer sends the reader
hunting and landing on the definition is the entire value.

It reports absence as loudly as presence. A declared behaviour nobody owns is `unmapped`. Partial
scenario coverage never reads as `verified`. Drift surfaces in both directions: code owning a
behaviour the contract does not declare, and a test proving a scenario the behaviour never declared.

## The friction loop

Observe, classify, propose, branch, test, compare, approve, record. The loop was named in the
roadmap and never connected. `src/lib/friction-loop.mjs` owns only the seam nothing else owned:
turning a recorded friction observation into ONE repair candidate the Builder Gym can judge.
Judging stays with `nodekit.builder-gym-verdict/v1`, the event log stays with
`nodekit.human-study-event/v1`, and the decision record stays with the Evolution Ledger. No new
schema family was added.

The property that makes it trustworthy is fail-closed adoption. A repair becomes adopted only by
presenting an independent gym verdict that authorized promotion for that repair. An agent may
propose. An agent may not approve its own repair.

One repair at a time is deliberate: a candidate that changes several things at once cannot be
attributed when the comparison moves, so the loop would learn nothing from its own result.
Comparison dimensions are fixed at proposal time so they cannot be chosen after seeing the result.

## Evidence

19 of 19 across four suites. The adversarial cases carry the weight:

- Six routes to self-approval are each tested and each stays blocked: no verdict at all; a non-gym
  object claiming authorization; a comparison in which the protected evaluator changed; one in which
  fixed inputs did not hold; a regressed outcome; and an adoption nobody can reference.
- A declared behaviour with no owner reports `unmapped` rather than being assumed present, and
  partial scenario coverage reports `partial` rather than `verified`.
- A regression found while building the index: the first scanner counted annotations that merely
  appeared inside string literals, so a fixture QUOTING an annotation registered as a real ownership
  claim. Annotations now count only in comments, with a test that fails if that returns. A map that
  treats quoted text as truth is how a map starts lying.
- A regression this work introduced and fixed: declaring behaviours in `nodekit.yaml` broke manifest
  validation because the repository schema sets `additionalProperties: false`. The contract now
  declares `behaviors` rather than the manifest carrying an undeclared key.

## Known limitations

- The index reports declared behaviours only. Four are declared. It does not claim the repository
  has no other behaviour, and an ownership annotation asserts ownership rather than proving it.
- The friction loop produces and gates repair candidates. It does not run the Builder Gym, and no
  repair has yet been carried through a real gym comparison end to end.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
