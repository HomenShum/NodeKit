# Native agent workspace and session identity

NodeKit persists native-agent continuity in Caseflow. The graph is a compiled execution view; it
does not own session identity, resume authority, or lifecycle state.

```text
authenticated Caseflow owner
        |
        v
native workspace artifact
        |
        v
native agent session artifact
        |
        v
verified checkpoint chain -- trusted adapter receipt --> resume lease
        |                                                   |
        +---------------- new durable checkpoint <----------+
```

`RESUMED` is returned only after the exact repository is remeasured, the trusted adapter receipt is
verified, the operational lease is held, and a new canonical checkpoint is durable.

## Canonical artifacts

| Contract | Purpose |
|---|---|
| `nodekit.native-workspace/v1` | Authenticated owner, Caseflow case, exact repository, write authority, and trusted repository receipt |
| `nodekit.native-agent-session/v1` | Workspace-bound adapter identity and SHA-256 provider-session identity |
| `nodekit.native-session-checkpoint/v1` | CAS-ordered resume cursor, exact repository, evidence digests, NodeTrace digest, and trusted adapter receipt |

There is no combined session snapshot and no continuation grant. The canonical artifacts contain
no caller-supplied owner, raw provider session ID, agent label, generation, host, credential,
status, or resumable flag.

The raw provider session ID remains inside the trusted adapter's private store. NodeKit receives
only its hash and receipts bound to the operation nonce.

## Public operations

`@homenshum/nodekit/native-agent-identity` exposes exactly five workflow operations:

- `workspace_bind`
- `session_start`
- `session_checkpoint`
- `session_resume`
- `session_status`

`session_status` derives a view from the canonical checkpoint chain, operational lease, and
NodeTrace. It does not persist a caller-set status.

## Exact resume boundary

Resume fails closed when:

- the expected checkpoint is not the verified frontier;
- the workspace or repository has moved;
- the provider-session hash differs;
- the trusted receipt or operation nonce binding is invalid;
- the session or direct-worktree lease is busy;
- the adapter exceeds the bounded execution budget;
- a raw provider identifier crosses the adapter boundary; or
- a new checkpoint cannot be persisted.

`session_start` validates the initial checkpoint and repository before persisting a session, so
invalid adapter evidence cannot leave a partial canonical session. Repeated exact workspace binds
and provider-session starts deduplicate to the existing Caseflow artifacts.

## Legacy migration

Migration is an operator-only CLI, not a public session operation:

```bash
nodekit session migrate-legacy --mode dry-run --input legacy.json --json
nodekit session migrate-legacy --mode apply --input legacy.json --output bundle.json --json
nodekit session migrate-legacy --mode verify --output bundle.json --json
nodekit session migrate-legacy --mode retire \
  --input legacy.json \
  --output bundle.json \
  --rollback rollback/legacy.json \
  --confirm-bundle-digest <sha256> \
  --json
```

The matrix is explicit:

| Legacy evidence | Outcome |
|---|---|
| exact repository + provider hash + trusted receipts + checkpoint | `migrated`, resumable through the canonical API |
| repository/authority evidence but missing provider or checkpoint evidence | `workspace_only`, `HISTORY_ONLY` |
| grant/status data without workspace evidence | `not_resumable` |
| caller owner mismatch | `rejected`, `OWNER_MISMATCH` |
| provider hash reused across owner/workspace boundaries | `rejected`, `IDENTITY_CONFLICT` |
| exact duplicate input | `deduplicated` |
| same record ID with different bytes | `rejected`, `IDENTITY_CONFLICT` |

Apply writes a verified migration bundle and leaves the legacy source untouched. Retire requires
the exact verified bundle digest and moves the source to a distinct rollback path. No source is
deleted before recoverable rollback material exists. A deployment then calls the non-public
`importLegacySessionMigration` helper with an authenticated Caseflow runtime, the active migration
case/run, and the separately approved bundle digest. The importer verifies the bundle again,
checks owner/case authority and every workspace → session → checkpoint dependency, and writes the
three canonical artifact types idempotently. It returns a content-addressed import receipt.

## Relationship to the latest NodeKit architecture

- Caseflow owns durable canonical state.
- NodeTrace records workspace, session, checkpoint, blocked, paused, and resumed events.
- NodeProof may verify the resulting evidence chain but is not issued by this module.
- The stage-local execution graph remains disposable and may point at canonical artifact refs.
- A local workspace/session index may contain refs and digests only; a cache hit never authorizes
  resume.
- ActiveGraph is not part of this release boundary.

Decision source: the NodeKit ChatGPT thread,
`https://chatgpt.com/c/6a571625-3b68-83e8-ad1b-2ebe297528cc`.
The reconciled assistant response is fingerprinted as
`bb58f10cf8dfb88b7d366bb206d92127f9b573dbdeb502e3e7e9ddcbf8b2357b`.

## Scenario coverage

The scenario suite covers exact resume, authenticated owner rejection, raw-provider-ID rejection,
repository substitution, stale frontiers, provider substitution, receipt failure, bounded digest
lists, timeout without lease leakage, 100 concurrent resumes across 10 sessions, a sustained
1,000-checkpoint chain, idempotent workspace/session starts, and invalid initial evidence without
partial persistence.

The migration suite covers the full matrix, tampering, bounded file reads, apply, verify, and
recoverable retirement. These package tests do not claim that every NodeKit consumer has integrated
the contract or that the draft Evolution event has received named-human approval.
