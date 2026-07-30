# Native-agent session identity evidence

## Decision

Native workspace, session, and checkpoint state are canonical Caseflow artifacts. The previous
combined identity snapshot and continuation grant are rejected because they duplicated lifecycle
authority and let caller-owned status, generation, host, or credential concepts drift from the
evidence chain.

The public surface is exactly:

- `workspace_bind`
- `session_start`
- `session_checkpoint`
- `session_resume`
- `session_status`

The canonical schemas are:

- `nodekit.native-workspace/v1`
- `nodekit.native-agent-session/v1`
- `nodekit.native-session-checkpoint/v1`

`RESUMED` requires a lease, exact repository remeasurement, a trusted nonce-bound adapter receipt,
and a newly persisted checkpoint. Status is derived from Caseflow, leases, and NodeTrace.

## Decision evidence

Source thread:
`https://chatgpt.com/c/6a571625-3b68-83e8-ad1b-2ebe297528cc`

Reconciled response SHA-256:
`bb58f10cf8dfb88b7d366bb206d92127f9b573dbdeb502e3e7e9ddcbf8b2357b`

The decision also fixes the architecture boundary:

- Caseflow is canonical.
- The execution graph is compiled and disposable.
- NodeTrace records transitions.
- NodeProof verifies evidence chains.
- Stateless MCP tools never own durable continuation state.
- ActiveGraph is excluded from this release.

## Scenario evidence

Targeted native identity, Caseflow, public API, migration matrix, and CLI tests cover:

- trusted exact resume and the required new checkpoint;
- no caller-supplied owner;
- no raw provider identity outside the trusted adapter;
- no repository or provider substitution;
- CAS checkpoint frontiers;
- deterministic idempotency and deduplication;
- no partial session on invalid initial evidence;
- bounded time, reads, digest lists, and leases;
- 100 concurrent resumes across 10 sessions;
- a sustained 1,000-checkpoint chain;
- explicit migrated, workspace-only, not-resumable, rejected, deduplicated, and identity-conflict
  outcomes;
- tamper detection; and
- apply, verify, then recoverable legacy retirement.

## Reliability audit

- **BOUND:** canonical reads, artifact digest lists, migration files, records, and operational
  leases are bounded.
- **HONEST_STATUS:** blocked resume returns a typed blocked state; `RESUMED` is impossible before a
  new checkpoint is durable.
- **HONEST_SCORES:** the contract contains no score.
- **TIMEOUT:** repository, adapter, trace, and lease operations use an abortable budget capped at
  30 seconds.
- **SSRF:** the module performs no fetch; canonical remote values are measured by the trusted
  repository adapter.
- **BOUND_READ:** canonical artifact and migration-file reads have explicit limits.
- **ERROR_BOUNDARY:** external failures and invalid evidence fail closed without false success.
- **DETERMINISTIC:** canonical artifacts, IDs, migration bundles, and idempotency keys use
  sorted-key content hashes.

## Known limitations

- Provider adapters and repository measurement implementations require consumer-specific live
  proofs.
- Production deployments must supply their authenticated Caseflow runtime to the internal
  `importLegacySessionMigration` helper; the CLI and importer remain intentionally non-public.
- This draft Evolution interpretation requires separately verified named-human approval.
