# Historical topology metadata acknowledgment

Read this after the repository HANDOFF.md. A maintainer preparing a developer handoff needs to account for one old metadata addition without rewriting the historical claim or calling an agent's repair human-reviewed.

The candidate retains the exact old assumption and signed event bytes. Its informational evidence names the original and editing commits, preserves both complete records, and binds the actual current-session directive. The verifier still reports one raw claim mutation, one acknowledgment and zero unresolved mutations. A visible warning states operator-directed-in-session assurance. No canonical event, verified invariant, detached signature or human-review claim was added.

Read journey.md for the actual before, tampering, repeated/concurrent use and recovery path. before-verifier.json and after-verifier.json are actual API outputs. original-record.json and acknowledged-record.json are exact Git record bytes. historical-records.json carries their canonical binding; operator-directive.md states the user's instruction and the agent's choice. source-bindings.json binds this uncommitted candidate separately from the earlier factory package.

Reproduce from the repository root with the installed local dependencies:

```powershell
node --test test/evolution-ledger.test.mjs test/evolution-immutability.test.mjs test/evolution-approval.test.mjs
npm test
npm run typecheck:public
npm run typecheck:component
npm run build:component
npm run evolution:verify
```

The retained relevant suites pass 32 tests. The full normal test command passes 857 repository tests and 8 component tests. Public/component typechecks, component build and the normal ledger command pass. All 45 generated component files stayed byte-identical. The package has no generic build script; logs/incorrect-build-command.log retains that command-selection failure. The first full-suite attempt rejected the stale behavior index; the existing generator corrected its moved owner line. Raw failures and successful logs are preserved in logs/. No dependency, lock, application UI or workflow change is part of this slice.

rollback-summary.json and rollback-verifier.json show restoration of 458 exact baseline runtime/schema/canonical files. The initial minimal export omitted one separately stored Postgres evidence artifact; that failure remains in the operator packet. Copying its exact previously bound bytes restored the baseline's sole historical-mutation failure. This proves restored baseline behavior, not a future committed-range git-revert receipt.

The agent-proposed draft currently identifies the observed baseline. deferred-review-preparation.json is deliberately not a receipt: after independent review and a real commit, use a draft bound to that actual material commit and the existing deferred review creator/verifier. Do not relabel the baseline as the repaired commit. Forbidden workflow changes still require the genuine canonical authority path. H1 credential control, signatures and final whole-PR approval remain open requirements.

The e7e4b10 factory and consumer receipts remain historical evidence for their exact package. This verifier patch changes current package source identity; no new factory, deployment, browser grade, paid provider call or host activation is claimed. UI applicability is N/A for this local governance patch, not a whole-product grade.
