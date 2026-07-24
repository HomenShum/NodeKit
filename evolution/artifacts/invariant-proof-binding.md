# A test filename is not proof

The behaviour index made ownership answerable: every ledger invariant resolves to a definition
rather than a filename. It did not do the same for verification. An annotation ASSERTS that a symbol
enforces an invariant; nothing bound that guarantee to the assertion that checks it.

The ledger's `verifierRefs` name test FILES. A file says "proof lives somewhere in here". It does
not say which assertion exercises the invariant, and a file keeps passing long after the assertion
that mattered was deleted or rewritten. That is the same weakness file-level ownership had, on the
other side of the chain.

## What changed

Verification is now reported with the same strictness as ownership:

- `annotated-test` — a test names the invariant and the scenario it proves.
- `named-test-file-only` — a verifierRef names a test file, but no test claims the invariant. The
  proof is gestured at, and this is NOT counted as verified.
- `unverified` — neither.

An invariant is **fully bound** only when a symbol owns it and a named assertion proves it.

## What was measured

With verification coverage in place, before binding anything: **19 of 19 owned, 0 of 19 proven.**
Every invariant's proof was a filename. After binding: **20 of 20 fully bound.**

## A wrong binding is worse than none

One binding was wrong on the first pass. `inv:caseflow-receipt-retry-containment` was attached to a
test about locale-independent ID ordering, which does not exercise retry containment at all. The
invariant would have reported as proven while nothing checked it — strictly worse than reporting the
gap, because it converts an open question into a false answer.

It now points at "case intake persists idempotently and multiple exceptions remain contained", which
is what the statement actually describes. Every other binding was chosen by reading the invariant
statement against the test body for the same reason.

## Known limitations

- A binding still asserts that a test exercises an invariant. The index checks that the claim
  EXISTS and is well-formed; it cannot prove the assertion actually covers the guarantee. Catching a
  wrong binding required reading the test, and it will again.
- Coverage is per invariant, not per clause. An invariant naming four properties is reported bound
  when one assertion claims it.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
