# Reference loop

NodeKit owns the provider-neutral contract for turning inspected reference facts into an
independently verifiable release decision. Consumers such as NodeSlide own their render and commit
receipts; adapters such as Mobbin only supply attributed, non-pixel observations.

The immutable chain is:

```text
ExternalReferenceRun
  -> ReferenceObservation
  -> DesignRule
  -> consumer candidate/render/commit receipt
  -> ReferenceScoreReceipt
  -> independent verification
```

Every record is content-addressed. Verification reopens each cited record and recomputes the
observation, rule, candidate, render-receipt, and score bindings. A caller cannot supply its own
verdict. Each scoring profile is an authoritative tracked manifest at
`reference/profiles/<profile>.json`; its ordered, unique rule IDs and digests must exactly match the
CLI request, candidate evaluations, stored rules, score receipt, and verifier replay. Profiles and
candidate evaluations are bounded to 500 rules.

The runtime records use `nodekit.reference-loop-observation/v1` and
`nodekit.reference-loop-design-rule/v1`. Those IDs are intentionally distinct from the aggregate
reference-corpus contracts `nodekit.reference-observation/v1` and `nodekit.design-rule/v1`.
Consumers must not substitute one shape for the other.

The tracked `reference/trust-policy.json` and selected profile manifest must both be unchanged from
the candidate's Git HEAD. Observations, rules, and external-run attestations live in the tracked
`reference/corpus/` tree and must also exist as exact unchanged bytes at that same candidate commit;
local or post-commit corpus injection fails closed. Their exact rule, observation, and external-run
digests are transitively bound through the candidate commit and score receipt. A Mobbin observation
must resolve to exactly one valid signed external run in that candidate tree; multiplicity is an
ambiguity failure, and deleting a committed run only from the worktree is also a failure. A human
exception is valid only when an Ed25519 H2 or H3 signature from that repo-pinned trust policy binds
the same candidate digest and accept/reject decision.

## CLI

```bash
nodekit reference observe --file observation.json --repo-root . --json
nodekit reference rule --file rule.json --repo-root . --json
# Review and commit reference/corpus/, reference/profiles/, and reference/trust-policy.json
# before creating the candidate receipt.
nodekit reference score \
  --candidate-receipt render-receipt.json \
  --rules rule_<digest> \
  --profile nodeslide \
  --repo-root . \
  --json
nodekit reference verify \
  --score .nodekit/references/scores/<digest>.json \
  --candidate-receipt render-receipt.json \
  --repo-root . \
  --json
nodekit reference status --provider mobbin --repo-root . --json
```

Example profile manifest:

```json
{
  "schemaVersion": "nodekit.reference-profile-manifest/v1",
  "profile": "nodeslide",
  "rules": [
    {
      "ruleId": "rule_<24 hex>",
      "ruleDigest": "<64 hex>"
    }
  ]
}
```

The same API is exported from `@homenshum/nodekit/reference-loop`.

## Mobbin boundary

Mobbin release evidence requires an authenticated live inspection plus an Ed25519 service
attestation. The repo-pinned `reference/trust-policy.json` must authorize the exact key, purpose,
producer tool, and producer version at assurance `S2` or `S3`. The signature binds provider,
operation, policy, exact source URL and remote object ID, checked/expiry times, nonce, producer,
observation and fact digests, and all prohibited-material booleans. A plain caller object containing
`status: "pass"` is not evidence.

A missing, expired, unsigned, failed, or `not-run` external run exits with code 5 and writes no
observation. External run receipts are immutable and content-addressed; status returns `pass` only
after reopening the linked observation and re-verifying the signature and every binding.

The durable record may contain only attributed atomic facts and source metadata. It rejects pixels,
screenshots, OCR, DOM snapshots, source payloads, caches, embeddings, RAG indexes, training use, and
equivalent nested aliases. This is a source-policy boundary, not a best-effort convention.

The authenticated MCP canary on 2026-07-29 inspected the Mobbin flow
[`Starting a presentation (Figma Slides)`](https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937).
The stored observation contains four facts only: one three-screen count, two ordered screen
relationships, and the `Starting & Completing` action category. No source pixels or payload were
stored. The MCP response did not include a NodeKit service signature, so this raw live canary is
recorded as transport-level evidence but does not independently make the generic core report
`pass`.

## Release semantics

- `pass`: every required rule is evaluated and satisfied, or a matching verified H2/H3 attestation
  authorizes the exact exception.
- `fail`: a rule is violated or a binding is stale or mutated.
- `incomplete`: required evidence was not observed.

The verifier is deterministic and fail-closed. A changed candidate commit, render receipt,
observation, rule, profile manifest, trust policy, external run, or score digest invalidates the
chain.
