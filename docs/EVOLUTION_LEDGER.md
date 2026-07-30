# NodeKit Evolution Ledger

The Evolution Ledger records why material NodeKit guarantees exist. It is an institutional reasoning system, not a feature changelog.

```text
Observed limitation
-> evidence
-> assumption disproven or scope-limited
-> architectural response
-> invariant
-> verifier
-> adoption
-> later validation, drift, supersession, or invalidation
```

## Canonical records

- `nodekit.evolution-event/v1`
- `nodekit.assumption/v1`
- `nodekit.invariant-claim/v1`
- `nodekit.evolution-evidence/v1`
- `nodekit.evolution-adoption/v1`

Canonical JSON lives under `evolution/`. Markdown timelines and adoption maps are generated projections. Events are separated into product, architecture, and harness tracks while sharing evidence and causal links.

## Authority and verification

Agents may draft an interpretation. Canonical events require a named human reviewer. Records are immutable; later changes supersede rather than overwrite them.

Reversible changes may continue without an immediate approval interruption when they carry a proof-backed deferred-review receipt. This does not promote an agent proposal or claim that a human approved it. The receipt binds the exact commit range and all material files to:

- exact before and after live request/response evidence;
- an at-a-glance journey card explaining what changed for the larger intended human goal;
- screenshots or clips when a product UI changed, or a concrete reason when no UI surface exists;
- a rollback target at the exact baseline plus content-addressed rollback verification evidence; and
- a risk declaration that excludes destructive writes, credentials or authority, irreversible migrations, material spend, external communication, and legal or compliance commitments.

Those excluded effects still require the normal pre-action authority gate. Human review remains deferred, visible, and able to promote, reject, or request rollback later.

Changing the approval or trust architecture itself is detected from the changed paths and requires `--authority-directive <file>`. The directive is content-addressed and labeled `operator-directed-in-session`; it is not represented as a cryptographic canonical-event approval.

The deferred lane fails closed for workflow, credential, secret, migration, billing, payment, deploy, and publishing paths. Those surfaces cannot opt into this receipt.

Receipts from a different baseline remain visible as historical; only a receipt that claims the active baseline can pass or fail the current materiality decision.

`nodekit evolution verify` fails closed on missing commits, missing or hash-drifted evidence, unverified invariants, unsupported adoption claims, circular supersession, incomplete model identity, incomplete screenshot or benchmark identity, and possible secrets.

`nodekit evolution sync-graph` converts verified records into a Knowledge Evolution patch. It never mutates the canonical graph directly; normal validation and approval remain mandatory.

## Commands

```bash
nodekit evolution init
nodekit evolution draft --id <id> --track architecture --category runtime --challenge <text> --resolution <text>
nodekit evolution record --file evolution/drafts/<event>.json --approval evolution/approval-<event>.json
nodekit evolution verify
nodekit evolution query --invariant <id>
nodekit evolution diff --from <commit> --to <commit>
nodekit evolution defer-review --drafts evolution/drafts/<event>.json --from <baseline> --to <candidate> --rollback <baseline> --before-live evidence/before/live-io.json --after-live evidence/after/live-io.json --journey-card evidence/after/journey.md --rollback-verification evidence/after/rollback-test.log --ui-not-applicable "Package runtime only; no product UI route changed" [--authority-directive evidence/before/operator-directive.md]
nodekit evolution build-docs
nodekit evolution sync-graph
```

Material changes include user workflow, public contracts, architectural ownership, security or authority, proof requirements, model routing, harness behavior, benchmark conclusions, and downstream guarantees. Routine formatting and dependency churn remain ordinary changelog entries.
