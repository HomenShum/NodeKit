# After: close-the-loop release gates

Captured on 2026-07-28 from branch `codex/close-the-loop-finish`, after repairing the
generated-index and workflow assertions, the macOS clipboard-status race, and the test-lane
classification guard.

Targeted release-gate command:

```text
node --test test/behavior-index.test.mjs test/ci-workflows.test.mjs
```

Result: **13 passed, 0 failed**.

Motion portability command:

```text
node --test test/motion-portability.test.mjs
```

Result: **8 passed, 0 failed**.

Generated-map and lane-integrity command:

```text
node --test test/repo-map.test.mjs test/behavior-index.test.mjs test/test-files.test.mjs
```

Result: **16 passed, 0 failed**.

Default developer gate:

```text
npm test
```

Result:

- repository fast lane: **494 passed, 0 failed**
- component boundary: **8 passed, 0 failed**
- total wall time: **68.2 seconds**
- repository-lane duration reported by Node: **55.6 seconds**

Before the acceptance-volume files were explicitly classified, a clean default run exceeded eight
minutes and still had a long-running submission proof child. The complete acceptance work was not
removed: `npm run test:all`, the quality workflow, and the new lane-integrity test retain every
`*.test.mjs` file exactly once across the fast and slow lanes.
