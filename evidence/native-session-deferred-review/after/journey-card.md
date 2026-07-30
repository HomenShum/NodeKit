# PR #30 journey proof: resume the correct coding-agent session after restart

Intended larger goal: a founder closes or loses the desktop process, returns later, and needs NodeKit to continue the exact authorized coding session without substituting the workspace, repository, provider session, or checkpoint frontier.

| Human question | Before (`391f1be`, main after PR #32) | After (PR #30 candidate) |
|---|---|---|
| Can NodeKit bind and resume a native coding session? | No. The exact package import returns `ERR_MODULE_NOT_FOUND`. | Yes. The exact workflow binds a workspace, starts a session, reports `CHECKPOINTED`, and returns `RESUMED`. |
| Is there durable proof of continuation? | No native continuation artifact exists. | Yes. Resume returns a content-addressed new checkpoint, and Caseflow contains workspace, session, initial checkpoint, and resumed checkpoint artifacts. |
| Can a raw provider session id leak into canonical state? | No governed native-session contract exists. | No. The live artifact scan reports `persistedRawProviderIdentity: false`. |
| Can caller-owned status become canonical truth? | No governed contract exists. | No. Status is derived; the live artifact scan reports `persistedCallerOwnedStatus: false`. |
| What happens if the operator dislikes the architecture? | There is no native-session feature to roll back. | Revert the exact range to `391f1be`; the rollback verifier proves the baseline returns to capability-absent behavior while retaining PR #32. |

## Exact evidence

- Before request/response: `evidence/native-session-deferred-review/before/live-io.json`
- After request/response: `evidence/native-session-deferred-review/after/live-io.json`
- Rollback verification: `evidence/native-session-deferred-review/after/rollback-verification.json`
- Hosted pre-change CI state: `evidence/native-session-deferred-review/before/pr-checks.json`

## UI media

Not applicable. PR #30 adds a package/runtime identity contract, schemas, migration support, and tests; it does not add or change a deployed product UI route. The journey and exact runtime I/O are the at-a-glance human proof surface.
