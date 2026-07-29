# After: provider-neutral reference loop

Measured 2026-07-29 from `D:\VSCode Projects\node-platform-complete-discussions`.

## Focused contract

Command:

```text
node --test test/reference-loop.test.mjs
```

Result: 11/11 tests passed.

- Prohibited Mobbin payload shapes and image URLs are rejected with exit code 5 and no observation
  directory.
- Observation/rule content addressing detects both candidate and stored-observation mutation.
- Lossy JSON values are rejected, and JSON-equivalent key order deduplicates to canonical bytes.
- Fake evidence and unsigned `not-applicable` cannot pass; novel-by-intent requires an exact H2/H3
  signature, while an H2/H3 reject always rejects.
- Observation and rule identity stayed deterministic in 100/100 repeated builds.
- `NOT_RUN` and caller-forged `PASS` fail closed. A repo-pinned S2 test signer passes only when its
  Ed25519 receipt binds the exact sanitized observation, producer, expiry, and prohibited-material
  declarations.
- The committed standalone validators matched all four source schemas byte-for-byte.
- `observe -> rule -> score -> verify` completed as four CLI processes in 0.662 seconds.

## Authenticated Mobbin canary

- Provider: Mobbin remote MCP
- Operation: authenticated live inspection
- Flow: `Starting a presentation (Figma Slides)`
- Flow ID: `033bd9d8-9418-4c27-b9f5-9a2a072a0937`
- Source: `https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937`
- Checked at: `2026-07-29T01:04:17.055Z`
- Transport-level canary verdict: PASS
- Generic NodeKit release status: NOT_RUN until the adapter supplies a purpose-bound S2/S3
  detached signature

Only four derived facts were retained: screen count 3, the position 1 -> 2 relationship, the
position 2 -> 3 relationship, and the `Starting & Completing` category. Stored pixels, cached
source payloads, embeddings, RAG indexing, and training use are all false.

No screenshot, OCR, DOM snapshot, source payload, cache entry, embedding, or training material is
stored in this evidence packet.
