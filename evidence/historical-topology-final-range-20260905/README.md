# Actual committed-range review packet

For the developer reviewing the local governance repair, commit 0c33b8a4ae3ef00d300d48456131f2aadbcc0d7c is independently reviewed and its exact rollback is exercised. Read journey.md, the source judgment and the before/after verifier outputs. The receipt is [evolution/deferred-reviews/deferred-review-sha256-7ead8e65b049e09e409f8e195817e0772b8d916d58be72c0108001b251ee27f7.json](../../evolution/deferred-reviews/deferred-review-sha256-7ead8e65b049e09e409f8e195817e0772b8d916d58be72c0108001b251ee27f7.json); it remains deferred human review and does not promote a canonical event.

The original source judgment and command output are exact bytes. Seven retained terminal logs contain historical whitespace; full staged diff checking reported those raw bytes, while authored code and metadata passed. No evidence was trimmed to manufacture a formatting pass. The older baseline-bound draft and all signed records remain unchanged.

receipt-input.json reproduces the existing createDeferredEvolutionReview call; receipt-api-output.json captures creation and verification. actual-range-rollback.json binds all 2,695 restored tracked files, the exact baseline tree and the expected original verifier failure. The retained rollback checkout is an operator-local diagnostic artifact, not a portable dependency or a production rollback claim.

Current package source differs from the earlier factory certificate. A fresh factory proof and separate whole-PR authority remain open. No new human approval, provider request, deployment or canonical promotion occurred.
