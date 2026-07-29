# Before: close-the-loop release gates

Captured on 2026-07-28 from branch `codex/close-the-loop-finish`, before the gate repair.

Command:

```text
node --test test/behavior-index.test.mjs test/ci-workflows.test.mjs
```

Result: **11 passed, 2 failed**.

- `test/behavior-index.test.mjs` reported that `behavior-index.json` was stale after source line offsets changed.
- `test/ci-workflows.test.mjs` required the quality workflow to run `npm test`, although the workflow had intentionally moved the complete CI gate to `npm run test:all`.

The broader `npm run test:repository` baseline was also stopped after running for more than five minutes. That result motivated the fast local lane plus complete CI lane already present on this branch; this change only repairs the stale assertions and generated index so those lanes are enforceable.
