# Existing-product adoption field card

Use this lane when NodeKit enters a repository with a working product, interface, agent, data path,
or legacy implementation. The existing product is the first reference. External products and new
architectures may improve unresolved gaps; they may not silently erase working behavior.

## One named proof

Before editing, name one user job and one observation that proves it survived the migration.

```yaml
user_job: "one real job already attempted in this product"
baseline_revision: "immutable existing revision"
candidate_finish_line: "local | demo | deployed | production candidate"
parity_proof: "one complete baseline/candidate journey"
explicit_non_goals: []
```

## Inspect before replacing

Gather from source, Git history, tests, runtime receipts, and real user cases:

```yaml
active_behaviors: []
active_tools: []
events: []
commands_and_inline_entrypoints: []
data_and_identity_paths: []
primary_journeys: []
failure_and_recovery_states: []
inactive_stubs: []
owners: {}
test_bindings: {}
unmapped_active_capabilities: []
```

Do not proceed to retirement while `unmapped_active_capabilities` is non-empty. Do not promote an
inactive or false-success stub into a product promise.

## Freeze the boundary

- **Product:** user, job, artifact, exclusions, finish line.
- **State:** canonical owner, identity, persistence, conflict, reload, Undo or rollback.
- **Agent:** one engine, tools, events, entry points, allowed and prohibited effects.
- **Interface:** real existing route, labeled change regions, required states, out-of-scope neighbors.
- **Authority:** automatic reversible effects versus pre-action consequence gates.
- **Proof:** locked cases, exact viewports, degraded cases, deployment identity, live signal.

## Implement in place

```text
INSPECT -> INVENTORY -> BOUND -> MIGRATE ONE SLICE
        -> PROVE PARITY -> RETIRE DUPLICATES -> RECORD ONE LEARNING
```

- Keep one integration owner.
- Use existing components and maintained libraries before custom infrastructure.
- Keep Caseflow canonical; graphs and UI maps are projections.
- Route every canonical write through typed operations, exact versions, deterministic digests,
  receipts, conflict behavior, and Undo or rollback.
- Low-risk reversible work may continue after checkpoint. Destructive, external, identity, spend,
  legal, and authority-changing effects pause unless a standing grant covers the exact effect.

## Required knockout journey

Replay the same baseline and candidate job, then add:

```text
apply -> reload -> Undo/rollback -> reload
```

Cover empty, loading, populated, degraded, overflow, recovery, completion, unauthorized access,
concurrency, sustained state, mobile, console/network health, and exact deployment identity when the
claim reaches those layers.

Completion requires zero unowned active capabilities, zero unapproved behavior loss, one canonical
engine/store per declared boundary, honest limitations, and a documentation drift check. A green
fixture or debug surface cannot certify the shipping route.
