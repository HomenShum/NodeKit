# Coding work with an explicit outcome

A builder gives a coding agent a product change and needs the next agent to know what was attempted and what remains unproved. For example, a sourcing packet may look correct until a second session loses the failed-sample record. Freeze that restart case before implementation and attach the resulting artifact when it is exercised (an outcome contract).

The outcome log preserves the intended result, exact version references, case assertions and locally observed artifact hashes so another person can inspect the work without reconstructing the conversation.

This document describes application bookkeeping. The canonical NodeKit launch skill still owns coding-agent behavior; Caseflow owns product transitions, NodeProof owns verification contracts, and the Evolution Ledger owns protected harness adoption. An outcome completion cannot approve a proposal, promote a harness, or authorize a release.

1. Read the repository entrypoint and research the real user's job. Pin current and candidate application revisions, generator revision and environment identity. If the candidate is uncommitted, use its exact tree/content digest and retain that snapshot.
2. Write an initialization JSON using the schema below. Name the smallest target, context sources, required cases, invariants and budgets. Include the motivating failure and restart/export cases. Map each invariant to at least one case; the utility does not infer that mapping.
3. Run `node scripts/outcome.mjs init outcome.json`. It creates `proof/outcome/events.jsonl` exclusively; an existing log is never replaced. Keep a separate project worktree for each frozen outcome/candidate so later code changes do not inherit an earlier case result.
4. Run the generated application's compile, check, demo, eval and relevant browser proof commands. Implement only the declared slice. Preserve authentic command output or exported artifacts inside the project.
5. Run `node scripts/outcome.mjs append case.json` for each attempt. Repeating a case preserves earlier attempts and makes the latest attempt authoritative for the local completion gate. Record failed or blocked cases honestly; a later failure supersedes an earlier pass.
6. Run `node scripts/outcome.mjs report` after a restart or handoff. It verifies the entire chain and renders `proof/outcome/report.txt` and `report.html` from the same in-memory log snapshot. Both contain the same terminal log hash.
7. Append a `complete` record only after all required latest cases pass with observed local artifact evidence. The utility re-reads those artifacts and rejects changed or missing bytes. Run the parent's named end-to-end proof after every dependent slice; a subtask's completion cannot close the parent.
8. Apply the existing independent review and authorized deployment policy separately. Record material harness lessons in the Evolution Ledger; do not reinterpret this local record as protected evaluation or promotion authority.

Example `outcome.json` (replace every version reference with an exact observed identity):

```json
{
  "schemaVersion": "app.coding-outcome/v1",
  "runId": "sourcing-packet-01",
  "userJob": "A maker compares attributed supplier terms and reopens the accepted packet.",
  "target": "Keep unavailable shipping costs unknown and preserve failed samples after restart.",
  "currentVersion": { "app": "BASELINE_COMMIT", "generator": "GENERATOR_COMMIT", "environment": "LOCKFILE_AND_RUNTIME_DIGEST" },
  "candidateVersion": { "app": "CANDIDATE_TREE_DIGEST", "generator": "GENERATOR_COMMIT", "environment": "LOCKFILE_AND_RUNTIME_DIGEST" },
  "context": { "scope": "Quote comparison and failed-sample revision", "sourceRefs": ["product/BRIEF.md@CONTENT_HASH"] },
  "cases": [
    { "id": "quote-terms", "description": "Missing shipping cost remains visibly unknown.", "required": true },
    { "id": "restart", "description": "A fresh session reopens the packet and failed sample evidence.", "required": true }
  ],
  "invariants": ["Supplier claims remain attributed; no ordering authority is inferred."],
  "budgets": { "timeMs": 3600000, "costUsd": 5, "attemptsPerCase": 3 }
}
```

An observed case record reads a nonempty project-local artifact and pins its exact bytes; the caller still supplies the status and measurements:

```json
{
  "type": "case",
  "caseId": "restart",
  "status": "passed",
  "summary": "A new process reopened the exported packet with the earlier failed sample.",
  "evidence": { "kind": "observed", "ref": "proof/restart-output.json" },
  "measurements": [{ "name": "reopened_samples", "value": 1, "unit": "count" }]
}
```

A claim without an artifact uses `"evidence": { "kind": "self-reported", "ref": "The agent believes the behavior works; not yet exercised." }`. It may be recorded, but cannot satisfy completion. `passed`, `failed`, and `blocked` are supported case statuses. Measurements are always labelled self-reported; the utility never invents measurements or claims to inspect the meaning of an artifact.

Decisions capture intent only:

```json
{ "type": "decision", "decision": "propose", "summary": "Request an independent review of the candidate; retain the current release." }
```

Decisions may be `continue`, `stop`, `propose`, or `reject`. They do not execute actions. The completion record is:

```json
{ "type": "complete", "summary": "Required local cases have passing artifact evidence; independent review and deployment remain separate." }
```

Use `--root PROJECT` to operate on another project; JSON input filenames are resolved from the current shell directory. Reports can be regenerated at any time without changing the log.

The log uses the existing `nodeagent.event/v1` envelope with application `outcome.*` event types. Its payload carries the previous content hash, record, optional artifact observation and deterministic sorted-key SHA-256. A single exclusive writer lock prevents concurrent agents from forking the chain. A busy writer returns an error; retry after it exits. After a crash, preserve the log and inspect the lock before an operator removes it. An incomplete line or damaged hash fails closed; the utility never repairs, truncates, or rewrites history.

Bounds: 32 KiB input, 1 MiB per observed artifact, 256 events with a reserved completion slot, 4 MiB log/report limits, 64 cases and a frozen per-case attempt cap. Time and cost budgets are declarations for the runner; this recorder neither runs commands nor meters spend. Paths must resolve inside the project, common credential files are refused, and artifact content is not embedded in reports. Do not submit secrets as summaries, source references or evidence.

The hash chain detects edits relative to retained history, not a malicious operator rewriting the entire chain or removing a valid tail. Preserve the reported terminal hash in a separately controlled review record when that threat matters. This tool supplies neither signatures nor independent verification. Reports describe what was recorded and observed at that time; they are not a claim that a source file or application is still unchanged later.

Proof command: `node --test test/outcome.test.mjs`. In the generator checkout, use `node --test templates/base/test/outcome.test.mjs`. This checks the utility; the consuming project's named user proof remains OPEN until independently exercised.
