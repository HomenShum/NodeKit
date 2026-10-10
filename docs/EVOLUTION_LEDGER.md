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

## Historical authorship and current measured scope

A maintainer must be able to read what an earlier author actually claimed without
turning it into a present-day guarantee. For example, an older scope-limited
frontend claim did not name a measured dimension. Adding a later interpretation
to that immutable record would rewrite its history (authored-contract revision).
Historical validity preserves authorship; it does not certify today's measured scope.

New records always use the current strict assumption schema. Supported and
scope-limited claims must name nonempty dimensions and cite evidence; the frozen
`nodekit.assumption.v1.pre-dimensions.schema.json` is never an admission contract.
There is no caller flag, id exception or legacy stamp that relaxes a new write.

An old unscoped claim is readable only when its exact original payload, full
introducing commit, continuous path lifecycle, original schema hash and ancestry
before the actual schema-tightening commit are verified. Shallow, missing, moved,
deleted/readded, malformed or changed provenance remains unknown and fails the
current dimension rule. Existing binding repair rules do not permit claim edits.

Verification, queries, documentation and graph proposals each consume one loaded
record snapshot and its computed verdict. A proven old claim is accompanied by
`authored-historical-unscoped`, its source/contract identity and
`currentDimensionsCertified: false`; this metadata does not alter the canonical
record. Queries expose failed inspection issues, while documentation and graph
projection refuse to generate successful output after failed inspection.

Historical unscoped claims are omitted from new current graph nodes and causal
edges. Existing derived interpretations and connected derived causal edges are
retired only through grounded DEPRECATE proposals, normal validation and normal
approval. Immutable source evidence remains available. No empty proposal is
reported as successful.

Later scope interpretations remain separate agent-proposed drafts. Their old
source attribution is not a future repair commit. Materiality remains OPEN until
a genuine permitted review route supplies its actual commit scope and proof.
A session directive is not a credential signature; canonical promotion and
replay protection remain unchanged.

A maintainer changing a workflow must use the genuine pre-action review path.
For example, this history-recovery repair includes
`.github/workflows/quality.yml`, so its whole range cannot close through deferred
review (workflow pre-action authority). The existing policy rejects any range
containing `.github/workflows/*` before considering an operator directive.
Even genuine in-range commits, command I/O, journey and rollback evidence plus
a content-bound session directive cannot override that exclusion. Keep
materiality OPEN, preserve the complete reviewed scope, and never split or
rebind a range to hide changed workflow or other material paths. An ordinary
source-review verdict is not canonical event approval or a credential signature.
