# Before: executable reference loop

Captured on 2026-07-28 after adding the acceptance specification but before implementing the
provider-neutral runtime.

```text
node --test test/reference-loop.test.mjs
```

Result: **RED**. Node failed with `ERR_MODULE_NOT_FOUND` for
`src/lib/reference-loop.mjs`, proving that the existing Atlas policy and design documentation did
not yet provide an executable `ReferenceObservation -> DesignRule -> ScoreReceipt` chain.
