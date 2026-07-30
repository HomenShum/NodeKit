# Workspace reference index

`@homenshum/nodekit/workspace-reference-index` is a disposable, bounded lookup projection over
Caseflow-canonical native workspace, session, and checkpoint artifacts.

It may store only:

- `workspaceId` and `sessionId`;
- canonical artifact refs and digests;
- the latest checkpoint ref and digest; and
- `builtFromCaseflowDigest`, `builtAt`, and the deterministic `indexDigest`.

It may not store owner, provider identity, host, credential, generation, lifecycle status, resume
flags, or cursors. A cache hit is never evidence that a session may resume. Call
`session_resume` against canonical Caseflow state and trusted adapters for that decision.

The compiler bounds canonical input to 4,096 artifacts, output to 256 entries, serialized output
to 256 KiB, and concurrent disposable writes to 64. Malformed or authority-bearing state fails
closed. The index can always be deleted and rebuilt without losing application truth.
