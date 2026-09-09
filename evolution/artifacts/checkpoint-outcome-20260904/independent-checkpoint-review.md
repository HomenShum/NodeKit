# Local checkpoint review and its limits

A returning developer needs to recover a saved requirement without changing its identity. The reviewed checkpoint normalizes metadata, state and retry entries separately, so its wrapper does not consume the depth allowance of content already accepted by the runtime.

The operator's independent review of candidate53348d6 replayed37 focused checkpoint/conformance/outcome tests,24 adversarial checks and both typechecks. Those historical full review logs remain with the operator's recovery packet; this public folder contains the reproducible before/after observation and rendered outcome report, not those raw logs.

Public evidence available here:

- [Before API requests and responses](before-live-io.json): the baseline memory runtime accepts and exposes the artifact but has no checkpoint method.
- [After API requests and responses](after-live-io.json): an independent Node process imports actual serialized checkpoint bytes, matches the snapshot and retries with the same artifact identity.
- [Exact baseline rollback](rollback-verification.json): reverting the complete six-commit range in a separate clone restores the baseline Git tree.
- [Generated outcome report](outcome-report.html), [phone capture](outcome-report-390.png), [desktop capture](outcome-report-1440.png) and [render observations](outcome-rendered.json).

Run the public scenario files with `node --test test/caseflow-checkpoint.test.mjs test/caseflow.test.mjs test/caseflow-conformance.test.mjs templates/base/test/outcome.test.mjs` after installing the lockfile dependencies. These tests and local receipts do not confer human approval, a complete visual grade or production readiness. The broader factory gates remain unfulfilled, and inherited Evolution Ledger verification failures are tracked separately in PR39.
