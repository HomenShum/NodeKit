# Ownership answerable for the repository, not a corner of it

The behaviour index covered four hand-declared behaviours. For everything else, "which code owns
this, and what proves it" was still unanswerable — the exact question the index existed to answer.

## Why the ledger is the right population

The Evolution Ledger already carries this repository's human-reviewed invariants, each naming the
files that verify it. Those ARE declared behaviour for the whole system: attested through the same
review path as every other material change, rather than invented for a map. Asking anyone to
re-declare the same statements in a second place would create a second thing to keep honest.

So the index covers them and reports coverage. The ledger keeps owning the statements.

## What was measured

Before annotating anything, with ledger coverage in place:

- **0 of 18** invariants owned by a named symbol
- **13** named a file only
- **5** were owned by nothing at all

After: **18 of 18** resolve to a definition.

Naming a file is not ownership. A file pointer sends the reader hunting through 2,581 lines of
`submission-gate.mjs`; landing on `evaluateSubmissionManifest` is the entire value. The index
distinguishes `annotated-symbol`, `named-file-only` and `unowned` rather than treating the middle
case as covered.

## Three defects in the tool, found by extending it

- The identifier pattern excluded colons, so every `inv:` annotation silently failed to match and
  read as absent. A map that cannot express the ids it is asked to cover reports a false zero.
- Ownership scanned only `src/`. Two invariants are enforced by the generated application's own
  certification script under `templates/base`, and both reported as unowned. That was the tool
  under-reporting, not the repository being negligent.
- A re-export barrel has no declaration to point at, and reporting `null` read identically to
  "the annotation found nothing". It now reports `(module exports)`, because a barrel's contract IS
  its export list.

## Ledger rot

An invariant naming a verifier file that no longer exists is a silent lie: the guarantee outlives
its proof. The index reports these. There are none today, and a test proves the detector fires.

The `#scenario` anchor is deliberately not treated as part of the path. The first version of the
check did treat it as one and reported a false positive — which would have trained readers to ignore
the signal, the failure mode that makes a rot detector worthless.

## Known limitations

- An ownership annotation ASSERTS that a symbol enforces an invariant. It does not prove it. The
  index reports claims and their absence; it cannot detect a claim that is simply wrong.
- The 18 invariants are the ledger's population, not every behaviour in the repository. Behaviour
  that was never material enough to earn an invariant is still uncovered.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
