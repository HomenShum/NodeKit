# NodeKit risk-derived governance graph

NodeKit classifies effects and proof state, then projects the result as a disposable graph. Caseflow
remains canonical. The graph cannot create authority and the builder cannot set its own mode.

## Four modes

| Mode | Engineering | Protected promotion |
| --- | --- | --- |
| `AUTO_CONTINUE` | Continue through candidate and evidence production | Not authorized |
| `AUTO_PROMOTE_WITH_ROLLBACK` | Continue | Allowed only by a standing policy, verified rollback, observation checks, and NodeProof |
| `DEFERRED_HUMAN_REVIEW` | Continue through showcase-ready evidence | Human decides at the specified promotion boundary |
| `PRE_ACTION_HUMAN_GATE` | Isolated engineering may continue | Stop before destructive, authority, migration, spend, external, legal, or irreversible effects |

Architecture is an input fact, not a risk category. A package boundary or schema file does not
create a human gate by itself.

## Typed receipts

- `nodekit.governance-risk-assessment/v1`
- `nodekit.change-evidence-pack/v1`
- `nodekit.rollback-receipt/v1`
- `nodekit.promotion-readiness-receipt/v1`
- `nodekit.human-feedback-event/v1`

Human feedback is bound to an exact candidate and evidence pack. A preference remains scoped and
expiring; it does not become a universal policy automatically.

## Visualize the PR #32 governance fixture

```powershell
node src/cli.mjs governance visualize --scenario pr32 --out .tmp/governance-graph.html
```

The command writes an HTML explanation and an adjacent JSON receipt bundle. The HTML cites atomic
Mobbin-derived reference observations stored under `design-dna/observations/`; no third-party
pixels are stored.

## Rollback adapter

`runRollbackAdapter` is dependency-injected. It observes the target, calls the target-specific
rollback operation only after an unhealthy result, and independently verifies restoration. The
receipt fails closed when the target is not applied or verification is malformed.

The adapter contract does not grant production authority. The caller must present a risk
assessment whose mode and standing policy permit the protected action.
